"""MCP / 工具域：注册表 + 按名执行。

调用方直接用子模块，不在这里 re-export：

- 工具注册与解析 → ``mcps.registry``（``resolve_tools`` / ``invoke_tools`` / ``tool_catalog``）
- 工具实现 → ``mcps.tools``
- 工作区与审批 → ``mcps.sandbox`` / ``mcps.workspace`` / ``mcps.bash_policy``
"""

__all__: list[str] = []
