# LLM 线路协议（不是按模型名硬编码）

## 原则

默认一切按 **OpenAI Chat Completions 兼容**处理。加新模型（SenseNova / 通义 / 自建网关…）只配 `base_url` + `model_id`，**不要**再写 `if model == xxx`。

只有协议真相反时才分线路：

| 线路 | 何时 | 行为 |
| --- | --- | --- |
| `openai`（默认） | 其它全部 | 出站剥 `reasoning` / `reasoning_content`；不发 DeepSeek `thinking` 字段 |
| `deepseek` | provider/model/base_url 含 deepseek | 回传 `reasoning_content`；`thinking=False` → `thinking.type=disabled` |

DeepSeek 是「必须回传思考」；多数兼容网关是「禁止回传思考」。默认走后者，避免 DeepSeek 修复污染 SenseNova 等。

## 以后若要可配置

在模型表加可选 `wire_profile: openai|deepseek`（下拉两项），而不是为每个模型 ID 加分支。当前用 URL/provider 自动推断 deepseek 即可。
