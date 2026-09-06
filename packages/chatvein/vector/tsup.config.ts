import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // 原生/重型依赖不打进包
  external: [
    '@huggingface/transformers',
    '@lancedb/lancedb',
    '@chatvein/common',
    'onnxruntime-node',
    'sharp',
  ],
})
