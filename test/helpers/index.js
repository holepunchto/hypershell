const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const { spawnSync } = require('child_process')
const createTestnet = require('@hyperswarm/testnet')
const DHT = require('@hyperswarm/dht')

const BIN_KEYGEN = path.join(__dirname, '..', '..', 'bin-keygen.js')
const BIN_SERVER = path.join(__dirname, '..', '..', 'bin-server.js')
const BIN_CLIENT = path.join(__dirname, '..', '..', 'bin-client.js')

module.exports = {
  BIN_KEYGEN,
  BIN_SERVER,
  BIN_CLIENT,
  createTmpDir,
  create
}

function createTmpDir (t) {
  const tmpdir = path.join(os.tmpdir(), 'hypershell-test-')
  const dir = fs.mkdtempSync(tmpdir)
  t.teardown(() => fsp.rm(dir, { recursive: true }))
  return dir
}

async function create (t) {
  const root = createTmpDir(t)
  const clientkey = path.join(root, 'peer-client')
  const serverkey = path.join(root, 'peer-server')
  const authorized_peers = path.join(root, 'authorized_peers')

  // + check more / ensure (or just create them manually actually via fs?)
  spawnSync(BIN_KEYGEN, ['-f', clientkey])
  spawnSync(BIN_KEYGEN, ['-f', serverkey])

  const clientseed = Buffer.from(fs.readFileSync(clientkey, 'utf8'), 'hex')
  const clientKeyPair = DHT.keyPair(clientseed)
  fs.writeFileSync(authorized_peers, '# <public key>\n' + clientKeyPair.publicKey.toString('hex') + '\n')

  const swarm = await createTestnet(3, { host: '127.0.0.1', port: 49737, teardown: t.teardown })

  const bootstrap = swarm.nodes[0].address()
  if (bootstrap.port !== 49737) {
    await swarm.destroy()
    throw new Error('Swarm failed to be created on specific port')
  }

  const serverseed = Buffer.from(fs.readFileSync(serverkey, 'utf8'), 'hex')
  const serverKeyPair = DHT.keyPair(serverseed)

  return { root, clientkey, serverkey, authorized_peers, swarm, clientKeyPair, serverKeyPair }
}
