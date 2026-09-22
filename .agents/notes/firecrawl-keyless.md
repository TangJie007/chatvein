# web_search 无 key 降级链

顺序（用户约定）：

1. **Claw Search** — OpenClaw/Claw 常用的 Parallel Search Free MCP  
   `https://search.parallel.ai/mcp`（可用 `CLAW_SEARCH_MCP_URL` 覆盖）
2. **Tavily Keyless** — `POST https://api.tavily.com/search` + `X-Tavily-Access-Mode: keyless`  
   （有 `TAVILY_API_KEY` 则 Bearer）
3. **Firecrawl** — REST `/v2/search` Keyless（有 `FIRECRAWL_API_KEY` 则 Bearer）  
   不用 `firecrawl-py`（无 key 构造即抛错）
4. **ddgs** — 最终兜底

某源 401/402/403/429 等写入进程级 `_disabled`，同进程后续请求跳过该源。

`web_fetch` 仍为 Firecrawl → httpx。
