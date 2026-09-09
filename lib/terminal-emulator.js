'use client'

/**
 * A compact VT100/xterm-subset screen buffer.
 *
 * Network switches drive the terminal with a small, well-known set of escape
 * sequences (cursor movement, erase, SGR colour, scroll region). Implementing
 * just that subset keeps the renderer dependency-free and lets it inherit the
 * application theme through CSS variables instead of shipping a second stylesheet.
 */

const DEFAULT_ATTR = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false }

const PALETTE_16 = [
  'ansi-black', 'ansi-red', 'ansi-green', 'ansi-yellow',
  'ansi-blue', 'ansi-magenta', 'ansi-cyan', 'ansi-white',
  'ansi-bright-black', 'ansi-bright-red', 'ansi-bright-green', 'ansi-bright-yellow',
  'ansi-bright-blue', 'ansi-bright-magenta', 'ansi-bright-cyan', 'ansi-bright-white'
]

const blankCell = () => ({ char: ' ', attr: DEFAULT_ATTR })

export class TerminalEmulator {
  constructor(cols = 80, rows = 24, scrollback = 2000) {
    this.cols = cols
    this.rows = rows
    this.scrollbackLimit = scrollback
    this.reset()
  }

  reset() {
    this.lines = [this.blankLine()]
    this.cursor = { x: 0, y: 0 }
    this.attr = { ...DEFAULT_ATTR }
    this.saved = null
    this.pending = ''
    this.title = ''
  }

  blankLine() {
    return Array.from({ length: this.cols }, blankCell)
  }

  /** Row index inside `lines` that the cursor's screen row maps to. */
  get top() {
    return Math.max(0, this.lines.length - this.rows)
  }

  lineAt(screenRow) {
    const index = this.top + screenRow
    while (this.lines.length <= index) this.lines.push(this.blankLine())
    const line = this.lines[index]
    while (line.length < this.cols) line.push(blankCell())
    return line
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = Math.max(20, cols)
    this.rows = Math.max(4, rows)
    for (const line of this.lines) {
      while (line.length < this.cols) line.push(blankCell())
      if (line.length > this.cols) line.length = this.cols
    }
    this.cursor.x = Math.min(this.cursor.x, this.cols - 1)
    this.cursor.y = Math.min(this.cursor.y, this.rows - 1)
  }

  newline() {
    this.cursor.y += 1
    if (this.cursor.y >= this.rows) {
      this.cursor.y = this.rows - 1
      this.lines.push(this.blankLine())
      if (this.lines.length > this.scrollbackLimit + this.rows) {
        this.lines.splice(0, this.lines.length - (this.scrollbackLimit + this.rows))
      }
    } else {
      this.lineAt(this.cursor.y)
    }
  }

  putChar(char) {
    if (this.cursor.x >= this.cols) { this.cursor.x = 0; this.newline() }
    const line = this.lineAt(this.cursor.y)
    line[this.cursor.x] = { char, attr: this.attr }
    this.cursor.x += 1
  }

  eraseInLine(mode) {
    const line = this.lineAt(this.cursor.y)
    if (mode === 1) for (let index = 0; index <= this.cursor.x && index < this.cols; index += 1) line[index] = blankCell()
    else if (mode === 2) for (let index = 0; index < this.cols; index += 1) line[index] = blankCell()
    else for (let index = this.cursor.x; index < this.cols; index += 1) line[index] = blankCell()
  }

  eraseInDisplay(mode) {
    if (mode === 2 || mode === 3) {
      for (let row = 0; row < this.rows; row += 1) {
        const line = this.lineAt(row)
        for (let index = 0; index < this.cols; index += 1) line[index] = blankCell()
      }
      return
    }
    if (mode === 1) {
      for (let row = 0; row < this.cursor.y; row += 1) {
        const line = this.lineAt(row)
        for (let index = 0; index < this.cols; index += 1) line[index] = blankCell()
      }
      this.eraseInLine(1)
      return
    }
    this.eraseInLine(0)
    for (let row = this.cursor.y + 1; row < this.rows; row += 1) {
      const line = this.lineAt(row)
      for (let index = 0; index < this.cols; index += 1) line[index] = blankCell()
    }
  }

  applySgr(params) {
    const values = params.length ? params : [0]
    const attr = { ...this.attr }
    for (let index = 0; index < values.length; index += 1) {
      const code = values[index]
      if (code === 0) Object.assign(attr, DEFAULT_ATTR)
      else if (code === 1) attr.bold = true
      else if (code === 2) attr.dim = true
      else if (code === 3) attr.italic = true
      else if (code === 4) attr.underline = true
      else if (code === 7) attr.inverse = true
      else if (code === 22) { attr.bold = false; attr.dim = false }
      else if (code === 23) attr.italic = false
      else if (code === 24) attr.underline = false
      else if (code === 27) attr.inverse = false
      else if (code >= 30 && code <= 37) attr.fg = PALETTE_16[code - 30]
      else if (code === 39) attr.fg = null
      else if (code >= 40 && code <= 47) attr.bg = PALETTE_16[code - 40]
      else if (code === 49) attr.bg = null
      else if (code >= 90 && code <= 97) attr.fg = PALETTE_16[code - 90 + 8]
      else if (code >= 100 && code <= 107) attr.bg = PALETTE_16[code - 100 + 8]
      else if (code === 38 || code === 48) {
        const target = code === 38 ? 'fg' : 'bg'
        if (values[index + 1] === 5) { attr[target] = PALETTE_16[values[index + 2] % 16] || null; index += 2 }
        else if (values[index + 1] === 2) { attr[target] = `rgb(${values[index + 2]} ${values[index + 3]} ${values[index + 4]})`; index += 4 }
      }
    }
    this.attr = attr
  }

  handleCsi(sequence) {
    const match = /^\[([?<>!]?)([0-9;]*)(.)$/.exec(sequence)
    if (!match) return
    const [, prefix, rawParams, command] = match
    const params = rawParams.split(';').filter((item) => item !== '').map((item) => Number(item))
    const first = params[0] ?? 0
    if (prefix === '?') return // private modes (cursor visibility, alt screen) are ignored

    switch (command) {
      case 'A': this.cursor.y = Math.max(0, this.cursor.y - Math.max(1, first)); break
      case 'B': this.cursor.y = Math.min(this.rows - 1, this.cursor.y + Math.max(1, first)); break
      case 'C': this.cursor.x = Math.min(this.cols - 1, this.cursor.x + Math.max(1, first)); break
      case 'D': this.cursor.x = Math.max(0, this.cursor.x - Math.max(1, first)); break
      case 'E': this.cursor.x = 0; this.cursor.y = Math.min(this.rows - 1, this.cursor.y + Math.max(1, first)); break
      case 'F': this.cursor.x = 0; this.cursor.y = Math.max(0, this.cursor.y - Math.max(1, first)); break
      case 'G': this.cursor.x = Math.min(this.cols - 1, Math.max(0, (first || 1) - 1)); break
      case 'H':
      case 'f':
        this.cursor.y = Math.min(this.rows - 1, Math.max(0, (params[0] || 1) - 1))
        this.cursor.x = Math.min(this.cols - 1, Math.max(0, (params[1] || 1) - 1))
        break
      case 'J': this.eraseInDisplay(first); break
      case 'K': this.eraseInLine(first); break
      case 'P': {
        const line = this.lineAt(this.cursor.y)
        line.splice(this.cursor.x, Math.max(1, first))
        while (line.length < this.cols) line.push(blankCell())
        break
      }
      case '@': {
        const line = this.lineAt(this.cursor.y)
        for (let index = 0; index < Math.max(1, first); index += 1) line.splice(this.cursor.x, 0, blankCell())
        line.length = this.cols
        break
      }
      case 'X': {
        const line = this.lineAt(this.cursor.y)
        for (let index = 0; index < Math.max(1, first) && this.cursor.x + index < this.cols; index += 1) line[this.cursor.x + index] = blankCell()
        break
      }
      case 'm': this.applySgr(params); break
      case 's': this.saved = { ...this.cursor }; break
      case 'u': if (this.saved) this.cursor = { ...this.saved }; break
      default: break
    }
  }

  /** Feeds raw device output into the buffer. Incomplete sequences are retained. */
  write(chunk) {
    let data = this.pending + chunk
    this.pending = ''
    let index = 0

    while (index < data.length) {
      const char = data[index]

      if (char === '\u001b') {
        const rest = data.slice(index + 1)
        if (!rest.length) { this.pending = data.slice(index); break }
        if (rest[0] === '[') {
          const end = /[@-~]/.exec(rest.slice(1))
          if (!end) { this.pending = data.slice(index); break }
          const sequence = rest.slice(0, end.index + 2)
          this.handleCsi(sequence)
          index += 1 + sequence.length
          continue
        }
        if (rest[0] === ']') {
          const terminator = rest.search(/\u0007|\u001b\\/)
          if (terminator === -1) { this.pending = data.slice(index); break }
          const body = rest.slice(1, terminator)
          const titleMatch = /^\d*;(.*)$/.exec(body)
          if (titleMatch) this.title = titleMatch[1]
          index += 1 + terminator + (rest[terminator] === '\u0007' ? 1 : 2)
          continue
        }
        if (rest[0] === '(' || rest[0] === ')') { index += 3; continue }
        if (rest[0] === '7') { this.saved = { ...this.cursor }; index += 2; continue }
        if (rest[0] === '8') { if (this.saved) this.cursor = { ...this.saved }; index += 2; continue }
        if (rest[0] === 'M') { this.cursor.y = Math.max(0, this.cursor.y - 1); index += 2; continue }
        index += 2
        continue
      }

      if (char === '\r') { this.cursor.x = 0; index += 1; continue }
      if (char === '\n') { this.cursor.x = 0; this.newline(); index += 1; continue }
      if (char === '\b') { this.cursor.x = Math.max(0, this.cursor.x - 1); index += 1; continue }
      if (char === '\t') {
        const next = Math.min(this.cols - 1, (Math.floor(this.cursor.x / 8) + 1) * 8)
        this.cursor.x = next
        index += 1
        continue
      }
      if (char === '\u0007') { index += 1; continue }
      if (char < ' ' && char !== ' ') { index += 1; continue }

      this.putChar(char)
      index += 1
    }
    data = null
  }

  /** Groups the visible screen into styled runs for rendering. */
  snapshot() {
    const rows = []
    for (let row = 0; row < this.rows; row += 1) {
      const line = this.lineAt(row)
      const runs = []
      let current = null
      for (let column = 0; column < this.cols; column += 1) {
        const cell = line[column] || blankCell()
        if (current && current.attr === cell.attr) current.text += cell.char
        else { current = { attr: cell.attr, text: cell.char }; runs.push(current) }
      }
      rows.push(runs)
    }
    return { rows, cursor: { ...this.cursor }, title: this.title }
  }

  /** Whole buffer as plain text, used by the copy action. */
  toText() {
    return this.lines.map((line) => line.map((cell) => cell.char).join('').replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
  }
}

export const ANSI_COLOR_VARS = PALETTE_16
