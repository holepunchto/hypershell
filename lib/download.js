const fs = require('fs')
const path = require('path')
const c = require('compact-encoding')
const m = require('../messages.js')
const tar = require('tar-fs')
const os = require('os')

const EMPTY = Buffer.alloc(0)

class DownloadServer {
  constructor ({ node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell-download',
      id: null,
      handshake: m.handshakeDownload,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        { encoding: m.downloadHeader }, // header
        { encoding: m.error }, // errors
        { encoding: c.raw } // data
      ]
    })
  }

  open () {
    this.channel.open({})
  }

  onopen (handshake) {
    const { source } = handshake

    try {
      const st = fs.lstatSync(source)
      this.channel.messages[0].send({ isDirectory: st.isDirectory() })
    } catch (error) {
      this.channel.messages[1].send(error)
      this.channel.close()
      return
    }

    const pack = tar.pack(source)
    this.channel.userData = { pack }

    pack.once('error', (error) => {
      this.channel.messages[1].send(error)
      this.channel.close()
    })

    pack.on('data', (chunk) => this.channel.messages[2].send(chunk))
    pack.once('end', () => this.channel.messages[2].send(EMPTY))
  }

  onclose () {
    if (this.channel.userData) this.channel.userData.pack.destroy()
  }
}

class DownloadClient {
  constructor ({ sourcePath, targetPath }, { node, socket, mux }) {
    this.sourcePath = sourcePath
    this.targetPath = targetPath

    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell-download',
      id: null,
      handshake: m.handshakeDownload,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        { encoding: m.downloadHeader, onmessage: this.ondownloadheader.bind(this) }, // header
        { encoding: m.error, onmessage: this.ondownloaderror.bind(this) }, // errors
        { encoding: c.raw, onmessage: this.ondownload.bind(this) } // data
      ]
    })
  }

  open () {
    const target = path.resolve(resolveHomedir(this.targetPath))
    this.channel.userData = { extract: null, target }

    this.channel.open({ source: this.sourcePath })
  }

  onopen () {}

  onclose () {
    this.socket.end()

    if (!this.channel.userData) return

    const { extract } = this.channel.userData
    if (extract) extract.destroy()
  }

  ondownloadheader (data, c) {
    const { isDirectory } = data

    const dir = isDirectory ? c.userData.target : path.dirname(c.userData.target)
    const opts = {
      readable: true,
      writable: true,
      map (header) {
        if (!isDirectory) header.name = path.basename(c.userData.target)
        return header
      }
    }

    const extract = tar.extract(dir, opts)
    c.userData.extract = extract

    extract.once('error', function (error) {
      console.error(error)
      c.close()
    })

    extract.once('finish', function () {
      c.close()
    })
  }

  ondownloaderror (data, c) {
    if (data.code === 'ENOENT') console.error('hypershell-server:', data.path + ': No such file or directory')
    else console.error(data.message)

    c.close()
  }

  ondownload (data, c) {
    const { extract } = c.userData
    if (data.length) extract.write(data)
    else extract.end()
  }
}

module.exports = { DownloadServer, DownloadClient }

// Based on expand-home-dir
function resolveHomedir (str) {
  if (!str) return str
  if (str === '~') return os.homedir()
  if (str.slice(0, 2) !== '~/') return str
  return path.join(os.homedir(), str.slice(2))
}
