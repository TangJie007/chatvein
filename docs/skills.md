# 技能（Skills）注入方案

> **已实现功能清单** → [`features.md`](./features.md)
> **角色与技能如何进入 Agent 图** → [`agent-graphs.md`](./agent-graphs.md)
> **Agent 流水线** → [`agents.md`](./agents.md)
> **后端目录总览** → [`项目目录总结.md`](./项目目录总结.md)

## 1. 方案一句话总结

技能 = **指令文本**，不注册为普通执行工具。注入采用**目录 + 按需加载**：

- system prompt 只注入**技能目录**（`name + description + slug`），不注入正文；
- 模型认为需要时，调用 **`load_skill(slug)` 工具**把对应 `SKILL.md` 完整正文按需拉进上下文；
- 真正的动作仍走已注册的 **MCP 工具**。

```text
技能目录（prompt 文本）  ──→  告诉模型"有哪些技能、何时用"
load_skill(slug) 工具    ──→  按需加载技能正文（几千米 SKILL.md 不挤爆上下文）
MCP 工具（执行能力）     ──→  真正"怎么做"
```

范围限定：`load_skill` 只允许加载**用户已启用**（角色常驻 + 会话级勾选合并）的技能，
不能越权读取未启用技能。这是「prompt 目录 + 按需加载 + 工具兜底」的混合方案。

## 2. 全链路

```text
前端（Composer 附件面板勾选 slug，勾选即会话级持久化）
  → PUT /api/conversations/{id}/skills   # Composer 勾选/移除时即时落盘
  → POST /api/chat { message, conversation_id?, role_id?, skills[] }  # 发送时兜底同步
  → main.py 技能接线：
      常驻技能 role_runtime.resident_skills  +  会话级技能 conversations.skills
      → dict.fromkeys 保序去重（常驻在前、会话在后）
      → skill_prompt_blocks(merged_slugs)
          └─ skills/service.py
              ├─ local_store.load_skill_catalog(slugs)     # 只读已安装技能，生成目录
              └─ local_store.format_skill_catalog_for_prompt()  # name+description+slug
      → 技能目录追加进 role_runtime["prompt"]（有角色时）
      → role_runtime["_skill_slugs"] = merged_slugs        # 下传给下游图
      → run_chat → agents/graphs/pipeline.py 组装 system prompt
          └─ prompts.py build_agent_system → "# Role\n{role}" 段
      → medium / hard 图 react_node：
          load_skill 为常驻工具（graphs/common.ALWAYS_ON_TOOLS），无条件挂进工具列表
          （不参与 select_tools 选型，绕开角色工具白名单过滤，保证"勾了技能就一定能按需加载"）
      → create_agent(system_prompt=..., tools=[..., load_skill])
      → agents/llm.py get_chat_model 发出模型请求
      → 模型需要时调用 load_skill(slug)
          └─ mcps/tools/skills.py → local_store.read_skill_md(slug) 返回完整正文
```

## 3. 数据模型与落盘

每个技能一个目录，挂在 `CHATVEIN_DATA_DIR/skills/<slug>/`（默认 `项目根/.chatvein/skills/`）。

```text
<data>/skills/<slug>/
  ├── SKILL.md      # 技能正文（load_skill 按需加载的内容，不直接注入）
  └── meta.json     # 元数据：slug / name / description / version / homepage / installed_at
```

| 项 | 说明 |
| --- | --- |
| 数据根目录 | 优先 `CHATVEIN_DATA_DIR` 环境变量，否则回退 `项目根/.chatvein`（`local_store._data_dir`） |
| slug 校验 | 白名单 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`，防止 `../`、绝对路径等越界写入 |
| SKILL.md 上限 | 单文件 120_000 字符（`_MAX_SKILL_MD`），安装超限直接拒绝，加载超限截断 |
| 安装 | `install_skill()`：slug 校验 → 正文校验 → 写 SKILL.md → 写 meta.json |
| 卸载 | `uninstall_skill()`：整目录 `rmtree` |

## 4. 技能来源（两种）

| 来源 | 位置 | 生命周期 | 说明 |
| --- | --- | --- | --- |
| 常驻技能 | `roles.resident_skills`（角色配置） | 每次会话自动带上 | 与人格相关，需稳定在目录里 |
| 会话级技能 | `conversations.skills`（会话配置） | 当前会话持续生效，跨轮保留 | Composer 附件面板手动勾选；已常驻的技能在面板中隐藏，不重复勾选 |

合并规则（`main.py`）：`dict.fromkeys(常驻 + 会话级)` 保序去重，保证 role prompt 里的
技能顺序稳定——**常驻技能在前，会话级技能在后**；重复 slug 只保留第一个。

> 说明：Composer 勾选/移除技能时即时写入 `PUT /api/conversations/{id}/skills`；
> `POST /api/chat` 发送时若携带 `skills` 也会兜底同步（`null` = 不改动，`[]` = 清空会话技能）。
> 发送后 chip 保留在 Composer，供当前会话后续轮次继续生效。

## 5. 注入细节

- **目录生成**：`load_skill_catalog` 只收录已安装技能（未安装 / 重复 slug 静默跳过）；
  `description` 优先取 `meta.json`，缺失时从 `SKILL.md` 头部提取第一个非空段落（`_extract_description`，截 160 字）。
- **目录格式**：`format_skill_catalog_for_prompt` 输出一行一个技能，并在开头明确引导调用 `load_skill`：

```markdown
【已启用技能目录 — 仅当任务确实需要下列技能时，调用 load_skill(slug) 工具加载其完整说明，再按说明执行】
- <技能名> (`<slug>`): <一句话简介>
- <技能名2> (`<slug2>`): <一句话简介>
```

- 有角色：技能目录追加在角色 prompt 之后，模型**先看角色再看技能**。
- 无角色：技能目录直接作为 `role_runtime.prompt`，此时 tools 省略表示不限制工具面。
- `_skill_slugs` 是内部字段，随 `role_runtime` 下传，仅用于标记「本会话已启用技能」；
  `load_skill` 已是常驻工具（`graphs/common.ALWAYS_ON_TOOLS`），由 `medium.py` / `hard.py`
  的 react_node 无条件挂载，与是否启用技能无关。

## 6. `load_skill` 工具

| 项 | 说明 |
| --- | --- |
| 定义 | `mcps/tools/skills.py`，`@tool load_skill(slug: str) -> str` |
| 分组 | 常驻注册到 `mcp-skills` 分组，无需环境探测，`ALL_TOOLS` 恒包含 |
| 返回 | `local_store.read_skill_md(slug)` 的完整正文；超 `_MAX_BODY`(120KB) 截断 |
| 未安装 | 返回明确错误 + 本机已安装技能清单 |
| 离线启发式 | `heuristic()` 返回空列表，不参与离线关键词选工具；离线时由 invoke_tools 提示无法自动填参 |
| 可用性保障 | 常驻工具（`ALWAYS_ON_TOOLS`），react_node 无条件挂载，不参与选型 / 角色白名单过滤 |

## 7. 边界与保护

| 保护项 | 实现 |
| --- | --- |
| 未安装技能 | 目录生成静默跳过；`load_skill` 返回错误 + 可用清单 |
| 越权加载 | `load_skill` 只能读已选技能，但本机技能均为用户安装，无鉴权门槛 |
| 超长正文 | 安装拒绝 / `load_skill` 返回截断 |
| 恶意 slug | 白名单正则校验，防目录穿越 |
| 上下文占用 | 只注入目录（每个技能一行），正文按需进上下文 |

## 8. 现状限制 / 刻意不做

| 限制 | 说明 |
| --- | --- |
| **无全局技能池检索** | `load_skill` 范围限定在用户已选技能内，不从全部已安装技能自动召回 |
| **无 embedding 召回** | 没有根据用户 query 的向量检索层，选技能靠"配置 + 手动勾选 + 模型判断" |
| **无读盘缓存** | 目录生成 / `load_skill` 每次请求重新读磁盘 |
| **无更新检测** | 安装后不检查 SkillHub 是否有新版本 |
| **无技能自动发现** | 不会自动把新安装技能塞进会话，需用户在 Composer 勾选 |

若后续要做"全局技能池"：可新增 `skills/retriever.py`（关键词 / embedding / LLM 选择），
在 `main.py` 技能接线之前用当前消息从**全部已安装技能**召回 top-k 加入目录；
常驻技能建议保留目录注入（人格相关，需稳定可见），懒加载只作用于池子技能。

## 9. 相关文件与接口

| 文件 / 接口 | 职责 |
| --- | --- |
| `skills/local_store.py` | 落盘、目录生成（`load_skill_catalog` / `format_skill_catalog_for_prompt`）；全文模式 `load_skill_blocks` / `format_skills_for_prompt` 兼容保留 |
| `skills/service.py` | SkillHub 浏览 / 详情 / 安装代理；`skill_prompt_blocks()` 接线入口（生成目录） |
| `skills/controller.py` | `/api/skills*` 路由 |
| `mcps/tools/skills.py` | `load_skill(slug)` 工具实现 |
| `mcps/tools/__init__.py` | `mcp-skills` 分组挂载 + 启发式模块注册 |
| `agents/graphs/medium.py` / `hard.py` | react_node 按 `_skill_slugs` 无条件附加 `load_skill` |
| `main.py` 技能接线段 | slug 合并 → 目录注入 → `_skill_slugs` 下传 |
| `roles/` | `resident_skills` 常驻技能字段 |
| `conversations/` | `conversations.skills` 会话级技能列；`PUT /api/conversations/{id}/skills` 落盘 |
| `POST /api/chat` | `skills[]` 字段兜底同步会话级技能（`null`=不改动 / `[]`=清空 / 列表=覆盖） |
| 前端 `Composer.tsx` | 附件面板勾选已安装技能（排除常驻技能，勾选即会话级持久化） |
