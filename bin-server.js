#!/usr/bin/env node

const { Command } = require('commander')

const program = new Command()

program
  .description('Create a P2P shell server.')
  .option('-f <filename>', 'Specifies the filename of the server key.')
  // .option('--key <hex or z32>', 'Inline key for the server.')
  .option('--firewall <filename>', 'Firewall file with a list of public keys allowed to connect.')
  .action(require('./actions/server.js'))

program.parseAsync()
