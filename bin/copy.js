#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const { Command } = require('commander')
const { SHELLDIR } = require('../constants.js')
const { ClientSocket } = require('../lib/client-socket.js')
const { UploadClient } = require('../lib/upload.js')
const { DownloadClient } = require('../lib/download.js')
const keygen = require('./keygen.js')

const publicKeyExpr = /^([a-fA-F0-9]{64}|[ybndrfg8ejkmcpqxot1uwisza345h769]{52}):/i

const program = new Command()

program
  .description('Transfers files using a P2P shell server as transport.')
  .argument('<source>', 'Source')
  .argument('<target>', 'Target')
  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  // .option('--key <hex or z32>', 'Inline key for the client.')
  .option('--testnet <number>', 'Use a local testnet.', parseInt)
  .action(cmd)
  .parseAsync()

async function cmd (sourcePath, targetPath, options = {}) {
  const fileOperation = sourcePath[0] === '@' || publicKeyExpr.test(sourcePath) ? 'download' : 'upload'
  let serverPublicKey = null

  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) {
    await keygen({ f: keyfile })
  }

  if (sourcePath[0] === '@' || publicKeyExpr.test(sourcePath)) {
    [serverPublicKey, sourcePath] = parseRemotePath(sourcePath)
    if (!serverPublicKey || !sourcePath) errorAndExit('Invalid source path.')
  } else if (targetPath[0] === '@' || publicKeyExpr.test(targetPath)) {
    [serverPublicKey, targetPath] = parseRemotePath(targetPath)
    if (!serverPublicKey || !targetPath) errorAndExit('Invalid target path.')
  } else {
    errorAndExit('Invalid source or target path.')
  }

  let bootstrap = null
  if (options.testnet != null) {
    bootstrap = [{ host: '127.0.0.1', port: options.testnet }]
  }

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey, bootstrap })
  const mux = new Protomux(socket)

  if (fileOperation === 'upload') {
    const upload = new UploadClient({ sourcePath, targetPath }, { node, socket, mux })
    upload.open()
  } else {
    const download = new DownloadClient({ sourcePath, targetPath }, { node, socket, mux })
    download.open()
  }
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function parseRemotePath (str) {
  const i = str.indexOf(':')
  if (i === -1) return [null, null]

  const isName = str[0] === '@'
  return [str.slice(isName ? 1 : 0, i), str.slice(i + 1)] // [host, path]
}
