#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key>', 'Public key of the server')
  // .argument('<server public key>', 'Public key of the server or absolute path to server public key')
  .option('-f <filename>', 'Specifies the filename of the client key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the client.')
  // .option('--connect <server public key>', 'Specifies the filename of the server public key')
  .action(require('./actions/client.js'))

program.parseAsync()
