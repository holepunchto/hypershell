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
    if (!sourcePath) errorAndExit('Invalid source path. For example: @name-or-public-key:/path/to/file')
  } else if (targetPath[0] === '@') {
    [serverPublicKey, targetPath] = parseRemotePath(targetPath)
    if (!targetPath) errorAndExit('Invalid target path. For example: @name-or-public-key:/path/to/file')
  } else {
    errorAndExit('Invalid source or target path.')
  }

  const socket = ClientSocket({ keyfile, serverPublicKey })
  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-copy',
    id: null,
    handshake: m.handshakeCopy,
    messages: [
      { encoding: c.buffer }, // upload files
      { encoding: c.buffer, onmessage: ondownload } // download files
    ],
    onclose () {
      socket.end()

      if (!this.userData) return

      const { download } = this.userData
      if (download && download.extract) download.extract.destroy()

      const { upload } = this.userData
      if (upload && upload.pack) upload.pack.destroy()
    }
  })

  if (fileOperation === 'upload') {
    channel.open({
      upload: { target: targetPath }
    })

    const source = path.resolve(resolveHomedir(sourcePath))
    let st
    try {
      st = fs.lstatSync(source)
    } catch (error) {
      if (error.code === 'ENOENT') console.log(source + ': No such file or directory')
      else console.error(error.message)

      // channel.close()
      socket.destroy()
      return
    }

    const header = { isDirectory: st.isDirectory() }
    channel.messages[0].send(Buffer.from(JSON.stringify(header)))

    const pack = tar.pack(source)

    pack.once('error', function (error) {
      console.error(error.message)
      channel.close()
    })

    pipeToMessage(pack, channel.messages[0])

    this.userData = {
      upload: { pack }
    }

    return
  }

  // File operation: download
  const target = path.resolve(resolveHomedir(targetPath))

  channel.open({
    download: { source: sourcePath }
  })

  channel.userData = {
    download: { extract: null, target }
  }
}

function ondownload (data, channel) {
  const { download } = channel.userData

  if (!download.extract) {
    const header = JSON.parse(data.toString())
    const { error, isDirectory } = header

    if (error) {
      if (error.code === 'ENOENT') console.log('hypershell-server:', error.path + ': No such file or directory')
      else console.error(error.message)

      channel.close()
      return
    }

    const targetDir = isDirectory ? download.target : path.dirname(download.target)

    const extract = tar.extract(targetDir, {
      readable: true,
      writable: true,
      map (header) {
        if (!isDirectory) header.name = path.basename(download.target)
        return header
      }
    })

    extract.on('error', function (error) {
      console.error(error)
      channel.close()
    })

    extract.on('finish', function () {
      channel.close()
    })

    download.extract = extract

    return
  }

  if (data) download.extract.write(data)
  else download.extract.end()
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function pipeToMessage (stream, message) {
  stream.on('data', function (chunk) {
    message.send(chunk)
  })

  stream.once('end', function () {
    message.send(EMPTY)
  })
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
