"""内置工具包：按本机运行时动态挂载 Bash / PowerShell / Browser。

模块约定：每个工具模块导出 ``TOOLS``（可挂载工具元组）+ ``heuristic()``（离线关键词命中）。
技能相关：
- ``skills`` 模块 = ``load_skill`` 工具（mcps/tools/skills.py），挂 ``mcp-skills`` 分组，恒常驻；
- 技能目录注入不在此层，见 main.py 技能接线段 → skills/service.skill_prompt_blocks()。
PDF 相关：
- ``pdf`` 模块 = ``pdf_info`` / ``pdf_read`` / ``pdf_merge`` / ``pdf_split`` /
  ``pdf_generate`` / ``pdf_encrypt`` / ``pdf_decrypt``（mcps/tools/pdf.py），挂 ``mcp-pdf`` 分组。
  读取/合并/拆分/加解密用 pypdf，生成用 reportlab（内置中文字体）。
"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from mcps.bash_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    bash_available,
    powershell_available,
)
from mcps.browser_runtime import browser_available  # pyright: ignore[reportImplicitRelativeImport]

from . import (
    bash,
    browser,
    core,
    excel_tools,
    fs,
    ip,
    kb,
    ocr,
    pdf,
    powershell,
    pptx_tools,
    sandbox,
    skills,
    sqlite_tools,
    web,
    word_tools,
)


def build_tool_groups() -> dict[str, list[BaseTool]]:
    """有 Git Bash 才挂 ``mcp-bash``；Windows 有 PowerShell 才挂 ``mcp-powershell``；
    Playwright 浏览器就绪才挂 ``mcp-browser``；技能加载器常驻 ``mcp-skills``。
    """
    groups: dict[str, list[BaseTool]] = {
        "core": list(core.TOOLS),
        "mcp-fs": list(fs.TOOLS),
        "mcp-web": list(web.TOOLS),
        "mcp-sqlite": list(sqlite_tools.TOOLS),
        "mcp-kb": list(kb.TOOLS),
        "mcp-codesandbox": list(sandbox.TOOLS),
        "mcp-ip": list(ip.TOOLS),
        "mcp-ocr": list(ocr.TOOLS),
        "mcp-pdf": list(pdf.TOOLS),
        "mcp-skills": list(skills.TOOLS),
        "mcp-docx": list(word_tools.TOOLS),
        "mcp-pptx": list(pptx_tools.TOOLS),
        "mcp-excel": list(excel_tools.TOOLS),
    }
    if bash_available():
        groups["mcp-bash"] = list(bash.TOOLS)
    if powershell_available():
        groups["mcp-powershell"] = list(powershell.TOOLS)
    if browser_available():
        groups["mcp-browser"] = list(browser.TOOLS)
    return groups


TOOL_GROUPS: dict[str, list[BaseTool]] = build_tool_groups()
ALL_TOOLS: list[BaseTool] = [t for group in TOOL_GROUPS.values() for t in group]


def refresh_tool_groups() -> dict[str, list[BaseTool]]:
    """环境变量变更后重建分组（测试或热切换路径时用）。"""
    global TOOL_GROUPS, ALL_TOOLS
    TOOL_GROUPS = build_tool_groups()
    ALL_TOOLS = [t for group in TOOL_GROUPS.values() for t in group]
    return TOOL_GROUPS


def heuristic_hits(message: str) -> list[str]:
    """按关键词启发式命中工具名（离线回落）。"""
    text = (message or "").lower()
    names: list[str] = []
    modules = [core, fs, web, sqlite_tools, kb, sandbox, ip, ocr, pdf, skills, word_tools, pptx_tools, excel_tools]
    if bash_available():
        modules.append(bash)
    if powershell_available():
        modules.append(powershell)
    if browser_available():
        modules.append(browser)
    for group in modules:
        names.extend(group.heuristic(text))
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


__all__ = [
    "ALL_TOOLS",
    "TOOL_GROUPS",
    "build_tool_groups",
    "heuristic_hits",
    "refresh_tool_groups",
]
