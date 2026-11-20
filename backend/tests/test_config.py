"""配置口径与文档一致性（batch4 · 4.4）。

两个承诺：
1. ``agents/config.py`` 的判定口径固定（``""``/``0``/``false``/``no``/``off`` 算关）。
2. ``docs/configuration.md`` 是唯一全量表：代码里真的读环境变量的 ``CHATVEIN_*``
   必须出现在表里，漏写就失败。

只扫「读环境变量」的调用（``os.getenv`` / ``os.environ.get`` / ``_env_flag`` /
``flag`` / ``number``），**不扫**日志标签——``print("CHATVEIN_VEC loaded=...")``
这种是事件名，不是配置，写进表里反而误导人。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from agents import config

_BACKEND = Path(__file__).resolve().parent.parent
_DOC = _BACKEND.parent / "docs" / "configuration.md"
#: 读环境变量的函数名（属性名或函数名，大小写不敏感）。
_ENV_READERS = frozenset({"getenv", "flag", "number"})


def _callee_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _reads_env(node: ast.Call) -> bool:
    name = _callee_name(node).lower()
    return "env" in name or name in _ENV_READERS


def _env_names() -> set[str]:
    names: set[str] = set()
    for path in _BACKEND.rglob("*.py"):
        if "tests" in path.parts or "data" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _reads_env(node) and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.startswith("CHATVEIN_"):
                        names.add(arg.value)
            # os.environ["CHATVEIN_X"] 也算
            elif isinstance(node, ast.Subscript):
                slice_node = node.slice
                if isinstance(slice_node, ast.Constant) and isinstance(
                    slice_node.value, str
                ):
                    if slice_node.value.startswith("CHATVEIN_"):
                        names.add(slice_node.value)
    return names


def test_every_env_switch_is_documented() -> None:
    doc = _DOC.read_text(encoding="utf-8")
    missing = sorted(name for name in _env_names() if name not in doc)
    assert not missing, (
        "docs/configuration.md 漏了这些开关（表格里要有一行，不写会被当成没实现）："
        + "、".join(missing)
    )


@pytest.mark.parametrize("raw", ["", "0", "false", "no", "off", " OFF "])
def test_flag_treats_these_as_off(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("CHATVEIN_TEST_FLAG", raw)
    assert config.flag("CHATVEIN_TEST_FLAG", True) is False


@pytest.mark.parametrize("raw", ["1", "true", "yes", "on", "anything"])
def test_flag_treats_everything_else_as_on(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    monkeypatch.setenv("CHATVEIN_TEST_FLAG", raw)
    assert config.flag("CHATVEIN_TEST_FLAG", False) is True


def test_flag_unset_uses_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_TEST_FLAG", raising=False)
    assert config.flag("CHATVEIN_TEST_FLAG", True) is True
    assert config.flag("CHATVEIN_TEST_FLAG", False) is False


def test_number_defaults_and_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_TEST_NUM", raising=False)
    assert config.number("CHATVEIN_TEST_NUM", 5, minimum=1) == 5
    monkeypatch.setenv("CHATVEIN_TEST_NUM", " 7 ")
    assert config.number("CHATVEIN_TEST_NUM", 5, minimum=1) == 7


@pytest.mark.parametrize("raw", ["abc", "1.5", "0", "-2"])
def test_number_rejects_bad_values(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    """写错就抛：静默退回默认值等于「设了没生效」，最难查。"""
    monkeypatch.setenv("CHATVEIN_TEST_NUM", raw)
    with pytest.raises(ValueError):
        config.number("CHATVEIN_TEST_NUM", 5, minimum=1)
