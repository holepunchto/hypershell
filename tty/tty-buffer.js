const EMPTY = Buffer.alloc(0)

module.exports = class TTYBuffer {
  constructor (size = 128) {
    this.mask = size - 1
    this.lines = new Array(size)
    this.index = 0
    this.overflow = null
    this.reset()
  }

  add (buf) {
    if (!buf.byteLength) return

    if (this.overflow) {
      buf = Buffer.concat([this.overflow, buf])
    }

    let i = 0

    while (i < buf.length) {
      const idx = buf.indexOf(10, i)

      if (idx === -1) {
        this.overflow = buf.subarray(i)
        return
      }

      const offset = i

      i = idx + 1

      const line = buf.subarray(offset, i)

      this.index = (this.index + 1) & this.mask
      this.lines[this.index] = line
    }

    this.overflow = null
  }

  toArray () {
    const top = this.index
    const sorted = new Array(this.lines.length + (this.overflow ? 1 : 0))

    for (let i = 0; i < this.lines.length; i++) {
      const top = (this.index + i + 1) & this.mask
      sorted[i] = this.lines[top]
    }

    if (this.overflow) sorted[sorted.length - 1] = this.overflow

    return sorted
  }

  toBuffer () {
    return Buffer.concat(this.toArray())
  }

  reset () {
    for (let i = 0; i < this.lines.length; i++) this.lines[i] = EMPTY
  }
}
