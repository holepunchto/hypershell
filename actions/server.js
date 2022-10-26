const fs = require('fs')
const os = require('os')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const TTY = require('../tty/index.js')
const { shelldir, errorAndExit } = require('../util.js')

const isWin = os.platform() === 'win32'

module.exports = async function (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = options.firewall ? path.resolve(options.firewall) : path.join(shelldir, 'firewall')

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
  const pubkey = socket.remotePublicKey.toString('hex')
  console.log('connection', pubkey)

  socket.setKeepAlive(5000)

  socket.on('open', () => console.log('socket opened', pubkey))
  socket.on('close', () => console.log('socket closed', pubkey))
  socket.on('end', () => console.log('socket ended / wants to end', pubkey))
  // socket.on('end', () => socket.end())

  socket.on('error', function (error) {
    console.error(error.code, error)
  })

  const shell = new TTY({
    name: 'hypershell',
    columns: isWin ? 8000 : undefined,
    rows: isWin ? 2400 : undefined
  })
  shell.attach(socket)
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
