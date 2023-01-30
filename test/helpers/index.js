const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const { spawn } = require('child_process')
// const { spawnSync } = require('child_process')
const createTestnet = require('@hyperswarm/testnet')
const DHT = require('@hyperswarm/dht')
const Keychain = require('keypear')

const BIN_KEYGEN = path.join(__dirname, '..', '..', 'bin/keygen.js')
const BIN_SERVER = path.join(__dirname, '..', '..', 'bin/server.js')
const BIN_CLIENT = path.join(__dirname, '..', '..', 'bin/client.js')
const BIN_COPY = path.join(__dirname, '..', '..', 'bin/copy.js')

module.exports = {
  BIN_KEYGEN,
  BIN_SERVER,
  BIN_CLIENT,
  BIN_COPY,
  create,
  spawnServer,
  spawnClient,
  spawnCopy,
  spawnKeygen,
  keygen,
  addAuthorizedPeer,
  sleep,
  waitForProcess,
  waitForServerReady
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
  const firewall = path.join(root, 'authorized_peers')

  const clientKeyPair = keygen(clientkey)
  const serverKeyPair = keygen(serverkey)
  addAuthorizedPeer(firewall, clientkey)

  const swarm = await useTestnet(t)

  return { root, clientkey, serverkey, firewall, swarm, clientKeyPair, serverKeyPair }
}

// + should require to pass the args array, and just automatically append --testnet

function spawnKeygen (t, { keyfile }) {
  const sp = spawn(process.execPath, [BIN_KEYGEN, '-f', keyfile], { timeout: 15000 })
  t.teardown(() => sp.kill())

  sp.stdout.setEncoding('utf8')
  sp.stderr.setEncoding('utf8')

  sp.on('error', (error) => t.fail('keygen error: ' + error.message))
  sp.stderr.on('data', (data) => t.fail('keygen stderr: ' + data))

  return sp
}

function spawnServer (t, { serverkey, firewall }) {
  const sp = spawn(process.execPath, [BIN_SERVER, '-f', serverkey, '--firewall', firewall, '--testnet'], { timeout: 15000 })
  t.teardown(() => sp.kill())

  sp.stdout.setEncoding('utf8')
  sp.stderr.setEncoding('utf8')

  sp.on('error', (error) => t.fail('server error: ' + error.message))
  sp.stderr.on('data', (data) => t.fail('server stderr: ' + data))

  return sp
}
function spawnClient (t, serverPublicKey, { clientkey }) {
  const sp = spawn(process.execPath, [BIN_CLIENT, serverPublicKey, '-f', clientkey, '--testnet'], { timeout: 15000 })
  t.teardown(() => sp.kill())

  sp.stdout.setEncoding('utf8')
  sp.stderr.setEncoding('utf8')

  sp.on('error', (error) => t.fail('client error: ' + error.message))
  sp.stderr.on('data', (data) => t.fail('client stderr: ' + data))

  return sp
}

function spawnCopy (t, source, target, { clientkey }) {
  const sp = spawn(process.execPath, [BIN_COPY, source, target, '-f', clientkey, '--testnet'], { timeout: 15000 })
  t.teardown(() => sp.kill())

  sp.stdout.setEncoding('utf8')
  sp.stderr.setEncoding('utf8')

  sp.on('error', (error) => t.fail('copy error: ' + error.message))
  sp.stderr.on('data', (data) => t.fail('copy stderr: ' + data))

  return sp
}

function keygen (keyfile) {
  const seed = Keychain.seed()
  fs.mkdirSync(path.dirname(keyfile), { recursive: true })
  fs.writeFileSync(keyfile, seed.toString('hex') + '\n', { flag: 'wx' })
  return DHT.keyPair(seed)
}

function addAuthorizedPeer (firewall, keyfile) {
  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)
  if (!fs.existsSync(firewall)) fs.writeFileSync(firewall, '# <public key>\n', { flag: 'wx' })
  fs.appendFileSync(firewall, keyPair.publicKey.toString('hex') + '\n')
}

async function useTestnet (t) {
  const swarm = await createTestnet(3, { host: '127.0.0.1', port: 40838 })
  t.teardown(() => swarm.destroy())

  const bootstrap = swarm.nodes[0].address()
  if (bootstrap.port !== 40838) {
    await swarm.destroy()
    throw new Error('Swarm failed to be created on specific port')
  }

  return swarm
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForProcess (child) {
  return new Promise((resolve, reject) => {
    child.on('spawn', done)
    child.on('error', done)

    function done (err) {
      child.removeListener('spawn', done)
      child.removeListener('error', done)
      err ? reject(err) : resolve()
    }
  })
}

function waitForServerReady (child) {
  return new Promise((resolve, reject) => {
    let step = 0

    child.stdout.on('data', ondata)
    child.stderr.on('data', onstderror)
    child.on('error', onerror)

    function cleanup () {
      child.stdout.removeListener('data', ondata)
      child.stderr.removeListener('data', onstderror)
      child.removeListener('error', onerror)
    }

    function ondata (data) {
      const match1 = data.indexOf('To connect to this shell,') > -1
      if (match1) step++

      const match2 = data.indexOf('hypershell ') > -1
      if (match2) step++

      if (step === 2) {
        cleanup()
        resolve()
      }
    }

    function onstderror (data) {
      cleanup()
      reject(new Error(data))
    }

    function onerror (err) {
      cleanup()
      reject(err)
    }
  })
}
