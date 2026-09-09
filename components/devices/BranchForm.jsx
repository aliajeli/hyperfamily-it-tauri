'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, Label } from '@/components/ui'
import { isValidHost } from '@/lib/utils'

const optionalHost = z.string().trim().refine((value) => !value || isValidHost(value), 'Enter a valid IP address or hostname')
const schema = z.object({
  name: z.string().trim().min(2, 'Branch name is required'),
  code: z.string().trim().min(2, 'Branch code is required').max(20).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash, or underscore'),
  warehouse_code: z.string().trim().min(1, 'Warehouse Code is required').max(40).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash, or underscore'),
  link1: z.string().trim().optional(), ip_link1: optionalHost,
  link2: z.string().trim().optional(), ip_link2: optionalHost,
  manager_name: z.string().trim().optional(), manager_tell: z.string().trim().optional(),
  deputy_name: z.string().trim().optional(), deputy_tell: z.string().trim().optional()
})
const defaults = { name: '', code: '', warehouse_code: '', link1: '', ip_link1: '', link2: '', ip_link2: '', manager_name: '', manager_tell: '', deputy_name: '', deputy_tell: '' }

export default function BranchForm({ value, onSubmit, saving }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: defaults })
  useEffect(() => {
    const populated = value ? Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)) : {}
    reset({ ...defaults, ...populated })
  }, [value, reset])
  const field = (name, label, placeholder, props = {}) => {
    const inputId = `branch-${name}`
    return <div><Label htmlFor={inputId}>{label}</Label><Input id={inputId} placeholder={placeholder} aria-required={['name', 'code', 'warehouse_code'].includes(name)} {...register(name)} {...props} />{errors[name] && <p className="mt-1 text-[11px] text-nord-11">{errors[name].message}</p>}</div>
  }
  return <form onSubmit={handleSubmit(onSubmit)} className="branch-directory-form space-y-4">
    <div className="grid gap-4 sm:grid-cols-3">{field('name', 'Name', 'Central Berlin')}{field('code', 'Code', 'BER-01')}{field('warehouse_code', 'Warehouse Code', 'WH-BER-01')}</div>
    <fieldset className="rounded-xl border p-4"><legend className="px-2 text-xs font-bold">Network links</legend><div className="grid gap-4 sm:grid-cols-2">{field('link1', 'Link1', 'MPLS / ISP name')}{field('ip_link1', 'IP Link1', '10.10.1.1')}{field('link2', 'Link2', 'LTE / ISP name')}{field('ip_link2', 'IP Link2', '10.10.1.2')}</div></fieldset>
    <fieldset className="rounded-xl border p-4"><legend className="px-2 text-xs font-bold">Branch contacts</legend><div className="grid gap-4 sm:grid-cols-2">{field('manager_name', 'Manager Name', 'Full name')}{field('manager_tell', 'Manager Tell', '+49 …', { type: 'tel' })}{field('deputy_name', 'Deputy Name', 'Full name')}{field('deputy_tell', 'Deputy Tell', '+49 …', { type: 'tel' })}</div></fieldset>
    <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : value ? 'Save branch' : 'Add branch'}</Button></div>
  </form>
}
