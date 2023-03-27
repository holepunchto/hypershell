const fs = require('fs')
const path = require('path')
const configs = require('tiny-configs')
const { SHELLDIR } = require('../constants.js')

module.exports = function getKnownPeer (host) {
  for (const peer of readKnownPeers()) {
    if (peer.name === host) {
      host = peer.publicKey
      break
    }
  }

  return Buffer.from(host, 'hex')
}

function readKnownPeers () {
  const filename = path.join(SHELLDIR, 'known_peers')

  if (!fs.existsSync(filename)) {
    // console.log('Notice: creating default known peers', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <name> <public key>\n', { flag: 'wx' })
  }

  try {
    const file = fs.readFileSync(filename, 'utf8')
    return configs.parse(file, { split: ' ', length: 2 })
      .map(m => ({ name: m[0], publicKey: m[1] }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
