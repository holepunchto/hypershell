const fs = require('fs')
const path = require('path')
const os = require('os')
const Keychain = require('keypear')
const DHT = require('@hyperswarm/dht')

module.exports = {
  createShellFolder,
  readAuthorizedKeys,
  readPeerSeed,
  parseFirewall
}

function createShellFolder () {
  fs.mkdirSync(path.join(os.homedir(), '.hypershell'), { recursive: true })
}

function readAuthorizedKeys (firewallFile) {
  createShellFolder()

  const file = firewallFile ? path.resolve(firewallFile) : path.join(os.homedir(), '.hypershell', 'firewall')

  if (!firewallFile && !fs.existsSync(file)) {
    const defaultPeerSeed = readPeerSeed()
    const keyPair = DHT.keyPair(defaultPeerSeed)
    fs.writeFileSync(file, 'peer-ed25519 ' + keyPair.publicKey.toString('hex') + '\n')
  }

  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .map(line => line.match(/peer-ed25519 ([a-zA-Z0-9]*)/i))
      .filter(m => m)
      .map(m => m[1])
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function readPeerSeed (name) {
  createShellFolder()

  const file = path.join(os.homedir(), '.hypershell', name || 'peer')

  if (!name && !fs.existsSync(file)) {
    fs.writeFileSync(file, Keychain.seed().toString('hex') + '\n')
  }

  return Buffer.from(fs.readFileSync(file, 'utf8'), 'hex')
}

function parseFirewall (publicKeys) {
  if (!publicKeys || typeof publicKeys === 'boolean') return () => false

  if (!Array.isArray(publicKeys)) {
    publicKeys = publicKeys.toString().split(',')
  }

  console.log('firewall', publicKeys)

  publicKeys = publicKeys.map(v => Buffer.from(v, 'hex'))

  return function (remotePublicKey, remoteHandshakePayload) {
    for (const publicKey of publicKeys) {
      if (remotePublicKey.equals(publicKey)) {
        console.log('firewall allowed', remotePublicKey.toString('hex'))
        return false
      }
    }
    console.log('firewall denied', remotePublicKey.toString('hex'))
    return true
  }
}
