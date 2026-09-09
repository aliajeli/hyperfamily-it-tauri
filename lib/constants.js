import packageInfo from '../package.json'

export { THEMES, THEME_FAMILIES, findTheme, applyTheme } from './themes'

export const APP_NAME = 'HyperFamily Branch Monitor'
export const APP_VERSION = packageInfo.version

export const DEVICE_TYPES = [
  'Router',
  'Switch',
  'iLO',
  'Server',
  'NVR',
  'AccessPoint',
  'Scale',
  'Client',
  'Checkout',
  'POS'
]

export const DEVICE_TYPE_DETAILS = {
  Router: { label: 'Router', description: 'Gateway model, management IP, port, and asset code' },
  Switch: { label: 'Switch', description: 'Switch identity, connection details, and managed ports' },
  iLO: { label: 'iLO', description: 'Server management interface and ESXi information' },
  Server: { label: 'Server', description: 'Server hostname, IP address, and display name' },
  NVR: { label: 'NVR', description: 'Network video recorder identity and asset details' },
  AccessPoint: { label: 'Access Point', description: 'Wireless access point model, placement, and port' },
  Scale: { label: 'Scale', description: 'Scale model, location, serial number, and asset code' },
  Client: { label: 'Client', description: 'Workstation hostname, user, IP, and domain' },
  Checkout: { label: 'Checkout', description: 'Checkout number, hostname, and IP address' },
  POS: { label: 'POS', description: 'Payment terminal, software, acceptance, and asset details' }
}

export const STATUS = {
  online: { label: 'Online', color: '#A3BE8C' },
  warning: { label: 'Warning', color: '#EBCB8B' },
  offline: { label: 'Offline', color: '#BF616A' },
  unknown: { label: 'Unknown', color: '#4C566A' }
}

export const DEFAULT_SETTINGS = {
  theme: 'aurora',
  // JSON bag of "R G B" values backing the Custom theme; empty until edited.
  theme_custom: '',
  ping_interval: 3,
  ping_history_count: 30,
  dashboard_branch_mode: 'compact_over_four',
  dashboard_branch_details_view: 'modal',
  teamviewer_path: 'C:\\Program Files\\TeamViewer\\TeamViewer.exe',
  teamviewer_password: '',
  winbox_path: 'C:\\Program Files\\Winbox\\winbox64.exe',
  winbox_port: 8291,
  vpn_gateway: '',
  vpn_port: 443,
  vpn_user: '',
  vpn_pass: '',
  teamviewer_lan_mode: true,
  vpn_autoconnect: false,
  forticlient_path: 'C:\\Program Files\\Fortinet\\FortiClient\\FortiClient.exe',
  terminal_font_size: 14,
  terminal_font_family: 'ui-monospace',
  terminal_ssh_port: 22,
  terminal_telnet_port: 23,
  webview_autologin: true,
  // Update Store App: where pushed files are deployed on the checkout
  // machines. The Store Commerce version itself is read from Programs and
  // Features (the uninstall registry), so no executable path is configured.
  store_update_path: 'C:\\Store Commerce\\Updates',
  // How the product is registered in Programs and Features. Microsoft has
  // shipped it as both "Store Commerce" and "Microsoft Store Commerce", and
  // the match is a case-insensitive substring, so the shorter form finds both.
  store_program_name: 'Store Commerce',
  // Target access: the checkouts live in their own domain (okcs) which does
  // not trust the operator's domain (gig), so admin-share access needs an
  // explicit account valid on the TARGET machines.
  target_domain: '',
  target_admin_user: '',
  target_admin_password: '',
  // Typography groups (see lib/typography.js).
  // An empty family means "use the application default".
  font_header_family: '',
  font_header_size: 100,
  font_title_family: '',
  font_title_size: 100,
  font_text_family: '',
  font_text_size: 100,
  font_info_family: '',
  font_info_size: 100,
  font_mono_family: '',
  font_mono_size: 100
}
