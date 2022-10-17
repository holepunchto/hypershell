const os = require('os')
const crypto = require('crypto')
const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const TTY = require('./tty/index.js')
const PTY = require('node-pty')
const Keychain = require('keypear')
const goodbye = require('graceful-goodbye')

// /\x1b[^m]*m/g
const argv = minimist(process.argv.slice(2))

if (argv.controller) controller()
else if (argv.slave) slave()
else throw new Error('--controller [seed] or --slave <publicKey>')

async function controller () {
  if (typeof argv.controller !== 'string') {
    console.log('random seed', Keychain.seed().toString('hex'))
    return
  }

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const keyPair = DHT.keyPair(sha256(argv.controller))
  const socket = node.connect(keyPair.publicKey)
  goodbye(() => socket.end(), 1)

  socket.on('open', () => console.log('(client side) socket opened'))
  socket.on('close', () => console.log('(client side) socket closed'))
  socket.on('end', () => socket.end())

  socket.on('data', function (buf) {
    const data = buf.toString()
    console.log('(client side) received', { data })
  })

  socket.once('data', function () {
    setTimeout(async () => {
      const response = await send(socket, 'echo $SHELL')
      console.log(response)
    }, 500)
  })
}

async function slave () {
  if (typeof argv.slave !== 'string') {
    console.log('random seed', Keychain.seed().toString('hex'))
    return
  }

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const server = node.createServer()
  goodbye(() => server.close(), 1)

  server.on('connection', function (socket) {
    console.log('remote public key', socket.remotePublicKey.toString('hex'))

    socket.on('open', () => console.log(Date.now(), '(server side) socket opened'))
    socket.on('close', () => console.log(Date.now(), '(server side) socket closed'))
    socket.on('end', () => socket.end())

    const tty = new TTY()
    tty.attach(socket)
  })

  const keyPair = DHT.keyPair(sha256(argv.slave))
  await server.listen(keyPair)

  console.log('server public key', server.publicKey.toString('hex'))
}

function send (socket, command) {
  console.log('send', { command })
  return new Promise(resolve => {
    socket.write(command + '\r')
    socket.once('data', function (buf) {
      const data = buf.toString().split('\n').filter(v => v)
      resolve(data)
    })
  })
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest()
}
