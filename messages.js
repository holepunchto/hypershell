const c = require('compact-encoding')

const stringArray = c.array(c.string)

const spawn = {
  preencode (state, s) {
    c.string.preencode(state, s.file || '')
    stringArray.preencode(state, s.args || [])
    c.uint.preencode(state, s.width)
    c.uint.preencode(state, s.height)
  },
  encode (state, s) {
    c.string.encode(state, s.file || '')
    stringArray.encode(state, s.args || [])
    c.uint.encode(state, s.width)
    c.uint.encode(state, s.height)
  },
  decode (state) {
    return {
      file: c.string.decode(state),
      args: stringArray.decode(state),
      width: c.uint.decode(state),
      height: c.uint.decode(state)
    }
  }
}

const handshakeShell = {
  preencode (state, h) {
    state.end++ // flags
    if (h.spawn) spawn.preencode(state, h.spawn)
  },
  encode (state, h) {
    const flags = (h.spawn ? 1 : 0)
    c.uint.encode(state, flags)
    if (h.spawn) spawn.encode(state, h.spawn)
  },
  decode (state) {
    const flags = c.uint.decode(state)
    return {
      spawn: flags & 1 ? spawn.decode(state) : null
    }
  }
}

const handshakeCopy = {
  preencode (state, h) {
    state.end++ // flags
    if (h.upload) c.json.preencode(state, h.upload)
    if (h.download) c.json.preencode(state, h.download)
  },
  encode (state, h) {
    const flags = (h.upload ? 1 : 0) | (h.download ? 2 : 0)
    c.uint.encode(state, flags)
    if (h.upload) c.json.encode(state, h.upload)
    if (h.download) c.json.encode(state, h.download)
  },
  decode (state) {
    const flags = c.uint.decode(state)
    return {
      upload: flags & 1 ? c.json.decode(state) : null,
      download: flags & 2 ? c.json.decode(state) : null
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
  spawn,
  handshakeShell,
  handshakeCopy,
  resize
}
