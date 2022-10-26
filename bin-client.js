#!/usr/bin/env node

const { Command } = require('commander')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key>', 'Public key of the server')
  // .argument('<server public key>', 'Public key of the server or absolute path to server public key')
  .option('-f <filename>', 'Specifies the filename of the client key.')
  // .option('--key <hex or z32>', 'Inline key for the client.')
  // .option('--connect <server public key>', 'Specifies the filename of the server public key')
  .action(require('./actions/client.js'))

program.parseAsync()
