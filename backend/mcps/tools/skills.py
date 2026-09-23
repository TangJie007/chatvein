"""技能加载工具：``load_skill(slug)`` 按需读取本机已启用技能的 SKILL.md 正文。

配合 main.py 的"技能目录注入"：system prompt 里只有技能 name+description 目录，
模型认为需要时调用本工具把完整正文拉进上下文，避免几千米的 SKILL.md 一次性
挤爆上下文。真正的动作仍走其他已注册的 MCP 工具。
"""

from __future__ import annotations

from langchain_core.tools import BaseTool, tool

from skills import local_store  # pyright: ignore[reportImplicitRelativeImport]

#: load_skill 单次返回正文上限，与 local_store._MAX_SKILL_MD 保持一致。
_MAX_BODY = 120_000


@tool
def load_skill(slug: str) -> str:
    """加载一个已启用技能的完整 SKILL.md 正文（技能目录中列出过的 slug）。

    仅当任务确实需要该技能时调用；正文可能较长，请按其中说明执行对应流程。
    技能未安装 / 不存在时返回错误并附本机可用技能清单。
    """
    cleaned = (slug or "").strip()
    body = local_store.read_skill_md(cleaned)
    if not body:
        installed = local_store.list_installed()
        available = ", ".join(str(s.get("slug")) for s in installed) or "(空)"
        return f"技能 `{cleaned}` 未安装或不存在。本机已安装技能: {available}"
    if len(body) > _MAX_BODY:
        body = body[:_MAX_BODY] + "\n\n(正文过长，已按上限截断)"
    return body


TOOLS: tuple[BaseTool, ...] = (load_skill,)


def heuristic(text: str) -> list[str]:
    """技能加载由模型按需决策，不参与离线启发式选择。"""
    return []
