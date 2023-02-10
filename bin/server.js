#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { Command } = require('commander')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const Protomux = require('protomux')
const readFile = require('read-file-live')
const { SHELLDIR } = require('../constants.js')
const { waitForSocketTermination } = require('../lib/client-socket.js')
const { ShellServer } = require('../lib/shell.js')
const { UploadServer } = require('../lib/upload.js')
const { DownloadServer } = require('../lib/download.js')
const { LocalTunnelServer } = require('../lib/local-tunnel.js')
const configs = require('tiny-configs')
const keygen = require('./keygen.js')

const program = new Command()

program
  .description('Create a P2P shell server.')
  .option('-f <filename>', 'Filename of the server seed key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the server.')
  .option('--firewall <filename>', 'List of allowed public keys.', path.join(SHELLDIR, 'authorized_peers'))
  .option('--testnet', 'Use a local testnet.', false)
  .action(cmd)
  .parseAsync()

async function cmd (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = path.resolve(options.firewall)

  if (!fs.existsSync(keyfile)) {
    await keygen({ f: keyfile })
  }

  let allowed = readAuthorizedPeers(firewall)
  const unwatchFirewall = readFile(firewall, function (buf) {
    allowed = readAuthorizedPeers(buf)
  })
  goodbye(() => unwatchFirewall(), 3)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT({ bootstrap: options.testnet ? [{ host: '127.0.0.1', port: 40838 }] : undefined })
  goodbye(() => node.destroy(), 3)

  const server = node.createServer({ firewall: onFirewall })
  goodbye(() => server.close(), 2)

  server.on('connection', onconnection)

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

function onconnection (socket) {
  const node = this.dht

  socket.on('end', () => socket.end())
  socket.on('close', () => console.log('Connection closed', socket.remotePublicKey.toString('hex')))
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const unregisterSocket = goodbye(() => {
    socket.end()
    return waitForSocketTermination(socket)
  }, 1)
  socket.once('close', () => unregisterSocket())

  const mux = new Protomux(socket)

  mux.pair({ protocol: 'hypershell' }, function () {
    const shell = new ShellServer({ node, socket, mux })
    if (!shell.channel) return
    shell.open()
  })

  mux.pair({ protocol: 'hypershell-upload' }, function () {
    const upload = new UploadServer({ node, socket, mux })
    if (!upload.channel) return
    upload.open()
  })

  mux.pair({ protocol: 'hypershell-download' }, function () {
    const download = new DownloadServer({ node, socket, mux })
    if (!download.channel) return
    download.open()
  })

  mux.pair({ protocol: 'hypershell-tunnel-local' }, function () {
    const tunnel = new LocalTunnelServer({ node, socket, mux })
    if (!tunnel.channel) return
    tunnel.open()
  })
}

function readAuthorizedPeers (filename) {
  if (typeof filename === 'string' && !fs.existsSync(filename)) {
    console.log('Notice: creating default firewall', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <public key>\n', { flag: 'wx' })
  }

  try {
    const list = typeof filename === 'string' ? fs.readFileSync(filename, 'utf8') : filename
    return configs.parse(list)
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
