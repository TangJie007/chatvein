"""模型配置的备用模型与单价字段（batch4 · 4.7）。

写入时就校验（而不是运行期静默忽略死链）：用户以为配好了、实际没生效，最难查。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine

import db
from models.entity import CreateLlmModelDto, UpdateLlmModelDto
from models.service import ModelsService


def _create(svc: ModelsService, name: str, **kwargs: object) -> str:
    payload = {"name": name, "model_id": "gpt-test", "api_key": "sk-test"}
    payload.update(kwargs)
    return svc.create_model(CreateLlmModelDto(**payload)).id  # type: ignore[arg-type]


def test_fallback_and_prices_roundtrip() -> None:
    svc = ModelsService()
    backup_id = _create(svc, "备用", model_id="gpt-mini")
    main = svc.create_model(
        CreateLlmModelDto(
            name="主",
            model_id="gpt-4o",
            api_key="sk-main",
            fallback_config_id=backup_id,
            price_input=2.0,
            price_output=8.0,
        )
    )
    assert main.fallback_config_id == backup_id
    assert main.price_input == 2.0
    assert main.price_output == 8.0


def test_empty_string_clears_fallback() -> None:
    """前端「不使用备用模型」提交空串，落库要是 NULL 而不是空字符串。"""
    svc = ModelsService()
    backup_id = _create(svc, "备用")
    main_id = _create(svc, "主", fallback_config_id=backup_id)
    updated = svc.update_model(main_id, UpdateLlmModelDto(fallback_config_id=""))
    assert updated is not None
    assert updated.fallback_config_id is None


def test_fallback_must_exist() -> None:
    with pytest.raises(ValueError, match="不存在"):
        _create(ModelsService(), "主", fallback_config_id="no-such-config")


def test_fallback_cannot_point_to_self() -> None:
    svc = ModelsService()
    main_id = _create(svc, "主")
    with pytest.raises(ValueError, match="不能指向自己"):
        svc.update_model(main_id, UpdateLlmModelDto(fallback_config_id=main_id))


def test_fallback_must_be_enabled() -> None:
    svc = ModelsService()
    backup_id = _create(svc, "备用")
    svc.update_model(backup_id, UpdateLlmModelDto(enabled=False))
    with pytest.raises(ValueError, match="停用"):
        _create(svc, "主", fallback_config_id=backup_id)


def test_v15_migration_is_idempotent(tmp_path: Path) -> None:
    """老库补列必须可重复跑（每次启动都会过一次迁移）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE llm_models (id VARCHAR(64) PRIMARY KEY, name VARCHAR(100))"
        )
        for _ in range(2):
            db._ensure_llm_models_fallback_columns(conn)
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(llm_models)")}
    assert {"fallback_config_id", "price_input", "price_output"} <= set(columns)
    engine.dispose()
