# 决策笔记：本地 BGE-zh 嵌入与向量存储

状态：已落地

## 背景

`@chatvein/vector` 长期空壳；记忆 / 工具选用 / RAG 需要进程内嵌入与可持久化检索。设计文档曾把「网关 embeddings」作 P0、本地 ONNX 作 P1；中文场景与离线桌面更需要**零 token、可缓存**的本地模型。用户要求安装 Transformers.js + `onnx-community/bge-small-zh-v1.5-ONNX` 并做向量存储。

## 决策

- 在 `@chatvein/vector` 依赖 **`@huggingface/transformers@^4.2`**，默认模型 **`onnx-community/bge-small-zh-v1.5-ONNX`**（512 维）。
- API：`createBgeZhEmbedder()`（懒加载 pipeline，mean pooling + normalize）+ `createLocalVectorStore({ embedder, dataDir? })`（**LanceDB** 表 `vectors`，cosine 向量检索）。
- pnpm `allowBuilds` 放行 `onnxruntime-node` / `protobufjs` / `sharp`（Transformers.js Node 运行时）。
- tsup `external` 排除 transformers / lancedb / onnxruntime，避免打进包体。
- 单元测试用 FakeEmbedder；真实模型首次拉取 HF 权重（可 `cacheDir`）。

> 存储后端后续已改为 LanceDB，见 [2026-09-06-vector-lancedb.md](./2026-09-06-vector-lancedb.md)。

## 备选方案

**为什么不用网关 OpenAI embeddings 作默认？**  
依赖网络与 API Key，每条记忆都耗 token；桌面离线与中文小模型场景不合适。网关仍可作为后续 `EmbeddingProvider` 实现并列。

**为什么不用 Xenova/bge-small-zh-v1.5 仓库名？**  
用户指定 `onnx-community/bge-small-zh-v1.5-ONNX`；与 Transformers.js ONNX 权重仓库一致。常量可配置覆盖。

**为什么暂不装 `@electric-sql/pglite-pgvector`？**  
一期向量量小，JSON + 余弦足够；HNSW 扩展作为规模触发项，避免过早引入 WASM 扩展兼容成本。

**为什么不用 LanceDB / Chroma / sqlite-vec？**  
设计已定 PGlite 与 observability 同栈；再引独立向量引擎增加分发体积与运维面。

## 影响

- 收益：本地中文嵌入 + 可持久化 upsert/search，memory / tool-selector 可直接消费。
- 代价：首次下载 ONNX 权重；Node 侧需原生 `onnxruntime-node`；Electron 主进程若 in-process 用需 externalize（推荐 sidecar）。
- 后续：规模上来再迁 pgvector halfvec + HNSW；可选云端 EmbeddingProvider 双轨。
