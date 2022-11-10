#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key or name>', 'Public key or name of the server')
  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the client.')
  // .option('--connect <server public key>', 'Specifies the filename of the server public key')
  .action(require('./actions/client.js'))

program.parseAsync()
