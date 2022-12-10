const os = require('os')
const c = require('compact-encoding')
const m = require('../messages.js')
const PTY = require('tt-native')

const isWin = os.platform() === 'win32'
const shellFile = isWin ? 'powershell.exe' : (process.env.SHELL || 'bash')
const EMPTY = Buffer.alloc(0)

class ShellServer {
  constructor ({ node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.channel = mux.createChannel({
      protocol: 'hypershell',
      id: null,
      handshake: m.handshakeSpawn,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        { encoding: c.buffer, onmessage: this.onstdin.bind(this) },
        { encoding: c.buffer }, // stdout
        { encoding: c.buffer }, // stderr
        { encoding: c.uint }, // exit code
        { encoding: m.resize, onmessage: this.onresize.bind(this) }
      ]
    })
  }

  open () {
    this.channel.open({})
  }

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
      this.channel.messages[3].send(1)
      this.channel.messages[2].send(Buffer.from(error.toString() + '\n'))
      this.channel.close()
      return
    }

    pty.on('data', (data) => {
      this.channel.messages[1].send(data)
    })

    pty.once('exit', (code) => {
      this.channel.messages[3].send(code)
    })

    pty.once('close', () => {
      this.channel.close()
    })

    // + avoid using userData
    this.channel.userData = { pty }
  }

  onclose () {
    if (!this.channel.userData) return

    const { pty } = this.channel.userData
    if (pty) {
      try {
        pty.kill('SIGKILL')
      } catch {} // ignore "Process has exited"
    }
  }

  onstdin (data, c) {
    const { pty } = c.userData
    if (data === null) pty.write(EMPTY)
    else pty.write(data)
  }

  onresize (data, c) {
    const { pty } = c.userData
    pty.resize(data.width, data.height)
  }
}

class ShellClient {
  constructor (rawArgs, { node, socket, mux }) {
    this.dht = node
    this.socket = socket
    this.mux = mux

    this.rawArgs = rawArgs

    this.channel = mux.createChannel({
      protocol: 'hypershell',
      id: null,
      handshake: m.handshakeSpawn,
      onopen: this.onopen.bind(this),
      onclose: this.onclose.bind(this),
      messages: [
        { encoding: c.buffer }, // stdin
        { encoding: c.buffer, onmessage: this.onstdout.bind(this) },
        { encoding: c.buffer, onmessage: this.onstderr.bind(this) },
        { encoding: c.uint, onmessage: this.onexitcode.bind(this) },
        { encoding: m.resize }
      ]
    })
  }

  open () {
    const spawn = ShellClient.parseVariadic(this.rawArgs)
    const [command = '', ...args] = spawn

    this.channel.open({
      file: command || '',
      args: args || [],
      width: process.stdout.columns,
      height: process.stdout.rows
    })

    this.setup()
  }

  onopen () {}

  onclose () {
    this.socket.end()
  }

  setup () {
    this.onstdin = this.onstdin.bind(this)
    this.onresize = this.onresize.bind(this)
    this.onsocketclose = this.onsocketclose.bind(this)

    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on('data', this.onstdin)
    process.stdout.on('resize', this.onresize)
    this.socket.once('close', this.onsocketclose)
  }

  onstdin (data) {
    this.channel.messages[0].send(data)
  }

  onstdout (data, c) {
    process.stdout.write(data)
  }

  onstderr (data, c) {
    process.stderr.write(data)
  }

  onexitcode (code, c) {
    process.exitCode = code
  }

  onresize () {
    this.channel.messages[4].send({
      width: process.stdout.columns,
      height: process.stdout.rows
    })
  }

  onsocketclose () {
    process.exit()
  }

  static parseVariadic (rawArgs) {
    const index = rawArgs.indexOf('--')
    const variadic = index === -1 ? null : rawArgs.splice(index + 1)
    return variadic || []
  }
}

module.exports = { ShellServer, ShellClient }
