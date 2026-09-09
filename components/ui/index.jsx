'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as SelectPrimitive from '@radix-ui/react-select'
import { X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 active:scale-[.98]',
  {
    variants: {
      variant: {
        primary: 'bg-[rgb(var(--primary))] px-4 py-2.5 text-white shadow-md shadow-black/10 hover:-translate-y-0.5 hover:brightness-110',
        secondary: 'border bg-[rgb(var(--surface)/.65)] px-4 py-2.5 text-[rgb(var(--text))] hover:bg-[rgb(var(--surface))]',
        ghost: 'px-3 py-2 text-[rgb(var(--muted))] hover:bg-[rgb(var(--border)/.55)] hover:text-[rgb(var(--text))]',
        danger: 'bg-nord-11 px-4 py-2.5 text-white hover:brightness-110',
        success: 'bg-nord-14 px-4 py-2.5 text-nord-0 hover:brightness-105'
      },
      size: { default: '', sm: 'h-9 px-3 text-xs', icon: 'h-10 w-10 p-0' }
    },
    defaultVariants: { variant: 'primary', size: 'default' }
  }
)

export const Button = React.forwardRef(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})

export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('h-10 w-full rounded-xl border bg-[rgb(var(--surface)/.72)] px-3.5 text-sm text-[rgb(var(--text))] shadow-sm transition placeholder:text-[rgb(var(--muted)/.6)] hover:border-[rgb(var(--muted)/.45)] focus:border-[rgb(var(--focus))]', className)} {...props} />
})

/**
 * Themed dropdown.
 *
 * A native <select> paints its option list with the operating system's own
 * widget, which ignores the application theme entirely — that is why the open
 * list looked plain and unstyled. This renders the list with Radix instead, so
 * it inherits the theme and can be animated, while deliberately keeping the
 * familiar `value` / `onChange` / `<option>` API of the element it replaces.
 *
 * `register()` from react-hook-form passes `onChange`, `onBlur`, `name` and a
 * `ref`, all of which are honoured, so uncontrolled form usage keeps working.
 */
export const Select = React.forwardRef(function Select({ className, children, value, defaultValue, onChange, onBlur, name, disabled, required, 'aria-label': ariaLabel, id, ...props }, ref) {
  const options = React.useMemo(() => {
    const collected = []
    const walk = (nodes) => React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === 'option') {
        const label = typeof child.props.children === 'string'
          ? child.props.children
          : React.Children.toArray(child.props.children).join('')
        collected.push({ value: String(child.props.value ?? label), label, disabled: child.props.disabled })
      } else if (child.props?.children) walk(child.props.children)
    })
    walk(children)
    return collected
  }, [children])

  const isControlled = value !== undefined
  const [internal, setInternal] = React.useState(() => String(defaultValue ?? options[0]?.value ?? ''))
  const current = isControlled ? String(value ?? '') : internal
  const hiddenRef = React.useRef(null)

  const emit = (next) => {
    if (!isControlled) setInternal(next)
    // Mirror the change onto a real form control so `register()` and any
    // consumer reading `event.target.value` behave exactly as before.
    const node = hiddenRef.current
    if (node) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setter ? setter.call(node, next) : (node.value = next)
    }
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } })
  }

  const selected = options.find((option) => option.value === current)

  return (
    <SelectPrimitive.Root value={current} onValueChange={emit} disabled={disabled} name={name} required={required}>
      <SelectPrimitive.Trigger
        id={id}
        ref={ref}
        aria-label={ariaLabel}
        onBlur={onBlur}
        className={cn(
          'group flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-[rgb(var(--surface)/.72)] px-3.5 text-left text-sm text-[rgb(var(--text))] shadow-sm outline-none transition-all duration-200',
          'hover:border-[rgb(var(--primary)/.45)] hover:bg-[rgb(var(--surface)/.9)]',
          'focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus))] data-[state=open]:border-[rgb(var(--primary)/.55)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
        {...props}
      >
        {/* Radix renders `placeholder` (not children) while the value is '', so
            an empty-valued option — like the typography "Default Font" — must
            carry its label in both places to stay visible in the trigger. */}
        <SelectPrimitive.Value placeholder={selected?.label ?? ''} asChild><span className="truncate">{selected?.label ?? ''}</span></SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={15} className="shrink-0 text-[rgb(var(--muted))] transition-transform duration-300 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      {/* Kept in the DOM so native form semantics and RHF refs still resolve. */}
      <select ref={hiddenRef} name={name} value={current} onChange={() => {}} tabIndex={-1} aria-hidden className="sr-only pointer-events-none absolute">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={10}
          className="select-content glass z-[70] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl p-1 shadow-2xl"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-[rgb(var(--muted))]"><ChevronUp size={13} /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-0.5">
            {options.map((option, index) => (
              <SelectPrimitive.Item
                key={`${option.value}-${index}`}
                value={option.value}
                disabled={option.disabled}
                style={{ animationDelay: `${Math.min(index, 10) * 18}ms` }}
                className={cn(
                  'select-item relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-8 pr-3 text-sm outline-none transition-colors duration-150',
                  'data-[highlighted]:bg-[rgb(var(--primary)/.14)] data-[highlighted]:text-[rgb(var(--primary))]',
                  'data-[state=checked]:font-semibold data-[state=checked]:text-[rgb(var(--primary))]',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45'
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2.5 grid place-items-center">
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-[rgb(var(--muted))]"><ChevronDown size={13} /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
})

export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('min-h-20 w-full resize-y rounded-xl border bg-[rgb(var(--surface)/.72)] p-3.5 text-sm', className)} {...props} />
})

export function Label({ className, ...props }) {
  return <label className={cn('field-label', className)} {...props} />
}

export function Card({ className, ...props }) { return <div className={cn('panel', className)} {...props} /> }
export function CardHeader({ className, ...props }) { return <div className={cn('p-4 pb-2.5', className)} {...props} /> }
export function CardTitle({ className, ...props }) { return <h3 className={cn('card-title font-bold tracking-tight', className)} {...props} /> }
export function CardDescription({ className, ...props }) { return <p className={cn('mt-1 text-sm text-[rgb(var(--muted))]', className)} {...props} /> }
export function CardContent({ className, ...props }) { return <div className={cn('p-4 pt-2', className)} {...props} /> }

export function Badge({ status, className, children, ...props }) {
  const styles = { online: 'bg-nord-14/20 text-[#628148]', warning: 'bg-nord-13/25 text-[#806823]', offline: 'bg-nord-11/20 text-nord-11', unknown: 'bg-nord-3/15 text-[rgb(var(--muted))]' }
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', styles[status] || styles.unknown, className)} {...props}>{status && <span className={cn('status-dot h-1.5 w-1.5', status === 'online' && 'bg-nord-14', status === 'warning' && 'bg-nord-13', status === 'offline' && 'bg-nord-11', status === 'unknown' && 'bg-nord-3')} />}{children}</span>
}

export function Dialog({ open, onOpenChange, trigger, title, description, children, className }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-nord-0/55 backdrop-blur-sm" />
        <DialogPrimitive.Content className={cn('dialog-content glass fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-4 sm:p-5 shadow-2xl outline-none', className)}>
          <div className="pr-10">
            <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-1 text-sm text-[rgb(var(--muted))]">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close asChild><button aria-label="Close dialog" className="absolute right-4 top-4 rounded-lg p-2 text-[rgb(var(--muted))] transition-all duration-300 hover:rotate-90 hover:scale-105 hover:bg-[rgb(var(--border)/.6)] hover:text-[rgb(var(--text))]"><X size={18} /></button></DialogPrimitive.Close>
          <div className="mt-3.5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Tabs({ value, onValueChange, tabs, children, className, listClassName }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      {/* Compact triggers with breathing room (v2.0.14): the strip keeps a
          padding around the buttons and a real gap between them, so triggers
          never touch the container edge or each other. */}
      <TabsPrimitive.List className={cn('flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-[rgb(var(--surface)/.48)] p-1', listClassName || 'mb-3.5')}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--text))] data-[state=active]:bg-[rgb(var(--primary))] data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-[rgb(var(--primary)/.28)]"
          >
            {tab.icon}{tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}
export function TabsContent({ value, children, className }) { return <TabsPrimitive.Content value={value} className={cn('outline-none data-[state=active]:animate-[tab-panel-in_.3s_ease-out]', className)}>{children}</TabsPrimitive.Content> }

export function Switch({ checked, onCheckedChange, compact = false, className, ...props }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative shrink-0 rounded-full bg-[rgb(var(--border))] transition duration-200 focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--surface))] disabled:cursor-not-allowed disabled:opacity-55 data-[state=checked]:bg-[rgb(var(--primary))]',
        compact ? 'h-5 w-9' : 'h-6 w-11',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className={cn('block translate-x-0.5 rounded-full bg-white shadow transition duration-200', compact ? 'h-4 w-4 data-[state=checked]:translate-x-[18px]' : 'h-5 w-5 data-[state=checked]:translate-x-[22px]')} />
    </SwitchPrimitive.Root>
  )
}

export function Skeleton({ className }) { return <div className={cn('animate-pulse rounded-xl bg-[rgb(var(--border)/.65)]', className)} /> }

export function EmptyState({ icon, title, description, action }) {
  return <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"><div className="mb-3 rounded-2xl bg-[rgb(var(--border)/.5)] p-3 text-[rgb(var(--muted))]">{icon}</div><h3 className="font-bold">{title}</h3><p className="mt-1 max-w-md text-sm text-[rgb(var(--muted))]">{description}</p>{action && <div className="mt-4">{action}</div>}</div>
}
