#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { Command } = require('commander')
const Keychain = require('keypear')
const DHT = require('@hyperswarm/dht')
const { SHELLDIR } = require('../constants.js')

const isModule = require.main !== module

if (isModule) {
  module.exports = cmd
  return
}

const program = new Command()

program
  .description('Create keys of type ed25519 for use by hypercore-protocol.')
  .option('-f <filename>', 'Filename of the seed key file.')
  .option('-c <comment>', 'Provides a new comment.')
  .action(cmd)
  .parseAsync()

async function cmd (options = {}) {
  console.log('Generating key.')

  let keyfile
  if (!options.f) {
    keyfile = path.join(SHELLDIR, 'peer')

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
    if (isModule) {
      console.log()
      return
    }

    errorAndExit(keyfile + ' already exists.') // Overwrite (y/n)?
  }

  const seed = Keychain.seed()
  fs.mkdirSync(path.dirname(keyfile), { recursive: true })
  fs.writeFileSync(keyfile, seed.toString('hex') + comment + '\n', { flag: 'wx' })

  console.log('Your key has been saved in', keyfile)
  console.log('The public key is:')
  console.log(DHT.keyPair(seed).publicKey.toString('hex'))

  if (isModule) console.log()
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

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
