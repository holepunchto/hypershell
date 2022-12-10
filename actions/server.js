const fs = require('fs')
const os = require('os')
const path = require('path')
const DHT = require('@hyperswarm/dht')
const goodbye = require('graceful-goodbye')
const PTY = require('tt-native')
const Protomux = require('protomux')
const c = require('compact-encoding')
const m = require('../messages.js')
const readFile = require('read-file-live')
const tar = require('tar-fs')
const net = require('net')
const pump = require('pump')

const isWin = os.platform() === 'win32'
const shellFile = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash')
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

    const channel = mux.createChannel({
      protocol: 'hypershell',
      id: null,
      handshake: m.handshakeSpawn,
      onopen (handshake) {
        let pty
        try {
          pty = PTY.spawn(handshake.file || shellFile, handshake.args, {
            cwd: os.homedir(),
            env: process.env,
            width: handshake.width,
            height: handshake.height
          })
        } catch (error) {
          this.messages[3].send(1)
          this.messages[2].send(Buffer.from(error.toString() + '\n'))
          this.close()
          return
        }

        pty.on('data', (data) => {
          this.messages[1].send(data)
        })

        pty.once('exit', (code) => {
          this.messages[3].send(code)
        })

        pty.once('close', () => {
          this.close()
        })

        this.userData = { pty }
      },
      messages: [
        { encoding: c.buffer, onmessage: onstdin }, // stdin
        { encoding: c.buffer }, // stdout
        { encoding: c.buffer }, // stderr
        { encoding: c.uint }, // exit code
        { encoding: m.resize, onmessage: onresize } // resize
      ],
      onclose () {
        if (!this.userData) return

        const { pty } = this.userData
        if (pty) {
          try {
            pty.kill('SIGKILL')
          } catch {} // ignore "Process has exited"
        }
      }
    })

    if (!channel) return console.log('Protocol (spawn) could not been created')

    channel.open({})
  })

  mux.pair({ protocol: 'hypershell-upload', id: null }, function () {
    if (mux.opened({ protocol: 'hypershell-upload', id: null })) return console.log('Protocol (upload) was already open')

    const channel = mux.createChannel({
      protocol: 'hypershell-upload',
      id: null,
      handshake: m.handshakeUpload,
      onopen (handshake) {
        const { target, isDirectory } = handshake

        const dir = isDirectory ? target : path.dirname(target)
        const extract = tar.extract(dir, {
          readable: true,
          writable: true,
          map (header) {
            if (!isDirectory) header.name = path.basename(target)
            return header
          }
        })

        extract.once('error', (error) => {
          this.messages[1].send(error)
          this.close()
        })

        extract.once('finish', () => this.close())

        this.userData = { extract }
      },
      messages: [
        null, // no header
        { encoding: m.error }, // errors
        { encoding: c.raw, onmessage: onupload } // data
      ],
      onclose () {
        if (this.userData) this.userData.extract.destroy()
      }
    })

    if (!channel) return console.log('Protocol (upload) could not been created')

    channel.open({})
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

    const channel = mux.createChannel({
      protocol: 'hypershell-tunnel-local',
      id: null,
      handshake: c.json,
      onopen (handshake) {
        this.userData = { node, socket, handshake, streams: new Map() } // + try to not pass { node, socket, handshake }
      },
      messages: [
        { encoding: c.json, onmessage: onstreamid },
      ],
      onclose () {
        if (!this.userData) return

        const { streams } = this.userData

        for (const [, stream] of streams) {
          stream.destroy()
        }
      }
    })

    if (!channel) return console.log('Protocol (tunnel-local) could not been created')

    channel.open({})
  })
}

function onstdin (data, channel) {
  const { pty } = channel.userData
  if (data === null) pty.write(EMPTY)
  else pty.write(data)
}

function onresize (data, channel) {
  const { pty } = channel.userData
  pty.resize(data.width, data.height)
}

function onupload (data, channel) {
  const { extract } = channel.userData
  if (data.length) extract.write(data)
  else extract.end()
}

function onstreamid (data, channel) {
  const { node, socket, handshake, streams } = channel.userData
  const { clientId } = data

  const rawStream = node.createRawStream()

  streams.set(rawStream.id, rawStream)
  rawStream.on('close', function () {
    streams.delete(rawStream.id)
  })

  channel.messages[0].send({ clientId, serverId: rawStream.id })

  DHT.connectRawStream(socket, rawStream, clientId)

  const remoteSocket = net.connect(handshake.port, handshake.address)
  rawStream.userData = remoteSocket

  pump(rawStream, remoteSocket, rawStream)
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

function randomIntExcept (current) {
  while (true) {
    const id = (Math.random() * 0x100000000) >>> 0
    if (id !== current) return id
  }
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
