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
  goodbye(() => node.destroy(), 2)

  const socket = node.connect(serverPublicKey, { keyPair })
  goodbye(() => socket.end(), 1)

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-sh',
    id: null,
    handshake: cHandshake,
    messages: [
      { encoding: c.buffer }, // stdin
      { encoding: c.buffer, onmessage: onstdout }, // stdout
      { encoding: c.json /* cHandshake */ } // resize
    ],
    onclose () {
      socket.end()
    }
  })

  channel.open({
    width: process.stdout.columns,
    height: process.stdout.rows
  })

  process.stdin.setRawMode(true)
  process.stdin.on('data', function (data) {
    channel.messages[0].send(data)
  })

  function onstdout (data) {
    process.stdout.write(data)
  }

  process.stdout.on('resize', function () {
    channel.messages[2].send({
      width: process.stdout.columns,
      height: process.stdout.rows
    })
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

const cHandshake = {
  preencode (state, p) {
    c.uint.preencode(state, p ? p.width : 0)
    c.uint.preencode(state, p ? p.height : 0)
  },
  encode (state, p) {
    c.uint.encode(state, p ? p.width : 0)
    c.uint.encode(state, p ? p.height : 0)
  },
  decode (state) {
    return {
      width: c.uint.decode(state),
      height: c.uint.decode(state)
    }
  }
}
