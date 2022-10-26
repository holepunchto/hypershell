const fs = require('fs')
const path = require('path')
const readline = require('readline')
const Keychain = require('keypear')
const DHT = require('@hyperswarm/dht')
const { shelldir, errorAndExit } = require('../util.js')

module.exports = async function (options = {}) {
  console.log('Generating key.')

  let keyfile
  if (!options.f) {
    keyfile = path.join(shelldir, 'peer')

    const answer = await question('Enter file in which to save the key (' + keyfile + '): ')
    const filename = answer.trim()
    if (filename) {
      keyfile = path.resolve(filename)
    }
  } else {
    keyfile = path.resolve(options.f)
  }

  const comment = options.c ? (' # ' + options.c) : ''

  if (fs.existsSync(keyfile)) {
    errorAndExit(keyfile + ' already exists.') // Overwrite (y/n)?
  }

  const seed = Keychain.seed()
  fs.mkdirSync(path.dirname(keyfile), { recursive: true })
  fs.writeFileSync(keyfile, seed.toString('hex') + comment + '\n', { flag: 'wx' })
  // Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')

  console.log('Your key has been saved in', keyfile)
  console.log('The public key is:')
  console.log(DHT.keyPair(seed).publicKey.toString('hex'))
}

function question (query = '') {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.question(query, function (answer) {
      rl.close()
      resolve(answer)
    })
  })
}
