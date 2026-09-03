# `@chatvein/memory`

分层记忆读写管线：个人 / 群组 / 全局。对外 `recall()` / `write()` / `consolidate()`，控制注入上下文的 token 与 prompt 缓存前缀稳定。

向量检索委托 `@chatvein/vector`；预算与截断仍走 `@chatvein/context`。排期 CP2。设计见 [`docs/design/03-记忆方案.md`](../../../docs/design/03-记忆方案.md)。
