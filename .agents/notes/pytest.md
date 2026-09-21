# pytest

后端单元测试用 pytest，而不是再写一套断言脚本。

- 运行时依赖仍只在 `backend/requirements.txt`（打包镜像不带测试工具）。
- 开发依赖在 `backend/requirements-dev.txt`，目前只追加 `pytest`。
- 测试放在 `backend/tests`，`pyproject.toml` 把 `backend` 加进 `pythonpath`，用例用临时库，不碰本机 `chatvein.db`。
