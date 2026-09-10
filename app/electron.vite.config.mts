import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * electrum 能力包在 dev/build 时直连 src，避免每次改框架还要先 build dist。
 * 三个进程各自只 alias 自己用到的包。
 */
const electrumSrc = (name: string) =>
  resolve(__dirname, `../packages/electrum/${name}/src/index.ts`)

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@electrum/common': electrumSrc('common'),
        '@electrum/core': electrumSrc('core'),
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
        '@electrum/preload': electrumSrc('preload'),
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
        '@': resolve(__dirname, 'src/renderer'),
        '@electrum/client': electrumSrc('client'),
      },
    },
    plugins: [vue(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
