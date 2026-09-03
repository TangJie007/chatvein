# `@chatvein/vector`

进程内本体向量库：嵌入 + **PGlite + pgvector**，提供 upsert / 混合检索（向量 + 全文）。零外部数据库服务。

被 `@chatvein/memory`、工具代码检索、群记忆调用。pgvector / BM25 扩展按需安装（见依赖选型 §5）。排期 CP2。设计见 [`docs/design/04-向量存储架构.md`](../../../docs/design/04-向量存储架构.md)。
