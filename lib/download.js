const fs = require('fs')
const path = require('path')
const c = require('compact-encoding')
const m = require('../messages.js')
const tar = require('tar-fs')
const os = require('os')

const EMPTY = Buffer.alloc(0)

class DownloadServer {
  constructor ({ mux }) {
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

    this.pack = null
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

    this.pack = tar.pack(source)

    this.pack.once('error', (error) => {
      this.channel.messages[1].send(error)
      this.channel.close()
    })

    this.pack.on('data', (chunk) => this.channel.messages[2].send(chunk))
    this.pack.once('end', () => this.channel.messages[2].send(EMPTY))
  }

  onclose () {
    if (this.pack) this.pack.destroy()
  }
}

class DownloadClient {
  constructor ({ sourcePath, targetPath }, { socket, mux }) {
    this.sourcePath = sourcePath
    this.targetPath = path.resolve(resolveHomedir(targetPath))

    this.socket = socket

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

    this.extract = null
  }

  open () {
    this.channel.open({ source: this.sourcePath })
  }

  onopen () {}

  onclose () {
    this.socket.end()

    if (this.extract) this.extract.destroy()
  }

  ondownloadheader (data, c) {
    const { isDirectory } = data

    const dir = isDirectory ? this.targetPath : path.dirname(this.targetPath)
    const opts = {
      readable: true,
      writable: true,
      map: (header) => {
        if (!isDirectory) header.name = path.basename(this.targetPath)
        return header
      }
    }

    this.extract = tar.extract(dir, opts)

    this.extract.once('error', function (error) {
      console.error(error)
      c.close()
    })

    this.extract.once('finish', function () {
      c.close()
    })
  }

  ondownloaderror (data, c) {
    if (data.code === 'ENOENT') console.error('hypershell-server:', data.path + ': No such file or directory')
    else console.error(data.message)

    c.close()
  }

  ondownload (data, c) {
    if (data.length) this.extract.write(data)
    else this.extract.end()
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
