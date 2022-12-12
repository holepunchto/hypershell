#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Transfers files using a P2P shell server as transport.')
  .argument('<source>', 'Source')
  .argument('<target>', 'Target')
  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the client.')
  .option('--testnet', 'Use a local testnet.', false)
  .action(require('./actions/copy.js'))

program.parseAsync()
