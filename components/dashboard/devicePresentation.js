export function descriptor(device = {}) {
  return `${device.name || ''} ${device.hostname || ''} ${device.model || ''}`.toLowerCase()
}

export function deviceRank(device = {}) {
  const text = descriptor(device)
  if (device.device_type === 'iLO') return 10
  if (device.device_type === 'Server' && text.includes('sql')) return 20
  if (device.device_type === 'Server' && text.includes('iis')) return 30
  if (device.device_type === 'Server') return 35
  if (device.device_type === 'Checkout') return 40 + Math.min(Number(device.checkout_number || 99), 99)
  return 200 + String(device.device_type || '').charCodeAt(0)
}

export function displayLabel(device = {}) {
  const text = descriptor(device)
  if (device.device_type === 'iLO') return 'iLO'
  if (device.device_type === 'Server' && text.includes('sql')) return 'Server - SQL'
  if (device.device_type === 'Server' && text.includes('iis')) return 'Server - IIS'
  if (device.device_type === 'Checkout' && device.checkout_number) return `Checkout ${device.checkout_number}`
  return device.name
}

export function visibleBranchDevices(branchId, devices = []) {
  return devices.filter((device) => device.branch_id === branchId && device.is_dashboard_visible)
}

export function orderedEquipment(devices = []) {
  return devices
    .filter((device) => device.device_type !== 'Router')
    .sort((left, right) => deviceRank(left) - deviceRank(right) || String(left.name || '').localeCompare(String(right.name || '')))
}
