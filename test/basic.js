const test = require('brittle')
const path = require('path')
const { create, spawnServer, spawnClient, spawnKeygen } = require('./helpers/index.js')

test('basic keygen', async function (t) {
  t.plan(3)

  const { root } = await create(t)
  const keyfile = path.join(root, 'peer-random')

  const keygen = await spawnKeygen(t, { keyfile })
  keygen.on('close', (code) => t.pass('keygen closed: ' + code))

  keygen.stdout.on('data', (data) => {
    if (data.indexOf('Generating key') > -1) t.pass('generating key')
    if (data.indexOf('Your key has been saved') > -1) t.pass('key saved')
  })
})

test('basic shell', async function (t) {
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

      client.kill('SIGINT')
      client.once('close', () => server.kill())
    }
  })

  client.stdin.write(Buffer.from(' HYPERSHELL_TEST_ENV="1234"\n echo "The number is: $HYPERSHELL_TEST_ENV"\n'))
  // client.stdin.end()
})
