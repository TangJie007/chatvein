# 10 · 浏览器（mcp-browser）

前置：本机已 `playwright install chromium`（或配置可执行文件）；设置页 Browser 为运行中。未注册则整组跳过。

---

### BR-01 打开并快照

- **用户输入**：`用浏览器打开 https://example.com ，做一次 snapshot，告诉我标题和可见文本要点`
- **期望工具**：`browser_navigate` + `browser_snapshot`（可有 `browser_info`）
- **验收**：内容与 example.com 相关
- **结果**：☐

---

### BR-02 按 ref 点击（可选）

- **用户输入**：`打开 example.com，snapshot 后点击页面上的 More information… 链接（用 ref，不要瞎点坐标）`
- **期望工具**：`browser_snapshot` → `browser_click`
- **验收**：导航到更多信息页或等价结果
- **结果**：☐

---

### BR-03 截图

- **用户输入**：`给当前页截一张图并告诉我保存路径`
- **期望工具**：`browser_take_screenshot`
- **验收**：返回落盘路径；文件存在
- **结果**：☐

---

### BR-04 关闭

- **用户输入**：`关掉浏览器标签/会话`
- **期望工具**：`browser_close` 或 `browser_tabs`
- **验收**：无残留错误即可
- **结果**：☐
