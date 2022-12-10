const fs = require('fs')
const path = require('path')
const c = require('compact-encoding')
const m = require('../messages.js')
const tar = require('tar-fs')
const os = require('os')

const EMPTY = Buffer.alloc(0)

class UploadServer {
  constructor ({ node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell-upload',
      id: null,
      handshake: m.handshakeUpload,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        null, // no header
        { encoding: m.error }, // errors
        { encoding: c.raw, onmessage: this.onupload.bind(this) } // data
      ]
    })
  }

  open () {
    this.channel.open({})
  }

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
    this.channel.userData = { extract }

    extract.once('error', (error) => {
      this.channel.messages[1].send(error)
      this.channel.close()
    })

    extract.once('finish', () => this.channel.close())
  }

  onclose () {
    if (this.channel.userData) this.channel.userData.extract.destroy()
  }

  onupload (data, c) {
    const { extract } = c.userData
    if (data.length) extract.write(data)
    else extract.end()
  }
}

class UploadClient {
  constructor ({ sourcePath, targetPath }, { node, socket, mux }) {
    this.sourcePath = sourcePath
    this.targetPath = targetPath

    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell-upload',
      id: null,
      handshake: m.handshakeUpload,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        null, // no header
        { encoding: m.error, onmessage: this.onuploaderror.bind(this) }, // errors
        { encoding: c.raw } // data
      ]
    })
  }

  open () {
    const source = path.resolve(resolveHomedir(this.sourcePath))

    try {
      const st = fs.lstatSync(source)

      this.channel.open({
        target: this.targetPath,
        isDirectory: st.isDirectory()
      })
    } catch (error) {
      if (error.code === 'ENOENT') console.log(source + ': No such file or directory')
      else console.error(error.message)

      this.socket.destroy()
      return
    }

    const pack = tar.pack(source)
    this.channel.userData = { pack }

    pack.once('error', (error) => {
      console.error(error.message)
      this.channel.close()
    })

    pack.on('data', (chunk) => this.channel.messages[2].send(chunk))
    pack.once('end', () => this.channel.messages[2].send(EMPTY))
  }

  onopen () {}

  onclose () {
    this.socket.end()

    if (this.channel.userData) this.channel.userData.pack.destroy()
  }

  onuploaderror (data, c) {
    console.error('hypershell-server:', data)
    c.close()
  }
}

module.exports = { UploadServer, UploadClient }

// Based on expand-home-dir
function resolveHomedir (str) {
  if (!str) return str
  if (str === '~') return os.homedir()
  if (str.slice(0, 2) !== '~/') return str
  return path.join(os.homedir(), str.slice(2))
}
