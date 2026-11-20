# 离线评测（eval）

评测的目标只有一个：**改 prompt / 改工具 / 改路由之后，能知道质量有没有掉**。它不覆盖 UI，也不测性能，跑完给一份 JSON 报告。

## 用法

```powershell
# 默认跑 backend/eval/cases/smoke.json
.\tools\run_eval.ps1

# 只校验用例文件（不进模型，可进 pre-commit）
.\tools\run_eval.ps1 -Rest @("--dry-run")

# 加 LLM 评分（默认关），指定评分模型
.\tools\run_eval.ps1 -Judge -Rest @("--judge-model", "<models.id>")

# 直接调脚本
.\.venv\Scripts\python.exe backend\eval\runner.py --cases backend\eval\cases\smoke.json --report eval-report.json
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--cases` | 用例文件，默认 `backend/eval/cases/smoke.json` |
| `--role` | 角色 id；缺省用主对话角色 |
| `--limit` | 只跑前 N 条（调试用） |
| `--judge` | 启用 LLM 评分（默认关闭） |
| `--judge-model` | 评分模型配置 id；缺省复用被测角色自己的模型（同模型评分有偏，趋势仍可比） |
| `--judge-threshold` | 达标线，默认 3.5（四维均值 0-5） |
| `--report` | 报告路径，`-` 表示打到 stdout |
| `--max-seconds` | 整批时间预算，超出的用例记为 skipped |
| `--dry-run` | 只校验用例文件 |
| `--quiet` | 只打印汇总，不逐条 |

退出码：`0` 全通过；`1` 有 fail / error / 跳过；`2` 用例文件或模型配置有问题。

## 用例格式

```json
{
  "suite": "smoke",
  "cases": [
    {
      "id": "arithmetic",
      "message": "算一下 37 * 19 + 128 等于多少。",
      "expect_tools": ["calculator"],
      "forbid_tools": ["get_current_time"],
      "expect_substring": ["831"],
      "forbid_substring": ["无法计算"],
      "rubric": "结果必须是 831；只用计算工具。"
    }
  ]
}
```

- `expect_tools` 里的**每一个**都必须被调用过；`forbid_tools` 一个都不能出现。
- `expect_substring` / `forbid_substring` 对最终回复做字面判断（大小写敏感），适合钉住关键事实（数字、专有名词、接口名）。
- `rubric` 只给 LLM 评分看，规则断言不读它。
- 列表字段写成字符串等价于单元素数组，手写用例少一层括号。
- 顶层也可以是裸数组（suite 取文件名）。

## 判定

1. **规则断言（必跑）**：`reply_non_empty` 永远检查；其余按用例字段。任何一条不满足 → `fail`。
2. **LLM 评分（可选）**：`relevance / correctness / tool_use / format` 各 0-5，取均值；低于阈值 → `fail`。
3. 跑用例本身抛异常（没配模型、工具崩）→ `error`，不会带走整批。

为什么要分离：规则断言是硬门槛，模型抖一下也不该让整套评测失去意义；judge 看的是「答得好不好」，只用于趋势。

## 运行环境

- 每条用例：`create_conversation_dir()` → `use_conversation_sandbox()` → `bind_turn()`，跑完删除目录。工具产生的文件不会进用户工作区，也不会因为「没有沙箱」直接失败。
- 直接调用 `pipeline.run_pipeline`，不起 HTTP 服务、不发 SSE——CI 上能跑，也不需要前端。
- 不写 `turn_traces`（不污染真实会话的追踪与指标）；需要看单轮轨迹时用 `--report -` 里的 `judge` / `checks` 字段。

## 报告字段

```json
{
  "schema_version": 1,
  "suite": "smoke",
  "generated_at": "2026-11-20T03:20:00+00:00",
  "role": {"id": "...", "name": "...", "model_id": "..."},
  "judge": {"enabled": false, "model_id": null, "threshold": 3.5},
  "totals": {"cases": 4, "executed": 4, "passed": 3, "failed": 1, "errors": 0, "skipped": 0, "pass_rate": 0.75, "elapsed_ms": 5120},
  "judge_mean": null,
  "results": [
    {"id": "arithmetic", "status": "pass", "elapsed_ms": 900, "difficulty": "simple",
     "reply": "831", "tools": [{"name": "calculator", "status": "ok"}],
     "checks": [{"name": "expect_tools", "ok": true, "detail": ""}], "judge": null, "error": null}
  ]
}
```

`results[].status` 取 `pass` / `fail` / `error`。`reply` 超过 4000 字会截断（报告不是日志，别塞整篇长文）。

## 与指标、OTel 的关系

- **指标**（`GET /api/conversations/{id}/metrics`）来自真实使用产生的追踪，eval 报告来自离线用例；两者互补，不要互相替代。
- **OTel**（`CHATVEIN_OTEL=1`）只导出真实对话的轮次，不导出 eval 运行（eval 不起 `tracing` 落库，导出没有意义）。

## 局限（当前已知）

- 用例不能预置本地文件，测不了「读某个文件」类工具；需要时再引入 `${case_dir}` 约定。
- 没有 prompt 版本号：报告只带 role / model。等 prompt registry 落地后再补，避免先造一个假字段。
- 单条用例不做硬超时（无法安全杀线程），用 `--max-seconds` 控整批预算。
- 没有 CI workflow：仓库当前无 workflow 文件，接 CI 只需执行 `tools/run_eval.ps1` 并读退出码。
