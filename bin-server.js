#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Create a P2P shell server.')
  .option('-f <filename>', 'Filename of the server seed key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the server.')
  .option('--firewall <filename>', 'List of allowed public keys.', path.join(SHELLDIR, 'authorized_peers'))
  .option('--testnet', 'Use a local testnet.', false)
  .action(require('./actions/server.js'))

program.parseAsync()
