const fs = require('fs')
const os = require('os')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const PTY = require('tt-native')
const Protomux = require('protomux')
const c = require('compact-encoding')
const { SHELLDIR } = require('../constants.js')
const m = require('../messages.js')

const isWin = os.platform() === 'win32'
const shellFile = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash')
const EMPTY = Buffer.alloc(0)

module.exports = async function (options = {}) {
  const keyfile = options.f ? path.resolve(options.f) : path.join(SHELLDIR, 'peer')

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

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
        console.log('Firewall allowed:', remotePublicKey.toString('hex'))
        return false
      }
    }

    console.log('Firewall denied:', remotePublicKey.toString('hex'))
    return true
  }
}

function onConnection (socket) {
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: m.handshake,
    onopen (handshake) {
      if (!handshake.spawn) {
        channel.close()
        return
      }

      let pty
      try {
        pty = PTY.spawn(handshake.spawn.file || shellFile, handshake.spawn.args, {
          cwd: process.env.HOME,
          env: process.env,
          width: handshake.spawn.width,
          height: handshake.spawn.height
        })
      } catch (error) {
        channel.messages[3].send(1)
        channel.messages[2].send(Buffer.from(error.toString() + '\n'))
        channel.close()
        return
      }

      pty.on('data', function (data) {
        channel.messages[1].send(data)
      })

      pty.once('exit', function (code) {
        channel.messages[3].send(code)
      })

      pty.once('close', function () {
        channel.close()
      })

      this.userData = { pty }
    },
    messages: [
      { encoding: c.buffer, onmessage: onstdin }, // stdin
      { encoding: c.buffer }, // stdout
      { encoding: c.buffer }, // stderr
      { encoding: c.uint }, // exit code
      { encoding: m.resize, onmessage: onresize } // resize
    ],
    onclose () {
      if (!this.userData) return

      const { pty } = this.userData
      if (pty) {
        try {
          pty.kill('SIGKILL')
        } catch {} // ignore "Process has exited"
      }
    }
  })

  channel.open({})
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
