'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from './index'
import { cn } from '@/lib/utils'

/**
 * In-app replacement for `window.confirm`.
 *
 * The native dialog is a synchronous, thread-blocking modal. When it is opened
 * from a tree that Radix is managing, Radix's scroll/focus lock is applied but
 * its cleanup never runs, so `pointer-events: none` is left behind on <body>
 * and the entire interface stops accepting clicks and keystrokes — which is
 * exactly the "cannot type in any text box after deleting" fault. An ordinary
 * React dialog keeps the whole flow asynchronous and inside React's lifecycle.
 */

const ConfirmContext = React.createContext(null)

export function ConfirmProvider({ children }) {
  const [request, setRequest] = React.useState(null)
  const resolver = React.useRef(null)

  const confirm = React.useCallback((options) => {
    const settings = typeof options === 'string' ? { description: options } : (options || {})
    return new Promise((resolve) => {
      resolver.current = resolve
      setRequest({
        title: settings.title || 'Are you sure?',
        description: settings.description || '',
        confirmLabel: settings.confirmLabel || 'Delete',
        cancelLabel: settings.cancelLabel || 'Cancel',
        destructive: settings.destructive !== false
      })
    })
  }, [])

  const settle = React.useCallback((value) => {
    setRequest(null)
    const resolve = resolver.current
    resolver.current = null
    // Resolve after the close transition so the caller's follow-up state
    // updates never race Radix's unmount cleanup.
    setTimeout(() => resolve?.(value), 0)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root open={Boolean(request)} onOpenChange={(open) => { if (!open) settle(false) }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-nord-0/55 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className={cn(
              'dialog-content glass fixed left-1/2 top-1/2 z-[60] w-[calc(100%-1.5rem)] max-w-md',
              '-translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 shadow-2xl outline-none'
            )}
            onOpenAutoFocus={(event) => {
              // Focus the safe action, never the destructive one.
              event.preventDefault()
              event.currentTarget.querySelector('[data-confirm-cancel]')?.focus()
            }}
          >
            <div className="flex gap-3.5">
              <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                request?.destructive ? 'bg-nord-11/12 text-nord-11' : 'bg-[rgb(var(--primary)/.12)] text-[rgb(var(--primary))]')}>
                <AlertTriangle size={21} />
              </div>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-base font-bold">{request?.title}</DialogPrimitive.Title>
                {request?.description
                  ? <DialogPrimitive.Description className="mt-1.5 text-sm leading-relaxed text-[rgb(var(--muted))]">{request.description}</DialogPrimitive.Description>
                  : null}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button data-confirm-cancel variant="ghost" size="sm" onClick={() => settle(false)}>{request?.cancelLabel}</Button>
              <Button
                size="sm"
                className={request?.destructive ? 'bg-nord-11 text-white hover:bg-nord-11/90' : undefined}
                onClick={() => settle(true)}
              >{request?.confirmLabel}</Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  )
}

/**
 * `const confirm = useConfirm()` → `if (!(await confirm('Delete X?'))) return`
 * Falls back to the native dialog only if the provider is somehow absent.
 */
export function useConfirm() {
  const context = React.useContext(ConfirmContext)
  return React.useMemo(
    () => context || ((options) => Promise.resolve(window.confirm(typeof options === 'string' ? options : options?.description || 'Are you sure?'))),
    [context]
  )
}
