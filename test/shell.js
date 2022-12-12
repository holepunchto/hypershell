const test = require('brittle')
const { create, spawnServer, spawnClient } = require('./helpers/index.js')

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

  client.stdin.write(Buffer.from('HYPERSHELL_TEST_ENV="1234"\necho "The number is: $HYPERSHELL_TEST_ENV"\n'))
  // client.stdin.end()
})
