import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    target: 'es2022',
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs'],
    target: 'es2022',
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
