const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const ClientSocket = require('../lib/client-socket.js')

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  const socket = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket)

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
