const fs = require('fs')
const path = require('path')
const DHT = require('hyperdht')
const goodbye = require('graceful-goodbye')
const { SHELLDIR } = require('../constants.js')
const configs = require('tiny-configs')

module.exports = {
  ClientSocket,
  waitForSocketTermination
}

function ClientSocket ({ keyfile, serverPublicKey, reusableSocket = false, testnet = false }) {
  serverPublicKey = parseNameOrPublicKey(serverPublicKey)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT({ bootstrap: testnet ? [{ host: '127.0.0.1', port: 40838 }] : undefined })
  const unregisterNode = goodbye(() => node.destroy(), 2)

  const socket = node.connect(serverPublicKey, { keyPair, reusableSocket })
  const unregisterSocket = goodbye(() => {
    socket.end()
    return waitForSocketTermination(socket)
  }, 1)

  socket.on('error', function (error) {
    if (error.code === 'ECONNRESET') console.error('Connection closed.')
    else if (error.code === 'ETIMEDOUT') console.error('Connection timed out.')
    else if (error.code === 'PEER_NOT_FOUND') console.error(error.message)
    else if (error.code === 'PEER_CONNECTION_FAILED') console.error(error.message, '(probably firewalled)')
    else console.error(error)

    process.exitCode = 1
  })

  socket.on('end', () => socket.end())
  socket.once('close', () => node.destroy())
  socket.once('close', () => unregisterNode())
  socket.once('close', () => unregisterSocket())

  socket.setKeepAlive(5000)

  return { node, socket }
}

function waitForSocketTermination (socket) {
  return new Promise((resolve) => {
    const isClosed = socket.rawStream._closed
    const isReadableEnded = socket.rawStream._readableState.ended
    const isWritableEnded = socket.rawStream._writableState.ended

    if (isClosed || (isReadableEnded && isWritableEnded)) {
      resolve()
      return
    }

    socket.on('end', onterm)
    socket.on('close', onterm)

    function onterm () {
      socket.removeListener('end', onterm)
      socket.removeListener('close', onterm)
      resolve()
    }
  })
}

function parseNameOrPublicKey (host) {
  for (const peer of readKnownPeers()) {
    if (peer.name === host) {
      host = peer.publicKey
      break
    }
  }

  return Buffer.from(host, 'hex')
}

function readKnownPeers () {
  const filename = path.join(SHELLDIR, 'known_peers')

  if (!fs.existsSync(filename)) {
    // console.log('Notice: creating default known peers', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <name> <public key>\n', { flag: 'wx' })
  }

  try {
    const file = fs.readFileSync(filename, 'utf8')
    return configs.parse(file, { split: ' ', length: 2 })
      .map(m => ({ name: m[0], publicKey: m[1] }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
