#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const { Command } = require('commander')
const Protomux = require('protomux')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const { SHELLDIR } = require('../constants.js')
const { ClientSocket } = require('../lib/client-socket.js')
const { ShellClient } = require('../lib/shell.js')
const { LocalTunnelClient } = require('../lib/local-tunnel.js')
const keygen = require('./keygen.js')
const getKnownPeer = require('../lib/get-known-peer.js')

const program = new Command()

program
  .description('Connect to a P2P shell.')
  .argument('<server public key or name>', 'Public key or name of the server')
  .option('-f <filename>', 'Filename of the client seed key.', path.join(SHELLDIR, 'peer'))
  .option('-L <[address:]port:host:hostport...>', 'Local port forwarding.')
  // .option('--primary-key <hex or z32>', 'Inline primary key for the client.')
  .option('--testnet', 'Use a local testnet.', false)
  .action(cmd)
  .parseAsync()

async function cmd (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) {
    await keygen({ f: keyfile })
  }

  if (options.L) {
    // Partially hardcoded "ClientSocket" here as tunnels behaves different, until we can organize better the dht, socket, and mux objects

    serverPublicKey = getKnownPeer(serverPublicKey)

    const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
    const keyPair = DHT.keyPair(seed)

    const node = new DHT({ bootstrap: options.testnet ? [{ host: '127.0.0.1', port: 40838 }] : undefined })
    goodbye(() => node.destroy(), 2)

    for (const config of options.L) {
      const tunnel = new LocalTunnelClient(config, { node, keyPair, serverPublicKey })
      await tunnel.ready()

      goodbye(() => tunnel.close(), 1)

      console.log('Tunnel on TCP', getHost(tunnel.server.address().address) + ':' + tunnel.server.address().port)
    }

    return
  }

  if (options.R) errorAndExit('-R not supported')

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey, testnet: options.testnet })
  const mux = new Protomux(socket)

  const shell = new ShellClient(this.rawArgs, { node, socket, mux })
  shell.open()
}

function getHost (address) {
  if (address === '::' || address === '0.0.0.0') return 'localhost'
  return address
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
