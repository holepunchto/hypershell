const os = require('os')
const { EventEmitter } = require('events')

const pty = require('node-pty')
const TTYBuffer = require('./tty-buffer.js')

const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')

module.exports = class TTY extends EventEmitter {
  constructor ({ name, socket, columns, rows, resumable } = {}) {
    super()

    this.name = name || null
    this.activeSocket = null
    this.resumable = !!resumable

    this.pty = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: columns,
      rows,
      cwd: process.env.HOME,
      env: process.env
    })

    this.buffer = new TTYBuffer()

    this.pty.on('data', (data) => {
      // console.log('tty data', { data: data.toString() }) // .replace(/\x1b[^m]*m/g, '')
      if (typeof data === 'string') data = Buffer.from(data)
      this.buffer.add(data)
      this.emit('data', data)
    })

    this.pty.on('exit', (code) => {
      if (this.activeSocket) {
        this.activeSocket.destroy()
        this.activeSocket = null
      }

      this.pty = null
      this.emit('exit', code)
    })

    // this.pty.write('stty raw -echo\r')
    // this.pty.write('stty -echo\r')

    if (socket) this.attach(socket)
  }

  attach (socket) {
    if (this.activeSocket) this.activeSocket.destroy()

    this.activeSocket = socket

    const ondata = data => socket.write(data)
    this.on('data', ondata)

    socket.on('data', (data) => {
      const str = data.toString()
      // console.log('server sent this', typeof data, { str })
      this.write(str)
    })

    socket.on('error', () => socket.destroy())

    socket.on('close', () => {
      this.removeListener('data', ondata)
      if (this.activeSocket === socket) this.activeSocket = null
      if (!this.resumable) this.kill()
    })

    const buf = this.resume()
    if (buf.length) {
      // console.log('buf resume', { data: buf.toString() })
      socket.write(buf)
    }
  }

  resize (cols, rows) {
    if (this.pty) this.pty.resize(cols, rows)
  }

  write (data) {
    if (this.pty) this.pty.write(data)
  }

  resume () {
    return this.buffer.toBuffer()
  }

  kill (signal) {
    if (this.pty) this.pty.kill(signal)
  }
}
