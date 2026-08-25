import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const commonSrc = resolve(__dirname, '../../packages/common/src')
const coreSrc = resolve(__dirname, '../../packages/core/src')
const preloadSrc = resolve(__dirname, '../../packages/preload/src')
const clientSrc = resolve(__dirname, '../../packages/client/src')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@electrum/common': resolve(commonSrc, 'index.ts'),
        '@electrum/core': resolve(coreSrc, 'index.ts'),
      },
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@electrum/common', '@electrum/core'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@electrum/preload': resolve(preloadSrc, 'index.ts'),
      },
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@electrum/preload'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@electrum/client': resolve(clientSrc, 'index.ts'),
      },
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
