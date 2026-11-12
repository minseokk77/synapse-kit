/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        synapse: {
          bg: '#0a0d14',
          surface: '#111726',
          border: '#1f293d',
          cyan: '#00f0ff',
          neon: '#00ff88',
          purple: '#a855f7',
        },
      },
      fontFamily: {
        mono: ['Fira Code', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
