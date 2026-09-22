# DeepSeek thinking + ReAct

## 问题

DeepSeek V4 默认 **thinking**。带 `tools` 的多轮（ReAct）要求把上一轮 assistant 的 `reasoning_content` 原样回传，否则第二轮 HTTP 400 / 表现成「卡在循环里」。

`ChatOpenAI` 与上游 `ChatDeepSeek`（至 1.1.x）序列化消息时都会丢掉该字段。

## 方案

- 依赖：`langchain-deepseek`（入库 `reasoning_content` 到 `AIMessage.additional_kwargs`）。
- 自研窄补丁：`agents/llm.py` 的 `ChatDeepSeekReact`，在 `_get_request_payload` 把 `reasoning_content` 写回 payload。
- 检测到 provider / model_id / base_url 含 `deepseek` 时用该子类；否则仍用 `ChatOpenAI`。

## 谁关 thinking

| 路径 | thinking |
| --- | --- |
| 路由 / 工具选型 / hard 规划·核对（结构化 + 强制 tool_choice） | **关**（不需要长思考，且 thinking 拒强制 tool_choice） |
| simple / medium·hard **ReAct** | **开**（靠 `ChatDeepSeekReact` 回传） |

否决「ReAct 一律关 thinking」：会削弱 Agent 推理，只是绕过序列化缺陷。
