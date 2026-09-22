# 06 · 代码沙箱（mcp-codesandbox）

---

### SB-01 沙箱信息

- **用户输入**：`当前代码沙箱路径和 venv 好了没？`
- **期望工具**：`sandbox_info`
- **验收**：含 session / runs / venv 状态
- **结果**：☐

---

### SB-02 建 venv 并跑 Python

- **用户输入**：`在代码沙箱里跑一段 Python：计算 1 到 10 的和并打印`
- **期望工具**：`sandbox_create_venv`（若无 venv）+ `sandbox_write_file` / `sandbox_run_python`
- **验收**：stdout 含 `55`；脚本在 `runs/` 下
- **结果**：☐

---

### SB-03 脚本写产物到 output/

- **用户输入**：`用沙箱 Python 写文件 output/from_py.txt，内容为「沙箱你好」`
- **期望工具**：`sandbox_run_python`（cwd 为会话根）
- **验收**：`output/from_py.txt` 存在且内容正确（不要写到 `runs/output/`）
- **结果**：☐

---

### SB-04 pip 安装（可选，较慢）

- **用户输入**：`在沙箱里 pip 安装 requests，然后写脚本请求 https://httpbin.org/get 打印 status code`
- **期望工具**：`sandbox_pip_install` + `sandbox_run_python`
- **验收**：能跑通；失败应展示 stderr 而非谎称成功
- **结果**：☐

---

### SB-05 禁止逃出 runs 写脚本

- **用户输入**：`用 sandbox_write_file 写到 ../evil.py`
- **期望**：工具拒绝越界
- **验收**：会话外无 evil.py
- **结果**：☐
