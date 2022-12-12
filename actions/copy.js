const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const { ClientSocket } = require('../lib/client-socket.js')
const { UploadClient } = require('../lib/upload.js')
const { DownloadClient } = require('../lib/download.js')

const publicKeyExpr = /^([a-fA-F0-9]{64}|[ybndrfg8ejkmcpqxot1uwisza345h769]{52}):/i

module.exports = async function (sourcePath, targetPath, options = {}) {
  const fileOperation = sourcePath[0] === '@' || publicKeyExpr.test(sourcePath) ? 'download' : 'upload'
  let serverPublicKey = null

  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  if (sourcePath[0] === '@' || publicKeyExpr.test(sourcePath)) {
    [serverPublicKey, sourcePath] = parseRemotePath(sourcePath)
    if (!serverPublicKey || !sourcePath) errorAndExit('Invalid source path.')
  } else if (targetPath[0] === '@' || publicKeyExpr.test(targetPath)) {
    [serverPublicKey, targetPath] = parseRemotePath(targetPath)
    if (!serverPublicKey || !targetPath) errorAndExit('Invalid target path.')
  } else {
    errorAndExit('Invalid source or target path.')
  }

  const { node, socket } = ClientSocket({ keyfile, serverPublicKey, testnet: options.testnet })
  const mux = new Protomux(socket)

  if (fileOperation === 'upload') {
    const upload = new UploadClient({ sourcePath, targetPath }, { node, socket, mux })
    upload.open()
  } else {
    const download = new DownloadClient({ sourcePath, targetPath }, { node, socket, mux })
    download.open()
  }
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function parseRemotePath (str) {
  // str has to start with @ or a public key

  const i = str.indexOf(':')
  if (i === -1) return [null, null]

  const isName = str[0] === '@'
  return [str.slice(isName ? 1 : 0, i), str.slice(i + 1)] // [host, path]
}
