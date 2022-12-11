const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const { SHELLDIR } = require('../constants.js')

module.exports = {
  ClientSocket,
  waitForSocketTermination
}

function ClientSocket ({ keyfile, serverPublicKey, reusableSocket = false }) {
  serverPublicKey = parseNameOrPublicKey(serverPublicKey)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const socket = node.connect(serverPublicKey, { keyPair, reusableSocket })
  goodbye(() => {
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

  socket.once('close', () => node.destroy())

  socket.setKeepAlive(5000)

  return { node, socket }
}

function waitForSocketTermination (socket) {
  return new Promise((resolve) => {
    const isClosed = socket.rawStream._closed
    const isReadableEnded = socket.rawStream._readableState.ended
    const isWritableEnded = socket.rawStream._writableState.ended

    // console.log('socket term', { isClosed, isReadableEnded, isWritableEnded })
    // waitForSocketTermination { isClosed: false, isReadableEnded: true, isWritableEnded: true }
    // + that doesn't trigger a close event?

    if (isReadableEnded && isWritableEnded) {
      resolve()
      return
    }

    // + timeout end destroy?

    if (isClosed) {
      resolve()
      return
    }

    socket.on('end', onend)
    socket.on('close', onclose)

    function onend () {
      // console.log('socket term (onend)', { isClosed, isReadableEnded, isWritableEnded })
      onterm()
    }

    function onclose () {
      // console.log('socket term (onclose)', { isClosed, isReadableEnded, isWritableEnded })
      onterm()
    }

    function onterm () {
      socket.removeListener('end', onend)
      socket.removeListener('close', onclose)
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
    return fs.readFileSync(filename, 'utf8')
      .split('\n')
      .map(line => {
        line = line.replace(/\s+/g, ' ').trim()
        line = line.replace(/#.*$/, '').trim()
        const i = line.indexOf(' ')
        if (i === -1) return null
        return [line.slice(0, i), line.slice(i + 1)]
      })
      .filter(m => m && m[0] && m[1])
      .map(m => ({ name: m[0], publicKey: m[1] }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
