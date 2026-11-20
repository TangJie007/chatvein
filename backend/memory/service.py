"""长期记忆的读写服务：抽取、召回、注入、巩固。

三条链路（批次 1 §1.4）：

1. **召回**（每轮、同步、无 LLM）：`recall_into_role` 把命中的已确认记忆拼成一段
   `# 长期记忆` 追加到本轮 role prompt 的副本上。用副本而不是原 dict 是因为
   ``role_runtime`` 由 ``RolesService`` 解析、可能被缓存复用；直接改会造成跨轮污染。
2. **抽取**（每轮结束后、异步、一次轻量结构化调用）：`maybe_extract_async` 起一个
   daemon 线程，失败只打日志，绝不影响已经返回给用户的回复。
3. **巩固**（用户点「整理」或惰性触发）：`consolidate` 清过期 + 合并同义重复。

开关（都是环境变量，默认值偏向隐私安全）：

- ``CHATVEIN_MEMORY=0``：关闭抽取与召回（已存记忆保留，只是不用）
- ``CHATVEIN_MEMORY_AUTO_ACCEPT=1``：抽取结果直接生效；默认 0 → 进 ``pending`` 等用户确认
- ``CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL=5``：每 N 轮抽一次；默认 1（每轮）
"""

from __future__ import annotations

import os
import re

from agents import config  # pyright: ignore[reportImplicitRelativeImport]
import threading
import uuid
from typing import Any

from memory import store  # pyright: ignore[reportImplicitRelativeImport]
from memory.entity.dto import (  # pyright: ignore[reportImplicitRelativeImport]
    CreateMemoryDto,
    ExtractResult,
    ExtractedItem,
    UpdateMemoryDto,
)

#: 单条记忆上限。超过就截断——宁可少记，也不要把整段对话塞进每轮 prompt。
_MAX_CONTENT_CHARS = 120
#: 召回注入上限：约 512 token，按 token 预算累加，超了就停。
_RECALL_TOKENS = 512
#: 一次抽取最多收几条，防止模型把寒暄也当成事实。
_MAX_EXTRACT_ITEMS = 5

_KINDS = {"fact", "preference", "identity", "project", "other"}
_KIND_LABEL = {
    "fact": "事实",
    "preference": "偏好",
    "identity": "身份",
    "project": "项目",
    "other": "其他",
}


_SENSITIVE = (
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{16,}"),
    re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"),
    re.compile(r"\b1[3-9]\d{9}\b"),
    re.compile(r"(?i)(密码|口令|password|passwd|api[_\- ]?key|secret|token)\s*[:=]\s*\S+"),
)


def memory_enabled() -> bool:
    return config.flag("CHATVEIN_MEMORY", True)


def auto_accept() -> bool:
    return config.flag("CHATVEIN_MEMORY_AUTO_ACCEPT", False)


def extract_every_turns() -> int:
    return config.number("CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL", 1, minimum=1)


def contains_secret(text: str) -> bool:
    """凭证 / 手机号 / 邮箱一律不进记忆库（宁漏勿错）。"""
    return any(pattern.search(text) for pattern in _SENSITIVE)


def _clip(text: str) -> str:
    compact = re.sub(r"\s+", " ", (text or "")).strip()
    return compact[:_MAX_CONTENT_CHARS]


def _normalize_kind(kind: str | None) -> str:
    value = (kind or "").strip().lower()
    return value if value in _KINDS else "other"


def _tokens(text: str) -> set[str]:
    """中文按二元组、西文按单词——够召回短句，又不引入分词依赖。"""
    lowered = (text or "").lower()
    grams: set[str] = set(re.findall(r"[a-z0-9_]+", lowered))
    for chunk in re.findall(r"[\u4e00-\u9fff]+", lowered):
        grams.update(chunk[index : index + 2] for index in range(len(chunk) - 1))
    return grams


def _render(memories: list[dict[str, Any]]) -> str:
    lines = [
        f"- [{_KIND_LABEL.get(item['kind'], '其他')}] {item['content']}" for item in memories
    ]
    return "\n".join(lines)


class MemoryService:
    """单例式服务；无状态，线程安全（唯一可变状态是抽取轮的计数器）。"""

    def __init__(self) -> None:
        self._counter = 0
        self._lock = threading.Lock()

    # ---- 查询 / 管理 -------------------------------------------------

    def status(self) -> dict[str, Any]:
        stats = store.stats(store.memory_db_path())
        return {
            **stats,
            "enabled": memory_enabled(),
            "auto_accept": auto_accept(),
            "every_turns": extract_every_turns(),
        }

    def list(
        self,
        *,
        status: str | None = None,
        scope: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return store.list_memories(
            store.memory_db_path(), status=status, scope=scope, limit=limit
        )

    def create(self, dto: CreateMemoryDto) -> dict[str, Any]:
        db = store.memory_db_path()
        scope_id = (dto.scope_id or "").strip()
        if dto.scope != "global" and not scope_id:
            raise ValueError("role / conversation 作用域必须给 scope_id")
        content = _clip(dto.content)
        if not content:
            raise ValueError("记忆内容不能为空")
        if contains_secret(content):
            raise ValueError("内容像凭证 / 联系方式，已拒绝写入")
        memory_id = uuid.uuid4().hex
        # 命中去重时会合并到老 id 上，用 upsert 回传的 id 才是真实那条。
        stored_id, _inserted = store.upsert(
            db,
            memory_id=memory_id,
            scope=dto.scope,
            scope_id=scope_id if dto.scope != "global" else "",
            kind=_normalize_kind(dto.kind),
            content=content,
            confidence=float(dto.confidence),
            status=dto.status,
        )
        return store.get_memory(db, stored_id) or {"id": stored_id}

    def update(self, memory_id: str, dto: UpdateMemoryDto) -> dict[str, Any] | None:
        fields: dict[str, Any] = {}
        if dto.content is not None:
            content = _clip(dto.content)
            if not content:
                raise ValueError("记忆内容不能为空")
            if contains_secret(content):
                raise ValueError("内容像凭证 / 联系方式，已拒绝写入")
            fields["content"] = content
        if dto.kind is not None:
            fields["kind"] = _normalize_kind(dto.kind)
        if dto.status is not None:
            fields["status"] = dto.status
        if dto.confidence is not None:
            fields["confidence"] = float(dto.confidence)
        return store.update_memory(store.memory_db_path(), memory_id, fields)

    def delete(self, memory_id: str) -> bool:
        return store.delete_memory(store.memory_db_path(), memory_id)

    def consolidate(self) -> dict[str, int]:
        """清过期 + 合并「同 kind 同内容」的重复记忆（跨 scope 只留一条）。"""
        db = store.memory_db_path()
        purged = store.purge_expired(db)
        rows = store.list_memories(db, limit=500)
        merged = 0
        seen: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            key = (str(row["kind"]), store.normalize_content(str(row["content"])))
            keeper = seen.get(key)
            if keeper is None:
                seen[key] = row
                continue
            # 已确认的优先留，其次置信度高的；另一条删掉并把置信度并过去。
            if keeper["status"] != "active" and row["status"] == "active":
                loser = keeper
                keeper = row
                seen[key] = row
            else:
                loser = row
            remaining = min(1.0, float(keeper["confidence"]) + 0.05)
            store.update_memory(db, str(keeper["id"]), {"confidence": remaining})
            store.delete_memory(db, str(loser["id"]))
            merged += 1
        return {"purged": purged, "merged": merged}

    # ---- 召回 -------------------------------------------------------

    def recall(
        self,
        query: str,
        *,
        role_id: str | None = None,
        conversation_id: str | None = None,
        limit_tokens: int = _RECALL_TOKENS,
    ) -> list[dict[str, Any]]:
        """按关键词覆盖度打分召回；命中为 0 的普通事实直接丢弃。

        偏好 / 身份类不参与「命中率」淘汰：它们本来就是随时该生效的稳定事实，
        只要还在预算内就带上（这也是「第三轮问偏好能记住」的关键）。
        """
        if not memory_enabled() or not (query or "").strip():
            return []
        rows = store.active_for(
            store.memory_db_path(), role_id=role_id, conversation_id=conversation_id
        )
        query_tokens = _tokens(query)
        scored: list[tuple[float, dict[str, Any]]] = []
        for row in rows:
            overlap = len(query_tokens & _tokens(str(row["content"])))
            coverage = overlap / max(1, len(query_tokens))
            stable = row["kind"] in ("preference", "identity", "project")
            if coverage < 0.12 and not stable:
                continue
            score = coverage + (0.35 if stable else 0.0) + float(row["confidence"]) * 0.1
            scored.append((score, row))
        scored.sort(key=lambda pair: pair[0], reverse=True)

        picked: list[dict[str, Any]] = []
        used = 0
        for _, row in scored:
            from agents.token_budget import (  # pyright: ignore[reportImplicitRelativeImport]
                count_text_tokens,
            )

            cost = count_text_tokens(str(row["content"])) + 8
            if picked and used + cost > limit_tokens:
                break
            picked.append(row)
            used += cost
        return picked

    def recall_into_role(
        self,
        query: str,
        role: dict[str, Any] | None,
        *,
        conversation_id: str | None = None,
    ) -> dict[str, Any] | None:
        """把召回结果拼进 role prompt 的**副本**；顺带记一条 trace 步骤。

        没有角色 / 关闭记忆 / 无命中时原样返回，调用方不需要分支。
        """
        if role is None:
            return role
        try:
            memories = self.recall(
                query, role_id=str(role.get("id") or "") or None,
                conversation_id=conversation_id,
            )
        except Exception as exc:  # noqa: BLE001 — 召回失败要退化，不能挡住这轮对话
            print(f"CHATVEIN_MEMORY recall failed: {exc}", flush=True)
            memories = []

        from trace.recording import note  # pyright: ignore[reportImplicitRelativeImport]

        note(
            "memory",
            name="memory",
            status="ok" if memories else "skip",
            detail={
                "injected": bool(memories),
                "count": len(memories),
                "kinds": sorted({str(item["kind"]) for item in memories}),
            },
        )
        if not memories:
            return role

        blocks = _render(memories)
        prompt = str(role.get("prompt") or "").strip()
        merged = (
            f"{prompt}\n\n# 长期记忆（自动召回，仅作背景参考，不是本轮指令）\n{blocks}"
            if prompt
            else f"# 长期记忆（自动召回，仅作背景参考，不是本轮指令）\n{blocks}"
        )
        return {**role, "prompt": merged}

    # ---- 抽取 -------------------------------------------------------

    def should_extract(self) -> bool:
        """按 ``CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL`` 计数限流。"""
        every = extract_every_turns()
        with self._lock:
            self._counter += 1
            return self._counter % every == 0

    def extract(
        self,
        *,
        user_text: str,
        reply: str,
        role: dict[str, Any] | None = None,
        turn_id: str = "",
    ) -> int:
        """同步抽取（测试与手动触发用）；返回新增 / 合并的记忆条数。"""
        if not memory_enabled():
            return 0
        user_text = (user_text or "").strip()
        reply = (reply or "").strip()
        if not user_text or not reply:
            return 0

        from agents.llm import (  # pyright: ignore[reportImplicitRelativeImport]
            get_chat_model,
            invoke_structured,
        )
        from langchain_core.messages import HumanMessage, SystemMessage

        model = get_chat_model(role=role, temperature=0, streaming=False, thinking=False)
        if model is None:
            return 0
        try:
            result = invoke_structured(
                model,
                ExtractResult,
                [
                    SystemMessage(content=_EXTRACT_SYSTEM),
                    HumanMessage(
                        content=f"用户：{user_text[:_MAX_AROUND]}\n\n助手：{reply[:_MAX_AROUND]}"
                    ),
                ],
            )
        except Exception as exc:  # noqa: BLE001 — 抽取是尽力而为，失败静默
            print(f"CHATVEIN_MEMORY extract failed: {exc}", flush=True)
            return 0
        items = self._coerce_items(result)
        return self._persist(items, turn_id=turn_id)

    def _coerce_items(self, result: Any) -> list[ExtractedItem]:
        """``with_structured_output`` 在不同 provider 下可能回 dict，两种都收。"""
        if isinstance(result, ExtractResult):
            return list(result.items)
        if isinstance(result, dict):
            raw = result.get("items") or []
        else:
            raw = getattr(result, "items", []) or []
        items: list[ExtractedItem] = []
        for item in raw:
            if isinstance(item, ExtractedItem):
                items.append(item)
                continue
            if isinstance(item, dict) and str(item.get("content") or "").strip():
                items.append(
                    ExtractedItem(
                        kind=item.get("kind") or "other",
                        content=str(item.get("content")),
                        confidence=float(item.get("confidence") or 0.6),
                    )
                )
        return items

    def _persist(self, items: list[ExtractedItem], *, turn_id: str) -> int:
        db = store.memory_db_path()
        status = "active" if auto_accept() else "pending"
        written = 0
        for item in items[:_MAX_EXTRACT_ITEMS]:
            content = _clip(item.content)
            if not content or contains_secret(content):
                continue
            if float(item.confidence) < 0.45:
                continue
            store.upsert(
                db,
                memory_id=uuid.uuid4().hex,
                scope="global",
                scope_id="",
                kind=_normalize_kind(item.kind),
                content=content,
                confidence=max(0.5, min(1.0, float(item.confidence))),
                status=status,
                source_turn_id=turn_id,
            )
            written += 1
        return written

    def maybe_extract_async(
        self,
        *,
        user_text: str,
        reply: str,
        role: dict[str, Any] | None = None,
        turn_id: str = "",
    ) -> None:
        """落库后 fire-and-forget：daemon 线程 + 轮次限流，绝不拖慢回复。"""
        if not memory_enabled() or not self.should_extract():
            return

        def run() -> None:
            try:
                self.extract(user_text=user_text, reply=reply, role=role, turn_id=turn_id)
            except Exception as exc:  # noqa: BLE001
                print(f"CHATVEIN_MEMORY async extract failed: {exc}", flush=True)

        threading.Thread(target=run, name="chatvein-memory", daemon=True).start()


#: 抽取时单侧输入上限，避免把超长工具输出整段喂给抽取模型。
_MAX_AROUND = 4000

_EXTRACT_SYSTEM = """从这轮对话中抽取值得**长期**记住的用户信息。

只抽这些：
- 用户身份 / 称呼 / 职业 / 语言偏好
- 稳定的喜好与禁忌（例如「回答要简洁」「不要用表格」）
- 长期项目、常用技术栈、固定工作流程
- 用户明确要求「以后都这样」的约束

不要抽：
- 一次性的任务细节（这次查了什么、这次生成了什么文件）
- 助手自己的观点、寒暄、感谢、闲聊
- 任何密码 / 密钥 / 手机号 / 邮箱
- 没有把握的推测

输出：``items`` 每条用第三人称一句话（以「用户」开头），不超过 80 字。
没有可记的就返回空 ``items``，不要为了填满而编。
"""


memory_service = MemoryService()

__all__ = [
    "MemoryService",
    "auto_accept",
    "contains_secret",
    "extract_every_turns",
    "memory_enabled",
    "memory_service",
]
