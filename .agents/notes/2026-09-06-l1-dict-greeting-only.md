# 决策笔记：L1 词典只留寒暄/自我介绍

状态：已落地

## 背景

L1 定档已全部 defer L2 后，`zh.json` 里 task/tool/negate/compare/… 大段动词表与对应 bump 规则只制造阅读噪声，不再影响终局策略。

## 决策

- `zh.json` **仅保留** `greetings` / `greetingParticles` / `selfIntroPrefixes`。
- 规则只留：empty / slash / mention_group / force_tier / greeting_trivial / self_intro_trivial。
- 删除 score 分档、`bandFromScore`、意图 bump、`negate_tools` 等。
- `isSelfIntro` 收紧为「前缀 + 像名字的短余下」（拒绝含任务痕迹的余下），不再依赖 task/tool 词典挡板。
- L2 prompt 关键特征只留 charLen / lang / greeting / selfIntro / codeFence / pathLike。

## 备选方案

### 为什么不连 codeFence/pathLike 特征也删？

零词典、正则即可，给 L2 便宜结构信号；不增加 locales 阅读负担。

### 为什么不删 json-rules-engine？

terminal + 寒暄 override 仍用规则表，保持可配置；未改引擎选型。

## 影响

- 收益：打开 `zh.json` / `rules.ts` 一眼能看完 L1 职责。
- 代价：L1 不再提供 tools/hint 软信号；拉群/否定工具等完全交给 L2。
