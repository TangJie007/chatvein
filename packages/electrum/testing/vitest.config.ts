import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/__mocks__/electron.ts'),
      '@electrum/common': resolve(__dirname, '../common/src'),
      '@electrum/core': resolve(__dirname, '../core/src'),
    },
  },
})
