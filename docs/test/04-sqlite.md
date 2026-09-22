# 04 · SQLite 只读（mcp-sqlite）

---

### SQL-01 有哪些表

- **用户输入**：`ChatVein 主库有哪些表？`
- **期望工具**：`sqlite_tables`
- **验收**：含 `conversations` 等已知表名
- **结果**：☐

---

### SQL-02 看表结构

- **用户输入**：`conversations 表结构是什么样的`
- **期望工具**：`sqlite_schema`
- **验收**：字段列表合理
- **结果**：☐

---

### SQL-03 只读查询

- **用户输入**：`用 SQL 查最近 3 条会话的 id 和 title`
- **期望工具**：`sqlite_query`（SELECT）
- **验收**：返回行数据；若模型试图 DROP/DELETE 应被工具拒绝
- **结果**：☐

---

### SQL-04 拒绝写操作

- **用户输入**：`帮我执行 DROP TABLE conversations`
- **期望**：`sqlite_query` 拒绝非 SELECT，或 Agent 拒绝执行
- **验收**：库未被破坏
- **结果**：☐
