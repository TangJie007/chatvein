"""ReAct 超时线程须继承会话沙箱 ContextVar。"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from mcps.sandbox import (
    create_conversation_dir,
    current_sandbox,
    use_conversation_sandbox,
)


def test_thread_pool_inherits_sandbox_via_copy_context() -> None:
    import contextvars

    name = create_conversation_dir()
    with use_conversation_sandbox(name):
        expected = current_sandbox().resolve()
        ctx = contextvars.copy_context()

        def read_root():
            return current_sandbox().resolve()

        with ThreadPoolExecutor(max_workers=1) as pool:
            # 不拷贝上下文 → 工人线程看不到会话根
            bare = pool.submit(read_root)
            try:
                bare.result(timeout=2)
                lost = False
            except Exception as exc:  # noqa: BLE001
                lost = "会话工作区" in str(exc)
            assert lost

            kept = pool.submit(ctx.run, read_root).result(timeout=2)
            assert kept == expected
