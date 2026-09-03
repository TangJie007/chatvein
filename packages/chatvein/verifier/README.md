# `@chatvein/verifier`

验证闭环：在沙箱里跑 build / test / lint，解析成结构化 `TestReport`（失败用例名、断言、堆栈关键帧）。

**硬规则：** Forge「完成」只能由本包结构化输出判定，不能靠模型自报。另含失败归因与提交检查清单。
