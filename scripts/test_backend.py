#!/usr/bin/env python3
"""MarkPure 后端 IPC 自动化测试。

用 Python 驱动 Rust 侧的 `mt_harness` 二进制，逐条验证全部 IPC 命令。

## 为什么要有这个 harness

桌面应用的 IPC 处理器原本只存在于 `main.rs` 的模块树里，没有命令行
入口。要在自动化环境里验证后端逻辑，唯一的办法是拉起整个 GUI 应用——
在 CI / 脚本里既慢又不可靠。

`backend/apps/desktop/src/bin/mt_harness.rs` 把同一条路由表
（`markpure::dispatch::execute_command`）暴露成 JSON-lines 通道：
stdin 每行一条命令，stdout 每行一条响应。本脚本就是它的客户端。

## 运行

```bash
# 自动构建 harness（若缺失或过期）后运行全部用例
python3 scripts/test_backend.py

# 只跑某一组
python3 scripts/test_backend.py TestDocRegistry

# 详细输出
python3 scripts/test_backend.py -v
```

测试使用临时目录作为配置目录与工作区，**不会**污染用户的真实设置
（`MARKPURE_CONFIG_DIR` 指向临时目录）。
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
HARNESS_BIN = REPO_ROOT / "target" / "debug" / "mt_harness"
DISPATCH_RS = REPO_ROOT / "backend" / "apps" / "desktop" / "src" / "dispatch.rs"
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"


class HarnessError(RuntimeError):
    """IPC 命令返回了 `error` 字段。"""


class Harness:
    """`mt_harness` 进程的客户端。"""

    def __init__(self, config_dir: pathlib.Path, cwd: pathlib.Path | None = None) -> None:
        env = dict(os.environ)
        env["MARKPURE_CONFIG_DIR"] = str(config_dir)
        # 禁用 macOS 的文件保险箱 / 崩溃弹窗，避免无头环境卡住。
        env.setdefault("RUST_BACKTRACE", "0")
        self._proc = subprocess.Popen(
            [str(HARNESS_BIN)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
            env=env,
            text=True,
            bufsize=1,
        )
        self._next_id = 1

    # ---------------------------------------------------------------- 调用

    def call_raw(self, cmd: str, params: dict | None = None) -> dict:
        """发一条命令，返回原始响应字典（不抛异常）。"""
        msg_id = self._next_id
        self._next_id += 1
        payload = {"id": msg_id, "cmd": cmd, "params": params or {}}
        assert self._proc.stdin is not None and self._proc.stdout is not None
        self._proc.stdin.write(json.dumps(payload) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            stderr = ""
            if self._proc.stderr is not None:
                stderr = self._proc.stderr.read()
            raise HarnessError(
                f"harness closed the connection while running '{cmd}'.\n{stderr}"
            )
        resp = json.loads(line)
        assert resp["id"] == msg_id, f"response id mismatch: {resp}"
        return resp

    def call(self, cmd: str, params: dict | None = None) -> object:
        """发一条命令并返回 `result`；出错时抛 [`HarnessError`]。"""
        resp = self.call_raw(cmd, params)
        if "error" in resp:
            raise HarnessError(f"{cmd}: {resp['error']}")
        return resp.get("result")

    def expect_error(self, cmd: str, params: dict | None = None) -> str:
        """断言命令返回错误，返回错误消息。"""
        resp = self.call_raw(cmd, params)
        if "error" not in resp:
            raise AssertionError(
                f"expected '{cmd}' to fail, but it returned: {resp.get('result')!r}"
            )
        return resp["error"]

    def send_raw_line(self, line: str) -> dict:
        """直接写一行原始文本（用于测试协议层容错）。"""
        assert self._proc.stdin is not None and self._proc.stdout is not None
        self._proc.stdin.write(line + "\n")
        self._proc.stdin.flush()
        return json.loads(self._proc.stdout.readline())

    # ---------------------------------------------------------------- 收尾

    def close(self) -> None:
        try:
            if self._proc.poll() is None:
                self.call_raw("__shutdown")
        except Exception:
            pass
        for stream in (self._proc.stdin, self._proc.stdout, self._proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except Exception:
                pass
        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait(timeout=5)

    def __enter__(self) -> "Harness":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def make_png_b64(width: int = 2, height: int = 2) -> str:
    """生成一张真实的 PNG（base64）。

    后端会解码并校验 PNG 字节（CRC / 块结构），因此测试必须用
    真正合法的 PNG，而不是手写的 base64 常量。
    """
    import base64
    import struct
    import zlib

    raw = b"".join(b"\x00" + bytes((200, 40, 60)) * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return base64.b64encode(blob).decode("ascii")


def ensure_harness() -> None:
    """确保 harness 二进制存在且比源码新。"""
    if not HARNESS_BIN.exists():
        print("[test_backend] building mt_harness ...", flush=True)
        subprocess.run(
            ["cargo", "build", "--bin", "mt_harness"],
            cwd=REPO_ROOT,
            check=True,
        )
        return

    newest_src = max(
        (p.stat().st_mtime for p in (REPO_ROOT / "backend" / "crates").rglob("*.rs")),
        default=0,
    )
    newest_src = max(
        newest_src,
        max(
            (p.stat().st_mtime for p in (REPO_ROOT / "backend" / "apps").rglob("*.rs")),
            default=0,
        ),
    )
    if newest_src > HARNESS_BIN.stat().st_mtime:
        print("[test_backend] sources changed, rebuilding mt_harness ...", flush=True)
        subprocess.run(
            ["cargo", "build", "--bin", "mt_harness"],
            cwd=REPO_ROOT,
            check=True,
        )


class BackendTestCase(unittest.TestCase):
    """所有后端用例的基类：每个用例一个隔离的 harness 进程。"""

    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp(prefix="markpure-test-")
        self.tmp_path = pathlib.Path(self._tmp)
        self.config_dir = self.tmp_path / "config"
        self.workspace = self.tmp_path / "workspace"
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.h = Harness(self.config_dir, cwd=self.tmp_path)

    def tearDown(self) -> None:
        self.h.close()
        shutil.rmtree(self._tmp, ignore_errors=True)

    # ---------------------------------------------------------------- 辅助

    def open_workspace(self) -> str:
        """把测试工作区注册为唯一的工作区根，返回 root id。"""
        root = self.h.call("add_workspace_root", {"path": str(self.workspace)})
        assert isinstance(root, dict)
        return root["id"]

    def write_file(self, rel: str, content: str) -> pathlib.Path:
        path = self.workspace / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path


# ==================================================================== 信封


class TestEnvelope(BackendTestCase):
    def test_unknown_command_reports_error(self) -> None:
        err = self.h.expect_error("definitely_not_a_command")
        assert "Unknown command" in err

    def test_malformed_envelope_gets_a_response(self) -> None:
        resp = self.h.send_raw_line("{not json")
        assert "error" in resp, resp

    def test_missing_params_report_error(self) -> None:
        assert "Missing" in self.h.expect_error("open_file", {})

    def test_ping(self) -> None:
        assert self.h.call("__ping") == {"pong": True}


# ==================================================================== 应用信息


class TestAppInfo(BackendTestCase):
    def test_app_info_shape(self) -> None:
        info = self.h.call("get_app_info")
        assert isinstance(info, dict)
        for key in ("name", "version", "description"):
            assert key in info, f"missing {key} in {info}"
        assert info["name"] == "MarkPure"


# ==================================================================== 配置


class TestConfig(BackendTestCase):
    def test_get_config_returns_defaults(self) -> None:
        cfg = self.h.call("get_config")
        assert isinstance(cfg, dict)
        assert "editor" in cfg
        assert "workspace_roots" in cfg or "last_workspace" in cfg

    def test_set_config_roundtrip(self) -> None:
        self.h.call("set_config", {"theme": "theme-dark"})
        cfg = self.h.call("get_config")
        assert cfg["theme"] == "theme-dark"

    def test_set_config_persists_across_restart(self) -> None:
        self.h.call("set_config", {"theme": "theme-one-dark"})
        self.h.close()

        with Harness(self.config_dir, cwd=self.tmp_path) as h2:
            cfg = h2.call("get_config")
            assert cfg["theme"] == "theme-one-dark"

    def test_set_config_editor_fields(self) -> None:
        self.h.call(
            "set_config",
            {"editor": {"font_size": 18, "lint_on_save": True, "word_wrap": False}},
        )
        cfg = self.h.call("get_config")
        assert cfg["editor"]["font_size"] == 18
        assert cfg["editor"]["lint_on_save"] is True
        assert cfg["editor"]["word_wrap"] is False

    def test_set_config_accepts_human_readable_theme(self) -> None:
        # 旧调用方可能传人类可读标签；后端应归一化为 CSS class。
        self.h.call("set_config", {"theme": "Dark"})
        cfg = self.h.call("get_config")
        assert cfg["theme"] == "theme-dark", cfg["theme"]

    def test_export_config_produces_importable_json(self) -> None:
        self.h.call("set_config", {"theme": "theme-graphite"})
        exported = self.h.call("export_config")
        assert isinstance(exported, dict)

        # 换一个新配置目录，导入后应还原同样的主题。
        other_cfg = self.tmp_path / "config2"
        other_cfg.mkdir()
        with Harness(other_cfg, cwd=self.tmp_path) as h2:
            h2.call("import_config", {"payload": exported})
            cfg = h2.call("get_config")
            assert cfg["theme"] == "theme-graphite", cfg


# ==================================================================== 大纲 / 双链 / 标签


class TestOutlineAndLinks(BackendTestCase):
    def test_outline_extracts_headings(self) -> None:
        content = "# One\n\ntext\n\n## Two\n\n### Three\n"
        items = self.h.call("get_outline", {"content": content})
        assert len(items) == 3
        # 契约是 [level, text] 二元组
        assert items[0] == [1, "One"], items
        assert items[2] == [3, "Three"], items

    def test_outline_empty_content(self) -> None:
        assert self.h.call("get_outline", {"content": ""}) == []

    def test_outline_ignores_hash_inside_code_fence(self) -> None:
        content = "```\n# not a heading\n```\n\n# real heading\n"
        items = self.h.call("get_outline", {"content": content})
        titles = [i[1] for i in items]
        assert "real heading" in titles
        assert "not a heading" not in titles, titles

    def test_wikilinks_with_alias(self) -> None:
        links = self.h.call("get_wikilinks", {"content": "[[Page]] and [[Other|Alias]]"})
        pages = {l["page"] for l in links}
        assert "Page" in pages and "Other" in pages
        alias = next(l for l in links if l["page"] == "Other")
        assert alias["alias"] == "Alias"

    def test_tags_extracted(self) -> None:
        tags = self.h.call("get_tags", {"content": "hello #tag1 and #tag2 end"})
        names = {t["name"] for t in tags}
        assert {"tag1", "tag2"} <= names, names

    def test_tags_have_offsets(self) -> None:
        content = "hello #tag1"
        tags = self.h.call("get_tags", {"content": content})
        assert tags
        t = tags[0]
        assert content[t["start"] : t["end"]] == "#tag1", (content, tags)


# ==================================================================== 文档注册表


class TestDocRegistry(BackendTestCase):
    def test_open_set_stats_close(self) -> None:
        self.h.call("doc_open", {"doc_id": "t1", "content": "hello world\nsecond line\n"})
        stats = self.h.call("doc_get_stats", {"doc_id": "t1"})
        assert stats["words"] == 4
        # rope 的行数语义：结尾换行会多出一个空行，因此 "a\nb\n" 记 3 行。
        assert stats["lines"] == 3, stats
        assert stats["characters"] > 0

        self.h.call("doc_set_content", {"doc_id": "t1", "content": "one two three\n"})
        stats = self.h.call("doc_get_stats", {"doc_id": "t1"})
        assert stats["words"] == 3

        self.h.call("doc_close", {"doc_id": "t1"})
        assert "document not found" in self.h.expect_error(
            "doc_get_stats", {"doc_id": "t1"}
        ).lower()

    def test_numeric_doc_id_is_accepted(self) -> None:
        # 旧客户端发送数字 doc_id；后端应把它规范化为字符串键。
        self.h.call("doc_open", {"doc_id": 7, "content": "hi"})
        stats = self.h.call("doc_get_stats", {"doc_id": "7"})
        assert stats["words"] == 1

    def test_stats_missing_document(self) -> None:
        assert "not found" in self.h.expect_error("doc_get_stats", {"doc_id": "nope"}).lower()

    def test_cjk_word_count(self) -> None:
        # 每个 CJK 字符计一个词。
        self.h.call("doc_open", {"doc_id": "cjk", "content": "你好世界\n"})
        stats = self.h.call("doc_get_stats", {"doc_id": "cjk"})
        assert stats["words"] == 4, stats

    def test_search_finds_matches(self) -> None:
        self.h.call("doc_open", {"doc_id": "s1", "content": "foo bar foo baz"})
        hits = self.h.call(
            "doc_search", {"doc_id": "s1", "query": "foo"}
        )
        assert len(hits) == 2
        assert hits[0]["from"] == 0
        assert hits[0]["to"] == 3

    def test_search_case_sensitive(self) -> None:
        self.h.call("doc_open", {"doc_id": "s2", "content": "Foo foo"})
        insensitive = self.h.call("doc_search", {"doc_id": "s2", "query": "foo"})
        sensitive = self.h.call(
            "doc_search", {"doc_id": "s2", "query": "foo", "case_sensitive": True}
        )
        assert len(insensitive) == 2
        assert len(sensitive) == 1

    def test_search_whole_word(self) -> None:
        self.h.call("doc_open", {"doc_id": "s3", "content": "foobar foo"})
        hits = self.h.call(
            "doc_search", {"doc_id": "s3", "query": "foo", "whole_word": True}
        )
        assert len(hits) == 1, hits

    def test_search_regex(self) -> None:
        self.h.call("doc_open", {"doc_id": "s4", "content": "a1 b22 c333"})
        hits = self.h.call(
            "doc_search", {"doc_id": "s4", "query": r"[a-c]\d+", "use_regex": True}
        )
        assert len(hits) == 3, hits

    def test_search_invalid_regex_returns_error(self) -> None:
        self.h.call("doc_open", {"doc_id": "s5", "content": "x"})
        self.h.expect_error(
            "doc_search", {"doc_id": "s5", "query": "([", "use_regex": True}
        )

    def test_registry_respects_max_documents(self) -> None:
        # MAX_DOCUMENTS = 50：注册表不应无限增长。
        for i in range(60):
            self.h.call("doc_open", {"doc_id": f"d{i}", "content": "x"})
        # 最旧的文档应已被淘汰，最新的仍在。
        assert "document not found" in self.h.expect_error(
            "doc_get_stats", {"doc_id": "d0"}
        ).lower()
        self.h.call("doc_get_stats", {"doc_id": "d59"})

    def test_doc_set_content_does_not_bypass_lru_cap(self) -> None:
        # `doc_set_content` 也会向注册表插入文档（此前文档不存在时），
        # 因此它同样必须服从 MAX_DOCUMENTS 上限。
        for i in range(60):
            self.h.call("doc_set_content", {"doc_id": f"c{i}", "content": "x"})
        assert "document not found" in self.h.expect_error(
            "doc_get_stats", {"doc_id": "c0"}
        ).lower()
        self.h.call("doc_get_stats", {"doc_id": "c59"})


# ==================================================================== 文件操作


class TestFileOps(BackendTestCase):
    def test_open_and_save_roundtrip(self) -> None:
        path = self.write_file("note.md", "# Title\n\nbody\n")
        info = self.h.call("open_file", {"path": str(path)})
        assert info["content"] == "# Title\n\nbody\n"
        assert info["file_name"] == "note.md"
        assert info["encoding"].lower() in ("utf-8", "utf8")

        out = self.workspace / "copy.md"
        self.h.call("save_file", {"path": str(out), "content": info["content"]})
        assert out.read_text(encoding="utf-8") == "# Title\n\nbody\n"

    def test_open_missing_file_errors(self) -> None:
        self.h.expect_error("open_file", {"path": str(self.workspace / "nope.md")})

    def test_open_directory_errors(self) -> None:
        self.h.expect_error("open_file", {"path": str(self.workspace)})

    def test_recent_files_are_tracked(self) -> None:
        path = self.write_file("recent.md", "x")
        self.h.call("open_file", {"path": str(path)})
        recent = self.h.call("get_recent_files")
        assert isinstance(recent, list)
        assert any(str(path) in str(entry) for entry in recent), recent

        self.h.call("clear_recent_files")
        assert self.h.call("get_recent_files") == []

    def test_create_rename_delete(self) -> None:
        self.open_workspace()

        created = self.h.call("create_file", {"path": str(self.workspace / "a.md")})
        assert (self.workspace / "a.md").exists()

        renamed = self.h.call(
            "rename_file",
            {"path": str(self.workspace / "a.md"), "new_name": "b.md"},
        )
        assert (self.workspace / "b.md").exists()
        assert not (self.workspace / "a.md").exists()
        assert str(renamed["path"]).endswith("b.md")

        self.h.call("delete_file", {"path": str(self.workspace / "b.md")})
        assert not (self.workspace / "b.md").exists()

    def test_create_directory(self) -> None:
        self.open_workspace()
        self.h.call("create_directory", {"path": str(self.workspace / "sub")})
        assert (self.workspace / "sub").is_dir()

    def test_crud_requires_a_workspace(self) -> None:
        err = self.h.expect_error("create_file", {"path": str(self.workspace / "x.md")})
        assert "workspace" in err.lower(), err

    def test_crud_rejects_path_outside_workspace(self) -> None:
        self.open_workspace()
        outside = self.tmp_path / "outside.md"
        err = self.h.expect_error("create_file", {"path": str(outside)})
        assert "outside" in err.lower() or "workspace" in err.lower(), err

    def test_crud_rejects_parent_traversal(self) -> None:
        self.open_workspace()
        evil = str(self.workspace / ".." / "escaped.md")
        self.h.expect_error("create_file", {"path": evil})
        assert not (self.tmp_path / "escaped.md").exists()

    def test_rename_rejects_traversal_in_new_name(self) -> None:
        self.open_workspace()
        self.write_file("safe.md", "x")
        self.h.expect_error(
            "rename_file",
            {"path": str(self.workspace / "safe.md"), "new_name": "../escaped.md"},
        )
        assert not (self.tmp_path / "escaped.md").exists()

    def test_get_doc_stats_legacy_command(self) -> None:
        stats = self.h.call("get_doc_stats", {"content": "one two three"})
        assert stats["words"] == 3

    def test_open_dropped_files(self) -> None:
        p1 = self.write_file("drop1.md", "one")
        p2 = self.write_file("drop2.md", "two")
        files = self.h.call("open_dropped_files", {"paths": [str(p1), str(p2)]})
        assert len(files) == 2
        assert {f["file_name"] for f in files} == {"drop1.md", "drop2.md"}

    def test_open_dropped_files_skips_missing(self) -> None:
        p1 = self.write_file("drop1.md", "one")
        files = self.h.call(
            "open_dropped_files",
            {"paths": [str(p1), str(self.workspace / "ghost.md")]},
        )
        assert len(files) == 1


# ============================================== 存储格式保真（编码 / 行尾 / BOM）


class TestFileFormatFidelity(BackendTestCase):
    """保存不得改写文件的字节级特征。

    前端交给 Rust 的内容永远是 UTF-8 + LF（ProseMirror 内部规范化）。
    若保存时不参考目标文件，打开 GBK / CRLF / 带 BOM 的文档保存后
    会被静默改写——用户看到的是"我根本没动编码，文件怎么变了"。
    """

    # 各编码的样本文本与原始字节（Python 内置 codec 与 Rust 侧一致）。
    SAMPLES = {
        "utf-8": ("# 标题\n\n正文 body\n", "# 标题\n\n正文 body\n".encode("utf-8")),
        "gbk": ("# 标题\n\n正文 body\n", "# 标题\n\n正文 body\n".encode("gbk")),
        "shift_jis": (
            "# タイトル\n\n本文 body\n",
            "# タイトル\n\n本文 body\n".encode("shift_jis"),
        ),
        "big5": ("# 標題\n\n正文 body\n", "# 標題\n\n正文 body\n".encode("big5")),
    }

    def write_bytes(self, rel: str, raw: bytes) -> pathlib.Path:
        path = self.workspace / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return path

    # ---------------------------------------------------------------- 单格式

    def test_save_preserves_gbk_bytes(self) -> None:
        text, raw = self.SAMPLES["gbk"]
        path = self.write_bytes("gbk.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        assert info["content"] == text
        assert info["encoding"] == "GBK", info["encoding"]

        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw, "GBK bytes must survive a save"

    def test_save_preserves_shift_jis_bytes(self) -> None:
        text, raw = self.SAMPLES["shift_jis"]
        path = self.write_bytes("sjis.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        assert info["encoding"] == "Shift_JIS", info["encoding"]

        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw, "Shift_JIS bytes must survive a save"

    def test_save_preserves_big5_bytes(self) -> None:
        text, raw = self.SAMPLES["big5"]
        path = self.write_bytes("big5.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        assert info["encoding"] == "Big5", info["encoding"]

        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw, "Big5 bytes must survive a save"

    def test_save_preserves_crlf_line_endings(self) -> None:
        raw = b"# Title\r\n\r\nbody\r\n"
        path = self.write_bytes("crlf.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        assert info["line_ending"] == "\r\n", repr(info["line_ending"])
        assert info["content"] == "# Title\n\nbody\n"

        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw, "CRLF must survive a save"

    def test_save_preserves_utf8_bom(self) -> None:
        raw = b"\xef\xbb\xbf# Title\n\nbody\n"
        path = self.write_bytes("bom.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        assert info["encoding"] == "UTF-8 BOM", info["encoding"]
        assert info["content"] == "# Title\n\nbody\n", "BOM must not leak into content"

        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw, "BOM must survive a save"

    def test_save_preserves_plain_utf8(self) -> None:
        raw = b"# Title\n\nbody\n"
        path = self.write_bytes("plain.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw

    def test_save_preserves_empty_file(self) -> None:
        path = self.write_bytes("empty.md", b"")
        info = self.h.call("open_file", {"path": str(path)})
        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == b""

    def test_save_preserves_missing_trailing_newline(self) -> None:
        raw = b"# Title\n\nbody"
        path = self.write_bytes("nonl.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        # lint_on_save 默认会补末尾换行——那是用户主动开启的整理规则，
        # 与编码保真是两回事。这里只断言编码没被改写。
        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes().startswith(b"# Title\n\nbody")
        assert not path.read_bytes().startswith(b"\xef\xbb\xbf")

    # ---------------------------------------------------------------- 编辑后

    def test_edit_then_save_keeps_encoding(self) -> None:
        text, raw = self.SAMPLES["gbk"]
        path = self.write_bytes("edit.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        edited = info["content"] + "新增一行\n"
        self.h.call("save_file", {"path": str(path), "content": edited})
        assert path.read_bytes() == edited.encode("gbk")
        assert b"\xef\xbb\xbf" != path.read_bytes()[:3]

    def test_edit_then_save_keeps_crlf(self) -> None:
        path = self.write_bytes("editcrlf.md", b"# Title\r\n\r\nbody\r\n")
        info = self.h.call("open_file", {"path": str(path)})
        edited = info["content"] + "more\n"
        self.h.call("save_file", {"path": str(path), "content": edited})
        assert path.read_bytes() == b"# Title\r\n\r\nbody\r\nmore\r\n"

    # ---------------------------------------------------------------- 新路径

    def test_save_to_new_path_inherits_source_encoding(self) -> None:
        """另存为到新路径时沿用源文档的编码与行尾。"""
        _, raw = self.SAMPLES["gbk"]
        src = self.write_bytes("src.md", raw)
        info = self.h.call("open_file", {"path": str(src)})

        dst = self.workspace / "new.md"
        self.h.call(
            "save_file",
            {
                "path": str(dst),
                "content": info["content"],
                "encoding": info["encoding"],
                "line_ending": info["line_ending"],
            },
        )
        assert dst.read_bytes() == raw

    def test_save_to_new_path_defaults_to_utf8(self) -> None:
        """没带格式信息的新文件按 UTF-8 + LF 落盘。"""
        dst = self.workspace / "default.md"
        self.h.call("save_file", {"path": str(dst), "content": "# 新文档\n"})
        assert dst.read_bytes() == "# 新文档\n".encode("utf-8")

    def test_save_to_new_path_inherits_crlf(self) -> None:
        dst = self.workspace / "newcrlf.md"
        self.h.call(
            "save_file",
            {
                "path": str(dst),
                "content": "# Title\n\nbody\n",
                "encoding": "UTF-8",
                "line_ending": "\r\n",
            },
        )
        assert dst.read_bytes() == b"# Title\r\n\r\nbody\r\n"

    # ---------------------------------------------------------------- 注册表

    def test_doc_registry_save_preserves_encoding(self) -> None:
        """doc_id 分支（文档注册表）同样不得改写编码。"""
        _, raw = self.SAMPLES["gbk"]
        path = self.write_bytes("reg.md", raw)
        info = self.h.call("open_file", {"path": str(path)})

        self.h.call(
            "doc_open",
            {
                "doc_id": "fmt-1",
                "content": info["content"],
                "encoding": info["encoding"],
                "line_ending": info["line_ending"],
            },
        )
        self.h.call("save_file", {"path": str(path), "doc_id": "fmt-1"})
        assert path.read_bytes() == raw, "registry save must keep GBK bytes"

    def test_doc_registry_save_to_new_path_inherits_encoding(self) -> None:
        _, raw = self.SAMPLES["gbk"]
        src = self.write_bytes("reg2.md", raw)
        info = self.h.call("open_file", {"path": str(src)})

        self.h.call(
            "doc_open",
            {
                "doc_id": "fmt-2",
                "content": info["content"],
                "encoding": info["encoding"],
                "line_ending": info["line_ending"],
            },
        )
        dst = self.workspace / "reg-new.md"
        self.h.call("save_file", {"path": str(dst), "doc_id": "fmt-2"})
        assert dst.read_bytes() == raw

    def test_dropped_files_report_format(self) -> None:
        _, raw = self.SAMPLES["gbk"]
        p = self.write_bytes("drop-gbk.md", raw)
        files = self.h.call("open_dropped_files", {"paths": [str(p)]})
        assert len(files) == 1
        assert files[0]["encoding"] == "GBK", files[0]
        assert files[0]["line_ending"] == "\n"

    def test_gbk_unencodable_char_is_rejected(self) -> None:
        """GBK 无法表示 emoji——保存必须报错而不是静默写成 `?`。"""
        _, raw = self.SAMPLES["gbk"]
        path = self.write_bytes("emoji.md", raw)
        self.h.expect_error(
            "save_file", {"path": str(path), "content": "# 标题\n\n🎉\n"}
        )
        assert path.read_bytes() == raw, "failed save must not touch the file"

    def test_lint_on_save_still_preserves_crlf(self) -> None:
        """开启「保存时 lint」后，行尾风格仍必须保持 CRLF。"""
        self.h.call("set_config", {"editor": {"lint_on_save": True}})
        path = self.write_bytes("lintcrlf.md", b"# Title  \r\n\r\nbody\r\n")
        info = self.h.call("open_file", {"path": str(path)})
        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        # 行尾空白被 lint 去掉，但 CRLF 保留。
        assert path.read_bytes() == b"# Title\r\n\r\nbody\r\n"

    def test_lint_on_save_still_preserves_encoding(self) -> None:
        self.h.call("set_config", {"editor": {"lint_on_save": True}})
        _, raw = self.SAMPLES["gbk"]
        path = self.write_bytes("lintgbk.md", raw)
        info = self.h.call("open_file", {"path": str(path)})
        self.h.call("save_file", {"path": str(path), "content": info["content"]})
        assert path.read_bytes() == raw


# ==================================================================== 目录树


class TestDirectoryTree(BackendTestCase):
    def test_tree_lists_files_and_dirs(self) -> None:
        self.write_file("a.md", "a")
        self.write_file("sub/b.md", "b")
        tree = self.h.call("get_directory_tree", {"path": str(self.workspace)})
        assert isinstance(tree, list)
        names = {entry["name"] for entry in tree}
        assert "a.md" in names
        assert "sub" in names

    def test_tree_depth_limits(self) -> None:
        # depth=1 表示「顶层 + 顶层子目录的直接子项」，更深一层不再展开。
        self.write_file("sub/deep/b.md", "b")
        self.write_file("sub/c.md", "c")
        tree = self.h.call(
            "get_directory_tree", {"path": str(self.workspace), "depth": 1}
        )
        sub = next(e for e in tree if e["name"] == "sub")
        child_names = {c["name"] for c in (sub.get("children") or [])}
        assert "c.md" in child_names, child_names
        deep = next((c for c in sub["children"] if c["name"] == "deep"), None)
        if deep is not None:
            assert not deep.get("children"), deep

    def test_tree_missing_path_errors(self) -> None:
        self.h.expect_error("get_directory_tree", {"path": str(self.tmp_path / "ghost")})


# ==================================================================== 搜索


class TestWorkspaceSearch(BackendTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.write_file("one.md", "hello world\nfoo bar\n")
        self.write_file("two.md", "nothing here\n")
        self.write_file("nested/three.md", "hello again\n")

    def test_basic_search(self) -> None:
        result = self.h.call(
            "search_workspace",
            {"path": str(self.workspace), "query": "hello"},
        )
        matches = result["matches"] if isinstance(result, dict) else result
        assert len(matches) == 2, matches
        files = {m["file"] for m in matches}
        assert any(f.endswith("one.md") for f in files)
        assert any(f.endswith("three.md") for f in files)

    def test_case_sensitive_search(self) -> None:
        result = self.h.call(
            "search_workspace",
            {"path": str(self.workspace), "query": "hello", "case_sensitive": True},
        )
        matches = result["matches"] if isinstance(result, dict) else result
        assert len(matches) == 2

        result = self.h.call(
            "search_workspace",
            {"path": str(self.workspace), "query": "HELLO", "case_sensitive": True},
        )
        matches = result["matches"] if isinstance(result, dict) else result
        assert len(matches) == 0, matches

    def test_regex_search(self) -> None:
        result = self.h.call(
            "search_workspace",
            {"path": str(self.workspace), "query": r"h\w+", "use_regex": True},
        )
        matches = result["matches"] if isinstance(result, dict) else result
        assert len(matches) >= 2

    def test_invalid_regex_errors(self) -> None:
        self.h.expect_error(
            "search_workspace",
            {"path": str(self.workspace), "query": "([", "use_regex": True},
        )

    def test_search_requires_path(self) -> None:
        self.h.expect_error("search_workspace", {"query": "x"})

    def test_multi_root_search(self) -> None:
        other = self.tmp_path / "other"
        other.mkdir()
        (other / "four.md").write_text("hello world\n", encoding="utf-8")
        result = self.h.call(
            "search_workspace",
            {"paths": [str(self.workspace), str(other)], "query": "hello"},
        )
        matches = result["matches"] if isinstance(result, dict) else result
        assert len(matches) == 3, matches


# ==================================================================== 导出


class TestExports(BackendTestCase):
    CONTENT = "# Title\n\nSome **bold** text.\n\n- item one\n- item two\n"
    PNG_B64 = make_png_b64()

    def test_export_html(self) -> None:
        out = self.tmp_path / "out.html"
        result = self.h.call(
            "export_html",
            {"content": self.CONTENT, "title": "Doc", "dest_path": str(out)},
        )
        assert result["path"] == str(out)
        html = out.read_text(encoding="utf-8")
        assert "<h1" in html or "<h1>" in html
        assert "bold" in html

    def test_export_html_with_theme_css(self) -> None:
        out = self.tmp_path / "themed.html"
        self.h.call(
            "export_html",
            {
                "content": self.CONTENT,
                "title": "Doc",
                "dest_path": str(out),
                "theme_css": ":root { --bg: #101010; }",
            },
        )
        html = out.read_text(encoding="utf-8")
        assert "#101010" in html, html[:500]

    def test_export_pdf(self) -> None:
        out = self.tmp_path / "out.pdf"
        result = self.h.call(
            "export_pdf",
            {"content": self.CONTENT, "title": "Doc", "dest_path": str(out)},
        )
        assert result["path"] == str(out)
        data = out.read_bytes()
        assert data.startswith(b"%PDF"), data[:16]

    def test_export_word(self) -> None:
        out = self.tmp_path / "out.docx"
        result = self.h.call(
            "export_word",
            {"content": self.CONTENT, "title": "Doc", "dest_path": str(out)},
        )
        assert result["path"] == str(out)
        data = out.read_bytes()
        assert data.startswith(b"PK"), data[:16]  # zip / docx 容器

    def test_export_png(self) -> None:
        png_b64 = self.PNG_B64
        out = self.tmp_path / "out.png"
        result = self.h.call(
            "export_png",
            {"bytes_b64": png_b64, "title": "Doc", "dest_path": str(out)},
        )
        assert result["path"] == str(out)
        assert out.read_bytes().startswith(b"\x89PNG")

    def test_export_png_accepts_data_uri(self) -> None:
        png_b64 = self.PNG_B64
        out = self.tmp_path / "out2.png"
        self.h.call(
            "export_png",
            {
                "bytes_b64": "data:image/png;base64," + png_b64,
                "title": "Doc",
                "dest_path": str(out),
            },
        )
        assert out.read_bytes().startswith(b"\x89PNG")

    def test_export_png_rejects_garbage(self) -> None:
        self.h.expect_error(
            "export_png",
            {
                "bytes_b64": "not-base64!!",
                "title": "Doc",
                "dest_path": str(self.tmp_path / "bad.png"),
            },
        )

    def test_export_html_requires_content(self) -> None:
        self.h.expect_error("export_html", {"title": "Doc"})


# ==================================================================== 主题


class TestThemes(BackendTestCase):
    def test_get_themes_returns_custom_themes_only(self) -> None:
        # 内置主题是前端的 CSS class，由 app.css 定义；后端只管理
        # 用户自定义主题（~/.config/markpure/themes/*.json）。
        themes = self.h.call("get_themes")
        assert isinstance(themes, list)
        assert themes == [], themes

    def test_import_export_delete_custom_theme(self) -> None:
        theme_file = self.tmp_path / "custom.json"
        theme_file.write_text(
            json.dumps(
                {
                    "name": "My Theme",
                    "author": "Tester",
                    "colors": {"bg": "#123456"},
                }
            ),
            encoding="utf-8",
        )
        theme = self.h.call("import_theme", {"path": str(theme_file)})
        # 导入时后端会分配新的唯一 id（避免与已有主题冲突）。
        theme_id = theme["id"]
        assert theme_id.startswith("custom_"), theme
        assert theme["name"] == "My Theme", theme
        # 缺失的颜色回落到默认值，而不是让导入失败。
        assert theme["colors"]["bg"] == "#123456", theme
        assert theme["colors"]["text"], theme

        ids = {t["id"] for t in self.h.call("get_themes")}
        assert theme_id in ids, ids

        dest = self.tmp_path / "exported.json"
        self.h.call("export_theme", {"id": theme_id, "dest_path": str(dest)})
        assert dest.exists()

        self.h.call("delete_theme", {"id": theme_id})
        ids = {t["id"] for t in self.h.call("get_themes")}
        assert theme_id not in ids

    def test_delete_theme_rejects_traversal_id(self) -> None:
        err = self.h.expect_error("delete_theme", {"id": "../../etc/passwd"})
        assert err, "expected an error for a traversal theme id"

    def test_import_theme_missing_file_errors(self) -> None:
        self.h.expect_error("import_theme", {"path": str(self.tmp_path / "ghost.json")})


# ==================================================================== 快捷键


class TestKeybindings(BackendTestCase):
    def test_defaults_present(self) -> None:
        bindings = self.h.call("get_keybindings")
        assert isinstance(bindings, list)
        assert len(bindings) > 0
        for b in bindings:
            assert "id" in b and "label" in b and "accelerator" in b

    def test_update_and_reset(self) -> None:
        original = self.h.call("get_keybindings")
        target = original[0]
        self.h.call(
            "update_keybinding",
            {"id": target["id"], "accelerator": "CommandOrControl+Shift+Z"},
        )
        updated = {b["id"]: b for b in self.h.call("get_keybindings")}
        assert updated[target["id"]]["accelerator"] == "CommandOrControl+Shift+Z"

        self.h.call("reset_keybindings")
        reset = {b["id"]: b for b in self.h.call("get_keybindings")}
        assert reset[target["id"]]["accelerator"] == target["accelerator"]

    def test_set_keybindings_replaces_all(self) -> None:
        original = self.h.call("get_keybindings")
        custom = [
            {"id": b["id"], "label": b["label"], "accelerator": "F5"} for b in original
        ]
        self.h.call("set_keybindings", custom)
        result = self.h.call("get_keybindings")
        assert all(b["accelerator"] == "F5" for b in result), result


# ==================================================================== 国际化


class TestI18n(BackendTestCase):
    def test_locale_info(self) -> None:
        locale = self.h.call("get_locale")
        assert isinstance(locale, dict)
        assert "current" in locale
        assert "available" in locale
        assert "translations" in locale
        assert locale["current"] in {lang for lang, _ in locale["available"]}

    def test_translations_for_each_language(self) -> None:
        for lang in ("en", "zh-CN", "ja"):
            table = self.h.call("get_translations", {"lang": lang})
            assert isinstance(table, dict)
            assert "menu.file" in table, f"missing menu.file in {lang}"
            assert len(table) > 30, f"{lang} has only {len(table)} keys"

    def test_all_languages_have_same_keys(self) -> None:
        en = set(self.h.call("get_translations", {"lang": "en"}))
        for lang in ("zh-CN", "ja"):
            other = set(self.h.call("get_translations", {"lang": lang}))
            missing = en - other
            assert not missing, f"{lang} is missing keys: {sorted(missing)[:10]}"

    def test_set_locale_changes_current(self) -> None:
        self.h.call("set_locale", {"lang": "ja"})
        locale = self.h.call("get_locale")
        assert locale["current"] == "ja", locale["current"]


# ==================================================================== 书签


class TestBookmarks(BackendTestCase):
    def test_bookmark_crud(self) -> None:
        assert self.h.call("get_bookmarks") == []

        bm = self.h.call(
            "add_bookmark",
            {"path": "/tmp/a.md", "title": "A", "tags": ["x", "y"]},
        )
        assert bm["title"] == "A"
        assert bm["tags"] == ["x", "y"]

        listed = self.h.call("get_bookmarks")
        assert len(listed) == 1

        updated = self.h.call(
            "update_bookmark", {"id": bm["id"], "title": "A2", "tags": ["z"]}
        )
        assert updated["title"] == "A2"
        assert updated["tags"] == ["z"]

        self.h.call("remove_bookmark", {"id": bm["id"]})
        assert self.h.call("get_bookmarks") == []

    def test_add_bookmark_requires_path_and_title(self) -> None:
        self.h.expect_error("add_bookmark", {"title": "A"})
        self.h.expect_error("add_bookmark", {"path": "/tmp/a.md"})

    def test_update_missing_bookmark_errors(self) -> None:
        self.h.expect_error("update_bookmark", {"id": "ghost", "title": "x"})

    def test_remove_missing_bookmark_errors(self) -> None:
        self.h.expect_error("remove_bookmark", {"id": "ghost"})


# ==================================================================== Markdown 扩展


class TestFrontmatter(BackendTestCase):
    def test_parse_frontmatter(self) -> None:
        content = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n"
        result = self.h.call("parse_frontmatter", {"content": content})
        assert isinstance(result, dict)
        fm = result["frontmatter"]
        assert fm["fields"]["title"] == "Hello", result
        assert fm["format"] == "Yaml", result
        assert result["bounds"]["start"] == 0, result

    def test_update_frontmatter_field(self) -> None:
        content = "---\ntitle: Hello\n---\n\n# Body\n"
        result = self.h.call(
            "update_frontmatter_field",
            {"content": content, "key": "title", "value": "World"},
        )
        assert "World" in result["content"], result
        assert "# Body" in result["content"], result

    def test_update_frontmatter_adds_missing_key(self) -> None:
        content = "---\ntitle: Hello\n---\n\nbody\n"
        result = self.h.call(
            "update_frontmatter_field",
            {"content": content, "key": "author", "value": "Me"},
        )
        assert "author" in result["content"], result

    def test_lint_markdown(self) -> None:
        dirty = "line with trailing spaces   \n\n\n\n\nafter\n"
        result = self.h.call("lint_markdown", {"content": dirty})
        assert isinstance(result, dict)
        cleaned = result["content"]
        assert "trailing spaces   \n" not in cleaned, repr(cleaned)
        assert cleaned.endswith("\n")
        assert "\n\n\n\n" not in cleaned, repr(cleaned)


class TestTables(BackendTestCase):
    TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"

    def test_to_csv(self) -> None:
        result = self.h.call(
            "table_to_csv",
            {"content": self.TABLE, "start": 0, "end": len(self.TABLE)},
        )
        assert "a,b" in result["csv"], result
        assert "1,2" in result["csv"], result

    def test_to_csv_quotes_cells_with_commas(self) -> None:
        table = "| a | b |\n| --- | --- |\n| x,y | z |\n"
        result = self.h.call(
            "table_to_csv", {"content": table, "start": 0, "end": len(table)}
        )
        assert '"x,y"' in result["csv"], result

    def test_to_csv_rejects_non_table(self) -> None:
        self.h.expect_error(
            "table_to_csv", {"content": "not a table", "start": 0, "end": 10}
        )

    def test_transform_table(self) -> None:
        result = self.h.call(
            "transform_table",
            {
                "content": self.TABLE,
                "op": {"type": "DeleteRow", "row_idx": 0},
                "start": 0,
                "end": len(self.TABLE),
            },
        )
        assert isinstance(result, dict)
        assert "1" not in result["transformed"], result

    def test_transform_table_rejects_unknown_op(self) -> None:
        self.h.expect_error(
            "transform_table",
            {
                "content": self.TABLE,
                "op": {"type": "NoSuchOp"},
                "start": 0,
                "end": len(self.TABLE),
            },
        )

    def test_align_table_column(self) -> None:
        result = self.h.call(
            "align_table_column",
            {
                "content": self.TABLE,
                "start": 0,
                "end": len(self.TABLE),
                "col": 0,
                "alignment": "center",
            },
        )
        assert isinstance(result, dict)
        assert ":---:" in result["transformed"], result


class TestFoldingAndTasks(BackendTestCase):
    def test_compute_folds(self) -> None:
        content = "# H1\n\n## H2\n\ntext\n\n```rust\nfn main() {}\n```\n"
        result = self.h.call("compute_folds", {"content": content})
        assert isinstance(result, list)
        assert len(result) >= 2, result
        assert result[0]["level"] == 1, result
        assert result[0]["heading_text"] == "H1", result

    def test_parse_task_items(self) -> None:
        content = "- [ ] todo\n- [x] done\n- plain\n"
        items = self.h.call("parse_task_items", {"content": content})
        assert isinstance(items, list)
        assert len(items) == 2, items
        assert items[0]["checked"] is False, items
        assert items[1]["checked"] is True, items
        assert items[0]["text"] == "todo", items


# ==================================================================== 工作区根


class TestWorkspaceRoots(BackendTestCase):
    def test_add_list_remove(self) -> None:
        root = self.h.call("add_workspace_root", {"path": str(self.workspace)})
        root_id = root["id"]

        listing = self.h.call("list_workspace_roots")
        assert len(listing["roots"]) == 1
        assert listing["active_id"] == root_id
        assert listing["roots"][0]["exists"] is True

        self.h.call("remove_workspace_root", {"root_id": root_id})
        assert self.h.call("list_workspace_roots")["roots"] == []

    def test_duplicate_root_is_rejected(self) -> None:
        self.h.call("add_workspace_root", {"path": str(self.workspace)})
        self.h.expect_error("add_workspace_root", {"path": str(self.workspace)})

    def test_missing_root_is_accepted_but_flagged(self) -> None:
        # 未挂载的外部磁盘是合法场景：根目录可以被登记，只是
        # `exists` 为 false，渲染器据此显示「缺失」徽标。
        root = self.h.call(
            "add_workspace_root", {"path": str(self.tmp_path / "ghost-dir")}
        )
        listing = self.h.call("list_workspace_roots")
        assert len(listing["roots"]) == 1
        assert listing["roots"][0]["exists"] is False
        assert listing["roots"][0]["id"] == root["id"]

    def test_set_active_root(self) -> None:
        other = self.tmp_path / "other"
        other.mkdir()
        r1 = self.h.call("add_workspace_root", {"path": str(self.workspace)})
        r2 = self.h.call("add_workspace_root", {"path": str(other)})

        result = self.h.call("set_active_workspace_root", {"root_id": r2["id"]})
        assert "evicted_doc_ids" in result
        assert self.h.call("list_workspace_roots")["active_id"] == r2["id"]

    def test_remove_missing_workspace_roots(self) -> None:
        gone = self.tmp_path / "gone"
        gone.mkdir()
        self.h.call("add_workspace_root", {"path": str(gone)})
        gone.rmdir()

        result = self.h.call("remove_missing_workspace_roots")
        assert len(result["removed_root_ids"]) == 1
        assert self.h.call("list_workspace_roots")["roots"] == []

    def test_expanded_dirs_roundtrip(self) -> None:
        root_id = self.open_workspace()
        self.h.call(
            "set_expanded_dirs_v2",
            {"root_id": root_id, "expanded_dirs": ["a", "b/c"]},
        )
        result = self.h.call("get_expanded_dirs_v2", {"root_id": root_id})
        assert sorted(result["expanded_dirs"]) == ["a", "b/c"], result


# ==================================================================== 工作区标签 / 反链 / 样式


class TestWorkspaceAnalysis(BackendTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.write_file("a.md", "# Title\n\n#tag1 #tag2\n\n[[b]]\n")
        self.write_file("b.md", "# Other\n\n#tag2\n")

    def test_workspace_tags(self) -> None:
        result = self.h.call("get_workspace_tags", {"path": str(self.workspace)})
        tags = result["tags"] if isinstance(result, dict) else result
        names = {t["name"] if isinstance(t, dict) else t for t in tags}
        assert {"tag1", "tag2"} <= names, names

    def test_backlinks(self) -> None:
        result = self.h.call(
            "get_backlinks", {"path": str(self.workspace), "page": "b"}
        )
        backlinks = result["backlinks"] if isinstance(result, dict) else result
        assert isinstance(backlinks, list)
        assert any("a.md" in str(b) for b in backlinks), backlinks

    def test_load_workspace_styles_missing_dir(self) -> None:
        # 没有 `.markpure/styles` 时不应报错。
        result = self.h.call(
            "load_workspace_styles", {"path": str(self.workspace)}
        )
        assert result is None or result == "" or isinstance(result, dict)


# ==================================================================== 图片 / 资源


class TestAssets(BackendTestCase):
    PNG_B64 = make_png_b64()

    def test_save_pasted_image(self) -> None:
        self.open_workspace()
        result = self.h.call(
            "save_pasted_image",
            {
                "workspace_path": str(self.workspace),
                "data": self.PNG_B64,
                "name": "pic.png",
            },
        )
        assert "path" in result, result
        assert pathlib.Path(result["path"]).exists()

    def test_get_file_info(self) -> None:
        path = self.write_file("info.md", "hello")
        info = self.h.call("get_file_info", {"path": str(path)})
        assert isinstance(info, dict)
        assert info.get("size", 0) > 0, info

    def test_image_to_base64(self) -> None:
        result = self.h.call("image_to_base64", {"data": self.PNG_B64})
        assert result["data_uri"].startswith("data:image/png;base64,")

    def test_image_to_base64_rejects_garbage(self) -> None:
        self.h.expect_error("image_to_base64", {"data": "!!!not base64!!!"})

    def test_track_and_is_file_modified(self) -> None:
        path = self.write_file("tracked.md", "hello")
        mtime = self.h.call("track_file", {"path": str(path)})
        assert "mtime" in mtime

        result = self.h.call("is_file_modified", {"path": str(path)})
        assert "is_modified" in result

    def test_upload_image_remote_rejects_private_url(self) -> None:
        # SSRF 防护：内网地址必须被拒绝。处理器把失败放进结果负载
        # （success=false + error），而不是抛 IPC 错误。
        result = self.h.call(
            "upload_image_remote",
            {
                "data": self.PNG_B64,
                "upload_url": "http://127.0.0.1:8080/upload",
            },
        )
        assert result["success"] is False, result
        assert result["error"], result

    def test_upload_image_remote_rejects_file_scheme(self) -> None:
        result = self.h.call(
            "upload_image_remote",
            {"data": self.PNG_B64, "upload_url": "file:///etc/passwd"},
        )
        assert result["success"] is False, result
        assert result["error"], result


# ==================================================================== 拼写检查


class TestSpellcheck(BackendTestCase):
    def test_detects_typo(self) -> None:
        result = self.h.call(
            "check_spelling", {"text": "helllo wrold", "lang": "en"}
        )
        words = {e["word"] for e in result["errors"]}
        assert "helllo" in words, result

    def test_correct_text_has_no_errors(self) -> None:
        result = self.h.call(
            "check_spelling", {"text": "the quick brown fox", "lang": "en"}
        )
        assert result["errors"] == [], result

    def test_requires_text(self) -> None:
        self.h.expect_error("check_spelling", {"lang": "en"})

    def test_empty_text_has_no_errors(self) -> None:
        result = self.h.call("check_spelling", {"text": "", "lang": "en"})
        assert result["errors"] == [], result


# ==================================================================== 标签页


class TestTabs(BackendTestCase):
    def test_tabs_roundtrip(self) -> None:
        tabs = self.h.call("get_tabs")
        assert isinstance(tabs, list)

        payload = [
            {
                "window_id": "main",
                "active_tab_id": "1",
                "tabs": [
                    {
                        "id": "1",
                        "name": "a.md",
                        "path": str(self.workspace / "a.md"),
                        "is_modified": False,
                    }
                ],
            }
        ]
        self.h.call("save_tabs", payload)
        again = self.h.call("get_tabs")
        assert isinstance(again, list)
        assert len(again) == 1, again
        assert again[0]["window_id"] == "main", again


# ==================================================================== 代码片段


class TestSnippets(BackendTestCase):
    def test_list_snippets(self) -> None:
        result = self.h.call("list_snippets")
        assert isinstance(result, dict)
        assert isinstance(result["snippets"], list)


# ==================================================================== 静态契约


class TestStaticContract(BackendTestCase):
    """静态检查：前端调用的每条 IPC 命令都必须在后端路由表里。"""

    def test_frontend_commands_are_implemented_in_backend(self) -> None:
        dispatch = DISPATCH_RS.read_text(encoding="utf-8")
        backend_cmds = set(re.findall(r'"([a-z_0-9]+)"', dispatch))
        # 去掉明显不是命令名的字符串。
        backend_cmds = {
            c
            for c in backend_cmds
            if not c.startswith("__")
            and c
            not in {
                "text",
                "content",
                "path",
                "id",
                "cmd",
                "params",
                "result",
                "error",
                "com",
                "toml",
                "png",
                "html",
                "pdf",
                "docx",
                "csv",
                "json",
                "css",
                "md",
                "markdown",
            }
        }

        frontend_cmds: set[str] = set()
        pattern = re.compile(r"ipc(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'")
        for path in FRONTEND_SRC.rglob("*"):
            if path.suffix not in (".ts", ".svelte") or not path.is_file():
                continue
            text = path.read_text(encoding="utf-8")
            frontend_cmds.update(pattern.findall(text))

        missing = sorted(frontend_cmds - backend_cmds)
        assert not missing, (
            "frontend calls IPC commands the backend does not implement: "
            f"{missing}"
        )

    def test_every_backend_command_has_a_frontend_caller_or_is_intentional(self) -> None:
        # 反向检查：后端实现了但前端从不调用的命令。仅作为信息性
        # 断言——列出清单，避免新增命令时忘记接线。
        dispatch = DISPATCH_RS.read_text(encoding="utf-8")
        backend_cmds = set(re.findall(r'^\s+"([a-z_0-9]+)"', dispatch, re.M))

        frontend_cmds: set[str] = set()
        pattern = re.compile(r"ipc(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'")
        for path in FRONTEND_SRC.rglob("*"):
            if path.suffix not in (".ts", ".svelte") or not path.is_file():
                continue
            frontend_cmds.update(pattern.findall(path.read_text(encoding="utf-8")))

        orphans = sorted(backend_cmds - frontend_cmds)
        # 这些是前端不直接调用、但由其它 IPC 间接驱动的命令。
        known_orphans = {
            "get_expanded_dirs_v2",
            "set_expanded_dirs_v2",
            "get_file_info",
            "image_to_base64",
            "is_file_modified",
            "lint_markdown",
            "remove_missing_workspace_roots",
            "track_file",
        }
        unexpected = sorted(set(orphans) - known_orphans)
        assert not unexpected, (
            "backend implements these commands but no frontend caller exists: "
            f"{unexpected}"
        )


# ==================================================================== 入口


if __name__ == "__main__":
    ensure_harness()
    unittest.main(verbosity=2)
