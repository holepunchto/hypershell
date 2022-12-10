const net = require('net')
const c = require('compact-encoding')
const pump = require('pump')
const DHT = require('@hyperswarm/dht')

class LocalTunnelServer {
  constructor ({ node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell-tunnel-local',
      id: null,
      handshake: c.json,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        { encoding: c.json, onmessage: this.onstreamid.bind(this) }
      ]
    })
  }

  open () {
    this.channel.open({})
  }

  onopen (handshake) {
    // + avoid using userData
    this.channel.userData = { handshake, streams: new Map() } // + try to not pass { node, socket, handshake }
  }

  onclose () {
    if (!this.channel.userData) return

    const { streams } = this.channel.userData

    for (const [, stream] of streams) {
      stream.destroy()
    }
  }

  onstreamid (data, c) {
    const { handshake, streams } = c.userData
    const { clientId } = data

    const rawStream = this.dht.createRawStream()

    streams.set(rawStream.id, rawStream)
    rawStream.on('close', function () {
      streams.delete(rawStream.id)
    })

    c.messages[0].send({ clientId, serverId: rawStream.id })

    DHT.connectRawStream(this.socket, rawStream, clientId)

    const remoteSocket = net.connect(handshake.port, handshake.address)
    rawStream.userData = remoteSocket

    pump(rawStream, remoteSocket, rawStream)
  }
}

class LocalTunnelClient {
  constructor (config, { node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.config = LocalTunnelClient.parse(config) // + defaults

    this.channel = mux.createChannel({
      protocol: 'hypershell-tunnel-local',
      id: null,
      handshake: c.json,
      messages: [
        { encoding: c.json, onmessage: this.onstreamid.bind(this) }
      ],
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this)
    })

    this.streams = new Map()
    this.server = net.createServer(this.onconnection.bind(this)) // + option for udp
    this.ready = null
  }

  open () {
    this.channel.open(this.config.remote)
  }

  onopen () {
    this.server.listen(this.config.local.port, this.config.local.host)
    this.ready = waitForServer(this.server) // + try same port error

    this.ready.catch((err) => {
      console.error(err)
      this.channel.close()
    })
  }

  async onclose () {
    this.socket.end()

    await this.ready
    if (this.server.listening) this.server.close()

    for (const [, stream] of this.streams) {
      stream.destroy()
    }
  }

  onconnection (localSocket) {
    const rawStream = this.dht.createRawStream() // + encryption? secret-stream?
    rawStream.userData = localSocket
    rawStream.on('close', () => localSocket.destroy())

    this.streams.set(rawStream.id, rawStream)
    rawStream.on('close', () => this.streams.delete(rawStream.id))

    this.channel.messages[0].send({ clientId: rawStream.id, serverId: 0 })
  }

  onstreamid (data, channel) {
    const { clientId, serverId } = data

    const rawStream = this.streams.get(clientId)
    if (!rawStream) throw new Error('Stream not found: ' + clientId)

    DHT.connectRawStream(this.socket, rawStream, serverId)

    const localSocket = rawStream.userData
    pump(localSocket, rawStream, localSocket)
  }

  static parse (config) {
    const match = config.match(/(?:(.*):)?([\d]+):(?:(.*):)?([\d]+)/i)
    // + should return errors
    if (!match[2]) errorAndExit('local port is required')
    if (!match[3]) errorAndExit('remote host is required')
    if (!match[4]) errorAndExit('remote port is required')

    const local = { host: match[1] || '0.0.0.0', port: match[2] }
    const remote = { host: match[3], port: match[4] }

    return { local, remote }
  }
}

function waitForServer (server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done)
    server.on('error', done)
    if (server.listening) done()

    function done (error) {
      server.removeListener('listening', done)
      server.removeListener('error', done)
      error ? reject(error) : resolve()
    }
  })
}

module.exports = { LocalTunnelClient, LocalTunnelServer }

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
