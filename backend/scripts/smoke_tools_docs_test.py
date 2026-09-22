"""Smoke: 直接调用工具（不经 LLM），覆盖 docs/test 里 FS / 沙箱冒烟路径。"""

from __future__ import annotations

from pathlib import Path

from mcps.sandbox import create_conversation_dir, current_sandbox, use_conversation_sandbox
from mcps.tools.fs import (
    create_directory,
    delete_path,
    list_directory,
    read_text_file,
    write_file,
)
from mcps.tools.sandbox import (
    sandbox_create_venv,
    sandbox_info,
    sandbox_run_python,
)


def main() -> None:
    name = create_conversation_dir()
    ok: list[str] = []
    with use_conversation_sandbox(name):
        root = current_sandbox()
        print(f"session={root}")

        # FS-01
        r = write_file.invoke({"path": "output/hello.txt", "content": "你好"})
        assert str(r).startswith("Successfully"), r
        assert (root / "output" / "hello.txt").read_text(encoding="utf-8") == "你好"
        ok.append("FS-01 write_file")

        # FS-02
        text = read_text_file.invoke({"path": "output/hello.txt"})
        assert "你好" in str(text), text
        ok.append("FS-02 read_text_file")

        # FS-03
        listing = list_directory.invoke({"path": "output"})
        assert "hello.txt" in str(listing), listing
        ok.append("FS-03 list_directory")

        # FS-04
        create_directory.invoke({"path": "output/notes"})
        write_file.invoke({"path": "output/notes/readme.md", "content": "笔记"})
        assert (root / "output" / "notes" / "readme.md").is_file()
        ok.append("FS-04 create_directory+write")

        # FS-10
        delete_path.invoke({"path": "output/notes/readme.md"})
        assert not (root / "output" / "notes" / "readme.md").exists()
        ok.append("FS-10 delete_path")

        # SB-01 / SB-02 / SB-03
        info = sandbox_info.invoke({})
        assert "runs=" in str(info), info
        ok.append("SB-01 sandbox_info")

        created = sandbox_create_venv.invoke({})
        assert "虚拟环境" in str(created), created
        ok.append("SB-02a create_venv")

        ran = sandbox_run_python.invoke(
            {
                "path": "sum10.py",
                "code": "print(sum(range(1, 11)))\n",
                "timeout_seconds": 60,
            }
        )
        assert "exit=0" in str(ran) and "55" in str(ran), ran
        ok.append("SB-02b run_python sum")

        wrote = sandbox_run_python.invoke(
            {
                "path": "write_out.py",
                "code": (
                    "from pathlib import Path\n"
                    "Path('output/from_py.txt').write_text('沙箱你好', encoding='utf-8')\n"
                    "print('ok')\n"
                ),
                "timeout_seconds": 60,
            }
        )
        assert "exit=0" in str(wrote), wrote
        assert (root / "output" / "from_py.txt").read_text(encoding="utf-8") == "沙箱你好"
        assert not (root / "runs" / "output" / "from_py.txt").exists()
        ok.append("SB-03 write to output/")

    print("PASS", len(ok))
    for item in ok:
        print(" ", item)


if __name__ == "__main__":
    main()
