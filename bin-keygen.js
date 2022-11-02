#!/usr/bin/env node

const { Command } = require('commander')

const program = new Command()

program
  .description('Create keys of type ed25519 for use by hypercore-protocol.')
  .option('-f <filename>', 'Specifies the filename of the key file.')
  .option('-c <comment>', 'Provides a new comment.')
  .action(require('./actions/keygen.js'))

program.parseAsync()
