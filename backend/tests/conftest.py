"""每个用例使用独立的数据目录和 SQLite 文件。"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

import db
import mcps.workspace as workspace


@pytest.fixture(autouse=True)
def isolated_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("CHATVEIN_DATA_DIR", str(data_dir))
    monkeypatch.setenv("CHATVEIN_DB_PATH", str(data_dir / "chatvein.db"))
    monkeypatch.delenv("CHATVEIN_WORKSPACE", raising=False)
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
