const minimist = require('minimist')
const DHT = require('@hyperswarm/dht')
const TTY = require('./tty/index.js')
const Keychain = require('keypear')
const goodbye = require('graceful-goodbye')

const argv = minimist(process.argv.slice(2))
const seed = argv._[0] ? Buffer.from(argv._[0], 'hex') : Keychain.seed()
const firewall = parseFirewall(argv.firewall)

const node = new DHT()
goodbye(() => node.destroy())

const server = node.createServer({ firewall })

server.on('connection', function (socket) {
  console.log('remote public key', socket.remotePublicKey.toString('hex'))

  socket.on('open', () => console.log(Date.now(), '(server side) socket opened'))
  socket.on('close', () => console.log(Date.now(), '(server side) socket closed'))
  socket.on('end', () => console.log(Date.now(), '(server side) socket ended / wants to end'))
  // socket.on('end', () => socket.end())

  const tty = new TTY()
  tty.attach(socket)
})

console.log('Using this seed to generate the key-pair:\n' + seed.toString('hex') + '\n')
const keyPair = DHT.keyPair(seed)

server.listen(keyPair).then(() => {
  console.log('To connect to this ssh server, on another computer run')
  console.log('hypershell ' + keyPair.publicKey.toString('hex'))
})

function parseFirewall (publicKeys) {
  // console.log('parseFirewall', typeof publicKeys, publicKeys)

  if (!publicKeys || typeof publicKeys === 'boolean') return () => false

  publicKeys = publicKeys.toString().split(',').map(v => Buffer.from(v, 'hex'))

  return function (remotePublicKey, remoteHandshakePayload) {
    for (const publicKey of publicKeys) {
      if (remotePublicKey.equals(publicKey)) {
        console.log('firewall allowed')
        return false
      }
    }
    console.log('firewall denied')
    return true
  }
}
