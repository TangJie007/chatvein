# Skill 市场（SkillHub + 本机安装）

## 现状

侧边栏「技能」→ 浏览腾讯 SkillHub 公开目录。后端：

- `GET /api/skills/` 代理列表
- `GET /api/skills/{slug}` 代理详情 + `SKILL.md`
- `GET /api/skills/installed` 本机已装列表
- `POST /api/skills/{slug}/install` 下载到 `CHATVEIN_DATA_DIR/skills/<slug>/`
- `DELETE /api/skills/{slug}` 卸载

对话 Composer 可选用已安装技能；`POST /api/chat` 的 `skills` 字段把 `SKILL.md` 注入角色 system。

## 后期可补

1. **自动发现**：按 description 自动挑选技能，不必手动点选。
2. **更新检测**：对比 SkillHub 版本。
3. **Registry**：SkillHub URL 可配置（默认已可用环境变量）。

与 MCP 工具轨分离：市场装的是程序性知识包，不是再列一套 `mcp-*` 开关。总表见 `docs/agents.md`。
