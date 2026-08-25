import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@electrum/common': resolve(__dirname, '../common/src'),
    },
  },
})
