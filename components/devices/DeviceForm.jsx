'use client'

import { useEffect } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Eye, EyeOff, Network, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select, Switch } from '@/components/ui'
import { DEVICE_TYPES, DEVICE_TYPE_DETAILS } from '@/lib/constants'
import { isValidHost } from '@/lib/utils'

const optionalHost = z.string().trim().refine((value) => !value || isValidHost(value), 'Enter a valid IP address or hostname')
const optionalPort = z.union([z.literal(''), z.coerce.number().int().min(1).max(65535)]).optional()
const optionalPositiveNumber = z.union([z.literal(''), z.coerce.number().int().min(1)]).optional()
const MAX_SWITCH_PORTS = 48
const switchPortSchema = z.object({
  port_number: z.coerce.number().int().min(1, 'Port Number is required').max(MAX_SWITCH_PORTS, `Port Number cannot exceed ${MAX_SWITCH_PORTS}`),
  vlan: z.string().trim().optional(),
  status: z.enum(['up', 'down', 'disabled']),
  ip: optionalHost,
  details: z.string().trim().optional()
})

const schema = z.object({
  branch_id: z.coerce.number().int().positive('Select a branch'),
  device_type: z.enum(DEVICE_TYPES),
  model: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Device Name is required'),
  location: z.string().trim().optional(),
  ip: z.string().trim().refine(isValidHost, 'Enter a valid IPv4 address or hostname'),
  port: optionalPort,
  asset_code: z.string().trim().optional(),
  connection_type: z.string().trim().optional(),
  transport: z.enum(['', 'ssh', 'telnet']).optional(),
  connection_port: z.string().trim().optional(),
  hostname: z.string().trim().optional(),
  user: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  esxi_version: z.string().trim().optional(),
  version: z.string().trim().optional(),
  terminal_id: z.string().trim().optional(),
  acceptance_id: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  checkout_number: optionalPositiveNumber,
  serial_number: z.string().trim().optional(),
  switch_ports: z.array(switchPortSchema).max(MAX_SWITCH_PORTS, `A Switch can contain at most ${MAX_SWITCH_PORTS} ports`).default([]),
  is_dashboard_visible: z.boolean().optional()
}).superRefine((data, context) => {
  if (data.device_type !== 'Switch') return
  const seen = new Set()
  data.switch_ports.forEach((port, index) => {
    if (seen.has(port.port_number)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['switch_ports', index, 'port_number'], message: 'Port numbers must be unique' })
    }
    seen.add(port.port_number)
  })
})

const defaults = {
  branch_id: '', device_type: 'Router', model: '', name: '', location: '', ip: '', port: '', asset_code: '',
  connection_type: '', transport: '', connection_port: '', hostname: '', user: '', domain: '', esxi_version: '', version: '',
  terminal_id: '', acceptance_id: '', brand: '', checkout_number: '', serial_number: '', switch_ports: [],
  is_dashboard_visible: false
}

const emptySwitchPort = (portNumber = 1) => ({ port_number: portNumber, vlan: '', status: 'up', ip: '', details: '' })

const fieldSets = {
  Router: ['name', 'model', 'ip', 'port', 'asset_code'],
  Switch: ['name', 'model', 'location', 'ip', 'transport', 'connection_type', 'connection_port', 'asset_code'],
  iLO: ['name', 'ip', 'esxi_version', 'model', 'asset_code'],
  Server: ['name', 'hostname', 'ip'],
  NVR: ['name', 'ip', 'model', 'asset_code'],
  AccessPoint: ['name', 'model', 'location', 'ip', 'port', 'asset_code'],
  Scale: ['name', 'model', 'location', 'ip', 'serial_number', 'asset_code'],
  Client: ['name', 'hostname', 'user', 'ip', 'domain'],
  Checkout: ['name', 'checkout_number', 'hostname', 'ip'],
  POS: ['name', 'checkout_number', 'brand', 'model', 'version', 'ip', 'terminal_id', 'acceptance_id', 'asset_code']
}

const fieldMeta = {
  model: { label: 'Model', placeholder: 'Manufacturer and model' },
  name: { label: 'Name', placeholder: 'Device display name' },
  location: { label: 'Location', placeholder: 'Network room / sales floor' },
  ip: { label: 'IP', placeholder: '10.10.1.10' },
  port: { label: 'Port', placeholder: '443', type: 'number', min: 1, max: 65535 },
  asset_code: { label: 'Asset Code', placeholder: 'HF-BER-001' },
  connection_type: { label: 'Connection Type', placeholder: 'Fiber / Copper / Uplink' },
  transport: {
    label: 'Terminal Protocol',
    hint: 'Used by the in-app terminal when connecting to this switch',
    options: [{ value: '', label: 'SSH (default)' }, { value: 'ssh', label: 'SSH' }, { value: 'telnet', label: 'Telnet' }]
  },
  connection_port: { label: 'Connection Port', placeholder: 'Gi1/0/24' },
  hostname: { label: 'Hostname', placeholder: 'BRANCH-SRV-01' },
  user: { label: 'User', placeholder: 'Local or domain user' },
  domain: { label: 'Domain', placeholder: 'HYPERFAMILY' },
  esxi_version: { label: 'ESXI Version', placeholder: '8.0 U3' },
  version: { label: 'Software Version', placeholder: '4.2.1' },
  terminal_id: { label: 'Terminal ID', placeholder: 'Terminal identifier' },
  acceptance_id: { label: 'Acceptance ID', placeholder: 'Acceptance identifier' },
  brand: { label: 'Brand', placeholder: 'Payment terminal brand' },
  checkout_number: { label: 'Checkout Number', placeholder: '1', type: 'number', min: 1 },
  serial_number: { label: 'Serial Number', placeholder: 'Manufacturer serial number' }
}

export default function DeviceForm({ value, branch, deviceType, onSubmit, onBack, saving }) {
  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaults
  })
  const { fields: switchPorts, append, remove } = useFieldArray({ control, name: 'switch_ports' })

  useEffect(() => {
    const type = value?.device_type || deviceType || 'Router'
    const sourcePorts = Array.isArray(value?.switch_ports) ? value.switch_ports : []
    // SQLite returns null for unused device-specific columns. Keep those values out of
    // form state so optional string validators receive an empty string instead of null.
    const populated = value ? Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)) : {}
    reset({
      ...defaults,
      ...populated,
      branch_id: value?.branch_id || branch?.id || '',
      device_type: type,
      port: value?.port || '',
      checkout_number: value?.checkout_number || '',
      switch_ports: type === 'Switch' ? (sourcePorts.length ? sourcePorts : value ? [] : [emptySwitchPort()]) : [],
      is_dashboard_visible: Boolean(value?.is_dashboard_visible)
    })
  }, [branch?.id, deviceType, reset, value])

  const type = watch('device_type')
  const visible = watch('is_dashboard_visible')
  const fields = fieldSets[type] || []
  const typeDetail = DEVICE_TYPE_DETAILS[type]

  const renderField = (name) => {
    const meta = fieldMeta[name]
    const label = type === 'iLO' && name === 'model' ? 'Server Model' : meta.label
    const inputId = `device-${type}-${name}`
    return (
      <div key={name}>
        <Label htmlFor={inputId}>{label}</Label>
        {meta.options ? (
          <Select id={inputId} {...register(name)}>
            {meta.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        ) : (
          <Input id={inputId} placeholder={meta.placeholder} type={meta.type} min={meta.min} max={meta.max} autoComplete="off" aria-required={name === 'name' || name === 'ip'} {...register(name)} />
        )}
        {meta.hint && <p className="mt-1 text-[10px] leading-relaxed text-[rgb(var(--muted))]">{meta.hint}</p>}
        {errors[name] && <p className="mt-1 text-[11px] font-semibold text-nord-11">{errors[name].message}</p>}
      </div>
    )
  }

  const addSwitchPort = () => {
    if (switchPorts.length >= MAX_SWITCH_PORTS) return
    const used = new Set(switchPorts.map((_, index) => Number(watch(`switch_ports.${index}.port_number`))))
    let next = 1
    while (next <= MAX_SWITCH_PORTS && used.has(next)) next += 1
    if (next <= MAX_SWITCH_PORTS) append(emptySwitchPort(next))
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="device-directory-form space-y-3.5">
      <input type="hidden" {...register('branch_id')} />
      <input type="hidden" {...register('device_type')} />

      <div className="flex flex-col gap-2 rounded-xl border bg-[rgb(var(--canvas)/.55)] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">Selected branch</p>
          <p className="mt-1 truncate text-sm font-black">{branch?.name || 'Unknown branch'} <span className="font-mono text-[10px] text-[rgb(var(--muted))]">· {branch?.code}</span></p>
        </div>
        <div className="rounded-xl border border-[rgb(var(--primary)/.2)] bg-[rgb(var(--primary)/.09)] px-3 py-2 text-right">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[rgb(var(--primary))]">{typeDetail?.label || type}</p>
          <p className="mt-0.5 text-[8px] text-[rgb(var(--muted))]">Only relevant fields are shown</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(renderField)}</div>

      {type === 'Switch' && (
        <fieldset className="rounded-xl border bg-[rgb(var(--canvas)/.34)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black"><Network size={16} className="text-[rgb(var(--primary))]" /> Managed switch ports</h3>
              <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">Define up to {MAX_SWITCH_PORTS} unique physical port numbers from 1 through {MAX_SWITCH_PORTS}.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addSwitchPort} disabled={switchPorts.length >= MAX_SWITCH_PORTS}><Plus size={14} />Add port ({switchPorts.length}/{MAX_SWITCH_PORTS})</Button>
          </div>

          <div className="mt-3 space-y-2">
            {switchPorts.map((port, index) => (
              <div key={port.id} className="relative rounded-xl border bg-[rgb(var(--surface)/.72)] p-2.5 pr-10 shadow-sm">
                <span className="absolute right-3 top-3 grid h-6 min-w-6 place-items-center rounded-lg bg-[rgb(var(--primary)/.1)] px-1.5 text-[9px] font-black text-[rgb(var(--primary))]">#{index + 1}</span>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div><Label htmlFor={`switch-port-${index}-number`}>Port Number</Label><Input id={`switch-port-${index}-number`} type="number" min="1" max={MAX_SWITCH_PORTS} aria-required="true" {...register(`switch_ports.${index}.port_number`)} />{errors.switch_ports?.[index]?.port_number && <p className="mt-1 text-[10px] font-semibold text-nord-11">{errors.switch_ports[index].port_number.message}</p>}</div>
                  <div><Label htmlFor={`switch-port-${index}-vlan`}>VLAN</Label><Input id={`switch-port-${index}-vlan`} placeholder="10 / Trunk" {...register(`switch_ports.${index}.vlan`)} /></div>
                  <div><Label htmlFor={`switch-port-${index}-status`}>Status</Label><Select id={`switch-port-${index}-status`} {...register(`switch_ports.${index}.status`)}><option value="up">Up</option><option value="down">Down</option><option value="disabled">Disabled</option></Select></div>
                  <div><Label htmlFor={`switch-port-${index}-ip`}>IP</Label><Input id={`switch-port-${index}-ip`} placeholder="Optional" {...register(`switch_ports.${index}.ip`)} />{errors.switch_ports?.[index]?.ip && <p className="mt-1 text-[10px] font-semibold text-nord-11">{errors.switch_ports[index].ip.message}</p>}</div>
                  <div><Label htmlFor={`switch-port-${index}-details`}>Details</Label><Input id={`switch-port-${index}-details`} placeholder="Uplink / camera" {...register(`switch_ports.${index}.details`)} /></div>
                </div>
                <button type="button" onClick={() => remove(index)} className="absolute bottom-3 right-3 grid h-7 w-7 place-items-center rounded-lg text-[rgb(var(--muted))] transition hover:bg-nord-11/12 hover:text-nord-11" aria-label={`Remove switch port ${index + 1}`}><Trash2 size={14} /></button>
              </div>
            ))}
            {!switchPorts.length && <div className="rounded-xl border border-dashed p-5 text-center text-xs text-[rgb(var(--muted))]">No ports defined yet. Select <b>Add port</b> to create one.</div>}
          </div>
        </fieldset>
      )}

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-[rgb(var(--surface)/.7)] p-3 transition hover:border-[rgb(var(--primary)/.35)] hover:shadow-sm">
        <span className="flex min-w-0 items-center gap-3">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${visible ? 'bg-[rgb(var(--primary)/.13)] text-[rgb(var(--primary))]' : 'bg-[rgb(var(--border)/.55)] text-[rgb(var(--muted))]'}`}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</span>
          <span><b className="block text-sm">Show on Dashboard</b><small className="mt-0.5 block text-[10px] text-[rgb(var(--muted))]">Monitor this device and include it in the selected branch&apos;s Dashboard view.</small></span>
        </span>
        <Switch checked={visible} onCheckedChange={(checked) => setValue('is_dashboard_visible', checked, { shouldDirty: true })} />
      </label>

      {Object.keys(errors).length > 0 && (
        <div role="alert" className="rounded-xl border border-nord-11/35 bg-nord-11/10 px-3 py-2 text-[11px] font-semibold text-nord-11">
          Some fields need attention. Review the highlighted inputs and try saving again.
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        {onBack ? <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft size={15} />Back to device types</Button> : <span />}
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : value ? 'Save changes' : `Add ${typeDetail?.label || type}`}</Button>
      </div>
    </form>
  )
}
