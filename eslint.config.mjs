import nextPlugin from '@next/eslint-plugin-next'
import reactPlugin from 'eslint-plugin-react'

export default [
  // electron/vendor holds verbatim upstream library sources (ssh2 and its pure
  // JavaScript dependencies). They are third-party code and are not linted.
  { ignores: ['node_modules/**', '.next/**', 'out/**', 'dist/**', 'electron/vendor/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { '@next/next': nextPlugin, react: reactPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error'
    }
  },
  {
    files: ['electron/**/*.js', 'tests/**/*.{js,mjs}', 'next.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: { globals: { require: 'readonly', module: 'readonly', process: 'readonly', __dirname: 'readonly', Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Response: 'readonly', AbortController: 'readonly', FormData: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly' } }
  },
  {
    // Runs inside the themed device-webview window, not in the main process.
    files: ['electron/main/device-webview-renderer.js'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly', URL: 'readonly' } }
  },
  {
    // The callbacks handed to page.evaluate() are serialised and run in the
    // browser under test, so browser globals are legitimate in these files.
    files: ['tests/**/*.playwright.mjs'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', getComputedStyle: 'readonly' } }
  },
  {
    files: ['app/**/*.{js,jsx}', 'components/**/*.{js,jsx}', 'stores/**/*.js', 'lib/**/*.js'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly', CustomEvent: 'readonly', Event: 'readonly', FileReader: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly', Blob: 'readonly', URL: 'readonly' } },
    rules: {
      /*
       * Native confirm()/alert()/prompt() called from inside a Radix-portalled
       * tree leave `pointer-events: none` on <body>, which makes every input in
       * the app untypable until a reload. Deleting a device, a credential or a
       * note all hit this. `confirm` is deliberately absent from the globals
       * above so bare calls fail no-undef; these rules catch the qualified
       * `window.*` forms too. Use `useConfirm()` from components/ui instead.
       */
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use useConfirm() from @/components/ui/ConfirmDialog — native confirm() locks pointer-events on <body>.' },
        { name: 'alert', message: 'Use toast() from sonner instead of native alert().' },
        { name: 'prompt', message: 'Use a themed dialog instead of native prompt().' }
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use useConfirm() from @/components/ui/ConfirmDialog — native confirm() locks pointer-events on <body>.' },
        { object: 'window', property: 'alert', message: 'Use toast() from sonner instead of native alert().' },
        { object: 'window', property: 'prompt', message: 'Use a themed dialog instead of native prompt().' }
      ]
    }
  },
  {
    // The single sanctioned use: the fallback when no ConfirmProvider is mounted.
    files: ['components/ui/ConfirmDialog.jsx'],
    rules: { 'no-restricted-properties': 'off' }
  }
]
