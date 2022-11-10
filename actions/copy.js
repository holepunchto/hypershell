const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const Protomux = require('protomux')
const c = require('compact-encoding')
const goodbye = require('graceful-goodbye')
const m = require('../messages.js')
const { SHELLDIR } = require('../constants.js')
const tar = require('tar-fs')
const os = require('os')

const EMPTY = Buffer.alloc(0)

module.exports = async function (sourcePath, targetPath, options = {}) {
  let serverPublicKey = null
  let fileOperation = null
  console.log('copy', { sourcePath, targetPath, options })

  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  // + reuse
  if (sourcePath[0] === '@') {
    const i = sourcePath.indexOf(':')
    if (i === -1) errorAndExit('Invalid source path. For example: @name-or-public-key:/path/to/file')
    fileOperation = 'download'
    serverPublicKey = sourcePath.slice(1, i)
    sourcePath = sourcePath.slice(i + 1)
  } else if (targetPath[0] === '@') {
    const i = targetPath.indexOf(':')
    if (i === -1) errorAndExit('Invalid target path. For example: @name-or-public-key:/path/to/file')
    fileOperation = 'upload'
    serverPublicKey = targetPath.slice(1, i)
    targetPath = targetPath.slice(i + 1)
  } else {
    errorAndExit('Invalid source and target paths.')
  }

  console.log({ serverPublicKey })
  console.log({ fileOperation, sourcePath, targetPath })

  for (const peer of readKnownPeers()) {
    if (peer.name === serverPublicKey) {
      serverPublicKey = peer.publicKey
      break
    }
  }
  serverPublicKey = Buffer.from(serverPublicKey, 'hex')

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const socket = node.connect(serverPublicKey, { keyPair })
  goodbye(() => socket.end(), 1)
  socket.once('close', () => node.destroy())

  socket.on('error', function (error) {
    if (error.code === 'ECONNRESET') console.error('Connection closed.')
    else if (error.code === 'ETIMEDOUT') console.error('Connection timed out.')
    else if (error.code === 'PEER_NOT_FOUND') console.error(error.message)
    else if (error.code === 'PEER_CONNECTION_FAILED') console.error(error.message, '(probably firewalled)')
    else console.error(error)

    process.exitCode = 1
  })

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell-copy',
    id: null,
    handshake: m.handshake,
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

  // fileOperation: download
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

function readKnownPeers () {
  const filename = path.join(SHELLDIR, 'known_peers')

  if (!fs.existsSync(filename)) {
    console.log('Notice: creating default known peers', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <name> <public key>\n', { flag: 'wx' })
  }

  try {
    return fs.readFileSync(filename, 'utf8')
      .split('\n')
      .map(line => {
        line = line.replace(/\s+/g, ' ').trim()
        line = line.replace(/#.*$/, '').trim()
        const i = line.indexOf(' ')
        if (i > -1) return [line.slice(0, i), line.slice(i + 1)]
      })
      .filter(m => m && m[0] && m[1])
      .map(m => ({ name: m[0], publicKey: m[1] }))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function pipeToMessage (stream, message) {
  stream.on('data', function (chunk) {
    message.send(chunk)
  })

  stream.once('end', function () {
    message.send(EMPTY)
  })
}

// Based on expand-home-dir
function resolveHomedir (str) {
  if (!str) return str
  if (str === '~') return os.homedir()
  if (str.slice(0, 2) !== '~/') return str
  return path.join(os.homedir(), str.slice(2))
}
