import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // node 内置模块保持外部引用（node:sqlite 等），不打包
  external: ['node:sqlite'],
})
