#!/usr/bin/env node

const path = require('path')
const { Command } = require('commander')
const { SHELLDIR } = require('./constants.js')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key>', 'Public key of the server')
  // .argument('<server public key>', 'Public key of the server or absolute path to server public key')

  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  .option('--upload-source <local source path>', 'Upload a source file from client to target path of the server.')
  .option('--upload-target <server target path>', 'Upload a source file from client to target path of the server.')
  .option('--download-source <server source path>', 'Download a source file from server to target path of the client.')
  .option('--download-target <local target path>', 'Download a source file from server to target path of the client.')
  // .option('--key <hex or z32>', 'Inline key for the client.')
  // .option('--connect <server public key>', 'Specifies the filename of the server public key')
  .action(require('./actions/client.js'))

program.parseAsync()
