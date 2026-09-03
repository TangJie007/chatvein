# 决策笔记：引入 es-toolkit +「不造轮子」工程约定

状态：已落地

## 背景

仓库需要统一的通用工具库，并明确：成熟第三方能解决的不要手写。用户指定引入 es-toolkit（口语「es-tools」）并在文档提示该原则。

## 决策

- 依赖 **`es-toolkit@^1.52.0`**，装在 `@chatvein/common` 与 `app`（`@electrum/chatvein`）；其他包按需声明同一依赖。
- **不**引入 lodash；通用 util 统一从 `es-toolkit` import（示例：`model.service` 的 `clamp`）。
- 文档：`docs/phase1/04-依赖选型.md` §1 原则 0；`01-第一期PRD` 红线 §9；`docs/index` 脚注；`.cursor/rules/prefer-third-party.mdc`（alwaysApply）约束 Agent。

## 备选方案

**lodash / lodash-es**：体积与类型体验弱于 es-toolkit，否决。

**只写文档不装包**：后续仍会散落手写 util，否决。

**在 common 再导出全部 es-toolkit**：增加维护面；各包直接依赖 `es-toolkit` 即可。

## 影响

- 收益：工具函数口径统一；Agent/人读文档即可知「先找成熟包」。
- 代价：多一个直接依赖（零 transitive 重依赖）。
- 后续注意：新包需要 util 时 `pnpm add es-toolkit --filter <pkg>`，勿自建 `utils/lodash.ts`。
