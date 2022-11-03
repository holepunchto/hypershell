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
const shellFile = isWin ? 'powershell.exe' : 'bash' // (process.env.SHELL || 'bash')

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
  // const pubkey = socket.remotePublicKey.toString('hex')
  // socket.once('open', () => console.log('socket opened', Date.now(), pubkey.substr(0, 6)))
  // socket.once('end', () => console.log('socket ended', Date.now()))
  // socket.once('close', () => console.log('socket closed', Date.now(), pubkey.substr(0, 6)))

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-sh',
    id: Buffer.from('terminal'),
    handshake: c.json,
    onopen (handshake) {
      console.log('terminal onopen', Date.now(), handshake)

      const pty = PTY.spawn(shellFile, null, {
        cwd: process.env.HOME,
        env: process.env,
        width: handshake.width, // isWin ? 8000 : 80, // columns
        height: handshake.height // isWin ? 2400 : 24, // rows
      })

      pty.on('data', onDataPTY)
      pty.once('close', () => channel.close()) // socket.destroy()

      this.userData = { pty, onDataPTY }

      function onDataPTY (data) {
        channel.messages[0].send(data)
      }
    },
    messages: [
      { encoding: c.raw, onmessage: onstdin },
      { encoding: c.json, onmessage: onresize }
    ],
    onclose () {
      console.log('terminal onclose', Date.now())

      if (this.userData) {
        const { pty, onDataPTY } = this.userData

        if (pty) {
          // pty.removeListener('data', onDataPTY)
          pty.kill('SIGKILL')
        }
      }
    },
    ondestroy () {
      console.log('terminal ondestroy', Date.now())
    }
  })

  channel.open({})

  socket.on('error', function (error) {
    console.error(error.code, error)
  })
}

function onstdin (data, channel) {
  const { pty } = channel.userData
  pty.write(data)
}

function onresize (data, channel) {
  console.log('onresize', data)
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
