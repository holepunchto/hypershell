const fs = require('fs')
const os = require('os')
const path = require('path')
const Keychain = require('keypear')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const PTY = require('tt-native')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')

const isWin = os.platform() === 'win32'
const shellFile = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash')
const EMPTY = Buffer.alloc(0)
const allowance = new Map()

module.exports = async function (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = path.resolve(options.firewall)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  readAuthorizedPeers(firewall)

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
    cleanupAllowance()

    for (const [publicKey] of allowance) {
      if (remotePublicKey.equals(Buffer.from(publicKey, 'hex'))) {
        console.log('Firewall allowance:', remotePublicKey.toString('hex'))
        allowance.delete(publicKey)
        return false
      }
    }

    for (const publicKey of readAuthorizedPeers(firewall)) {
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
    protocol: 'hypershell',
    id: null,
    handshake: m.handshake,
    onopen (handshake) {
      if (!handshake.spawn) {
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
      { encoding: m.resize, onmessage: onresize }, // resize
      { encoding: m.allowance, onmessage: onallowance }, // one time allowance (request)
      { encoding: m.buffer } // one time allowance (response)
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

function onallowance (data, channel) {
  cleanupAllowance()

  const token = Keychain.seed().subarray(0, 8)
  const seed = Buffer.alloc(32).fill(token, 0, token.length)
  const keyPair = DHT.keyPair(seed)
  allowance.set(keyPair.publicKey.toString('hex'), Date.now() + data.expiry)
  channel.messages[6].send(token)
}

function cleanupAllowance () {
  for (const [publicKey, expiry] of allowance) {
    if (expiry - Date.now() < 0) {
      allowance.delete(publicKey)
    }
  }
}

function readAuthorizedPeers (filename) {
  if (!fs.existsSync(filename)) {
    console.log('Notice: creating default firewall', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <public key>\n', { flag: 'wx' })
  }

  try {
    return fs.readFileSync(filename, 'utf8')
      .split('\n')
      .map(line => {
        line = line.replace(/\s+/g, ' ').trim()
        line = line.replace(/#.*$/, '').trim()
        return line
      })
      .filter(m => m)
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
