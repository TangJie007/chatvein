import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // node:sqlite 等内置模块必须保持外部引用，不能被打包成 require('sqlite')
  external: ['node:sqlite'],
})
