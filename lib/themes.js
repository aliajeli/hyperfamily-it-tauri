// Central theme catalogue.
// Every theme is pure data: the palette is applied at runtime as CSS custom
// properties on <html>, so adding a theme never requires new CSS.
// Values are "R G B" triplets so Tailwind can use rgb(var(--x) / <alpha>).

function theme(id, name, mode, family, description, vars) {
  return { id, name, mode, family, description, ...vars }
}

const SNOW = { canvas: '229 233 240', surface: '236 239 244', text: '46 52 64', muted: '76 86 106', border: '216 222 233' }
const POLAR = { canvas: '46 52 64', surface: '59 66 82', text: '236 239 244', muted: '196 205 221', border: '76 86 106' }

export const THEMES = [
  /* ---------------------------------------------------------------- Nord light */
  theme('aurora', 'Aurora Light', 'light', 'Nord', 'Warm Nord Aurora accents over Snow Storm surfaces', {
    primary: '191 97 106', secondary: '208 135 112', accent: '235 203 139', focus: '191 97 106', ...SNOW,
    colors: ['#BF616A', '#D08770', '#EBCB8B', '#ECEFF4']
  }),
  theme('frost', 'Frost Light', 'light', 'Nord', 'Cool Nord cyan and blue accents', {
    primary: '94 129 172', secondary: '136 192 208', accent: '143 188 187', focus: '136 192 208', ...SNOW,
    colors: ['#8FBCBB', '#88C0D0', '#81A1C1', '#ECEFF4']
  }),
  theme('snow', 'Snow Light', 'light', 'Nord', 'Clean Snow Storm neutrals with a Polar Night accent', {
    primary: '76 86 106', secondary: '216 222 233', accent: '129 161 193', focus: '129 161 193', ...SNOW,
    colors: ['#ECEFF4', '#E5E9F0', '#D8DEE9', '#4C566A']
  }),
  theme('tundra', 'Tundra Light', 'light', 'Nord', 'Nord green and purple accents on calm light surfaces', {
    primary: '94 129 172', secondary: '163 190 140', accent: '180 142 173', focus: '163 190 140', ...SNOW,
    colors: ['#A3BE8C', '#B48EAD', '#D8DEE9', '#ECEFF4']
  }),
  theme('glacier', 'Glacier Light', 'light', 'Nord', 'Icy Frost teal on the brightest Snow Storm canvas', {
    primary: '143 188 187', secondary: '129 161 193', accent: '136 192 208', focus: '143 188 187',
    canvas: '236 239 244', surface: '248 250 252', text: '46 52 64', muted: '76 86 106', border: '223 229 238',
    colors: ['#8FBCBB', '#81A1C1', '#88C0D0', '#F8FAFC']
  }),
  theme('boreal', 'Boreal Light', 'light', 'Nord', 'Nord forest green leading a soft daylight palette', {
    primary: '132 163 112', secondary: '143 188 187', accent: '235 203 139', focus: '163 190 140', ...SNOW,
    colors: ['#84A370', '#8FBCBB', '#EBCB8B', '#ECEFF4']
  }),

  /* ----------------------------------------------------------------- Nord dark */
  theme('polar', 'Polar Night', 'dark', 'Nord', 'Classic Nord dark workspace with Frost highlights', {
    primary: '136 192 208', secondary: '67 76 94', accent: '180 142 173', focus: '136 192 208', ...POLAR,
    colors: ['#2E3440', '#3B4252', '#434C5E', '#88C0D0']
  }),
  theme('arctic-night', 'Arctic Night', 'dark', 'Nord', 'Deep Polar Night surfaces with strong blue Frost accents', {
    primary: '129 161 193', secondary: '136 192 208', accent: '143 188 187', focus: '136 192 208',
    ...POLAR, surface: '67 76 94',
    colors: ['#2E3440', '#434C5E', '#5E81AC', '#81A1C1']
  }),
  theme('fjord-night', 'Fjord Night', 'dark', 'Nord', 'Teal Nord Frost accents for network operations', {
    primary: '143 188 187', secondary: '136 192 208', accent: '163 190 140', focus: '143 188 187',
    ...POLAR, canvas: '59 66 82', surface: '67 76 94',
    colors: ['#3B4252', '#4C566A', '#8FBCBB', '#88C0D0']
  }),
  theme('aurora-night', 'Aurora Night', 'dark', 'Nord', 'Dark Nord surfaces with purple and red Aurora accents', {
    primary: '180 142 173', secondary: '191 97 106', accent: '208 135 112', focus: '180 142 173', ...POLAR,
    colors: ['#2E3440', '#3B4252', '#B48EAD', '#BF616A']
  }),
  theme('nord-ember', 'Nord Ember', 'dark', 'Nord', 'Warm Aurora orange over the deepest Polar Night', {
    primary: '208 135 112', secondary: '235 203 139', accent: '191 97 106', focus: '208 135 112',
    ...POLAR, canvas: '38 43 54',
    colors: ['#262B36', '#3B4252', '#D08770', '#EBCB8B']
  }),
  theme('nord-moss', 'Nord Moss', 'dark', 'Nord', 'Aurora green highlights for calm night monitoring', {
    primary: '163 190 140', secondary: '143 188 187', accent: '136 192 208', focus: '163 190 140', ...POLAR,
    colors: ['#2E3440', '#3B4252', '#A3BE8C', '#8FBCBB']
  }),

  /* ------------------------------------------------------------ Non-Nord light */
  theme('porcelain', 'Porcelain', 'light', 'Modern', 'Neutral slate surfaces with a confident indigo primary', {
    primary: '79 70 229', secondary: '99 102 241', accent: '14 165 233', focus: '79 70 229',
    canvas: '241 245 249', surface: '255 255 255', text: '15 23 42', muted: '100 116 139', border: '226 232 240',
    colors: ['#4F46E5', '#6366F1', '#0EA5E9', '#FFFFFF']
  }),
  theme('sandstone', 'Sandstone', 'light', 'Modern', 'Warm paper tones with a terracotta accent', {
    primary: '194 101 66', secondary: '217 155 98', accent: '138 122 90', focus: '194 101 66',
    canvas: '245 240 232', surface: '253 250 244', text: '52 44 36', muted: '124 110 95', border: '231 222 208',
    colors: ['#C26542', '#D99B62', '#8A7A5A', '#FDFAF4']
  }),
  theme('mint', 'Mint Studio', 'light', 'Modern', 'Fresh emerald on a bright, low-contrast workspace', {
    primary: '13 148 136', secondary: '16 185 129', accent: '2 132 199', focus: '13 148 136',
    canvas: '240 247 245', surface: '255 255 255', text: '17 40 38', muted: '90 116 112', border: '215 232 228',
    colors: ['#0D9488', '#10B981', '#0284C7', '#FFFFFF']
  }),
  theme('rose-quartz', 'Rose Quartz', 'light', 'Modern', 'Soft rose and violet for a friendly console', {
    primary: '219 39 119', secondary: '168 85 247', accent: '244 114 182', focus: '219 39 119',
    canvas: '250 242 246', surface: '255 253 254', text: '48 26 40', muted: '124 96 112', border: '240 224 233',
    colors: ['#DB2777', '#A855F7', '#F472B6', '#FFFDFE']
  }),
  theme('solarized-light', 'Solarized Light', 'light', 'Classic', 'The classic Solarized base3 palette', {
    primary: '38 139 210', secondary: '42 161 152', accent: '181 137 0', focus: '38 139 210',
    canvas: '238 232 213', surface: '253 246 227', text: '7 54 66', muted: '101 123 131', border: '223 214 190',
    colors: ['#268BD2', '#2AA198', '#B58900', '#FDF6E3']
  }),
  theme('graphite', 'Graphite Light', 'light', 'Modern', 'Monochrome workspace with a single amber highlight', {
    primary: '55 65 81', secondary: '107 114 128', accent: '217 119 6', focus: '217 119 6',
    canvas: '243 244 246', surface: '255 255 255', text: '17 24 39', muted: '107 114 128', border: '229 231 235',
    colors: ['#374151', '#6B7280', '#D97706', '#FFFFFF']
  }),
  theme('sky', 'Sky Ops', 'light', 'Modern', 'Bright operations blue tuned for large dashboards', {
    primary: '2 132 199', secondary: '14 165 233', accent: '6 182 212', focus: '2 132 199',
    canvas: '238 246 252', surface: '255 255 255', text: '12 34 52', muted: '86 108 128', border: '216 231 243',
    colors: ['#0284C7', '#0EA5E9', '#06B6D4', '#FFFFFF']
  }),

  /* ------------------------------------------------------------- Non-Nord dark */
  theme('midnight', 'Midnight Indigo', 'dark', 'Modern', 'Deep navy surfaces with an electric indigo primary', {
    primary: '129 140 248', secondary: '99 102 241', accent: '56 189 248', focus: '129 140 248',
    canvas: '15 23 42', surface: '30 41 59', text: '226 232 240', muted: '148 163 184', border: '51 65 85',
    colors: ['#0F172A', '#1E293B', '#818CF8', '#38BDF8']
  }),
  theme('carbon', 'Carbon', 'dark', 'Modern', 'True neutral dark UI with a cyan signal colour', {
    primary: '34 211 238', secondary: '82 82 91', accent: '250 204 21', focus: '34 211 238',
    canvas: '9 9 11', surface: '24 24 27', text: '244 244 245', muted: '161 161 170', border: '39 39 42',
    colors: ['#09090B', '#18181B', '#22D3EE', '#FACC15']
  }),
  theme('emerald-dark', 'Emerald Night', 'dark', 'Modern', 'Dark teal shell with a vivid emerald primary', {
    primary: '52 211 153', secondary: '20 184 166', accent: '125 211 252', focus: '52 211 153',
    canvas: '6 26 26', surface: '11 40 39', text: '224 242 241', muted: '148 180 176', border: '22 61 58',
    colors: ['#061A1A', '#0B2827', '#34D399', '#7DD3FC']
  }),
  theme('dracula', 'Dracula', 'dark', 'Classic', 'The well-known purple and pink developer palette', {
    primary: '189 147 249', secondary: '255 121 198', accent: '80 250 123', focus: '189 147 249',
    canvas: '40 42 54', surface: '52 55 70', text: '248 248 242', muted: '175 177 197', border: '68 71 90',
    colors: ['#282A36', '#343746', '#BD93F9', '#FF79C6']
  }),
  theme('tokyo-night', 'Tokyo Night', 'dark', 'Classic', 'Cool blue-violet night palette with neon accents', {
    primary: '122 162 247', secondary: '187 154 247', accent: '125 207 255', focus: '122 162 247',
    canvas: '26 27 38', surface: '36 40 59', text: '192 202 245', muted: '150 158 190', border: '52 59 88',
    colors: ['#1A1B26', '#24283B', '#7AA2F7', '#BB9AF7']
  }),
  theme('gruvbox-dark', 'Gruvbox Dark', 'dark', 'Classic', 'Retro warm contrast for long shifts', {
    primary: '250 189 47', secondary: '184 187 38', accent: '254 128 25', focus: '250 189 47',
    canvas: '40 40 40', surface: '60 56 54', text: '235 219 178', muted: '189 174 147', border: '80 73 69',
    colors: ['#282828', '#3C3836', '#FABD2F', '#FE8019']
  }),
  theme('solarized-dark', 'Solarized Dark', 'dark', 'Classic', 'The classic Solarized base03 palette', {
    primary: '38 139 210', secondary: '42 161 152', accent: '203 75 22', focus: '38 139 210',
    canvas: '0 43 54', surface: '7 54 66', text: '238 232 213', muted: '147 161 161', border: '25 71 84',
    colors: ['#002B36', '#073642', '#268BD2', '#2AA198']
  }),
  theme('crimson-dark', 'Crimson Ops', 'dark', 'Modern', 'High-alert red accents for NOC wall displays', {
    primary: '244 63 94', secondary: '251 113 133', accent: '250 204 21', focus: '244 63 94',
    canvas: '21 14 17', surface: '35 22 28', text: '250 235 240', muted: '190 160 172', border: '64 38 48',
    colors: ['#150E11', '#23161C', '#F43F5E', '#FACC15']
  }),
/* --------------------------------------------------------- Added in 2.0.11 */
  theme('linen', 'Linen', 'light', 'Modern', 'Soft off-white paper with a muted plum primary', {
    primary: '124 58 137', secondary: '158 104 168', accent: '196 122 92', focus: '124 58 137',
    canvas: '246 243 240', surface: '255 253 251', text: '43 36 44', muted: '119 106 120', border: '231 224 220',
    colors: ['#7C3A89', '#9E68A8', '#C47A5C', '#FFFDFB']
  }),
  theme('harbour', 'Harbour', 'light', 'Modern', 'Maritime navy and brass on a cool grey canvas', {
    primary: '30 64 109', secondary: '58 112 158', accent: '191 149 63', focus: '30 64 109',
    canvas: '238 242 246', surface: '252 253 255', text: '18 32 47', muted: '92 111 130', border: '215 224 233',
    colors: ['#1E406D', '#3A709E', '#BF953F', '#FCFDFF']
  }),
  theme('citrus', 'Citrus', 'light', 'Modern', 'Bright lime and tangerine for a high-energy console', {
    primary: '132 152 20', secondary: '217 119 6', accent: '20 148 108', focus: '132 152 20',
    canvas: '247 248 238', surface: '255 255 250', text: '38 42 24', muted: '108 116 86', border: '229 232 210',
    colors: ['#849814', '#D97706', '#14946C', '#FFFFFA']
  }),
  theme('lavender-light', 'Lavender', 'light', 'Modern', 'Gentle violet tones for low-glare daytime work', {
    primary: '109 79 214', secondary: '139 110 233', accent: '86 145 214', focus: '109 79 214',
    canvas: '244 243 251', surface: '255 255 255', text: '31 27 51', muted: '108 102 137', border: '227 224 243',
    colors: ['#6D4FD6', '#8B6EE9', '#5691D6', '#FFFFFF']
  }),
  theme('slate-ops', 'Slate Ops', 'light', 'Modern', 'Neutral steel greys with a decisive blue signal', {
    primary: '37 99 235', secondary: '71 85 105', accent: '13 148 136', focus: '37 99 235',
    canvas: '240 242 245', surface: '250 251 253', text: '20 27 38', muted: '95 107 124', border: '222 227 234',
    colors: ['#2563EB', '#475569', '#0D9488', '#FAFBFD']
  }),
  theme('sepia', 'Sepia Reading', 'light', 'Classic', 'Warm low-blue palette that is easy on tired eyes', {
    primary: '146 84 32', secondary: '176 122 66', accent: '96 108 56', focus: '146 84 32',
    canvas: '243 235 220', surface: '250 244 232', text: '58 45 30', muted: '124 106 82', border: '227 214 192',
    colors: ['#925420', '#B07A42', '#606C38', '#FAF4E8']
  }),
  theme('obsidian', 'Obsidian', 'dark', 'Modern', 'Near-black surfaces with a restrained steel primary', {
    primary: '148 163 184', secondary: '100 116 139', accent: '56 189 248', focus: '148 163 184',
    canvas: '10 12 16', surface: '20 24 31', text: '226 232 240', muted: '145 156 172', border: '38 45 56',
    colors: ['#0A0C10', '#14181F', '#94A3B8', '#38BDF8']
  }),
  theme('deep-ocean', 'Deep Ocean', 'dark', 'Modern', 'Abyssal blues with a bioluminescent cyan accent', {
    primary: '56 189 248', secondary: '45 212 191', accent: '129 140 248', focus: '56 189 248',
    canvas: '8 22 40', surface: '14 34 58', text: '219 234 247', muted: '139 165 190', border: '27 55 84',
    colors: ['#081628', '#0E223A', '#38BDF8', '#2DD4BF']
  }),
  theme('plum-night', 'Plum Night', 'dark', 'Modern', 'Aubergine shell with a magenta signal colour', {
    primary: '232 121 249', secondary: '167 139 250', accent: '94 234 212', focus: '232 121 249',
    canvas: '26 15 32', surface: '40 24 48', text: '243 232 250', muted: '186 165 199', border: '64 41 76',
    colors: ['#1A0F20', '#281830', '#E879F9', '#A78BFA']
  }),
  theme('amber-dark', 'Amber Console', 'dark', 'Classic', 'Vintage amber terminal glow on charcoal', {
    primary: '251 191 36', secondary: '245 158 11', accent: '253 224 71', focus: '251 191 36',
    canvas: '18 16 12', surface: '31 27 20', text: '250 240 216', muted: '186 172 141', border: '58 50 36',
    colors: ['#12100C', '#1F1B14', '#FBBF24', '#FDE047']
  }),
  theme('matrix', 'Matrix', 'dark', 'Classic', 'Phosphor green on black for the purists', {
    primary: '74 222 128', secondary: '34 197 94', accent: '163 230 53', focus: '74 222 128',
    canvas: '5 12 8', surface: '11 24 16', text: '220 245 227', muted: '134 178 148', border: '24 51 34',
    colors: ['#050C08', '#0B1810', '#4ADE80', '#A3E635']
  }),
  theme('monokai', 'Monokai', 'dark', 'Classic', 'The familiar editor palette, pink and lime on graphite', {
    primary: '249 38 114', secondary: '166 226 46', accent: '102 217 239', focus: '249 38 114',
    canvas: '39 40 34', surface: '52 53 46', text: '248 248 242', muted: '178 178 166', border: '73 72 62',
    colors: ['#272822', '#34352E', '#F92672', '#A6E22E']
  }),
  theme('nord-frostbite', 'Nord Frostbite', 'dark', 'Nord', 'Polar Night pushed darker with icy Frost edges', {
    primary: '136 192 208', secondary: '129 161 193', accent: '236 239 244', focus: '136 192 208',
    canvas: '24 28 36', surface: '38 44 56', text: '236 239 244', muted: '178 190 210', border: '58 68 84',
    colors: ['#181C24', '#262C38', '#88C0D0', '#ECEFF4']
  }),
  theme('nord-dawn', 'Nord Dawn', 'light', 'Nord', 'Snow Storm with a warm Aurora yellow lead', {
    primary: '191 145 40', secondary: '208 135 112', accent: '94 129 172', focus: '191 145 40', ...SNOW,
    colors: ['#BF9128', '#D08770', '#5E81AC', '#ECEFF4']
  })
]

export const THEME_VARS = ['primary', 'secondary', 'accent', 'canvas', 'surface', 'text', 'muted', 'border', 'focus']

/* ------------------------------------------------------------ custom theme */

export const CUSTOM_THEME_ID = 'custom'
export const CUSTOM_THEME_STORAGE_KEY = 'hyperfamily.theme.custom'

/** Human labels and one-line explanations for the custom colour editor. */
export const THEME_VAR_DETAILS = {
  canvas: { label: 'Canvas', hint: 'Page background behind every card' },
  surface: { label: 'Surface', hint: 'Cards, panels, table headers' },
  border: { label: 'Border', hint: 'Card outlines, dividers, table rules' },
  text: { label: 'Text', hint: 'Primary reading colour' },
  muted: { label: 'Muted text', hint: 'Labels, hints, secondary values' },
  primary: { label: 'Primary', hint: 'Buttons, active tabs, key highlights' },
  secondary: { label: 'Secondary', hint: 'Supporting accents and chips' },
  accent: { label: 'Accent', hint: 'Charts and decorative details' },
  focus: { label: 'Focus ring', hint: 'Keyboard focus outline' }
}

/** "R G B" -> "#rrggbb", for the colour inputs. */
export function tripletToHex(triplet) {
  const parts = String(triplet || '').trim().split(/\s+/).map((value) => Math.max(0, Math.min(255, Number(value) || 0)))
  while (parts.length < 3) parts.push(0)
  return `#${parts.slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** "#rrggbb" (or "#rgb") -> "R G B". Invalid input falls back to black. */
export function hexToTriplet(hex) {
  let value = String(hex || '').trim().replace(/^#/, '')
  if (value.length === 3) value = value.split('').map((character) => character + character).join('')
  if (!/^[0-9a-f]{6}$/i.test(value)) return '0 0 0'
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)).join(' ')
}

/**
 * Relative luminance, used to decide whether a custom palette should report
 * itself as light or dark. `colorScheme` drives native scrollbars and form
 * controls, so getting this wrong leaves white scrollbars on a black page.
 */
function isLight(canvasTriplet) {
  const [r, g, b] = String(canvasTriplet || '0 0 0').split(/\s+/).map(Number)
  const channel = (value) => {
    const normalized = (Number(value) || 0) / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) > 0.4
}

/** The palette a brand-new custom theme starts from: the current default. */
export function defaultCustomColors() {
  return Object.fromEntries(THEME_VARS.map((key) => [key, THEMES[0][key]]))
}

/** Builds a full theme object out of a bag of "R G B" values. */
export function buildCustomTheme(colors) {
  const values = { ...defaultCustomColors(), ...(colors || {}) }
  return {
    id: CUSTOM_THEME_ID,
    name: 'Custom',
    mode: isLight(values.canvas) ? 'light' : 'dark',
    family: 'Custom',
    description: 'Your own palette — every colour is editable',
    ...values,
    colors: [values.canvas, values.surface, values.primary, values.accent].map(tripletToHex)
  }
}

export function readCustomColors() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const colors = {}
    for (const key of THEME_VARS) if (typeof parsed?.[key] === 'string') colors[key] = parsed[key]
    return Object.keys(colors).length ? colors : null
  } catch { return null }
}

/** Reads the JSON blob stored in the `theme_custom` setting row. */
export function parseCustomColors(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const colors = {}
    for (const key of THEME_VARS) if (typeof parsed?.[key] === 'string') colors[key] = parsed[key]
    return Object.keys(colors).length ? colors : null
  } catch { return null }
}

export function rememberCustomColors(colors) {
  try { window.localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(colors)) } catch { /* private mode */ }
}

/**
 * Resolves a theme id to a theme object.
 *
 * The custom theme is not in THEMES — its colours live in the settings row —
 * so it is rebuilt on demand from whatever palette the caller supplies, or
 * from the mirrored copy in localStorage when nothing is passed.
 */
export function findTheme(id, customColors) {
  if (id === CUSTOM_THEME_ID) {
    return buildCustomTheme(customColors || (typeof window === 'undefined' ? null : readCustomColors()))
  }
  return THEMES.find((item) => item.id === id) || THEMES[0]
}

/**
 * Where the chosen theme is remembered for the *next* launch.
 *
 * The database is the source of truth, but reading it is asynchronous and only
 * possible after sign-in, so the login screen used to paint in the default
 * theme every time. Mirroring the id into localStorage lets the boot script in
 * app/layout.js restore the real theme synchronously, before the first paint.
 */
export const THEME_STORAGE_KEY = 'hyperfamily.theme'

export function rememberTheme(id) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* private mode */ }
}

export function readRememberedTheme() {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY) } catch { return null }
}

export function applyTheme(themeOrId, customColors) {
  if (typeof document === 'undefined') return
  const value = typeof themeOrId === 'string' ? findTheme(themeOrId, customColors) : themeOrId
  if (value.id === CUSTOM_THEME_ID) {
    // Mirror the palette so the pre-paint boot script can restore it too.
    rememberCustomColors(Object.fromEntries(THEME_VARS.map((key) => [key, value[key]])))
  }
  const root = document.documentElement
  for (const key of THEME_VARS) root.style.setProperty(`--${key}`, value[key])
  root.style.colorScheme = value.mode
  root.dataset.theme = value.id
  root.dataset.colorMode = value.mode
  rememberTheme(value.id)

  // Auxiliary windows (device auto-login views) follow the application theme.
  try {
    const palette = Object.fromEntries(PALETTE_KEYS.map((key) => [key, value[key]]).filter(([, channel]) => channel))
    window.hyperfamily?.remote?.palette?.(palette)
    window.dispatchEvent(new CustomEvent('hyperfamily:theme', { detail: { id: value.id, mode: value.mode, palette } }))
  } catch { /* auxiliary theming is best-effort */ }
}

/* ------------------------------------------------------ animated theme swap */

let themeTransitionRunning = false

/**
 * Applies a theme with one smooth, uniform crossfade (v2.0.18).
 *
 * The whole window is swapped through the browser's View Transition API: the
 * runtime snapshots the old palette and the new one, then crossfades the two
 * over one second. Because it is a single full-window blend, EVERY element —
 * background, cards, text, borders — starts and finishes at exactly the same
 * moment; nothing can change before or after anything else.
 *
 * The timing lives in globals.css (::view-transition-group(root)). Falls back
 * to an instant apply when the runtime lacks View Transitions, when the user
 * prefers reduced motion, or when a transition is already in flight.
 */
export function applyThemeAnimated(themeOrId, customColors) {
  const documentObject = typeof document !== 'undefined' ? document : null
  const windowObject = typeof window !== 'undefined' ? window : null
  const reducedMotion = windowObject?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

  if (themeTransitionRunning || !documentObject || !windowObject || reducedMotion || !documentObject.startViewTransition) {
    applyTheme(themeOrId, customColors)
    return
  }

  themeTransitionRunning = true
  try {
    const transition = documentObject.startViewTransition(() => applyTheme(themeOrId, customColors))
    transition.finished.finally(() => { themeTransitionRunning = false })
  } catch {
    themeTransitionRunning = false
    applyTheme(themeOrId, customColors)
  }
}

const PALETTE_KEYS = ['canvas', 'surface', 'border', 'text', 'muted', 'primary', 'danger', 'success']

export const THEME_FAMILIES = ['Nord', 'Modern', 'Classic']
