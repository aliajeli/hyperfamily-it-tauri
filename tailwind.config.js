/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-color-mode="dark"]'],
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        nord: {
          0: '#2E3440', 1: '#3B4252', 2: '#434C5E', 3: '#4C566A',
          4: '#D8DEE9', 5: '#E5E9F0', 6: '#ECEFF4', 7: '#8FBCBB',
          8: '#88C0D0', 9: '#81A1C1', 10: '#5E81AC', 11: '#BF616A',
          12: '#D08770', 13: '#EBCB8B', 14: '#A3BE8C', 15: '#B48EAD'
        }
      },
      boxShadow: {
        glass: '0 18px 50px rgba(46,52,64,.12)',
        glow: '0 0 0 4px rgba(136,192,208,.15)'
      },
      keyframes: {
        'pulse-ring': { '0%,100%': { transform: 'scale(.94)', opacity: '1' }, '50%': { transform: 'scale(1)', opacity: '.65' } },
        float: { '0%,100%': { transform: 'translate3d(0,0,0)' }, '50%': { transform: 'translate3d(28px,-34px,0)' } },
        shake: { '0%,100%': { transform: 'translateX(0)' }, '25%': { transform: 'translateX(-4px)' }, '75%': { transform: 'translateX(4px)' } }
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s ease-in-out infinite',
        float: 'float 20s ease-in-out infinite',
        shake: 'shake .35s ease-in-out'
      }
    }
  },
  plugins: []
}
