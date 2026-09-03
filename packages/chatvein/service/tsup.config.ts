import { defineConfig } from 'tsup'

export default defineConfig({
  // cli.ts is the `forge` bin entry; index.ts exports the sidecar server API
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
})
