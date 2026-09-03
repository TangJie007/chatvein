# 插件运行时：`@deepseek-ai/cordis`

> 版本：v1.0 ｜ 日期：2026-09-03
> 决策：**本软件 harness 侧插件化统一使用 `@deepseek-ai/cordis`**
> 上位：[`../phase1/02-方案设计.md`](../phase1/02-方案设计.md) §1.4、[`../phase1/04-依赖选型.md`](../phase1/04-依赖选型.md)

---

## 1 决策摘要

| 项 | 内容 |
|----|------|
| 选定 | `@deepseek-ai/cordis@^4.0.2` + `cordis-plugin-loader` / `include` / `timer` |
| 不用 | 上游 `cordis` / `@cordisjs/*`（禁止混装）；自研装配器（被 Cordis 取代） |
| 落点 | `@chatvein/core`（持根 Context）、`@chatvein/service`（CLI/sidecar 启动） |
| 不落点 | `@electrum/*`、渲染进程、preload |

理由：可逆 Fiber（热插拔/卸载干净）、服务注入与 DeepSeek Harness「everything is a plugin」同族，便于对齐业界 harness 插件写法；MIT。

---

## 2 与其它层的分工

```
┌─ Electron 壳 ──────────────────────────────┐
│  @electrum/* : 窗口 / IPC / DI（壳）        │  ← 不引入 Cordis
└──────────────────┬─────────────────────────┘
                   │ spawn / IPC
┌─ Harness（纯 Node）────────────────────────┐
│  @deepseek-ai/cordis Context               │
│    plugins → models / tools / sandbox / …  │
│    orchestrator 插件内部 → LangGraph 任务图 │
└────────────────────────────────────────────┘
```

| 层 | 管什么 | 不管什么 |
|----|--------|----------|
| Cordis | 插件加载/卸载、服务键、事件、定时器 dispose | 任务边条件、checkpoint 语义 |
| LangGraph | plan→implement→verify… 状态机 | 插件生命周期 |
| Electrum | BrowserWindow、ipcMain、控制器 | Agent 业务 |

---

## 3 插件约定（草案）

能力包导出 Cordis 插件，在 core 里挂载：

```ts
import { Context, Service } from '@deepseek-ai/cordis'
// 或：import { Context, Service } from '@chatvein/core'

declare module '@deepseek-ai/cordis' {
  interface Context {
    models: ModelsService
  }
}

class ModelsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'models')
  }
  // routeForRole / invoke / …
}

export function apply(ctx: Context) {
  ctx.plugin(ModelsService)
}
// 或 Object.assign(apply, { name: 'models', inject: […] })
```

访问：`ctx.models`、`ctx.tools`、`ctx.orchestrator`…  
卸载：`fiber.dispose()` 撤回本插件注册的事件/服务/定时器。

配置驱动（P0+）：`@deepseek-ai/cordis-plugin-loader` + `include` 读取 `forge.config` 中的插件列表。

---

## 4 已安装包

| npm 包 | 版本 | 归属 |
|--------|------|------|
| `@deepseek-ai/cordis` | ^4.0.2 | core、service |
| `@deepseek-ai/cordis-plugin-loader` | ^1.0.3 | core |
| `@deepseek-ai/cordis-plugin-include` | ^1.0.7 | core |
| `@deepseek-ai/cordis-plugin-timer` | ^1.1.4 | core |

`@chatvein/core` 再导出 `Context` / `Service` / `Fiber`，调用方优先从 `@chatvein/core` import，避免散落多处依赖声明。

---

## 5 红线

1. 全家桶只用 `@deepseek-ai/cordis*`，不混装上游。
2. `packages/chatvein/**` 可不依赖 electron；Cordis 只出现在 core/service（及将来的 agents/groups 等纯 Node 包）。
3. 赛前锁版本；升级需跑 `pnpm test:harness`。
4. Cordis **不替代** LangGraph；任务图仍在 orchestrator。
