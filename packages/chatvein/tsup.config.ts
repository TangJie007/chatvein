import { defineConfig } from 'tsup'

export default defineConfig({
  // 主入口 `index` 是门面；下层工厂按子路径暴露，避免主入口泄漏内部实现细节
  entry: {
    index: 'src/index.ts',
    router: 'src/router/index.ts',
    conversation: 'src/conversation/index.ts',
    model: 'src/model/index.ts',
    'tools-filter': 'src/tools-filter/index.ts',
  },
  format: ['cjs', 'esm'],
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    'langchain',
    '@langchain/core',
    '@langchain/langgraph',
    'deepagents',
    'zod',
    'es-toolkit',
    'lru-cache',
    'mime-types',
    'ml-distance',
    '@langchain/openai',
  ],
})
