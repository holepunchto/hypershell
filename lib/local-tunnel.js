const net = require('net')
const c = require('compact-encoding')
const pump = require('pump')
const DHT = require('@hyperswarm/dht')
const SecretStream = require('@hyperswarm/secret-stream')

class LocalTunnelServer {
  constructor ({ node, socket, mux, options }) {
    this.dht = node
    this.socket = socket

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

    this.options = options

    this.streams = new Map()
    this.config = null
  }

  open () {
    this.channel.open({})
  }

  onopen (handshake) {
    const isHostAllowed = LocalTunnelServer.firewallHosts(this.options.tunnelHost, handshake.host)
    const isPortAllowed = LocalTunnelServer.firewallPorts(this.options.tunnelPort, handshake.port)

    if (!isHostAllowed || !isPortAllowed) {
      this.channel.close()
      return
    }

    this.config = handshake
  }

  onclose () {
    for (const [, stream] of this.streams) {
      stream.destroy()
    }
  }

  onstreamid (data, c) {
    const { clientId } = data

    const rawStream = this.dht.createRawStream()
    this.streams.set(rawStream.id, rawStream)
    rawStream.on('close', () => this.streams.delete(rawStream.id))

    c.messages[0].send({ clientId, serverId: rawStream.id })

    DHT.connectRawStream(this.socket, rawStream, clientId)
    const secretStream = new SecretStream(true, rawStream)

    const remoteSocket = net.connect(this.config.port, this.config.host)
    rawStream.userData = { remoteSocket, secretStream }

    pump(secretStream, remoteSocket, secretStream)
  }

  static firewallHosts (hosts, target) {
    if (!hosts) return true

    for (const host of hosts) {
      // + support for cidr ranges?
      if (host === target) return true
    }

    return false
  }

  static firewallPorts (ports, target) {
    if (!ports) return true

    for (const port of ports) {
      const isRange = port.indexOf('-') > -1
      let list = null

      if (isRange) {
        const [start, end] = port.split('-', 2).map(Number)
        const length = end - start + 1

        list = Array.from({ length }, (_, i) => start + i)
      } else {
        list = [Number(port)]
      }

      for (const number of list) {
        if (number === target) return true
      }
    }

    return false
  }
}

class LocalTunnelClient {
  constructor (config, { node, socket, mux }) {
    this.dht = node
    this.socket = socket

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
    const rawStream = this.dht.createRawStream()
    this.streams.set(rawStream.id, rawStream)
    rawStream.on('close', () => this.streams.delete(rawStream.id))

    this.channel.messages[0].send({ clientId: rawStream.id, serverId: 0 })

    rawStream.userData = { localSocket }
    rawStream.on('close', () => localSocket.destroy())
  }

  onstreamid (data, channel) {
    const { clientId, serverId } = data

    const rawStream = this.streams.get(clientId)
    if (!rawStream) throw new Error('Stream not found: ' + clientId)
    const { localSocket } = rawStream.userData

    DHT.connectRawStream(this.socket, rawStream, serverId)
    const secretStream = new SecretStream(false, rawStream)

    rawStream.userData.secretStream = secretStream

    pump(localSocket, secretStream, localSocket)
  }

  static parse (config) {
    const match = config.match(/(?:(.*):)?([\d]+):(?:(.*):)?([\d]+)/i)
    // + should return errors
    if (!match[2]) errorAndExit('local port is required')
    if (!match[3]) errorAndExit('remote host is required')
    if (!match[4]) errorAndExit('remote port is required')

    const local = { host: match[1] || '0.0.0.0', port: Number(match[2]) }
    const remote = { host: match[3], port: Number(match[4]) }

    return { local, remote }
  }
}

function waitForServer (server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done)
    server.on('error', done)
    // if (server.listening) done()

    function done (error) {
      server.removeListener('listening', done)
      server.removeListener('error', done)
      error ? reject(error) : resolve()
    }
  })
}

module.exports = { LocalTunnelServer, LocalTunnelClient }

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
