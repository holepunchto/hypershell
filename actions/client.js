const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const { shelldir, errorAndExit } = require('../util.js')

module.exports = async function (serverPublicKey, options = {}) {
  console.log('client', { serverPublicKey }, options)

  const keyfile = options.f ? path.resolve(options.f) : path.join(shelldir, 'peer')

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  serverPublicKey = Buffer.from(serverPublicKey, 'hex')

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const socket = node.connect(serverPublicKey, { keyPair })
  goodbye(() => socket.end(), 1)

  socket.setKeepAlive(5000)

  process.stdin.setRawMode(true)
  process.stdin.pipe(socket).pipe(process.stdout)

  socket.on('error', function (error) {
    if (error.code === 'ECONNRESET') console.error('Connection closed.')
    else if (error.code === 'ETIMEDOUT') console.error('Connection timed out.')
    else if (error.code === 'PEER_NOT_FOUND') console.error(error.message)
    else if (error.code === 'PEER_CONNECTION_FAILED') console.error(error.message, '(probably firewalled)')
    else console.error(error)

    process.exit()
  })
}
