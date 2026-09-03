# 决策笔记：models 并发信号量——装饰器限流、超额排队而非拒绝

状态：已落地

## 背景

M1-2 要求 models 包具备「OpenAI 兼容适配 + ChatModelLike + 计量 + 强/中/弱 Router + 降级链 + 并发信号量」。盘点发现前五项已在最小实现中交付（`OpenAICompatibleChatModel`/`MeteredChatModel`/`ModelRouter`，见 [2026-09-03-harness-mvp-common-obs-models.md](2026-09-03-harness-mvp-common-obs-models.md)），**唯一缺口是并发信号量**：PRD F7/5.3.7 要求「按模型配置最大并发，防止限流（429）」，且 M0-6 的 `ForgeConfig.ModelEndpointConfig.maxConcurrency` 字段已预留但无人消费。

## 决策

- **新增通用 `Semaphore`（`models/src/semaphore.ts`）**：计数信号量，`acquire()` 返回 release 函数；满员时调用方排队（FIFO），release 把名额直接移交给队首等待者（`active` 不变，公平不丢名额）。暴露 `capacity/inFlight/pending` 便于观测。
- **`ConcurrencyLimitedChatModel` 装饰器**：包装任意 `ChatModelLike`，invoke 前 `acquire`、finally 里 release（内层抛错也释放名额）。不改变返回值/错误，只做并发整形。默认 `maxConcurrency=1`（串行）。
- **限流粒度 = 单个端点/模型**：信号量包在每个 endpoint 模型外层（与 `ForgeConfig.models.<tier>[].maxConcurrency` 一一对应），而不是 Router 级全局闸门。降级链上每个备用端点有各自的并发额度。
- **超额排队而非报错**：调用方 await 排队，把对同一模型的并发整形到网关可承受范围；这符合"防 429"的目标（快速失败只会诱发重试风暴）。
- **工厂 `factory.ts`**：`createEndpointModel(cfg)` = OpenAI 直连 +（`maxConcurrency>1` 时）并发装饰器；`createModelRouter(tiers, opts)` 把 ForgeConfig 三档端点装成带降级链的 `ModelRouter`。`maxConcurrency<=1` 不包装饰器（本就串行，省一层）。
- 从 `@chatvein/models` 导出 `Semaphore`/`ConcurrencyLimitedChatModel`/`createEndpointModel`/`createModelRouter`。

验收：models 包 3 个 spec、13 个用例全绿（新增信号量 5 例：非法 capacity、FIFO 排队、并发不超限、=1 串行化、出错释放名额；工厂 4 例：装饰器装配/缺省不包/路由可调用降级/空档抛错）。

## 备选方案

**把并发控制做进 ModelRouter（全局闸门）**：Router 是降级选择层，全局一个信号量无法表达"每个模型各自的 maxConcurrency"（强模型额度 2、弱模型额度 8 这类配置）。放在端点装饰器上，与配置粒度一致，且 Router 保持纯粹的"选模型+降级"职责。

**超额直接 reject（快速失败）**：会把"并发太多"变成错误，诱发上层重试，反而加重 429。排队把请求整形为网关能消化的速率，是限流的本意。

**用 p-limit 等三方库**：信号量是 ~40 行的小原语，零依赖更利于纯 Node 包与赛事沙箱；且需要 `inFlight/pending` 观测点，自写更顺手。

## 影响

- 收益：ForgeConfig 的 `maxConcurrency` 真正生效；M1 orchestrator 并发/重试时不会打爆单模型配额；信号量是通用原语，tools/sandbox 的并发控制也可复用。
- 代价 / 放弃：排队不设超时（调用方可能长时间等待）；当前靠模型自身的 `timeoutMs`/AbortSignal 兜底，未来若需要可给 acquire 加超时。装饰器与 MeteredChatModel 可叠加（顺序：限流 → 计量 → 实际调用），装配顺序由 core/service 在 M1-8 决定。
- 后续注意：`createEndpointModel` 目前只包并发不包计量；生产装配建议 `new MeteredChatModel(new ConcurrencyLimitedChatModel(raw))` 或反之，由 core 统一；降级 `onFallback` 回调可在工厂透传用于落 trace。
