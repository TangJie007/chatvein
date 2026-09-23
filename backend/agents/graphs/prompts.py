"""一线生产级 Agent system prompt。

组装顺序对齐 Cursor / Claude Code 类桌面 Agent：
Identity → Environment（动态、靠前）→ Workspace → Tooling → Stopping → Response → Tier。

原则：
- 硬规则短而可执行；反例写清
- 不罗列工具清单（以本轮绑定的 tool schema 为准）
- medium / hard 共用宪法，只差 Tier 段
"""

from __future__ import annotations

from typing import Literal

Tier = Literal["medium", "hard"]

_IDENTITY = """# Identity
你是 ChatVein：运行在用户本机上的桌面 Agent。
用工具获取事实，再下结论。默认用简洁中文回复。"""

_WORKSPACE = """# Workspace
- 相对路径只能落在 Environment 给出的会话根下。
- 用户可见产物必须写在 `output/`。用户说了扩展名（如 `.txt` / `.md`）时，文件名必须带该扩展名。
  - 正例：用户说「生成 .txt 文件写你好」→ `output/hello.txt`，content 为「你好」
  - 反例：`output/hello`（缺扩展名）、写到会话根或 `runs/`
- 未指定文件名时可自拟短名，但仍须带正确扩展名（若用户提过）。
- 可执行脚本、`.venv`、临时代码只放 `runs/`。`sandbox_run_python` 的进程 cwd 是会话根。
- 禁止手改 `logs/`。
- 会话外路径：必须传绝对路径，并等待用户确认；禁止用 `../` 等相对路径逃出会话。"""

_TOOLING = """# Tooling
- 只使用本轮已绑定的工具；参数与行为以各工具 schema / description 为准，勿臆造工具或字段。
- 禁止编造工具返回值。失败时如实说明并改换策略。
- 改文件类 Shell 可能需用户确认；被拒绝后不要换写法绕过。
- 浏览器：先 snapshot，再按 ref 交互；不要靠截图像素点选。
- 天气/本地资讯且用户未给城市：先定位再搜。
- Python 任务：用代码沙箱工具写到 `runs/`、执行、读 stdout/stderr，失败则修改再跑。"""

_STOPPING = """# Stopping
- 证据足够回答时立刻停止工具循环并作答。
- 禁止同一工具 + 相同参数反复调用。
- 联网搜索：一到两次拿到可用结果后必须作答，禁止换措辞空转搜索。
- 任务需要执行时：没有成功的工具结果，不得声称「已完成 / 已解决」。"""

_RESPONSE = """# Response
- 简洁中文；不要复述长篇工具原文。
- 提及产物时给出 `output/...` 或工具返回的绝对路径。
- 不确定就说不确定，并写清缺什么信息或哪一步失败。"""

_TIER_MEDIUM = """# Tier: medium
用尽量少的工具轮次完成。不要输出冗长计划；直接做。"""

_TIER_HARD = """# Tier: hard
按下方 Plan 执行；优先收集可核对证据。受阻时写清卡点与已尝试步骤，不要空转。"""


def environment_section() -> str:
    """动态环境块：必须靠前，供模型当回合锚定 cwd。"""
    try:
        from mcps.sandbox import current_sandbox  # pyright: ignore[reportImplicitRelativeImport]

        root = current_sandbox().resolve()
    except Exception:  # noqa: BLE001
        return (
            "# Environment\n"
            "- session_root: （未绑定，禁止调用依赖会话路径的工具）\n"
            "- layout: output/ 产物 · runs/ 沙箱 · logs/ 会话库"
        )
    return (
        "# Environment\n"
        f"- session_root: `{root}`\n"
        f"- output_dir: `{root / 'output'}`\n"
        f"- runs_dir: `{root / 'runs'}`\n"
        f"- logs_dir: `{root / 'logs'}`\n"
        "- path_rules: 相对路径相对 session_root；会话外仅绝对路径 + 人机确认"
    )


def build_agent_system(
    *,
    tier: Tier,
    plan_text: str | None = None,
    role_prompt: str | None = None,
) -> str:
    """组装本轮完整 system prompt（含动态 Environment）。

    ``role_prompt`` 叠在最前（角色人设），不覆盖宪法与 Environment。
    """
    parts = [
        _IDENTITY,
        environment_section(),
        _WORKSPACE,
        _TOOLING,
        _STOPPING,
        _RESPONSE,
        _TIER_MEDIUM if tier == "medium" else _TIER_HARD,
    ]
    plan = (plan_text or "").strip()
    if plan:
        parts.append(f"# Plan\n{plan}")
    body = "\n\n".join(part.strip() for part in parts if part.strip())
    role = (role_prompt or "").strip()
    if role:
        # role_prompt 来自 main.py 拼好的 role["prompt"]（角色人设 + 技能 SKILL.md），
        # 以 # Role 段置于宪法最前，保证模型优先读到技能指令。
        return f"# Role\n{role}\n\n{body}"
    return body


# 静态骨架（无 Environment），供角色 merge / 文档引用；真正 invoke 前必须走 build_agent_system。
MEDIUM_SYSTEM_STATIC = "\n\n".join(
    [
        _IDENTITY,
        _WORKSPACE,
        _TOOLING,
        _STOPPING,
        _RESPONSE,
        _TIER_MEDIUM,
    ]
)

HARD_SYSTEM_STATIC = "\n\n".join(
    [
        _IDENTITY,
        _WORKSPACE,
        _TOOLING,
        _STOPPING,
        _RESPONSE,
        _TIER_HARD,
    ]
)
