# 决策笔记：移除 L1 json-rules-engine

状态：已落地

## 背景

L1 收敛为「寒暄/自我介绍/terminal 短路 vs defer L2」后，规则表只剩约 6 条硬条件，再挂 `json-rules-engine` + `rules.ts` + `materialize` 事件累加，阅读与依赖成本都高于收益。

## 决策

- 用纯函数 `decideL1(ctx)`（`l1/decide.ts`）直接分支；删除 `rules.ts` / `rules-engine.ts` / `materialize.ts`。
- 移除 `@chatvein/agents` 对 `json-rules-engine` 的依赖。
- `reloadRules` 保留为空操作（deprecated）。

## 备选方案

### 为什么不继续外置 JSON 规则？

当前条件全是布尔特征，无运营热更新需求；外置 JSON 增加一层间接性，却几乎无配置面消费者。

### 为什么不自研迷你规则表？

比直接 if 更绕；需要时再抽。

## 影响

- 收益：L1 目录更短，零规则引擎依赖。
- 代价：改短路条件需改 TS（可接受）。
