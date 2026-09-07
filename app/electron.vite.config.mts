import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

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
  '@chatvein/core': chatveinPkg('core'),
  '@chatvein/orchestrator': chatveinPkg('orchestrator'),
  '@chatvein/sandbox': chatveinPkg('sandbox'),
  '@chatvein/compiler': chatveinPkg('compiler'),
  '@chatvein/verifier': chatveinPkg('verifier'),
  // agents/models/core 传递依赖：一并指到 src，防止仍解析到过期 dist
  '@chatvein/context': chatveinPkg('context'),
  '@chatvein/observability': chatveinPkg('observability'),
  '@chatvein/tools': chatveinPkg('tools'),
  '@chatvein/memory': chatveinPkg('memory'),
} as const

const chatveinMainExclude = Object.keys(chatveinMainAliases)

/**
 * 含原生 .node / 重型 ONNX 的包必须 runtime require，不能打进 electron-vite bundle。
 * （ssr.noExternal=true 时，workspace 包常被解析成绝对路径，仅靠 deps 名匹配不够。）
 */
const NATIVE_VECTOR_EXTERNALS = [
  '@chatvein/vector',
  '@huggingface/transformers',
  '@lancedb/lancedb',
  'onnxruntime-node',
  'sharp',
] as const

function externalizeNativeVector(): Plugin {
  const pathRes = [
    /[\\/]packages[\\/]chatvein[\\/]vector[\\/]/,
    /[\\/]node_modules[\\/](?:@chatvein[\\/]vector|@huggingface[\\/]transformers|@lancedb[\\/]lancedb|onnxruntime-node|sharp)([\\/]|$)/,
  ]
  return {
    name: 'externalize-native-vector',
    enforce: 'pre',
    config(config) {
      const extras: Array<string | RegExp> = [...NATIVE_VECTOR_EXTERNALS, ...pathRes]
      const prev = config.build?.rollupOptions?.external
      const merged =
        prev == null
          ? extras
          : Array.isArray(prev)
            ? [...prev, ...extras]
            : [prev, ...extras]
      config.build ??= {}
      config.build.rollupOptions = {
        ...config.build.rollupOptions,
        external: merged,
      }
      // 与 electron-vite 的 ssr.noExternal=true 配合：显式保留外部化
      config.ssr = {
        ...config.ssr,
        external: [
          ...(Array.isArray(config.ssr?.external) ? config.ssr.external : []),
          ...NATIVE_VECTOR_EXTERNALS,
        ],
      }
    },
  }
}

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
        include: [...NATIVE_VECTOR_EXTERNALS],
      }),
      externalizeNativeVector(),
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
