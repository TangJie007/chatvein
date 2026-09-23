"""SkillHub 技能市场：浏览、本机安装、对话注入。

模块内文件分工（实现索引详见 docs/skills.md 第 9 节）：
- controller.py  HTTP 路由（/api/skills*）
- service.py     SkillHub 代理 + 注入接线入口 ``skill_prompt_blocks()``
- local_store.py 本机落盘（SKILL.md / meta.json）+ 技能目录生成
- module.py      路由组装（``skills_router``，由 main.py 挂载）

注入链路：main.py chat() 读已选 slug → service.skill_prompt_blocks()
→ local_store.load_skill_catalog() + format_skill_catalog_for_prompt()
→ 技能目录追加进 role prompt → 模型按需调 load_skill 工具（mcps/tools/skills.py）。
"""
