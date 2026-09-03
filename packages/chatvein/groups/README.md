# `@chatvein/groups`

群组会话：建群/拉人、消息流、发言路由（@ / 主持人 / 轮转）、收敛（投票/摘要）。群成员实际说话仍调 `@chatvein/agents`。

LangGraph supervisor / 群图在本包内；app `group/*` 不得内嵌图。排期 CP2。记忆集成见 [`docs/design/05-群组记忆架构.md`](../../../docs/design/05-群组记忆架构.md)。
