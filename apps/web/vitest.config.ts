import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@flowscale/ui': resolve(__dirname, 'src/components/ui/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'src/store/**/*.ts',
        'src/components/ui/cn.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/lib/db/**', // DB init requires real SQLite
      ],
    },
  },
})
