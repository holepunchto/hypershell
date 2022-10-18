#!/usr/bin/env node
const { readPeerSeed } = require('./util.js')
const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const TTY = require('./tty/index.js')
const goodbye = require('graceful-goodbye')

// node client.js <server public key>
// node client.js <server public key> --seed <client seed file>

const argv = minimist(process.argv.slice(2))
if (!argv._[0]) throw new Error('Public key is required, i.e. hypershell <server public key>')
const seed = readPeerSeed(argv.seed)
const serverPublicKey = Buffer.from(argv._[0], 'hex')

const node = new DHT()
goodbye(() => node.destroy(), 2)

const keyPair = DHT.keyPair(seed)
console.log('Your peer public key is:', keyPair.publicKey.toString('hex'))

const socket = node.connect(serverPublicKey, { keyPair })
socket.setKeepAlive(5000)
goodbye(() => socket.end(), 1)

process.stdin.pipe(socket).pipe(process.stdout)

socket.on('error', function (error) {
  console.error(error)
  process.exit()
})
