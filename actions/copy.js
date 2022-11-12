const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const tar = require('tar-fs')
const os = require('os')
const ClientSocket = require('../lib/client-socket.js')

const EMPTY = Buffer.alloc(0)
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

  const socket = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket)

  if (fileOperation === 'upload') {
    const upload = mux.createChannel({
      protocol: 'hypershell-upload',
      id: null,
      handshake: m.handshakeUpload,
      messages: [
        null, // no header
        { encoding: m.error, onuploaderror }, // errors
        { encoding: c.raw } // data
      ],
      onclose () {
        socket.end()

        if (upload.userData.pack) upload.userData.pack.destroy()
      }
    })

    const source = path.resolve(resolveHomedir(sourcePath))

    try {
      const st = fs.lstatSync(source)

      upload.open({
        target: targetPath,
        isDirectory: st.isDirectory()
      })
    } catch (error) {
      if (error.code === 'ENOENT') console.log(source + ': No such file or directory')
      else console.error(error.message)

      socket.destroy()
      return
    }

    const pack = tar.pack(source)
    upload.userData = { pack }

    pack.once('error', function (error) {
      console.error(error.message)
      upload.close()
    })

    pack.on('data', (chunk) => upload.messages[2].send(chunk))
    pack.once('end', () => upload.messages[2].send(EMPTY))
  } else {
    const download = mux.createChannel({
      protocol: 'hypershell-download',
      id: null,
      handshake: m.handshakeDownload,
      messages: [
        { encoding: m.downloadHeader, onmessage: ondownloadheader }, // header
        { encoding: m.error, onmessage: ondownloaderror }, // errors
        { encoding: c.raw, onmessage: ondownload } // data
      ],
      onclose () {
        socket.end()

        if (!download.userData) return

        const { extract } = download.userData
        if (extract) extract.destroy()
      }
    })

    const target = path.resolve(resolveHomedir(targetPath))

    download.open({
      source: sourcePath
    })

    download.userData = {
      extract: null,
      target
    }
  }
}

function onuploaderror (data, channel) {
  console.error('hypershell-server:', data)
  channel.close()
}

function ondownloadheader (data, channel) {
  const { isDirectory } = data

  const dir = isDirectory ? channel.userData.target : path.dirname(channel.userData.target)
  const opts = {
    readable: true,
    writable: true,
    map (header) {
      if (!isDirectory) header.name = path.basename(channel.userData.target)
      return header
    }
  }

  const extract = tar.extract(dir, opts)
  channel.userData.extract = extract

  extract.once('error', function (error) {
    console.error(error)
    channel.close()
  })

  extract.once('finish', function () {
    channel.close()
  })
}

function ondownloaderror (data, channel) {
  if (data.code === 'ENOENT') console.error('hypershell-server:', data.path + ': No such file or directory')
  else console.error(data.message)

  channel.close()
}

function ondownload (data, channel) {
  const { extract } = channel.userData
  if (data.length) extract.write(data)
  else extract.end()
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

// Based on expand-home-dir
function resolveHomedir (str) {
  if (!str) return str
  if (str === '~') return os.homedir()
  if (str.slice(0, 2) !== '~/') return str
  return path.join(os.homedir(), str.slice(2))
}
