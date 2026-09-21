# Skill 市场（SkillHub 浏览）

## 现状

侧边栏「技能」→ 浏览腾讯 SkillHub 公开目录。后端：

- `GET /api/skills/` 代理列表 `https://api.skillhub.cn/api/skills`
- `GET /api/skills/{slug}` 代理详情 `https://api.skillhub.cn/api/v1/skills/{slug}`，并尽力拉取 `SKILL.md`

前端点击卡片打开右侧详情抽屉（简介 / 统计 / 安全扫描 / 正文）；安装按钮仍禁用。

## 后期需要补

1. **安装**：下载技能包到本机目录（建议 `CHATVEIN_DATA_DIR/skills/<slug>/`），校验 `SKILL.md`。
2. **使用**：Agent 按 `description` 发现技能，把正文注入 system / 工具说明；真正执行仍走现有 MCP 工具。
3. **生命周期**：更新、卸载、已安装列表。
4. **Registry**：SkillHub URL 可配置（默认 SkillHub，可切 ClawHub / 自建）。

与 MCP 工具轨分离：市场装的是程序性知识包，不是再列一套 `mcp-*` 开关。总表见 `docs/agents.md`。
