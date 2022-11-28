const fs = require('fs')
const path = require('path')
const net = require('net')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const ClientSocket = require('../lib/client-socket.js')
const pump = require('pump')
const DHT = require('@hyperswarm/dht')

// hypershell home -L 127.0.0.1:3000:127.0.0.1:80

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket) // + what if I create the mux on 'connect' event?

  if (options.L) {
    const tunnel = parseTunnel(options.L) // + defaults

    const channel = mux.createChannel({
      protocol: 'hypershell-tunnel-local',
      id: null,
      handshake: c.json,
      messages: [
        { encoding: c.json, onmessage: onstreamid },
      ],
      onopen () {
        console.log(Date.now(), '5) onopen')

        channel.userData = { streams: {} }
      },
      onclose () {
        console.log(Date.now(), '12) onclose')
        socket.end()
      }
    })

    channel.open(tunnel.remote)

    const server = net.createServer() // + option for udp

    server.on('connection', function (localSocket) {
      const { streams } = channel.userData

      const rawStream = node.createRawStream() // + encryption?
      console.log('node createRawStream', { clientId: rawStream.id })
      streams[rawStream.id] = rawStream
      channel.messages[0].send({ clientId: rawStream.id, serverId: 0 })

      pump(localSocket, rawStream, localSocket)
    })

    await listenTCP(server, tunnel.local.port, tunnel.local.host)
    // + goodbye => server.close()

    function onstreamid (data) {
      const { streams } = channel.userData
      const { clientId, serverId } = data

      const rawStream = streams[clientId]
      if (!rawStream) throw new Error('Stream not found: ' + clientId)

      console.log('DHT connectRawStream', { serverId })
      DHT.connectRawStream(socket, rawStream, serverId)
    }

    return
  } else if (options.R) {

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

  console.log(socket)
  console.log(socket.rawStream.udx.createStream)

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

function randomIntExcept (current) {
  while (true) {
    const id = (Math.random() * 0x100000000) >>> 0
    if (id !== current) return id
  }
}

// based on bind-easy
function listenTCP (server, port, address) {
  return new Promise(function (resolve, reject) {
    server.on('listening', onlistening)
    server.on('error', done)

    server.listen(port, address)

    function onlistening () {
      done(null)
    }

    function done (err) {
      server.removeListener('listening', onlistening)
      server.removeListener('error', done)

      if (err) reject(err)
      else resolve()
    }
  })
}
