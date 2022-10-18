#!/usr/bin/env node
const { readAuthorizedKeys, readPeerSeed, parseFirewall } = require('./util.js')
const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const TTY = require('./tty/index.js')
const goodbye = require('graceful-goodbye')

// node server.js
// node server.js --firewall <authorized keys file>
// node server.js --firewall <authorized keys file> --seed <server seed key>
// node server.js --firewall <authorized keys file> <server seed file>

const argv = minimist(process.argv.slice(2))
const seed = argv.seed ? Buffer.from(argv.seed, 'hex') : readPeerSeed(argv._[0])
const firewall = parseFirewall(readAuthorizedKeys(argv.firewall))

const node = new DHT()
goodbye(() => node.destroy(), 2)

const server = node.createServer({ firewall })
goodbye(() => server.close(), 1)

server.on('connection', function (socket) {
  console.log('remote public key', socket.remotePublicKey.toString('hex'))

  socket.setKeepAlive(5000)

  socket.on('open', () => console.log(Date.now(), '(server side) socket opened'))
  socket.on('close', () => console.log(Date.now(), '(server side) socket closed'))
  socket.on('end', () => console.log(Date.now(), '(server side) socket ended / wants to end'))
  // socket.on('end', () => socket.end())

  socket.on('error', function (error) {
    console.error(error.code, error)
  })

  const tty = new TTY()
  tty.attach(socket)
})

console.log('Using this seed to generate the key-pair:\n' + seed.toString('hex') + '\n')
const keyPair = DHT.keyPair(seed)

server.listen(keyPair).then(() => {
  console.log('To connect to this ssh server, on another computer run')
  console.log('hypershell ' + keyPair.publicKey.toString('hex'))
  console.log()
})
