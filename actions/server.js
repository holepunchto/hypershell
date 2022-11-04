const fs = require('fs')
const os = require('os')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const PTY = require('tt-native')
const Protomux = require('protomux')
const c = require('compact-encoding')
const { SHELLDIR } = require('../constants.js')

const isWin = os.platform() === 'win32'
const shellFile = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash')
const EMPTY = Buffer.alloc(0)

module.exports = async function (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = options.firewall ? path.resolve(options.firewall) : path.join(SHELLDIR, 'firewall')

  if (!options.firewall && !fs.existsSync(firewall)) {
    console.log('Creating default firewall', firewall)
    fs.mkdirSync(path.dirname(firewall), { recursive: true })
    fs.writeFileSync(firewall, '', { flag: 'wx' })
  }

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')
  if (!fs.existsSync(firewall)) console.error('Warning: firewall file does not exists: ' + firewall)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const server = node.createServer({ firewall: onFirewall })
  goodbye(() => server.close(), 1)

  server.on('connection', onConnection)

  await server.listen(keyPair)

  console.log('To connect to this shell, on another computer run:')
  console.log('hypershell ' + keyPair.publicKey.toString('hex'))
  console.log()

  function onFirewall (remotePublicKey, remoteHandshakePayload) {
    const publicKeys = readAuthorizedKeys(firewall)

    for (const publicKey of publicKeys) {
      if (remotePublicKey.equals(publicKey)) {
        console.log('firewall allowed', remotePublicKey.toString('hex'))
        return false
      }
    }

    console.log('firewall denied', remotePublicKey.toString('hex'))
    return true
  }
}

function onConnection (socket) {
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-sh',
    id: Buffer.from('terminal'),
    handshake: cHandshake,
    onopen (handshake) {
      console.log('onopen', handshake)

      const pty = PTY.spawn(shellFile, null, {
        cwd: process.env.HOME,
        env: process.env,
        width: handshake.width,
        height: handshake.height
      })

      pty.on('data', function (data) {
        channel.messages[1].send(data)
      })

      pty.once('close', function () {
        channel.close()
      })

      this.userData = { pty }
    },
    messages: [
      { encoding: c.buffer, onmessage: onstdin }, // stdin
      { encoding: c.buffer }, // stdout
      { encoding: c.json /* cHandshake */, onmessage: onresize } // resize
    ],
    onclose () {
      console.log('onclose')

      if (this.userData) {
        const { pty } = this.userData
        pty.kill('SIGKILL')
      }
    }
  })

  channel.open({ width: 0, height: 0 })
}

function onstdin (data, channel) {
  const { pty } = channel.userData
  if (data === null) pty.write(EMPTY)
  else pty.write(data)
}

function onresize (data, channel) {
  const { pty } = channel.userData
  pty.resize(data.width, data.height)
}

function readAuthorizedKeys (firewall) {
  try {
    return fs.readFileSync(firewall, 'utf8')
      .split('\n')
      .map(line => line.match(/([a-zA-Z0-9]*)/i))
      .filter(m => m)
      .map(m => m[1])
      .map(v => Buffer.from(v, 'hex'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

const cHandshake = {
  preencode (state, p) {
    console.log('preencode', p)
    c.uint.preencode(state, p ? p.width : 0)
    c.uint.preencode(state, p ? p.height : 0)
  },
  encode (state, p) {
    console.log('encode', p)
    c.uint.encode(state, p ? p.width : 0)
    c.uint.encode(state, p ? p.height : 0)
  },
  decode (state) {
    console.log('decode', state)
    return {
      width: c.uint.decode(state),
      height: c.uint.decode(state)
    }
  }
}
