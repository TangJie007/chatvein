# `@chatvein/vector`

进程内向量库：本地嵌入 + **LanceDB** 持久化检索。

## 嵌入

- **Transformers.js**（`@huggingface/transformers`）
- 模型：`onnx-community/bge-small-zh-v1.5-ONNX`（512 维，中文检索）

```ts
import { createBgeZhEmbedder, createLocalVectorStore } from '@chatvein/vector'

const embedder = createBgeZhEmbedder({ cacheDir: './.cache/hf' })
const store = createLocalVectorStore({ embedder, dataDir: './data/vector' })

await store.upsert([
  { content: '会话工作区在 workspaceRoot/slug 下', kind: 'doc' },
])
const hits = await store.search('工作区路径', { topK: 5 })
```

首次 `embed` / `search` 会从 HuggingFace 拉取 ONNX 权重（可缓存到 `cacheDir`）。

## 存储

- **`@lancedb/lancedb`**：表 `vectors`（`id` + `vector` + 元数据）
- upsert：`mergeInsert`；检索：`vectorSearch` + cosine distance
- `dataDir` 为本地目录；省略则用系统临时目录（测试用）

被 `@chatvein/memory`、工具选用、群记忆调用。排期 CP2。
