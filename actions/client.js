const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const Protomux = require('protomux')
const c = require('compact-encoding')
const goodbye = require('graceful-goodbye')
const { SHELLDIR } = require('../constants.js')

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = options.f ? path.resolve(options.f) : path.join(SHELLDIR, 'peer')

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  serverPublicKey = Buffer.from(serverPublicKey, 'hex')

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy())

  const socket = node.connect(serverPublicKey, { keyPair })

  socket.once('open', () => console.log('socket opened', Date.now()))
  socket.once('end', () => console.log('socket ended', Date.now()))
  socket.once('close', () => console.log('socket closed', Date.now()))

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-sh',
    id: Buffer.from('terminal'),
    onopen () {
      console.log('channel onopen', Date.now())
    },
    messages: [
      {
        encoding: c.buffer,
        onmessage (data) {
          process.stdout.write(data)
        }
      }
    ],
    onclose () {
      console.log('channel onclose', Date.now())
      socket.end()
    },
    ondestroy () {
      console.log('channel ondestroy', Date.now())
    }
  })

  channel.open()

  process.stdin.setRawMode(true)
  process.stdin.on('data', function (data) {
    channel.messages[0].send(data)
  })

  socket.on('error', function (error) {
    if (error.code === 'ECONNRESET') console.error('Connection closed.')
    else if (error.code === 'ETIMEDOUT') console.error('Connection timed out.')
    else if (error.code === 'PEER_NOT_FOUND') console.error(error.message)
    else if (error.code === 'PEER_CONNECTION_FAILED') console.error(error.message, '(probably firewalled)')
    else console.error(error)

    process.exit()
  })

  socket.once('close', function () {
    console.error('Connection closed.')
    process.exit()
  })
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
