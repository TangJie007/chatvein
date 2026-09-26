"""知识库管理 REST API 测试。

覆盖：状态 / 列表 / 详情 / 增删改 / 关键词搜索（向量模型未就绪时自动退化）/
批量导入 / 清空 / 重建索引（模型未就绪返回 409）/ 参数校验 / 404 语义。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

import main as main_module

client = TestClient(main_module.app)


def _create(title: str, content: str, source: str = "") -> dict:
    resp = client.post("/api/kb/docs", json={"title": title, "content": content, "source": source})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_status_empty_db() -> None:
    resp = client.get("/api/kb/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["indexed"] == 0
    assert isinstance(data["db_path"], str)
    assert data["db_path"].endswith("kb.sqlite")


def test_create_and_get() -> None:
    doc = _create("向量检索", "这是一条测试笔记，讲的是 sqlite-vec 向量检索。")
    assert doc["id"]
    assert doc["title"] == "向量检索"
    assert doc["char_count"] > 0
    assert doc["indexed"] in (True, False)  # 向量模型未装时 False，装好后 True

    detail = client.get(f"/api/kb/docs/{doc['id']}")
    assert detail.status_code == 200
    assert detail.json()["content"].startswith("这是一条测试笔记")


def test_list_with_search_and_pagination() -> None:
    _create("第一条", "苹果香蕉", source="a.txt")
    _create("第二条", "葡萄橙子", source="b.txt")
    _create("第三条", "苹果派配方", source="c.txt")

    all_docs = client.get("/api/kb/docs").json()
    assert all_docs["total"] == 3
    assert len(all_docs["items"]) == 3

    q = client.get("/api/kb/docs", params={"q": "苹果"}).json()
    assert q["total"] == 2
    assert {i["title"] for i in q["items"]} == {"第一条", "第三条"}

    paged = client.get("/api/kb/docs", params={"limit": 2, "offset": 0}).json()
    assert paged["total"] == 3
    assert len(paged["items"]) == 2
    assert paged["limit"] == 2
    assert paged["offset"] == 0


def test_update_reindexes_and_keeps_id() -> None:
    doc = _create("旧标题", "旧内容")
    resp = client.put(
        f"/api/kb/docs/{doc['id']}",
        json={"title": "新标题", "content": "新内容", "source": "new.txt"},
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["id"] == doc["id"]
    assert updated["title"] == "新标题"
    assert updated["content"] == "新内容"
    assert updated["source"] == "new.txt"

    # 只更新部分字段
    partial = client.put(f"/api/kb/docs/{doc['id']}", json={"source": "patch.txt"}).json()
    assert partial["title"] == "新标题"
    assert partial["source"] == "patch.txt"


def test_create_validation_errors() -> None:
    assert client.post("/api/kb/docs", json={"title": "t", "content": "  "}).status_code == 400
    assert client.post("/api/kb/docs", json={"title": "t"}).status_code == 422
    assert client.post("/api/kb/docs", json={"content": "x" * 100_001}).status_code == 422


def test_missing_doc_returns_404() -> None:
    assert client.get("/api/kb/docs/nope").status_code == 404
    assert client.put("/api/kb/docs/nope", json={"title": "t"}).status_code == 404
    assert client.delete("/api/kb/docs/nope").status_code == 404


def test_search_keyword_fallback() -> None:
    _create("公司制度", "年假每年 15 天，加班需要提前申请。", source="hr.md")
    _create("产品手册", "ChatVein 支持多 Agent 团队协作。", source="manual.md")

    resp = client.post("/api/kb/search", json={"query": "年假", "limit": 5})
    assert resp.status_code == 200
    hits = resp.json()["items"]
    assert hits, "关键词检索应命中"
    assert hits[0]["title"] == "公司制度"
    assert "年假" in hits[0]["content"]

    # 不存在的关键词应空命中
    empty = client.post("/api/kb/search", json={"query": "不存在的词xyz"})
    assert empty.json()["items"] == []


def test_delete_doc() -> None:
    doc = _create("待删除", "内容")
    resp = client.delete(f"/api/kb/docs/{doc['id']}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == doc["id"]
    assert client.get(f"/api/kb/docs/{doc['id']}").status_code == 404


def test_import_items() -> None:
    resp = client.post(
        "/api/kb/import",
        json={
            "items": [
                {"title": "导入一", "content": "第一条导入的内容"},
                {"title": "导入二", "content": "第二条导入的内容", "source": "x.md"},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["created"] == 2
    assert client.get("/api/kb/docs").json()["total"] == 2


def test_clear() -> None:
    _create("a", "1")
    _create("b", "2")
    resp = client.delete("/api/kb/docs")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2
    assert client.get("/api/kb/docs").json()["total"] == 0


def test_rebuild_index_without_model_returns_409() -> None:
    # 测试环境未安装向量模型：重建索引应明确拒绝而不是静默吞掉
    resp = client.post("/api/kb/rebuild-index")
    assert resp.status_code == 409


def test_kb_tools_still_registered() -> None:
    """Agent 侧工具与知识库管理共用同一存储，工具注册不能被破坏。"""
    from mcps.tools import kb  # pyright: ignore[reportImplicitRelativeImport]

    names = {t.name for t in kb.TOOLS}
    assert {"kb_add_note", "kb_search", "kb_search_messages", "kb_index_workspace"} <= names
    assert kb.heuristic("帮我查一下知识库里的笔记")
