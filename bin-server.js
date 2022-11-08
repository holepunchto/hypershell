#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Create a P2P shell server.')
  .option('-f <filename>', 'Specifies the filename of the server key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the server.')
  .option('--firewall <filename>', 'Firewall file with a list of public keys allowed to connect.', path.join(SHELLDIR, 'firewall'))
  .action(require('./actions/server.js'))

program.parseAsync()
