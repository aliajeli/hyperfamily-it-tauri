'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, ChevronsUp, Hash, Minus, NotebookPen, Palette, Pin, PinOff, Plus, Save, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import AppShell from '@/components/layout/AppShell'
import { Button, EmptyState, Input, Skeleton, Textarea } from '@/components/ui'
import { getApi } from '@/lib/api'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'

const blankNote = { id: null, name: '', body: '', pinned: 0, color: 'default', priority: 0, tags: [] }

/**
 * Note colours are stored by name, not as a hex value, so every theme renders
 * its own shade of each one and a note keeps its meaning after a theme change.
 */
const NOTE_COLORS = [
  { id: 'default', label: 'Neutral', swatch: 'rgb(var(--muted))', tint: 'rgb(var(--canvas))', edge: 'rgb(var(--border))' },
  { id: 'red', label: 'Red', swatch: '#BF616A', tint: 'rgba(191,97,106,.12)', edge: 'rgba(191,97,106,.5)' },
  { id: 'amber', label: 'Amber', swatch: '#EBCB8B', tint: 'rgba(235,203,139,.14)', edge: 'rgba(235,203,139,.55)' },
  { id: 'green', label: 'Green', swatch: '#A3BE8C', tint: 'rgba(163,190,140,.14)', edge: 'rgba(163,190,140,.55)' },
  { id: 'blue', label: 'Blue', swatch: '#88C0D0', tint: 'rgba(136,192,208,.14)', edge: 'rgba(136,192,208,.55)' },
  { id: 'purple', label: 'Purple', swatch: '#B48EAD', tint: 'rgba(180,142,173,.14)', edge: 'rgba(180,142,173,.55)' }
]

const colorOf = (id) => NOTE_COLORS.find((entry) => entry.id === id) || NOTE_COLORS[0]

/** Three levels is enough to triage by and few enough to scan at a glance. */
const PRIORITIES = [
  { id: 0, label: 'Normal', short: 'Normal', icon: Minus, tone: 'rgb(var(--muted))' },
  { id: 1, label: 'Important', short: 'Important', icon: ChevronsUp, tone: '#EBCB8B' },
  { id: 2, label: 'Critical', short: 'Critical', icon: AlertTriangle, tone: '#BF616A' }
]

const priorityOf = (value) => PRIORITIES.find((entry) => entry.id === Number(value)) || PRIORITIES[0]

const preview = (body) => (body || '').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Empty note'

/**
 * Tags live in their own column (v2.0.16) — adding one never touches the note
 * body. The pattern below only extracts #hashtags that older notes still
 * carry inside their text, so nothing already written loses its tags.
 */
const TAG_PATTERN = /#[A-Za-z0-9_\u00C0-\u024F-]{1,40}/g

const normalizeTags = (value) => {
  try {
    if (Array.isArray(value)) return value.map(String)
    if (typeof value === 'string') return JSON.parse(value || '[]')
    return []
  } catch { return [] }
}

const sanitizeTag = (tag) => String(tag).replace(/^#+/, '').trim().toLowerCase().slice(0, 40)

const tagsOfBody = (body) => [...new Set(((body || '').match(TAG_PATTERN) || []).map((tag) => tag.toLowerCase()))]

/** A note's full tag set: the stored tags plus any legacy body hashtags. */
const noteTags = (note) => [...new Set([
  ...normalizeTags(note?.tags).map(sanitizeTag).filter(Boolean),
  ...tagsOfBody(note?.body)
])]

/** Chips read as hashtags even though tags are stored without the '#'. */
const displayTag = (tag) => (String(tag).startsWith('#') ? tag : `#${tag}`)

const when = (value) => {
  if (!value) return ''
  const date = new Date(String(value).includes('T') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function NotesPage() {
  // Undefined during the static prerender; populated from the first client render.
  const api = getApi()
  const confirm = useConfirm()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [menu, setMenu] = useState(null) // { x, y, noteId } — right-click menu
  const [tagInput, setTagInput] = useState('')
  const nameRef = useRef(null)

  const load = useCallback(async (selectId = null) => {
    if (!api) return
    try {
      const rows = (await api.notes.list()).map((note) => ({ ...note, tags: normalizeTags(note.tags) }))
      setNotes(rows)
      setDraft((current) => {
        if (selectId) return rows.find((note) => note.id === selectId) || current
        if (current) return current
        return rows[0] || null
      })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // The right-click menu closes on Escape and on window blur.
  useEffect(() => {
    if (!menu) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setMenu(null) }
    const onBlur = () => setMenu(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu])

  /**
   * Applies a small patch (pin, colour, priority) to a saved note without
   * disturbing the editor: the list is re-read and, when the note is the one
   * currently open, the draft follows along.
   */
  const quickUpdate = async (note, patch, label) => {
    try {
      await api.notes.save({
        id: note.id,
        name: note.name,
        body: note.body || '',
        pinned: note.pinned ? 1 : 0,
        color: note.color || 'default',
        priority: Number(note.priority || 0),
        tags: normalizeTags(note.tags),
        ...patch
      })
      const rows = (await api.notes.list()).map((item) => ({ ...item, tags: normalizeTags(item.tags) }))
      setNotes(rows)
      setDraft((current) => (current?.id === note.id ? { ...current, ...patch } : current))
      toast.success(label)
    } catch (error) {
      toast.error(error.message)
    }
  }

  const togglePin = async (note) => {
    await quickUpdate(note, { pinned: note.pinned ? 0 : 1 }, note.pinned ? 'Note unpinned' : 'Note pinned')
  }

  /**
   * Tag helpers (v2.0.16). Tags live in their own list, completely separate
   * from the note body: adding or removing one never touches the text, and
   * the chips sit next to the colour pickers in the toolbar.
   */
  const addTag = () => {
    const tag = sanitizeTag(tagInput)
    if (!tag) return
    setDraft((current) => {
      const tags = normalizeTags(current.tags).map(sanitizeTag).filter(Boolean)
      if (tags.includes(tag)) return current
      return { ...current, tags: [...tags, tag] }
    })
    setTagInput('')
  }

  const removeTag = (tag) => {
    setDraft((current) => ({ ...current, tags: normalizeTags(current.tags).filter((item) => item !== tag) }))
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? notes.filter((note) => `${note.name} ${note.body || ''} ${noteTags(note).join(' ')}`.toLowerCase().includes(needle))
      : notes
    // Pinned first, then the most urgent, then the most recently touched.
    return [...rows].sort((a, b) =>
      (Boolean(b.pinned) - Boolean(a.pinned))
      || (Number(b.priority || 0) - Number(a.priority || 0))
      || (new Date(b.updated_at || 0) - new Date(a.updated_at || 0)))
  }, [notes, query])

  const dirty = useMemo(() => {
    if (!draft) return false
    if (!draft.id) return Boolean(draft.name.trim() || draft.body.trim())
    const original = notes.find((note) => note.id === draft.id)
    if (!original) return true
    return original.name !== draft.name
      || (original.body || '') !== (draft.body || '')
      || Boolean(original.pinned) !== Boolean(draft.pinned)
      || (original.color || 'default') !== (draft.color || 'default')
      || Number(original.priority || 0) !== Number(draft.priority || 0)
      || JSON.stringify(normalizeTags(original.tags)) !== JSON.stringify(normalizeTags(draft.tags))
  }, [draft, notes])

  const startNew = () => {
    setDraft({ ...blankNote })
    setTimeout(() => nameRef.current?.focus(), 40)
  }

  const select = async (note) => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        description: 'The edits to the note you are viewing have not been saved yet.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing'
      })
      if (!ok) return
    }
    setDraft({ ...note, body: note.body || '', color: note.color || 'default', priority: Number(note.priority || 0), tags: normalizeTags(note.tags) })
  }

  const save = async (override = {}) => {
    const payload = { ...draft, ...override }
    if (!payload.name.trim()) { toast.error('Give the note a name first'); nameRef.current?.focus(); return }
    setSaving(true)
    try {
      const saved = await api.notes.save({
        id: payload.id || undefined,
        name: payload.name.trim(),
        body: payload.body || '',
        pinned: payload.pinned ? 1 : 0,
        color: payload.color || 'default',
        priority: Number(payload.priority || 0),
        tags: normalizeTags(payload.tags)
      })
      await load(saved?.id || payload.id)
      if (saved?.id && !payload.id) setDraft({ ...saved, body: saved.body || '', color: saved.color || 'default', priority: Number(saved.priority || 0), tags: normalizeTags(saved.tags) })
      toast.success(payload.id ? 'Note saved' : 'Note created')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (note) => {
    const ok = await confirm({
      title: `Delete “${note.name}”?`,
      description: 'The note and everything written in it are permanently removed.',
      confirmLabel: 'Delete note'
    })
    if (!ok) return
    try {
      await api.notes.remove(note.id)
      const rows = await api.notes.list()
      setNotes(rows)
      setDraft((current) => (current?.id === note.id ? rows[0] || null : current))
      toast.success('Note deleted')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col gap-3" onKeyDown={onKeyDown}>
        <header className="flex flex-wrap items-center gap-3">
          <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]">
            <NotebookPen size={20} />
            <span aria-hidden className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[rgb(var(--primary))] ring-2 ring-[rgb(var(--surface))]" />
          </span>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Notes</h1>
            <p className="text-[11px] text-[rgb(var(--muted))]">Runbooks, VLAN plans and anything else worth keeping</p>
          </div>
          <span className="hidden rounded-full border bg-[rgb(var(--surface)/.6)] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--muted))] sm:inline">
            {loading ? '…' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </span>
          <Button className="ml-auto" size="sm" onClick={startNew}><Plus size={14} /> New note</Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-2 rounded-2xl border bg-[rgb(var(--surface))] p-3">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes or #tags" className="pl-8 text-[12px]" aria-label="Search notes" />
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {loading && [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-16 w-full" />)}
              <AnimatePresence initial={false}>
                {filtered.map((note) => {
                  const tags = noteTags(note)
                  return (
                    <motion.button
                      key={note.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0, scale: draft?.id === note.id ? 1.015 : 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      whileHover={{ y: -2 }}
                      transition={{ layout: { type: 'spring', stiffness: 400, damping: 32 } }}
                      type="button"
                      onClick={() => select(note)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setMenu({ x: event.clientX, y: event.clientY, noteId: note.id })
                      }}
                      style={note.color && note.color !== 'default' && draft?.id !== note.id
                        ? { background: colorOf(note.color).tint, borderColor: colorOf(note.color).edge }
                        : undefined}
                      className={cn(
                        'group relative w-full overflow-hidden rounded-xl border bg-[rgb(var(--canvas))] p-2 text-left transition-all duration-200 hover:border-[rgb(var(--primary)/.55)] hover:shadow-md hover:shadow-black/5',
                        draft?.id === note.id && 'border-[rgb(var(--primary)/.65)] bg-[rgb(var(--primary)/.08)] shadow-[0_0_0_1px_rgb(var(--primary)/.28),0_10px_30px_-14px_rgb(var(--primary)/.5)]',
                        Boolean(note.pinned) && draft?.id !== note.id && 'shadow-sm'
                      )}
                    >
                      {/* A colour is only useful if it can be spotted without reading. */}
                      {note.color && note.color !== 'default' && draft?.id !== note.id && (
                        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: colorOf(note.color).swatch }} />
                      )}
                      {/* The open note carries the same spring-animated indicator
                          bar as the sidebar's active page (v2.0.16). */}
                      {draft?.id === note.id && (
                        <motion.span
                          layoutId="note-active-bar"
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          className="absolute inset-y-0 left-0 w-1 rounded-r-full bg-[rgb(var(--primary))] shadow-[0_0_12px_rgb(var(--primary)/.75)]"
                        />
                      )}
                      <div className="flex items-center gap-1.5">
                        {/* Pin lives on the LEFT, vertically centered in the
                            card — one click pins/unpins right from the list. */}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={note.pinned ? `Unpin ${note.name}` : `Pin ${note.name}`}
                          title={note.pinned ? 'Unpin note' : 'Pin note'}
                          onClick={(event) => { event.stopPropagation(); togglePin(note) }}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); togglePin(note) } }}
                          className={cn(
                            'grid h-7 w-6 shrink-0 place-items-center self-center rounded-md transition',
                            note.pinned
                              ? 'text-[rgb(var(--primary))]'
                              : 'text-[rgb(var(--muted))] opacity-40 hover:opacity-100 group-hover:opacity-100'
                          )}
                        >
                          <Pin size={13} fill={note.pinned ? 'currentColor' : 'none'} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {Number(note.priority) > 0 && (() => {
                              const level = priorityOf(note.priority)
                              const Icon = level.icon
                              return (
                                <span
                                  className="flex shrink-0 items-center gap-0.5 rounded-full px-1 py-0.5 text-[8.5px] font-extrabold uppercase"
                                  style={{ color: level.tone, background: 'rgb(var(--surface)/.85)' }}
                                >
                                  <Icon size={9} /> {level.short}
                                </span>
                              )
                            })()}
                            <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold">{note.name}</span>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`Delete ${note.name}`}
                              onClick={(event) => { event.stopPropagation(); remove(note) }}
                              onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); remove(note) } }}
                              className="shrink-0 rounded-md p-1 text-[rgb(var(--muted))] opacity-0 transition hover:bg-nord-11/15 hover:text-nord-11 group-hover:opacity-100"
                            >
                              <Trash2 size={12} />
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-[rgb(var(--muted))]">{preview(note.body)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                role="button"
                                tabIndex={0}
                                aria-label={`Filter by ${displayTag(tag)}`}
                                title={`Filter by ${displayTag(tag)}`}
                                onClick={(event) => { event.stopPropagation(); setQuery(tag) }}
                                onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); setQuery(tag) } }}
                                className="rounded-full bg-[rgb(var(--primary)/.1)] px-1.5 py-0.5 text-[8.5px] font-bold text-[rgb(var(--primary))] transition hover:bg-[rgb(var(--primary)/.2)]"
                              >
                                {displayTag(tag)}
                              </span>
                            ))}
                            {tags.length > 3 && <span className="text-[8.5px] font-bold text-[rgb(var(--muted))]">+{tags.length - 3}</span>}
                            <span className="ml-auto flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                              <span className="h-1 w-1 rounded-full bg-[rgb(var(--border))]" />
                              {when(note.updated_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>

              {!loading && !filtered.length && (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-[rgb(var(--border)/.4)] text-[rgb(var(--muted))]">
                    <NotebookPen size={20} />
                  </span>
                  <p className="text-[11px] font-bold">{notes.length ? 'No note matches that search' : 'No notes yet'}</p>
                  <p className="text-[10px] text-[rgb(var(--muted))]">{notes.length ? 'Try a different keyword.' : 'Create the first one to start keeping track.'}</p>
                </div>
              )}
            </div>
          </aside>

          {draft ? (
            <AnimatePresence mode="wait">
              <motion.section
                key={draft.id || 'new'}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="relative flex min-h-0 flex-col gap-2 overflow-hidden rounded-2xl border bg-[rgb(var(--surface))] p-3"
              >
                {/* The note's colour as a soft banner, so the editor matches the card. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
                  style={{
                    background: `linear-gradient(90deg, ${colorOf(draft.color || 'default').swatch}, transparent 80%)`,
                    opacity: draft.color && draft.color !== 'default' ? 1 : 0.35
                  }}
                />
                <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[rgb(var(--primary)/.07)] blur-2xl" />

                <div className="flex items-center gap-2">
                  <Input
                    ref={nameRef}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="Note name"
                    aria-label="Note name"
                    className="flex-1 border-0 bg-transparent px-0 text-base font-extrabold shadow-none focus-visible:ring-0"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    title={draft.pinned ? 'Unpin note' : 'Pin note'}
                    aria-label={draft.pinned ? 'Unpin note' : 'Pin note'}
                    aria-pressed={Boolean(draft.pinned)}
                    className={cn(draft.pinned && 'text-[rgb(var(--primary))]')}
                    onClick={() => (draft.id ? save({ pinned: draft.pinned ? 0 : 1 }) : setDraft({ ...draft, pinned: draft.pinned ? 0 : 1 }))}
                  >
                    {draft.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </Button>
                  <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                    <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>

              {/* Colour, tags and priority sit above the body: all describe the
                  whole note, and each is one click rather than a buried menu. */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-[rgb(var(--canvas))] px-2.5 py-2">
                <div className="flex items-center gap-1.5" role="group" aria-label="Note colour">
                  <Palette size={13} className="text-[rgb(var(--muted))]" />
                  {NOTE_COLORS.map((entry) => {
                    const active = (draft.color || 'default') === entry.id
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-label={`${entry.label} colour`}
                        aria-pressed={active}
                        title={entry.label}
                        onClick={() => setDraft({ ...draft, color: entry.id })}
                        className={cn(
                          'grid h-6 w-6 place-items-center rounded-full border-2 transition-all duration-200 hover:scale-110',
                          active ? 'border-[rgb(var(--text))] scale-110' : 'border-transparent'
                        )}
                        style={{ background: entry.swatch }}
                      >
                        {active && <Check size={11} className="text-[rgb(var(--canvas))]" strokeWidth={3.5} />}
                      </button>
                    )
                  })}
                </div>

                {/* Tags: their own list beside the colours — adding or removing
                    one never touches the note body (v2.0.16). */}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="Note tags">
                  <Hash size={11} className="shrink-0 text-[rgb(var(--muted))]" />
                  {(draft.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-0.5 rounded-full bg-[rgb(var(--primary)/.12)] pl-1.5 pr-0.5 text-[9px] font-bold text-[rgb(var(--primary))]"
                    >
                      <button
                        type="button"
                        title={`Filter by ${displayTag(tag)}`}
                        onClick={() => setQuery(tag)}
                        className="py-0.5 transition hover:opacity-70"
                      >
                        {displayTag(tag)}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove tag ${displayTag(tag)}`}
                        title={`Remove ${displayTag(tag)}`}
                        onClick={() => removeTag(tag)}
                        className="grid h-3.5 w-3.5 place-items-center rounded-full opacity-60 transition hover:bg-[rgb(var(--primary)/.25)] hover:opacity-100"
                      >
                        <X size={8} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                  <span className="flex items-center gap-0.5 rounded-full border border-dashed bg-[rgb(var(--canvas)/.6)] py-0.5 pl-2 pr-0.5">
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }}
                      placeholder="Add #tag"
                      aria-label="New tag"
                      className="w-16 bg-transparent text-[9px] font-bold text-[rgb(var(--text))] outline-none placeholder:text-[rgb(var(--muted)/.7)]"
                    />
                    <button
                      type="button"
                      aria-label="Add tag"
                      title="Add tag"
                      onClick={addTag}
                      disabled={!tagInput.trim()}
                      className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[rgb(var(--primary)/.2)] text-[rgb(var(--primary))] transition enabled:hover:bg-[rgb(var(--primary)/.35)] disabled:opacity-40"
                    >
                      <Plus size={8} strokeWidth={3.5} />
                    </button>
                  </span>
                </div>

                <div className="ml-auto flex items-center gap-1" role="group" aria-label="Note priority">
                  {PRIORITIES.map((level) => {
                    const Icon = level.icon
                    const active = Number(draft.priority || 0) === level.id
                    return (
                      <button
                        key={level.id}
                        type="button"
                        aria-pressed={active}
                        aria-label={`${level.label} priority`}
                        onClick={() => setDraft({ ...draft, priority: level.id })}
                        className={cn(
                          'flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-bold transition-all duration-200',
                          active ? 'border-current' : 'border-transparent text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.45)]'
                        )}
                        style={active ? { color: level.tone, background: 'rgb(var(--surface))' } : undefined}
                      >
                        <Icon size={11} /> {level.short}
                      </button>
                    )
                  })}
                </div>
              </div>

              <Textarea
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder="Write anything — steps, IP plans, #tags, passwords you rotate, reminders…"
                aria-label="Note body"
                className="min-h-0 flex-1 resize-none font-mono text-[12px] leading-relaxed"
              />

              <div className="flex items-center gap-2 px-1 text-[10px] text-[rgb(var(--muted))]">
                <span className="rounded-full bg-[rgb(var(--border)/.4)] px-2 py-0.5 font-semibold">{(draft.body || '').length} characters</span>
                {draft.updated_at && <span className="hidden sm:inline">Updated {when(draft.updated_at)}</span>}
                <span
                  className={cn(
                    'ml-auto rounded-full px-2 py-0.5 font-semibold',
                    dirty ? 'bg-nord-13/20 text-[#8b6e1c]' : 'bg-nord-14/15 text-[#66834e]'
                  )}
                >
                  {dirty ? 'Unsaved changes — Ctrl+S to save' : 'All changes saved'}
                </span>
              </div>
              </motion.section>
            </AnimatePresence>
          ) : (
            <section className="grid place-items-center rounded-2xl border border-dashed bg-[rgb(var(--surface)/.5)]">
              <EmptyState
                icon={<NotebookPen size={26} />}
                title="No note selected"
                description="Pick a note on the left, or create a new one to start writing."
                action={<Button size="sm" onClick={startNew}><Plus size={14} /> New note</Button>}
              />
            </section>
          )}
        </div>

        {/* Right-click menu: colour + priority for the note under the cursor. */}
        {menu && (() => {
          const target = notes.find((note) => note.id === menu.noteId)
          if (!target) return null
          const width = 236
          const height = 268
          const left = Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 12)
          const top = Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - height - 12)
          return (
            <>
              <div
                className="fixed inset-0 z-[70]"
                onClick={() => setMenu(null)}
                onContextMenu={(event) => { event.preventDefault(); setMenu(null) }}
              />
              <motion.div
                role="menu"
                aria-label={`Actions for ${target.name}`}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="dialog-content fixed z-[80] rounded-xl border bg-[rgb(var(--surface))] p-2 shadow-2xl"
                style={{ left, top, width }}
              >
                <p className="px-1 text-[9px] font-extrabold uppercase tracking-wider text-[rgb(var(--muted))]">Colour</p>
                <div className="mt-1 flex items-center gap-1.5 px-1">
                  {NOTE_COLORS.map((entry) => {
                    const active = (target.color || 'default') === entry.id
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-label={`Set ${entry.label} colour`}
                        title={entry.label}
                        onClick={() => { setMenu(null); quickUpdate(target, { color: entry.id }, 'Note colour updated') }}
                        className={cn(
                          'grid h-6 w-6 place-items-center rounded-full border-2 transition-all duration-150 hover:scale-110',
                          active ? 'border-[rgb(var(--text))]' : 'border-transparent'
                        )}
                        style={{ background: entry.swatch }}
                      >
                        {active && <Check size={10} className="text-[rgb(var(--canvas))]" strokeWidth={3.5} />}
                      </button>
                    )
                  })}
                </div>

                <div className="my-1.5 h-px bg-[rgb(var(--border)/.7)]" />

                <p className="px-1 text-[9px] font-extrabold uppercase tracking-wider text-[rgb(var(--muted))]">Priority</p>
                <div className="mt-1 grid gap-0.5 px-0.5">
                  {PRIORITIES.map((level) => {
                    const Icon = level.icon
                    const active = Number(target.priority || 0) === level.id
                    return (
                      <button
                        key={level.id}
                        type="button"
                        aria-label={`Set ${level.label} priority`}
                        onClick={() => { setMenu(null); quickUpdate(target, { priority: level.id }, 'Priority updated') }}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10.5px] font-bold transition',
                          active ? 'bg-[rgb(var(--border)/.4)]' : 'hover:bg-[rgb(var(--border)/.4)]'
                        )}
                      >
                        <Icon size={11} style={{ color: level.tone }} />
                        <span>{level.label}</span>
                        {active && <Check size={11} className="ml-auto" strokeWidth={3} />}
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            </>
          )
        })()}
      </div>
    </AppShell>
  )
}
