const test = require('brittle')
const path = require('path')
const fs = require('fs')
const { create, spawnServer, spawnClient, spawnCopy, spawnKeygen } = require('./helpers/index.js')

test('keygen', async function (t) {
  t.plan(5)

  const { root } = await create(t)
  const keyfile = path.join(root, 'peer-random')

  t.absent(fs.existsSync(keyfile))

  const keygen = await spawnKeygen(t, { keyfile })
  keygen.on('close', (code) => t.pass('keygen closed: ' + code))

  keygen.stdout.on('data', (data) => {
    if (data.indexOf('Generating key') > -1) t.pass('generating key')
    if (data.indexOf('Your key has been saved') > -1) t.pass('key saved')
  })

  keygen.on('close', () => t.ok(fs.existsSync(keyfile)))
})

test('shell', async function (t) {
  t.plan(4)

  const { clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const server = await spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))

  server.stdout.on('data', (data) => {
    if (data.startsWith('Firewall allowed:')) {
      t.pass('Server firewall allowed')
    }
  })

  const client = await spawnClient(t, serverKeyPair.publicKey.toString('hex'), { clientkey })
  client.on('close', (code) => t.pass('client closed: ' + code))

  client.stdout.on('data', (data) => {
    if (data.indexOf('The number is: 1234\r\n') > -1) {
      t.pass('client stdout match')

      client.kill()
      client.once('close', () => server.kill())
    }
  })

  client.stdin.write(Buffer.from(' HYPERSHELL_TEST_ENV="1234"\n echo "The number is: $HYPERSHELL_TEST_ENV"\n'))
  // client.stdin.end()
})

test('copy - upload (absolute path)', async function (t) {
  t.plan(5)

  const { root, clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const src = path.join(root, 'file-original.txt')
  const dst = path.join(root, 'file-backup.txt')

  fs.writeFileSync(src, 'hello', { flag: 'wx' })
  t.absent(fs.existsSync(dst))

  const server = await spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))

  const pk = serverKeyPair.publicKey.toString('hex')

  const upload = await spawnCopy(t, src, pk + ':' + dst, { clientkey })
  upload.on('close', (code) => t.pass('upload closed: ' + code))

  upload.on('close', () => {
    t.ok(fs.existsSync(dst))
    t.alike(fs.readFileSync(dst), Buffer.from('hello'))

    server.kill()
  })
})

test('copy - download (absolute path)', async function (t) {
  t.plan(5)

  const { root, clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const src = path.join(root, 'file-original.txt')
  const dst = path.join(root, 'file-backup.txt')

  fs.writeFileSync(src, 'hello', { flag: 'wx' })
  t.absent(fs.existsSync(dst))

  const server = await spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))

  const pk = serverKeyPair.publicKey.toString('hex')

  const download = await spawnCopy(t, pk + ':' + src, dst, { clientkey })
  download.on('close', (code) => t.pass('download closed: ' + code))

  download.on('close', () => {
    t.ok(fs.existsSync(dst))
    t.alike(fs.readFileSync(dst), Buffer.from('hello'))

    server.kill()
  })
})
