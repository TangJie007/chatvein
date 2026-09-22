"""web_search 降级链：Claw → Tavily → Firecrawl → ddgs。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from mcps.tools import web as web_mod


def setup_function() -> None:
    web_mod.reset_web_search_state_for_tests()


def teardown_function() -> None:
    web_mod.reset_web_search_state_for_tests()


def _client_returning(responses: list[MagicMock]) -> MagicMock:
    fake = MagicMock()
    fake.__enter__.return_value = fake
    fake.__exit__.return_value = None
    fake.post.side_effect = list(responses)
    return fake


def test_web_search_prefers_claw_then_stops(monkeypatch) -> None:
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)

    init = MagicMock()
    init.status_code = 200
    init.headers = {"mcp-session-id": "s1"}
    init.text = "{}"
    call = MagicMock()
    call.status_code = 200
    call.json.return_value = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json_dumps_results(),
                }
            ]
        },
    }

    with (
        patch.object(web_mod.httpx, "Client", return_value=_client_returning([init, call])),
        patch.object(web_mod, "_search_tavily") as tavily,
        patch.object(web_mod, "_search_firecrawl") as firecrawl,
        patch.object(web_mod, "_search_ddgs") as ddgs,
    ):
        out = web_mod.web_search.invoke({"query": "天气"})

    assert out.startswith("source=claw-search")
    tavily.assert_not_called()
    firecrawl.assert_not_called()
    ddgs.assert_not_called()


def json_dumps_results() -> str:
    import json

    return json.dumps(
        {
            "results": [
                {
                    "url": "https://example.com/w",
                    "title": "天气",
                    "excerpts": ["晴 25°C"],
                }
            ]
        }
    )


def test_web_search_falls_through_to_tavily(monkeypatch) -> None:
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    with (
        patch.object(web_mod, "_search_claw", return_value=None),
        patch.object(
            web_mod,
            "_search_tavily",
            return_value="source=tavily-keyless\n1. ok",
        ) as tavily,
        patch.object(web_mod, "_search_firecrawl") as firecrawl,
        patch.object(web_mod, "_search_ddgs") as ddgs,
    ):
        out = web_mod.web_search.invoke({"query": "hello"})

    assert out.startswith("source=tavily-keyless")
    tavily.assert_called_once()
    firecrawl.assert_not_called()
    ddgs.assert_not_called()


def test_web_search_falls_through_to_firecrawl_then_ddgs(monkeypatch) -> None:
    with (
        patch.object(web_mod, "_search_claw", return_value=None),
        patch.object(web_mod, "_search_tavily", return_value=None),
        patch.object(web_mod, "_search_firecrawl", return_value=None),
        patch.object(web_mod, "_search_ddgs", return_value="source=ddgs\nok") as ddgs,
    ):
        out = web_mod.web_search.invoke({"query": "hello"})

    assert out.startswith("source=ddgs")
    ddgs.assert_called_once()


def test_tavily_keyless_header(monkeypatch) -> None:
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "results": [{"url": "https://a.com", "title": "A", "content": "b"}]
    }
    client = _client_returning([resp])
    with patch.object(web_mod.httpx, "Client", return_value=client):
        out = web_mod._search_tavily("q", 3)
    assert out and out.startswith("source=tavily-keyless")
    headers = client.post.call_args.kwargs["headers"]
    assert headers.get("X-Tavily-Access-Mode") == "keyless"
    assert "Authorization" not in headers
