const os = require('os')
const path = require('path')
const createTestnet = require('@hyperswarm/testnet')

const testnet = { ready: null, swarm: null }

module.exports = {
  SHELLDIR: path.join(os.homedir(), '.hypershell'),
  useTestnet
}

async function useTestnet () {
  let swarm = await createTestnet(1, { host: '127.0.0.1', port: 49737 })

  const bootstrap = swarm.nodes[0].address()
  if (bootstrap.port !== 49737) {
    await swarm.destroy()

    swarm = await createTestnet(0)
    swarm.bootstrap.push([{ host: '127.0.0.1', port: 49737 }])
  }

  return swarm
}

/* async function useTestnet () {
  if (testnet.ready) return testnet.ready

  let ready = null
  testnet.ready = new Promise(resolve => {
    ready = resolve
  })

  let swarm = await createTestnet(1, { host: '127.0.0.1', port: 49737 })

  const bootstrap = swarm.nodes[0].address()
  if (bootstrap.port !== 49737) {
    await swarm.destroy()

    swarm = await createTestnet(0)
    swarm.bootstrap.push([{ host: '127.0.0.1', port: 49737 }])
  }

  ready(testnet.swarm)

  return testnet.swarm
} */
