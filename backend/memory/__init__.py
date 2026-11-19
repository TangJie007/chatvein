"""长期记忆模块（批次 1 §1.4）。

- ``store.py``：独立 SQLite（``<data>/memory.sqlite``）的裸 SQL 读写
- ``service.py``：抽取 / 召回 / 巩固 / 合并，以及注入 role prompt
- ``controller.py``：``/api/memories`` 管理与状态接口

与主库、会话库分开：记忆是「用户画像」而非业务实体，独立文件便于整份删除 / 备份。
"""
