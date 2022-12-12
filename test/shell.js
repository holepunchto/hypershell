const test = require('brittle')
const { spawn } = require('child_process')
const { create, BIN_SERVER, BIN_CLIENT } = require('./helpers/index.js')
// const DHT = require('@hyperswarm/dht')

test('basic shell', async function (t) {
  t.plan(6)

  const { clientkey, serverkey, firewall, serverKeyPair } = await create(t)

  const server = spawn(BIN_SERVER, ['-f', serverkey, '--firewall', firewall, '--testnet'], { timeout: 15000 })
  t.teardown(() => server.kill())

  server.stdout.setEncoding('utf8')
  server.stderr.setEncoding('utf8')

  server.on('spawn', () => t.pass('server spawned'))
  server.on('close', (code) => t.pass('server closed'))
  server.on('error', (error) => t.fail('server error: ' + error.message))

  server.stderr.on('data', (data) => t.fail('server stderr: ' + data))

  await waitForProcess(server)
  await waitForServerReady(server)

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

function waitForServerReady (child) {
  return new Promise((resolve, reject) => {
    let step = 0

    child.stdout.on('data', ondata)
    child.stderr.on('data', onerror)

    function cleanup () {
      child.stdout.removeListener('data', ondata)
      child.stderr.removeListener('data', onerror)
    }

    function ondata (data) {
      if (step === 0) {
        const match = data.startsWith('To connect to this shell,')
        if (!match) reject(new Error('Server first stdout is wrong'))
        step++
      } else if (step === 1) {
        const match = data.startsWith('hypershell ')
        if (!match) reject(new Error('Server second stdout is wrong'))
        cleanup()
        resolve()
      }
    }

    function onerror (data) {
      cleanup()
      reject(new Error(data))
    }
  })
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

/* function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
} */
