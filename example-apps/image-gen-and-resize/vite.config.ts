import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:14173',
        changeOrigin: true,
        proxyTimeout: 360_000,
        timeout: 360_000,
      },
    },
  },
})
