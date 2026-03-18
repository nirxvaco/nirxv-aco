/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        body:    ['Barlow', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
        'drops-display': ['Space Grotesk', 'sans-serif'],
        'drops-body':    ['Outfit', 'sans-serif'],
      },
      colors: {
        vault: {
          bg: '#08080f',
          surface: '#0e0e1a',
          border: '#1a1a2e',
          accent: '#00c8ff',       // cyan from logo
          'accent-dim': '#0099cc',
          gold: '#ffe600',          // yellow from logo
          'gold-dim': '#ccb800',
          purple: '#b44fff',        // purple glow from logo
          red: '#ff3355',
          green: '#00e396',
          muted: '#3a3a5a',
          text: '#eef0ff',
          'text-dim': '#7a7a9a',
        },
      },
    },
  },
  plugins: [],
}
