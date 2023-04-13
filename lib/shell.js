const path = require('path')
const os = require('os')
const c = require('compact-encoding')
const m = require('../messages.js')
const PTY = require('tt-native')

const shellFile = getShell()
const EMPTY = Buffer.alloc(0)

class ShellServer {
  constructor ({ mux }) {
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

    this.pty = null
  }

  open () {
    this.channel.open({})
  }

  onopen (handshake) {
    try {
      this.pty = PTY.spawn(handshake.command || shellFile, handshake.args, {
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

    this.pty.on('data', (data) => this.channel.messages[1].send(data))
    this.pty.once('exit', (code) => this.channel.messages[3].send(code))
    this.pty.once('close', () => this.channel.close())
  }

  onclose () {
    if (this.pty) {
      try {
        this.pty.kill('SIGKILL')
      } catch {} // ignore "Process has exited"
    }
  }

  onstdin (data, c) {
    if (data === null) this.pty.write(EMPTY)
    else this.pty.write(data)
  }

  onresize (data, c) {
    this.pty.resize(data.width, data.height)
  }
}

class ShellClient {
  constructor (rawArgs, { socket, mux }) {
    const spawn = ShellClient.parseVariadic(rawArgs)
    this.command = spawn.shift() || ''
    this.args = spawn

    this.socket = socket

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
    this.channel.open({
      command: this.command,
      args: this.args,
      width: process.stdout.columns || 80, // cols/rows doesn't exists if spawned without a terminal
      height: process.stdout.rows || 24
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
    process.stdin.on('data', this.onstdin) // + stdin 'end' event?
    process.stdout.on('resize', this.onresize)
    this.socket.on('close', this.onsocketclose)

    process.stdin.resume()
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
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24
    })
  }

  onsocketclose () {
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.removeListener('data', this.onstdin)
    process.stdout.removeListener('resize', this.onresize)
    this.socket.removeListener('close', this.onsocketclose)

    process.stdin.pause() // + process.exit()?
  }

  static parseVariadic (rawArgs) {
    const index = rawArgs.indexOf('--')
    const variadic = index === -1 ? null : rawArgs.splice(index + 1)
    return variadic || []
  }
}

module.exports = { ShellServer, ShellClient, shellFile }

function getShell () {
  if (process.platform === 'win32') {
    const filename = path.join(process.env.PROGRAMFILES, 'Git', 'git-bash.exe')
    const gitBash = fs.statSync(filename, { throwIfNoEntry: false })
    return gitBash ? filename : 'powershell.exe'
  }

  return process.env.SHELL || 'bash'
}
