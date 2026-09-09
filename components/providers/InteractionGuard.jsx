'use client'

import { useEffect } from 'react'

/**
 * Safety net against a permanently unresponsive interface.
 *
 * Three distinct kinds of wreckage can survive a modal that unmounts while it
 * is closing (a delete that re-renders the list under its own dialog):
 *   1. `pointer-events: none` left on <body>;
 *   2. an orphaned full-screen overlay that silently swallows every click;
 *   3. `aria-hidden`/`inert` left on the app root, which blocks focus so no
 *      field can be typed into even though the pointer still works.
 * Only (1) was handled before, which is why the fault could still be seen.
 *
 * Radix's modal primitives (Dialog, DropdownMenu, Select) set
 * `pointer-events: none` on <body> while a modal layer is open and remove it on
 * cleanup. If a layer unmounts in the same tick that it closes — which is what
 * happens when a row is deleted and the list re-renders underneath the menu
 * that triggered the delete — the cleanup can be skipped, and the style is left
 * behind forever. The window then looks completely normal but ignores every
 * click and keystroke, so no text box can be focused or typed into.
 *
 * This guard watches <body> and strips the lock whenever no Radix layer is
 * actually mounted, so the fault can never persist even if a future component
 * reintroduces the same race. It is a few microseconds of work per mutation and
 * is inert while a real modal is open.
 */

/**
 * A modal layer is only genuinely open when its *content* is mounted. The
 * overlay alone does not count: an orphaned overlay with no content is exactly
 * the wreckage this guard exists to clear.
 */
const CONTENT_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]'
].join(',')

/** Full-screen scrims Radix leaves behind. Invisible, but they eat every click. */
const OVERLAY_SELECTOR = '.dialog-overlay,.dashboard-dialog-overlay,[data-radix-dialog-overlay],[data-radix-alert-dialog-overlay]'

/**
 * Any dialog content in the document, *including* one that is mid-close.
 * A closing dialog is still React's business, so the guard must keep its hands
 * off it — an overlay only counts as orphaned when no content exists at all.
 */
const ANY_CONTENT = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]'

const layerOpen = () => Boolean(document.querySelector(CONTENT_SELECTOR))

function releaseIfStuck() {
  const { body } = document
  if (!body) return

  // A real modal is on screen: leave everything alone.
  if (layerOpen()) return

  // ---- 1. The classic body lock -------------------------------------------
  if (body.style.pointerEvents === 'none') body.style.removeProperty('pointer-events')
  if (body.hasAttribute('data-scroll-locked')) {
    body.style.removeProperty('overflow')
    body.removeAttribute('data-scroll-locked')
  }

  // ---- 2. Orphaned overlays ------------------------------------------------
  // The real cause of "I click the text box and nothing happens": the dialog
  // content unmounted with the row that opened it, but its overlay — a
  // fixed, transparent, full-screen element — was never removed. The page
  // looks completely normal and every click lands on the scrim instead.
  //
  // The scrim is *neutralised*, never removed from the DOM. These nodes are
  // still owned by React, and deleting one behind React's back makes the next
  // reconciliation fail and takes the whole page down — a far worse bug than
  // the one being fixed. Hiding it is invisible to React and just as effective.
  if (!document.querySelector(ANY_CONTENT)) {
    document.querySelectorAll(OVERLAY_SELECTOR).forEach((node) => {
      node.style.pointerEvents = 'none'
      node.style.display = 'none'
    })
  }

  // ---- 3. Stale aria-hidden / inert on the application root ---------------
  // Radix marks every sibling of an open dialog as hidden from assistive tech
  // and inert. If the cleanup is skipped, the whole app stays inert: focus
  // cannot enter any field, so typing is impossible even though the pointer
  // works. Clearing it restores keyboard access.
  if (!document.querySelector(ANY_CONTENT)) {
    document.querySelectorAll('body > [aria-hidden="true"]').forEach((node) => {
      if (node.hasAttribute('data-arena-permanent-hidden')) return
      node.removeAttribute('aria-hidden')
    })
    document.querySelectorAll('body > [inert]').forEach((node) => node.removeAttribute('inert'))
  }
}

export default function InteractionGuard() {
  useEffect(() => {
    releaseIfStuck()

    // Defer briefly so Radix's own cleanup wins the tick when it does run;
    // a timer is used rather than an animation frame because frames are
    // throttled (or never delivered) in background and headless windows,
    // which would leave the interface locked exactly when it matters.
    let pending = null
    const scheduleCheck = () => {
      if (pending) return
      pending = setTimeout(() => { pending = null; releaseIfStuck() }, 50)
    }

    // One registration only: calling observe() twice on the same node replaces
    // the earlier options rather than adding to them, which would silently
    // stop the attribute watch this guard depends on.
    // `subtree: true` matters: the stale overlay and the stale `aria-hidden`
    // both live on body *children*, so watching only <body> itself would miss
    // the very state this guard was added to clear.
    const observer = new MutationObserver(scheduleCheck)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'data-scroll-locked', 'aria-hidden', 'inert', 'data-state'],
      childList: true,
      subtree: true
    })

    // A click that lands on nothing is the classic symptom; re-check then too.
    const onPointerDown = () => scheduleCheck()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('focusin', onPointerDown, true)

    // Final backstop: even if every event above is missed, the interface can
    // never stay dead for more than a second.
    const sweep = setInterval(releaseIfStuck, 1000)

    return () => {
      clearTimeout(pending)
      clearInterval(sweep)
      observer.disconnect()
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('focusin', onPointerDown, true)
    }
  }, [])

  return null
}
