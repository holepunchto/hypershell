const fs = require('fs')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const readFile = require('read-file-live')
const tar = require('tar-fs')
const { ShellServer } = require('../lib/shell.js')
const { LocalTunnelServer } = require('../lib/local-tunnel.js')
const { UploadServer } = require('../lib/upload.js')

const EMPTY = Buffer.alloc(0)

module.exports = async function (options = {}) {
  const keyfile = path.resolve(options.f)
  const firewall = path.resolve(options.firewall)

  if (!fs.existsSync(keyfile)) errorAndExit(keyfile + ' not exists.')

  let allowed = readAuthorizedPeers(firewall)
  const unwatchFirewall = readFile(firewall, function (buf) {
    allowed = readAuthorizedPeers(buf)
  })
  goodbye(() => unwatchFirewall(), 2)

  const seed = Buffer.from(fs.readFileSync(keyfile, 'utf8'), 'hex')
  const keyPair = DHT.keyPair(seed)

  const node = new DHT()
  goodbye(() => node.destroy(), 2)

  const server = node.createServer({ firewall: onFirewall })
  goodbye(() => server.close(), 1)

  server.on('connection', onConnection)

  await server.listen(keyPair)

  console.log('To connect to this shell, on another computer run:')
  console.log('hypershell ' + keyPair.publicKey.toString('hex'))
  console.log()

  function onFirewall (remotePublicKey, remoteHandshakePayload) {
    for (const publicKey of allowed) {
      if (remotePublicKey.equals(publicKey)) {
        console.log('Firewall allowed:', remotePublicKey.toString('hex'))
        return false
      }
    }

    console.log('Firewall denied:', remotePublicKey.toString('hex'))
    return true
  }
}

function onConnection (socket) {
  const node = this.dht

  socket.on('close', () => console.log('Socket disconnect', socket.remotePublicKey.toString('hex')))
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const ungoodbye = goodbye(() => {
    socket.end()
    return waitForSocketTermination(socket)
  }, 1)
  socket.once('close', () => ungoodbye())

  const mux = new Protomux(socket)

  mux.pair({ protocol: 'hypershell', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell', id: null })) return console.log('Protocol (spawn) was already open')

    const shell = new ShellServer({ node, socket, mux })
    if (!shell.channel) return console.log('Protocol (spawn) could not been created')

    shell.open()
  })

  mux.pair({ protocol: 'hypershell-upload', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-upload', id: null })) return console.log('Protocol (upload) was already open')

    const upload = new UploadServer({ node, socket, mux })
    if (!upload.channel) return console.log('Protocol (upload) could not been created')

    upload.open()
  })

  mux.pair({ protocol: 'hypershell-download', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-download', id: null })) return console.log('Protocol (download) was already open')

    const channel = mux.createChannel({
      protocol: 'hypershell-download',
      id: null,
      handshake: m.handshakeDownload,
      onopen (handshake) {
        const { source } = handshake

        try {
          const st = fs.lstatSync(source)
          this.messages[0].send({ isDirectory: st.isDirectory() })
        } catch (error) {
          this.messages[1].send(error)
          this.close()
          return
        }

        const pack = tar.pack(source)
        this.userData = { pack }

        pack.once('error', (error) => {
          this.messages[1].send(error)
          this.close()
        })

        pack.on('data', (chunk) => this.messages[2].send(chunk))
        pack.once('end', () => this.messages[2].send(EMPTY))
      },
      messages: [
        { encoding: m.downloadHeader }, // header
        { encoding: m.error }, // errors
        { encoding: c.raw } // data
      ],
      onclose () {
        if (this.userData) this.userData.pack.destroy()
      }
    })

    if (!channel) return console.log('Protocol (download) could not been created')

    channel.open({})
  })

  mux.pair({ protocol: 'hypershell-tunnel-local', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-tunnel-local', id: null })) return console.log('Protocol (tunnel-local) was already open')

    const tunnel = new LocalTunnelServer({ node, socket, mux })
    if (!tunnel.channel) return console.log('Protocol (tunnel-local) could not been created')

    tunnel.open({})
  })
}

function readAuthorizedPeers (filename) {
  if (typeof filename === 'string' && !fs.existsSync(filename)) {
    console.log('Notice: creating default firewall', filename)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '# <public key>\n', { flag: 'wx' })
  }

  try {
    const list = typeof filename === 'string' ? fs.readFileSync(filename, 'utf8') : (filename || '').toString()
    return list
      .split('\n')
      .map(line => {
        line = line.replace(/\s+/g, ' ').trim()
        line = line.replace(/#.*$/, '').trim()
        return line
      })
      .filter(m => m)
      .map(v => Buffer.from(v, 'hex'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}

function waitForSocketTermination (socket) {
  return new Promise((resolve) => {
    const isClosed = socket.rawStream._closed
    const isReadableEnded = socket.rawStream._readableState.ended
    const isWritableEnded = socket.rawStream._writableState.ended

    // console.log('socket term', { isClosed, isReadableEnded, isWritableEnded })
    // waitForSocketTermination { isClosed: false, isReadableEnded: true, isWritableEnded: true }
    // + that doesn't trigger a close event?

    if (isReadableEnded && isWritableEnded) {
      resolve()
      return
    }

    // + timeout end destroy?

    if (isClosed) {
      resolve()
      return
    }

    socket.on('end', onend)
    socket.on('close', onclose)

    function onend () {
      // console.log('socket term (onend)', { isClosed, isReadableEnded, isWritableEnded })
      onterm()
    }

    function onclose () {
      // console.log('socket term (onclose)', { isClosed, isReadableEnded, isWritableEnded })
      onterm()
    }

    function onterm () {
      socket.removeListener('end', onend)
      socket.removeListener('close', onclose)
      resolve()
    }
  })
}
