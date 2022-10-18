#!/usr/bin/env node
const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const Keychain = require('keypear')

const argv = minimist(process.argv.slice(2))
const seed = Keychain.seed()
const keyPair = DHT.keyPair(seed)

console.log('New seed: ' + seed.toString('hex'))
console.log('Public key: ' + keyPair.publicKey.toString('hex'))
