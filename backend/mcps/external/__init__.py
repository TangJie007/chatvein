"""外部 MCP 协议客户端（stdio / SSE / Streamable HTTP）。

本包**故意不在这里导入任何子模块**：``mcp`` SDK 是可选依赖，未配置外部 server
时不该被拉起；``mcps.tools.__init__`` 会按需访问 ``state``。
"""
