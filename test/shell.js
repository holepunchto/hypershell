const test = require('brittle')
const { spawn } = require('child_process')
const { create, spawnServer, waitForProcess, BIN_CLIENT } = require('./helpers/index.js')
// const DHT = require('@hyperswarm/dht')

test('basic shell', async function (t) {
  t.plan(5)

  const { clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const server = await spawnServer(t, { serverkey, firewall })
  server.once('close', () => t.pass('server closed'))

  server.stdout.on('data', (data) => {
    if (data.startsWith('Firewall allowed:')) {
      t.pass('Server firewall allowed')
    }
  })

  const client = spawn(BIN_CLIENT, [serverKeyPair.publicKey.toString('hex'), '-f', clientkey, '--testnet'], { timeout: 15000 })
  t.teardown(() => client.kill())

  client.stdout.setEncoding('utf8')
  client.stderr.setEncoding('utf8')

  client.on('spawn', () => t.pass('client spawned'))
  client.on('close', (code) => t.pass('client closed: ' + code))
  client.on('error', (error) => t.fail('client error: ' + error.message))

  await waitForProcess(client)

  client.stdout.on('data', (data) => {
    if (data.indexOf('The number is: 1234\r\n') > -1) {
      t.pass('client stdout match')

      client.kill('SIGINT')
      client.once('close', () => server.kill())
    }
  })
  client.stderr.on('data', (data) => t.fail('client stderr: ' + data))

  client.stdin.write(Buffer.from('HYPERSHELL_TEST_ENV="1234"\necho "The number is: $HYPERSHELL_TEST_ENV"\n'))
  // client.stdin.end()
})
