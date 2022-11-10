const fs = require('fs')
const path = require('path')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const tar = require('tar-fs')
const os = require('os')
const ClientSocket = require('../lib/client-socket.js')

const EMPTY = Buffer.alloc(0)

module.exports = async function (sourcePath, targetPath, options = {}) {
  const fileOperation = sourcePath[0] === '@' ? 'download' : 'upload'
  let serverPublicKey = null

  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  if (sourcePath[0] === '@') {
    [serverPublicKey, sourcePath] = parseRemotePath(sourcePath)
    if (!sourcePath) errorAndExit('Invalid source path.')
  } else if (targetPath[0] === '@') {
    [serverPublicKey, targetPath] = parseRemotePath(targetPath)
    if (!targetPath) errorAndExit('Invalid target path.')
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
  const i = str.indexOf(':')
  if (i === -1) return [null, null]
  return [str.slice(1, i), str.slice(i + 1)] // [host, path]
}

// Based on expand-home-dir
function resolveHomedir (str) {
  if (!str) return str
  if (str === '~') return os.homedir()
  if (str.slice(0, 2) !== '~/') return str
  return path.join(os.homedir(), str.slice(2))
}
