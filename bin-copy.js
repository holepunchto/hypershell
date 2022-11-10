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
  .action(require('./actions/copy.js'))

program.parseAsync()

// (upload)   hypershell-copy <source local path> <pub key or name>:<target remote path>
// (download) hypershell-copy <remote public key or name>:<source remote path> <target local path>
// (both)     hypershell-copy <remote public key or name>:<source local path> <remote public key or name or name>:<target remote path>

// [examples]
// (upload)   hypershell-copy ./app.js @machine3:/home/user/Desktop/app-backup.js
// (download) hypershell-copy <pub key or name>:/home/user/Desktop/app.js ./app-received.js
// (both)     hypershell-copy machine3:/home/user/Desktop/app-backup.js machine4:/home/user/Desktop/another-backup.js
