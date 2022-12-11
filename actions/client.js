const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const { ClientSocket } = require('../lib/client-socket.js')
const { ShellClient } = require('../lib/shell.js')
const { LocalTunnelClient } = require('../lib/local-tunnel.js')

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket) // + what if I create the mux on 'connect' event?

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
