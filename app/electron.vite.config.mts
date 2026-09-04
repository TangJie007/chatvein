import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const commonSrc = resolve(__dirname, '../packages/electrum/common/src')
const coreSrc = resolve(__dirname, '../packages/electrum/core/src')
const preloadSrc = resolve(__dirname, '../packages/electrum/preload/src')
const clientSrc = resolve(__dirname, '../packages/electrum/client/src')

/** monorepo 能力包：dev/build 直连 src，避免每次改完还要先 build dist */
const chatveinPkg = (name: string) =>
  resolve(__dirname, `../packages/chatvein/${name}/src/index.ts`)

const chatveinMainAliases = {
  '@chatvein/agents': chatveinPkg('agents'),
  '@chatvein/models': chatveinPkg('models'),
  '@chatvein/common': chatveinPkg('common'),
  // agents/models 传递依赖：一并指到 src，防止仍解析到过期 dist
  '@chatvein/context': chatveinPkg('context'),
  '@chatvein/observability': chatveinPkg('observability'),
  '@chatvein/tools': chatveinPkg('tools'),
} as const

const chatveinMainExclude = Object.keys(chatveinMainAliases)

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@electrum/common': resolve(commonSrc, 'index.ts'),
        '@electrum/core': resolve(coreSrc, 'index.ts'),
        ...chatveinMainAliases,
      },
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@electrum/common', '@electrum/core', ...chatveinMainExclude],
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
