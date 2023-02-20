#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const { Command } = require('commander')
const Protomux = require('protomux')
const { SHELLDIR } = require('../constants.js')
const { ClientSocket } = require('../lib/client-socket.js')
const { ShellClient } = require('../lib/shell.js')
const { LocalTunnelClient } = require('../lib/local-tunnel.js')
const keygen = require('./keygen.js')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key or name>', 'Public key or name of the server')
  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  .option('-L <[address:]port:host:hostport>', 'Local port forwarding.')
  // .option('-R <[address:]port:host:hostport>', 'Remote port forwarding.')
  // .option('--key <hex or z32>', 'Inline key for the client.')
  // .option('--connect <server public key>', 'Specifies the filename of the server public key')
  .option('--testnet', 'Use a local testnet.', false)
  .action(cmd)
  .parseAsync()

async function cmd (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) {
    await keygen({ f: keyfile })
  }

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey, testnet: options.testnet })
  const mux = new Protomux(socket)

  if (options.L) {
    const tunnel = new LocalTunnelClient(options.L, { node, socket, mux })
    tunnel.open()
    return
  } else if (options.R) {
    errorAndExit('-R not supported yet')
    return
  }

  const shell = new ShellClient(this.rawArgs, { node, socket, mux })
  shell.open()
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
