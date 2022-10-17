const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const TTY = require('./tty/index.js')
const Keychain = require('keypear')
const goodbye = require('graceful-goodbye')

const argv = minimist(process.argv.slice(2))
if (!argv._[0]) throw new Error('Public key is required, i.e. hypershell <public key>')
const seed = argv.seed ? Buffer.from(argv.seed, 'hex') : Keychain.seed()
const publicKey = Buffer.from(argv._[0], 'hex')

const node = new DHT()
goodbye(() => node.destroy())

const keyPair = DHT.keyPair(seed)
const socket = node.connect(publicKey, { keyPair })
socket.setKeepAlive(5000)

process.stdin.pipe(socket).pipe(process.stdout)
