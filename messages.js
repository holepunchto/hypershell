const c = require('compact-encoding')

const stringArray = c.array(c.string)

const handshakeSpawn = {
  preencode (state, s) {
    c.string.preencode(state, s.command || '')
    stringArray.preencode(state, s.args || [])
    c.uint.preencode(state, s.width)
    c.uint.preencode(state, s.height)
  },
  encode (state, s) {
    c.string.encode(state, s.command || '')
    stringArray.encode(state, s.args || [])
    c.uint.encode(state, s.width)
    c.uint.encode(state, s.height)
  },
  decode (state) {
    return {
      command: c.string.decode(state),
      args: stringArray.decode(state),
      width: c.uint.decode(state),
      height: c.uint.decode(state)
    }
  }
}

const handshakeUpload = {
  preencode (state, u) {
    c.string.preencode(state, u.target || '')
    c.bool.preencode(state, u.isDirectory || false)
  },
  encode (state, u) {
    c.string.encode(state, u.target || '')
    c.bool.encode(state, u.isDirectory || false)
  },
  decode (state) {
    return {
      target: c.string.decode(state),
      isDirectory: c.bool.decode(state)
    }
  }
}

const handshakeDownload = {
  preencode (state, u) {
    c.string.preencode(state, u.source || '')
  },
  encode (state, u) {
    c.string.encode(state, u.source || '')
  },
  decode (state) {
    return {
      source: c.string.decode(state)
    }
  }
}

const downloadHeader = {
  preencode (state, d) {
    c.bool.preencode(state, d.isDirectory)
  },
  encode (state, d) {
    c.bool.encode(state, d.isDirectory)
  },
  decode (state) {
    return {
      isDirectory: c.bool.decode(state)
    }
  }
}

const error = {
  preencode (state, e) {
    c.string.preencode(state, e.code || '')
    c.string.preencode(state, e.path || '')
    c.string.preencode(state, e.message || '')
  },
  encode (state, e) {
    c.string.encode(state, e.code || '')
    c.string.encode(state, e.path || '')
    c.string.encode(state, e.message || '')
  },
  decode (state) {
    return {
      code: c.string.decode(state),
      path: c.string.decode(state),
      message: c.string.decode(state)
    }
  }
}

const resize = {
  preencode (state, r) {
    c.uint.preencode(state, r.width)
    c.uint.preencode(state, r.height)
  },
  encode (state, r) {
    c.uint.encode(state, r.width)
    c.uint.encode(state, r.height)
  },
  decode (state) {
    return {
      width: c.uint.decode(state),
      height: c.uint.decode(state)
    }
  }
}

module.exports = {
  handshakeSpawn,
  handshakeUpload,
  handshakeDownload,
  downloadHeader,
  error,
  resize
}
