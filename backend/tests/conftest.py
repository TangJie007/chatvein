"""每个用例使用独立的数据目录和 SQLite 文件。"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

import db
import mcps.bash_runtime as bash_runtime
import mcps.browser_runtime as browser_runtime
import mcps.browser_session as browser_session
import mcps.workspace as workspace


@pytest.fixture(autouse=True)
def isolated_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CHATVEIN_DB_PATH", str(data_dir / "chatvein.db"))
    monkeypatch.delenv("CHATVEIN_WORKSPACE", raising=False)
    monkeypatch.delenv("CHATVEIN_GIT_BASH", raising=False)
    monkeypatch.delenv("CHATVEIN_SKIP_GIT_BASH_CHECK", raising=False)
    monkeypatch.delenv("CHATVEIN_POWERSHELL_PATH", raising=False)
    monkeypatch.delenv("CHATVEIN_USE_POWERSHELL_TOOL", raising=False)
    monkeypatch.delenv("CHATVEIN_BROWSER", raising=False)
    monkeypatch.delenv("CHATVEIN_BROWSER_EXECUTABLE", raising=False)
    monkeypatch.delenv("CHATVEIN_BROWSER_HEADLESS", raising=False)
    monkeypatch.delenv("CHATVEIN_USE_BROWSER_TOOL", raising=False)
    _reset_singletons()
    db.init_db()
    yield data_dir
    _reset_singletons()


def _reset_singletons() -> None:
    if db._engine is not None:
        db._engine.dispose()
    db._engine = None
    db._db_path_cache = None
    workspace._cache.loaded = False
    workspace._cache.user_root = None
    bash_runtime.clear_runtime_cache()
    browser_runtime.clear_runtime_cache()
    browser_session.reset_session()
