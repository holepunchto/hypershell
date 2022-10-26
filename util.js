const path = require('path')
const os = require('os')

const shelldir = path.join(os.homedir(), '.hypershell')

module.exports = {
  shelldir,
  errorAndExit
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
