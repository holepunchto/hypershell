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
  socket.on('error', (error) => console.error(error.code, error))

  socket.setKeepAlive(5000)

  const mux = new Protomux(socket)

  const channel = mux.createChannel({
    protocol: 'hypershell',
    id: null,
    handshake: m.handshake,
    onopen (handshake) {
      if (handshake.upload) {
        const { target } = handshake.upload

        this.userData = {
          upload: { extract: null, target }
        }

        return
      }

      if (handshake.download) {
        const source = path.resolve(handshake.download.source)

        let st
        try {
          st = fs.lstatSync(source)
        } catch (error) {
          console.error(error.message) // extra debugging

          const header = { error: { ...error, message: error.message } }
          channel.messages[6].send(Buffer.from(JSON.stringify(header)))
          channel.close()
          return
        }

        const pack = tar.pack(source)

        /* pack.once('error', function (error) {
          console.error(error)
          channel.close()
        }) */

        const header = { isDirectory: st.isDirectory() }
        channel.messages[6].send(Buffer.from(JSON.stringify(header)))

        pipeToMessage(pack, channel.messages[6])

        this.userData = {
          download: { pack }
        }

        return
      }

      if (!handshake.spawn) {
        return
      }

      let pty
      try {
        pty = PTY.spawn(handshake.spawn.file || shellFile, handshake.spawn.args, {
          cwd: process.env.HOME,
          env: process.env,
          width: handshake.spawn.width,
          height: handshake.spawn.height
        })
      } catch (error) {
        channel.messages[3].send(1)
        channel.messages[2].send(Buffer.from(error.toString() + '\n'))
        channel.close()
        return
      }

      pty.on('data', function (data) {
        channel.messages[1].send(data)
      })

      pty.once('exit', function (code) {
        channel.messages[3].send(code)
      })

      pty.once('close', function () {
        channel.close()
      })

      this.userData = { pty }
    },
    messages: [
      { encoding: c.buffer, onmessage: onstdin }, // stdin
      { encoding: c.buffer }, // stdout
      { encoding: c.buffer }, // stderr
      { encoding: c.uint }, // exit code
      { encoding: m.resize, onmessage: onresize }, // resize
      { encoding: m.buffer, onmessage: onupload }, // upload files
      { encoding: m.buffer } // download files
    ],
    onclose () {
      if (!this.userData) return

      const { pty } = this.userData
      if (pty) {
        try {
          pty.kill('SIGKILL')
        } catch {} // ignore "Process has exited"
      }

      const { upload } = this.userData
      if (upload && upload.extract) upload.extract.destroy()

      const { download } = this.userData
      if (download && download.pack) download.pack.destroy()
    }
  })

  channel.open({})
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
  const { upload } = channel.userData

  if (!upload.extract) {
    const header = JSON.parse(data.toString())
    const { isDirectory } = header
    const targetDir = isDirectory ? upload.target : path.dirname(upload.target)

    const extract = tar.extract(targetDir, {
      readable: true,
      writable: true,
      map (header) {
        if (!isDirectory) header.name = path.basename(upload.target)
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

    upload.extract = extract

    return
  }

  if (data.length) upload.extract.write(data)
  else upload.extract.end()
}

function ondownload (data, channel) {
  const { download } = channel.userData

  if (!download.extract) {
    const header = JSON.parse(data.toString())
    const { isDirectory } = header

    const targetDir = isDirectory ? download.target : path.dirname(download.target)
    fs.mkdirSync(targetDir, { recursive: true })

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

function pipeToMessage (stream, message) {
  stream.on('data', function (chunk) {
    message.send(chunk)
  })

  stream.once('end', function () {
    message.send(EMPTY)
  })
}
