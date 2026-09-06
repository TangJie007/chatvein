# 决策笔记：向量存储改用 LanceDB

状态：已落地

## 背景

`@chatvein/vector` 初版用 PGlite + `embedding_json` + JS 余弦扫表。用户要求安装 `@lancedb/lancedb` 并从 vector 包移除 `@electric-sql/pglite`，让本体向量走专用嵌入式向量库。

## 决策

- `@chatvein/vector` 依赖 **`@lancedb/lancedb@^0.38`**，移除 **`@electric-sql/pglite`**（observability 的 PGlite 保留，仅作 trace）。
- `LocalVectorStore`：`connect(dataDir)` → 表 `vectors`；`mergeInsert('id')` upsert；`vectorSearch` + `distanceType('cosine')`；过滤用 SQL `where`。
- `dataDir` 省略时用 `os.tmpdir()` 临时库（测试）；生产传持久目录。
- tsup external `@lancedb/lancedb`；设计文档 04 / 依赖选型同步。

## 备选方案

**为什么不用继续 PGlite + pgvector？**  
向量 ANN 是 LanceDB 主业；PGlite 更适合 SQL/trace。拆分后避免「一个 WASM Postgres 扛两种负载」。

**为什么不用 Chroma / sqlite-vec？**  
用户指定 LanceDB；原生绑定与 Node 22+ 对齐，本地目录零服务。

## 影响

- 收益：真实向量索引、API 更贴近检索场景；与 trace 存储解耦。
- 代价：多一个原生平台包（`@lancedb/lancedb-*-*`）；旧 PGlite 向量表不兼容，需重建索引。
- 后续：可选 LanceDB FTS 做混合检索；memory 包接入本 store。
