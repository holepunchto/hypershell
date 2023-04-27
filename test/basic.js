const test = require('brittle')
const path = require('path')
const fs = require('fs')
const { create, spawnKeygen, spawnServer, spawnClient, spawnCopy, waitForProcess, waitForServerReady } = require('./helpers/index.js')
const { shellFile } = require('../lib/shell.js')

test('keygen', async function (t) {
  t.plan(6)

  const { root } = await create(t)
  const keyfile = path.join(root, 'peer-random')
  t.absent(fs.existsSync(keyfile))

  const keygen = spawnKeygen(t, { keyfile })
  keygen.on('close', (code) => t.pass('keygen closed: ' + code))

  keygen.stdout.on('data', (data) => {
    if (data.indexOf('Generating key') > -1) t.pass('generating key')
    if (data.indexOf('Your key has been saved') > -1) t.pass('key saved')
  })

  keygen.on('close', () => {
    t.ok(fs.existsSync(keyfile))
    if (process.platform === 'win32') {
      t.pass('No user-specific file permissions on windows')
    } else {
      const mode = fs.statSync(keyfile).mode.toString(8) // byte repr
      const permissions = mode.slice(-3)
      t.is(permissions, '600') // Only user can access
    }
  })

  await waitForProcess(keygen)
})

test('shell', async function (t) {
  t.plan(4)

  const { clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const server = spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))

  server.stdout.on('data', (data) => {
    if (data.startsWith('Firewall allowed:')) {
      t.pass('Server firewall allowed')
    }
  })

  await waitForServerReady(server)

  const client = spawnClient(t, serverKeyPair.publicKey.toString('hex'), { clientkey })
  client.on('close', (code) => t.pass('client closed: ' + code))

  client.stdout.on('data', (data) => {
    if (data.indexOf('The number is: 1234') > -1) {
      t.pass('client stdout match')

      client.kill()
      client.once('close', () => server.kill())
    }
  })

  await waitForProcess(client)

  if (shellFile.indexOf('powershell.exe') > -1) {
    client.stdin.write(Buffer.from(' $env:HYPERSHELL_TEST_ENV="1234"\r\n echo "The number is: $env:HYPERSHELL_TEST_ENV"\r\n'))
  } else {
    client.stdin.write(Buffer.from(' HYPERSHELL_TEST_ENV="1234"\n echo "The number is: $HYPERSHELL_TEST_ENV"\n'))
  }
  // client.stdin.end()
})

test('copy - upload (absolute path)', async function (t) {
  t.plan(5)

  const { root, clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const src = path.join(root, 'file-original.txt')
  const dst = path.join(root, 'file-backup.txt')

  fs.writeFileSync(src, 'hello', { flag: 'wx' })
  t.absent(fs.existsSync(dst))

  const server = spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))
  await waitForServerReady(server)

  const pk = serverKeyPair.publicKey.toString('hex')

  const upload = spawnCopy(t, src, pk + ':' + dst, { clientkey })
  upload.on('close', (code) => t.pass('upload closed: ' + code))

  upload.on('close', () => {
    t.ok(fs.existsSync(dst))
    t.alike(fs.readFileSync(dst), Buffer.from('hello'))

    server.kill()
  })

  await waitForProcess(upload)
})

test('copy - download (absolute path)', async function (t) {
  t.plan(5)

  const { root, clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const src = path.join(root, 'file-original.txt')
  const dst = path.join(root, 'file-backup.txt')

  fs.writeFileSync(src, 'hello', { flag: 'wx' })
  t.absent(fs.existsSync(dst))

  const server = spawnServer(t, { serverkey, firewall })
  server.once('close', (code) => t.pass('server closed: ' + code))
  await waitForServerReady(server)

  const pk = serverKeyPair.publicKey.toString('hex')

  const download = spawnCopy(t, pk + ':' + src, dst, { clientkey })
  download.on('close', (code) => t.pass('download closed: ' + code))

  download.on('close', () => {
    t.ok(fs.existsSync(dst))
    t.alike(fs.readFileSync(dst), Buffer.from('hello'))

    server.kill()
  })

  await waitForProcess(download)
})
