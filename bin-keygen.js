#!/usr/bin/env node

/*
hypershell-server
hypershell <server public key hex or z32>
hypershell-keygen

hypershell-copy-id
hypershell-files // like scp
hypershell-tunnel // create (remote) or receive (local) a port forward
hypershell-proxy // dynamic port forwarding (SOCKS proxy)
*/

const { Command } = require('commander')

const program = new Command()

program
  .description('Create keys of type ed25519 for use by hypercore-protocol.')
  .option('-f <filename>', 'Specifies the filename of the key file.')
  .option('-c <comment>', 'Provides a new comment.')
  .action(require('./actions/keygen.js'))

program.parseAsync()
