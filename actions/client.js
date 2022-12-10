const fs = require('fs')
const path = require('path')
const net = require('net')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const ClientSocket = require('../lib/client-socket.js')
const pump = require('pump')
const DHT = require('@hyperswarm/dht')

class LocalTunnel {
  constructor (config, { node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.config = LocalTunnel.parse(config) // + defaults

    this.channel = mux.createChannel({
      protocol: 'hypershell-tunnel-local',
      id: null,
      handshake: c.json,
      messages: [
        { encoding: c.json, onmessage: this.onstreamid.bind(this) },
      ],
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this)
    })

    this.streams = new Map()
    this.server = net.createServer(this.onconnection.bind(this)) // + option for udp
    this.ready = null

    this.channel.open(this.config.remote)
  }

  onopen () {
    this.server.listen(this.config.local.port, this.config.local.host)
    this.ready = waitForServer(server) // + try same port error

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
    const rawStream = this.dht.createRawStream() // + encryption?
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
    if (!match[2]) errorAndExit('local port is required')
    if (!match[3]) errorAndExit('remote host is required')
    if (!match[4]) errorAndExit('remote port is required')

    const local = { host: match[1] || '0.0.0.0', port: match[2] }
    const remote = { host: match[3], port: match[4] }

    return { local, remote }
  }
}

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket) // + what if I create the mux on 'connect' event?

  if (options.L) {
    new LocalTunnel(options.L, { node, socket, mux })
    return
  } else if (options.R) {
    errorAndExit('-R not supported yet')
    return
  }

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: m.handshakeSpawn,
    messages: [
      { encoding: c.buffer }, // stdin
      { encoding: c.buffer, onmessage: onstdout }, // stdout
      { encoding: c.buffer, onmessage: onstderr }, // stderr
      { encoding: c.uint, onmessage: onexitcode }, // exit code
      { encoding: m.resize } // resize
    ],
    onclose () {
      socket.end()
    }
  })

  const spawn = parseVariadic(this.rawArgs)
  const [command = '', ...args] = spawn

  channel.open({
    file: command || '',
    args: args || [],
    width: process.stdout.columns,
    height: process.stdout.rows
  })

  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  process.stdin.on('data', function (data) {
    channel.messages[0].send(data)
  })

  function onstdout (data) {
    process.stdout.write(data)
  }

  function onstderr (data) {
    process.stderr.write(data)
  }

  function onexitcode (code) {
    process.exitCode = code
  }

  process.stdout.on('resize', function () {
    channel.messages[4].send({
      width: process.stdout.columns,
      height: process.stdout.rows
    })
  })

  socket.once('close', function () {
    process.exit()
  })
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function parseVariadic (rawArgs) {
  const index = rawArgs.indexOf('--')
  const variadic = index === -1 ? null : rawArgs.splice(index + 1)
  return variadic || []
}

function parseTunnel (tunnel) {
  const match = tunnel.match(/(?:(.*):)?([\d]+):(?:(.*):)?([\d]+)/i)
  if (!match[2]) errorAndExit('port is required (address:port:host:hostport)')
  if (!match[3]) errorAndExit('host is required (address:port:host:hostport)')
  if (!match[4]) errorAndExit('hostport is required (address:port:host:hostport)')

  const local = { host: match[1] || '0.0.0.0', port: match[2] }
  const remote = { host: match[3], port: match[4] }

  return { local, remote }
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
