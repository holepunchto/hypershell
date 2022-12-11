const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const Protomux = require('protomux')
const readFile = require('read-file-live')
const { waitForSocketTermination } = require('../lib/client-socket.js')
const { ShellServer } = require('../lib/shell.js')
const { LocalTunnelServer } = require('../lib/local-tunnel.js')
const { UploadServer } = require('../lib/upload.js')
const { DownloadServer } = require('../lib/download.js')

module.exports = async function (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = path.resolve(options.firewall)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  let allowed = readAuthorizedPeers(firewall)
  const unwatchFirewall = readFile(firewall, function (buf) {
    allowed = readAuthorizedPeers(buf)
  })
  goodbye(() => unwatchFirewall(), 3)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 3)

  const server = node.createServer({ firewall: onFirewall })
  goodbye(() => server.close(), 2)

  server.on('connection', onConnection)

  await server.listen(keyPair)

  console.log('To connect to this shell, on another computer run:')
  console.log('hypershell ' + keyPair.publicKey.toString('hex'))
  console.log()

  function onFirewall (remotePublicKey, remoteHandshakePayload) {
    for (const publicKey of allowed) {
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
  const node = this.dht

  socket.on('close', () => console.log('Socket disconnect', socket.remotePublicKey.toString('hex')))
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const ungoodbye = goodbye(() => {
    socket.end()
    return waitForSocketTermination(socket)
  }, 1)
  socket.once('close', () => ungoodbye())

  const mux = new Protomux(socket)
  // + allow opening multiple protocols from the same socket?

  mux.pair({ protocol: 'hypershell', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell', id: null })) return console.log('Protocol (spawn) was already open')

    const shell = new ShellServer({ node, socket, mux })
    if (!shell.channel) return console.log('Protocol (spawn) could not been created')

    shell.open()
  })

  mux.pair({ protocol: 'hypershell-upload', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-upload', id: null })) return console.log('Protocol (upload) was already open')

    const upload = new UploadServer({ node, socket, mux })
    if (!upload.channel) return console.log('Protocol (upload) could not been created')

    upload.open()
  })

  mux.pair({ protocol: 'hypershell-download', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-download', id: null })) return console.log('Protocol (download) was already open')

    const download = new DownloadServer({ node, socket, mux })
    if (!download.channel) return console.log('Protocol (download) could not been created')

    download.open()
  })

  mux.pair({ protocol: 'hypershell-tunnel-local', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-tunnel-local', id: null })) return console.log('Protocol (tunnel-local) was already open')

    const tunnel = new LocalTunnelServer({ node, socket, mux })
    if (!tunnel.channel) return console.log('Protocol (tunnel-local) could not been created')

    tunnel.open({})
  })
}

function readAuthorizedPeers (filename) {
  if (typeof filename === 'string' && !fs.existsSync(filename)) {
    console.log('Notice: creating default firewall', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <public key>\n', { flag: 'wx' })
  }

  try {
    const list = typeof filename === 'string' ? fs.readFileSync(filename, 'utf8') : (filename || '').toString()
    return list
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
