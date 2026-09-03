# `@chatvein/context`

上下文与 Token 管理：头尾截断（中间折叠）、错误帧抽取、任务历史压缩、文件索引、全局 BudgetGuard（token / 步数 / 墙钟 / 连续失败熔断）。

工具输出进模型前必须过截断器。计量在 `models`，**是否继续跑**由本包护栏判定。Chat 轨同样复用（CP0-5 接 agents）。
