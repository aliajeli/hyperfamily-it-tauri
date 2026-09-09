'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TerminalEmulator } from '@/lib/terminal-emulator'
import { commonPrefix, completions, currentWord, tokenize } from '@/lib/terminal-syntax'

const CHAR_RATIO = 0.6 // width/height ratio of the monospace cell

const ANSI_HEX = {
  'ansi-black': '#3B4252', 'ansi-red': '#BF616A', 'ansi-green': '#A3BE8C', 'ansi-yellow': '#EBCB8B',
  'ansi-blue': '#81A1C1', 'ansi-magenta': '#B48EAD', 'ansi-cyan': '#88C0D0', 'ansi-white': '#E5E9F0',
  'ansi-bright-black': '#4C566A', 'ansi-bright-red': '#D08770', 'ansi-bright-green': '#B9D2A1',
  'ansi-bright-yellow': '#F0D399', 'ansi-bright-blue': '#9DB8D4', 'ansi-bright-magenta': '#C7A5C2',
  'ansi-bright-cyan': '#A3D5E0', 'ansi-bright-white': '#ECEFF4'
}

/**
 * Syntax colours are expressed as theme variables with a Nord fallback, so the
 * highlighting shifts with whichever app theme is active instead of fighting it.
 */
const SYNTAX_STYLE = {
  prompt: { color: 'rgb(var(--muted))', fontWeight: 700 },
  command: { color: 'var(--ansi-cyan, #88C0D0)', fontWeight: 600 },
  config: { color: 'var(--ansi-magenta, #B48EAD)', fontWeight: 600 },
  destructive: { color: 'var(--ansi-red, #BF616A)', fontWeight: 700 },
  keyword: { color: 'var(--ansi-blue, #81A1C1)' },
  address: { color: 'var(--ansi-green, #A3BE8C)' },
  interface: { color: 'var(--ansi-green, #A3BE8C)' },
  number: { color: 'var(--ansi-yellow, #EBCB8B)' },
  string: { color: 'var(--ansi-yellow, #EBCB8B)' },
  flag: { color: 'var(--ansi-bright-black, #4C566A)' },
  comment: { color: 'rgb(var(--muted))', fontStyle: 'italic' }
}

// Emulator attributes carry CSS-variable identifiers (ansi-red, ansi-bright-cyan…)
// so the palette follows the app theme; hex/rgb values pass straight through.
const colorFor = (value) => {
  if (!value) return null
  if (ANSI_HEX[value]) return `var(--${value}, ${ANSI_HEX[value]})`
  return value
}

export const DEFAULT_TERMINAL_FONT = 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace'

/**
 * Renders a live terminal session. The screen buffer lives in a ref so device
 * output never triggers a React reconciliation per byte; a repaint is scheduled
 * on an animation frame instead.
 *
 * Highlighting is applied only to rows the device sent with no colour of their
 * own. Anything the device coloured itself is left untouched, so `show` output
 * that already uses ANSI keeps its intended appearance.
 */
export default function TerminalScreen({
  session,
  api,
  fontSize = 13,
  fontFamily = DEFAULT_TERMINAL_FONT,
  highlight = true,
  onSizeChange
}) {
  const holderRef = useRef(null)
  const screenRef = useRef(null)
  const emulatorRef = useRef(null)
  const frameRef = useRef(0)
  const inputRef = useRef('') // locally echoed line, used for completion only
  const [revision, setRevision] = useState(0)
  const [size, setSize] = useState({ cols: 80, rows: 24 })
  const [followTail, setFollowTail] = useState(true)
  const [picker, setPicker] = useState(null) // { items, index, prefix }

  if (!emulatorRef.current) emulatorRef.current = new TerminalEmulator(80, 24)

  const repaint = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      setRevision((value) => value + 1)
    })
  }, [])

  // Measure the container and derive the character grid from the font metrics.
  useLayoutEffect(() => {
    const holder = holderRef.current
    if (!holder) return undefined
    const measure = () => {
      const lineHeight = Math.round(fontSize * 1.42)
      const charWidth = fontSize * CHAR_RATIO
      const cols = Math.max(20, Math.floor((holder.clientWidth - 24) / charWidth))
      const rows = Math.max(6, Math.floor((holder.clientHeight - 16) / lineHeight))
      setSize((previous) => (previous.cols === cols && previous.rows === rows ? previous : { cols, rows }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(holder)
    return () => observer.disconnect()
  }, [fontSize, fontFamily])

  useEffect(() => {
    emulatorRef.current.resize(size.cols, size.rows)
    repaint()
    onSizeChange?.(size)
    if (session?.sessionId) api.resize({ sessionId: session.sessionId, cols: size.cols, rows: size.rows }).catch(() => {})
  }, [size, session?.sessionId, api, onSizeChange, repaint])

  // Device output stream.
  useEffect(() => {
    if (!session?.sessionId) return undefined
    const unsubscribe = api.onData((payload) => {
      if (payload.sessionId !== session.sessionId) return
      emulatorRef.current.write(payload.data)
      repaint()
    })
    return unsubscribe
  }, [session?.sessionId, api, repaint])

  useEffect(() => {
    emulatorRef.current.reset()
    emulatorRef.current.resize(size.cols, size.rows)
    inputRef.current = ''
    setPicker(null)
    repaint()
    // A new session id means a brand-new screen.
  }, [session?.sessionId])

  useEffect(() => {
    if (!followTail) return
    const node = screenRef.current
    if (node) node.scrollTop = node.scrollHeight
  })

  const send = useCallback((data) => {
    if (!session?.sessionId || session.state === 'closed') return
    api.write({ sessionId: session.sessionId, data }).catch(() => {})
  }, [api, session?.sessionId, session?.state])

  /**
   * Tracks what the operator typed on the current line. The device owns the
   * real line editor, so this is a best-effort shadow used purely to know which
   * word Tab or Ctrl+Space should complete. Enter and Ctrl+C reset it.
   */
  const trackInput = useCallback((data) => {
    if (data === '\r' || data === '\u0003') { inputRef.current = ''; return }
    if (data === '\u007f') { inputRef.current = inputRef.current.slice(0, -1); return }
    if (data.length === 1 && data >= ' ') inputRef.current += data
    else if (data.length > 1 && !data.startsWith('\u001b')) inputRef.current += data
  }, [])

  const transmit = useCallback((data) => {
    trackInput(data)
    send(data)
    setFollowTail(true)
  }, [send, trackInput])

  /**
   * Replaces the word being typed with `word`, using backspaces the device
   * understands.
   *
   * `whole` marks the completion as a finished command rather than a partial
   * prefix. Finished commands are followed by a space so the caret is already
   * positioned for the next argument, which is what the shell itself does and
   * saves reaching for the spacebar after every pick. A partial prefix (the
   * longest common stem of several candidates) must not get one, because the
   * word is still being typed.
   */
  const applyCompletion = useCallback((word, whole = true) => {
    const typed = currentWord(inputRef.current)
    const suffix = word.slice(typed.length)
    const trailing = whole ? ' ' : ''
    if (word.slice(0, typed.length).toLowerCase() !== typed.toLowerCase()) {
      // Case differs or the pick is unrelated: rewrite the whole word.
      transmit('\u007f'.repeat(typed.length))
      transmit(word + trailing)
      return
    }
    if (suffix || trailing) transmit(suffix + trailing)
  }, [transmit])

  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && window.getSelection()?.toString()) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return

    // ---- Command picker navigation takes priority while it is open ----
    if (picker) {
      // Tab and Enter both *accept* the highlighted command — the completion is
      // written followed by a space, ready for the next argument. Cycling is on
      // the arrow keys (and Shift+Tab, which steps back without accepting).
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault()
        applyCompletion(picker.items[picker.index])
        setPicker(null)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPicker((p) => ({ ...p, index: (p.index + 1) % p.items.length }))
        return
      }
      if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
        event.preventDefault()
        setPicker((p) => ({ ...p, index: (p.index - 1 + p.items.length) % p.items.length }))
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); setPicker(null); return }
    }

    // ---- Ctrl+Space: popup of every command starting with what was typed ----
    if (event.ctrlKey && (event.key === ' ' || event.code === 'Space')) {
      event.preventDefault()
      const prefix = currentWord(inputRef.current)
      const items = completions(prefix)
      if (items.length) setPicker({ items: items.slice(0, 200), index: 0, prefix })
      return
    }

    // ---- Tab: complete as far as unambiguous, else open the picker ----
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const prefix = currentWord(inputRef.current)
      const items = completions(prefix)
      if (!items.length) { transmit('\t'); return }
      if (items.length === 1) { applyCompletion(items[0]); return }
      const shared = commonPrefix(items)
      if (shared.length > prefix.length) { applyCompletion(shared, false); return }
      setPicker({ items: items.slice(0, 200), index: 0, prefix })
      return
    }

    const map = {
      Enter: '\r', Backspace: '\u007f', Escape: '\u001b',
      ArrowUp: '\u001b[A', ArrowDown: '\u001b[B', ArrowRight: '\u001b[C', ArrowLeft: '\u001b[D',
      Home: '\u001b[H', End: '\u001b[F', Delete: '\u001b[3~', PageUp: '\u001b[5~', PageDown: '\u001b[6~'
    }

    if (map[event.key]) { event.preventDefault(); transmit(map[event.key]); return }
    if (event.ctrlKey && /^[a-z]$/i.test(event.key)) {
      event.preventDefault()
      const code = String.fromCharCode(event.key.toLowerCase().charCodeAt(0) - 96)
      transmit(code)
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.altKey) {
      event.preventDefault()
      transmit(event.key)
      // Keep an open picker in sync with the narrowing prefix.
      if (picker) {
        const prefix = currentWord(inputRef.current)
        const items = completions(prefix)
        setPicker(items.length ? { items: items.slice(0, 200), index: 0, prefix } : null)
      }
    }
  }

  const onPaste = (event) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text')
    if (text) { transmit(text.replace(/\r?\n/g, '\r')) }
  }

  // `revision` is bumped by repaint(); it is the dependency that makes this
  // memo recompute after the emulator buffer changes.
  const snapshot = useMemo(() => emulatorRef.current.snapshot(), [size, revision])
  const lineHeight = Math.round(fontSize * 1.42)

  return (
    <div ref={holderRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-[rgb(var(--canvas))]">
      <div
        ref={screenRef}
        role="textbox"
        aria-label="Terminal screen"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => setPicker(null)}
        onScroll={(event) => {
          const node = event.currentTarget
          setFollowTail(node.scrollHeight - node.scrollTop - node.clientHeight < 24)
        }}
        className="h-full w-full cursor-text overflow-y-auto px-3 py-2 font-mono outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--primary)/.5)]"
        style={{ fontSize, lineHeight: `${lineHeight}px`, fontFamily }}
      >
        {snapshot.rows.map((runs, rowIndex) => {
          // A row the device left uncoloured is ours to highlight; a row it
          // coloured itself is rendered exactly as the device intended.
          const plain = highlight && runs.every((run) => {
            const { attr } = run
            return !attr.fg && !attr.bg && !attr.inverse && !attr.underline
          })

          if (plain) {
            const text = runs.map((run) => run.text).join('')
            if (!text.trim()) return <div key={rowIndex} className="whitespace-pre" style={{ height: lineHeight }}>{text}</div>
            return (
              <div key={rowIndex} className="whitespace-pre" style={{ height: lineHeight }}>
                {tokenize(text).map((token, index) => (
                  <span key={index} style={SYNTAX_STYLE[token.kind]}>{token.text}</span>
                ))}
              </div>
            )
          }

          return (
            <div key={rowIndex} className="whitespace-pre" style={{ height: lineHeight }}>
              {runs.map((run, runIndex) => {
                const { attr } = run
                const foreground = colorFor(attr.inverse ? attr.bg : attr.fg)
                const background = colorFor(attr.inverse ? attr.fg : attr.bg)
                const style = {
                  color: foreground || (attr.inverse ? 'rgb(var(--canvas))' : undefined),
                  background: background || (attr.inverse ? 'rgb(var(--text))' : undefined),
                  fontWeight: attr.bold ? 700 : undefined,
                  fontStyle: attr.italic ? 'italic' : undefined,
                  textDecoration: attr.underline ? 'underline' : undefined,
                  opacity: attr.dim ? 0.68 : undefined
                }
                return <span key={runIndex} style={style}>{run.text}</span>
              })}
            </div>
          )
        })}
      </div>

      {/* Cursor is drawn as an overlay so it never disturbs the text runs. */}
      {session?.state === 'connected' && (
        <span
          aria-hidden
          className="pointer-events-none absolute animate-pulse rounded-[1px] bg-[rgb(var(--primary))]"
          style={{
            left: 12 + snapshot.cursor.x * fontSize * CHAR_RATIO,
            top: 8 + snapshot.cursor.y * lineHeight,
            width: Math.max(2, fontSize * CHAR_RATIO),
            height: lineHeight - 2,
            opacity: 0.55
          }}
        />
      )}

      {/* Ctrl+Space / ambiguous-Tab command picker, anchored to the cursor. */}
      {picker && (
        <div
          role="listbox"
          aria-label="Command suggestions"
          className="absolute z-20 max-h-56 w-56 overflow-y-auto rounded-xl border bg-[rgb(var(--surface))] p-1 shadow-2xl"
          style={{
            left: Math.min(12 + snapshot.cursor.x * fontSize * CHAR_RATIO, Math.max(12, (holderRef.current?.clientWidth || 320) - 236)),
            top: Math.min(8 + (snapshot.cursor.y + 1) * lineHeight + 4, Math.max(8, (holderRef.current?.clientHeight || 240) - 232))
          }}
        >
          <div className="px-2 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-widest text-[rgb(var(--muted))]">
            {picker.items.length} match{picker.items.length === 1 ? '' : 'es'}{picker.prefix ? ` for “${picker.prefix}”` : ''}
          </div>
          {picker.items.map((item, index) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={index === picker.index}
              // Mouse-down keeps focus on the screen so the completion still lands.
              onMouseDown={(event) => { event.preventDefault(); applyCompletion(item); setPicker(null) }}
              onMouseEnter={() => setPicker((p) => (p ? { ...p, index } : p))}
              className={`block w-full truncate rounded-lg px-2 py-1 text-left font-mono text-[11px] ${
                index === picker.index ? 'bg-[rgb(var(--primary)/.16)] text-[rgb(var(--primary))]' : 'text-[rgb(var(--text))]'
              }`}
            >
              <b>{item.slice(0, picker.prefix.length)}</b>{item.slice(picker.prefix.length)}
            </button>
          ))}
        </div>
      )}

      {!followTail && (
        <button
          type="button"
          onClick={() => { setFollowTail(true); if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight }}
          className="absolute bottom-3 right-3 rounded-lg border bg-[rgb(var(--surface))] px-2.5 py-1 text-[10px] font-bold shadow-lg"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
