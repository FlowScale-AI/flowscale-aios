/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zinc: {
          950: '#09090b',
        },
      },
    },
  },
  plugins: [],
}
