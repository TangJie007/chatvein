import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // 单测直接跑 workspace 源码，避免依赖 dist 构建顺序
      '@chatvein/observability': fileURLToPath(
        new URL('../observability/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
})
