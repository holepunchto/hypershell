const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const Protomux = require('protomux')
const c = require('compact-encoding')
const goodbye = require('graceful-goodbye')
const m = require('../messages.js')
const { SHELLDIR } = require('../constants.js')
const tar = require('tar-fs')

const EMPTY = Buffer.alloc(0)

module.exports = async function (serverPublicKey, options = {}) {
  const keyfile = path.resolve(options.f)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

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

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: m.handshake,
    messages: [
      { encoding: c.buffer }, // stdin
      { encoding: c.buffer, onmessage: onstdout }, // stdout
      { encoding: c.buffer, onmessage: onstderr }, // stderr
      { encoding: c.uint, onmessage: onexitcode }, // exit code
      { encoding: m.resize }, // resize
      { encoding: m.buffer }, // upload files
      { encoding: m.buffer, onmessage: ondownload } // download files
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

  const spawn = parseVariadic(this.rawArgs)
  const [command = '', ...args] = spawn

  if (options.uploadSource && options.uploadTarget) {
    const source = path.resolve(options.uploadSource)
    const st = fs.lstatSync(source)

    channel.open({
      upload: { target: options.uploadTarget }
    })

    const header = { isDirectory: st.isDirectory() }
    channel.messages[5].send(Buffer.from(JSON.stringify(header)))

    const pack = tar.pack(source)

    /* pack.once('error', function (error) {
      console.error(error)
      channel.close()
    }) */

    pipeToMessage(pack, channel.messages[5])

    this.userData = {
      upload: { pack }
    }

    return
  }

  if (options.downloadSource && options.downloadTarget) {
    const target = path.resolve(options.downloadTarget)

    channel.open({
      download: { source: options.downloadSource }
    })

    channel.userData = {
      download: { extract: null, target }
    }

    return
  }

  channel.open({
    spawn: {
      file: command || '',
      args: args || [],
      width: process.stdout.columns,
      height: process.stdout.rows
    }
  })

  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  process.stdin.on('data', function (data) {
    channel.messages[0].send(data)
  })

  function onstdout (data) {
    process.stdout.write(data)
  }

  function onstderr (data) {
    process.stderr.write(data)
  }

  function onexitcode (code) {
    process.exitCode = code
  }

  process.stdout.on('resize', function () {
    channel.messages[4].send({
      width: process.stdout.columns,
      height: process.stdout.rows
    })
  })

  socket.on('error', function (error) {
    if (error.code === 'ECONNRESET') console.error('Connection closed.')
    else if (error.code === 'ETIMEDOUT') console.error('Connection timed out.')
    else if (error.code === 'PEER_NOT_FOUND') console.error(error.message)
    else if (error.code === 'PEER_CONNECTION_FAILED') console.error(error.message, '(probably firewalled)')
    else console.error(error)

    process.exitCode = 1
  })

  socket.once('close', function () {
    process.exit()
  })
}

function ondownload (data, channel) {
  const { download } = channel.userData

  if (!download.extract) {
    const header = JSON.parse(data.toString())
    const { isDirectory } = header
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

  if (data.length) download.extract.write(data)
  else download.extract.end()
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function parseVariadic (rawArgs) {
  const index = rawArgs.indexOf('--')
  const variadic = index === -1 ? null : rawArgs.splice(index + 1)
  return variadic || []
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
