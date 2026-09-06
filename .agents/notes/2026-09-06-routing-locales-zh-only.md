# 决策笔记：路由 locales 仅中文

状态：已落地

## 背景

`routing/locales` 原先按「一期 zh + 可扩 en」拆 `_common.json` / `zh.json`，并在 `detectLang` 里区分 `en` / `mix` / `unknown`。产品明确**不支持英文**后，多语种骨架只会增加词典合并与 coverage 分支，没有收益。

## 决策

- 删除 `_common.json`；口语确认类短词（`ok` / `okay` / emoji）并入 `zh.json`。
- `locales/index.ts` 只加载 `zh.json` + `prototypes/zh.json`；导出 `ZH_DICT` / `resolveDict('zh'|'unsupported')`。
- `HeuristicCtx.lang` 收敛为 `'zh' | 'unsupported'`；非中文 → `dictCoverage: 'none'`（仍 defer L2，不本地寒暄短路）。
- `RoutePrototype.lang` 仅保留可选 `'zh'`。
- 不提供 en 词典、en 先例、mix 合并路径。

## 备选方案

### 为什么不把「hello」也当中文寒暄短路？

产品不支持英文：纯英文应走 L2/主模，而不是用中文模板假答。中文会话里偶发 `ok`/`👍` 仍可短路。

### 为什么词典里还留 commit / grep 等拉丁词？

那是中文开发口语里的**工具别名**，不是英文语种支持；与 en locale 无关。

## 影响

- 收益：locales 目录与类型更短，无假 multi-lang。
- 代价：纯英文输入永远 coverage=none，依赖 L2；若以后要正式支持英文需重加语种包（刻意门槛）。
