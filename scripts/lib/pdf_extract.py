#!/usr/bin/env python3
"""从 printpdf 生成的 PDF 中提取可见文本。

`printpdf` 嵌入的是 **CID 编码的 Type0 字体**：内容流里写的是
`<hex> Tj`，十六进制字节是**字形编号**，不是字符本身。想判断某个
词是否真的出现在 PDF 里（例如导出后中文是不是被整段丢掉），
必须用每个字体自带的 `ToUnicode` CMap 把编号映射回 Unicode。

这个模块不追求通用 PDF 解析，只覆盖 `printpdf` 的输出结构：

- 页对象 → `/Resources` → `/Font` → `{"/F0": 对象号}`
- 字体对象 → `/ToUnicode` → CMap 流（`beginbfchar` 段）
- 内容流 → `/Fn size Tf` 切换字体，`<hex> Tj` 输出文本

## 用法

```python
from pdf_extract import extract_text

text = extract_text(path.read_bytes())
assert "标题一" in text
```
"""

from __future__ import annotations

import re
import zlib

# `N 0 obj ... endobj`
_OBJ_RE = re.compile(rb"(\d+)\s+0\s+obj\b(.*?)\bendobj", re.S)
# 间接引用 `N 0 R`
_REF_RE = re.compile(rb"(\d+)\s+0\s+R")
# 流内容
_STREAM_RE = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)
# CMap 里的单字符映射 `<src> <dst>`
_BFCHAR_RE = re.compile(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")
# 内容流里的操作符：切换字体 / 输出文本
_OP_RE = re.compile(
    rb"/(F\d+)\s+[\d.]+\s+Tf"  # /F0 9 Tf
    rb"|<([0-9A-Fa-f]*)>\s*Tj"  # <0041> Tj
    rb"|\[(.*?)\]\s*TJ",  # [<0041> -10 <0042>] TJ
    re.S,
)


def _objects(data: bytes) -> dict[int, bytes]:
    """把 PDF 拆成 `{对象号: 对象内容}`。"""
    return {int(m.group(1)): m.group(2) for m in _OBJ_RE.finditer(data)}


def _resolve(objs: dict[int, bytes], ref: bytes) -> bytes:
    """解析 `N 0 R` 形式的间接引用，返回被引用对象的内容。"""
    m = _REF_RE.match(ref.strip())
    if not m:
        return b""
    return objs.get(int(m.group(1)), b"")


def _stream_bytes(body: bytes) -> bytes:
    """取出对象里的流内容；能解压缩就解压。"""
    m = _STREAM_RE.search(body)
    if not m:
        return b""
    raw = m.group(1)
    try:
        return zlib.decompress(raw)
    except zlib.error:
        return raw


def _utf16be(hex_digits: str) -> str:
    """把 UTF-16BE 十六进制串解码成字符。"""
    try:
        raw = bytes.fromhex(hex_digits)
    except ValueError:
        return ""
    if len(raw) % 2 == 1:
        raw = raw[:-1]
    try:
        return raw.decode("utf-16-be")
    except UnicodeDecodeError:
        return ""


def _parse_cmap(data: bytes) -> dict[int, str]:
    """解析 `ToUnicode` CMap 的 `bfchar` 映射：字形编号 → 字符。"""
    text = data.decode("latin-1")
    mapping: dict[int, str] = {}
    # 只取 `beginbfchar` 段内的条目——`beginbfrange` 段的
    # `<lo> <hi> <dst>` 三元组会被下面的二元正则误匹配。
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in _BFCHAR_RE.findall(block):
            mapping[int(src, 16)] = _utf16be(dst)
    return mapping


def _font_maps(objs: dict[int, bytes]) -> dict[str, dict[int, str]]:
    """建立 `{字体名: CMap 映射}`。

    页面资源里的 `/Font` 字典把 `/F0` 这样的名字映射到字体对象号，
    字体对象再通过 `/ToUnicode` 指向 CMap 流。
    """
    maps: dict[str, dict[int, str]] = {}

    # 找页面对象 → /Resources → /Font → {名字: 字体对象号}
    font_names: dict[str, bytes] = {}
    for body in objs.values():
        if b"/Type/Page" not in body and b"/Type /Page" not in body:
            continue
        m = re.search(rb"/Resources\s+(\d+)\s+0\s+R", body)
        resources = objs.get(int(m.group(1)), b"") if m else body
        fm = re.search(rb"/Font\s+(\d+)\s+0\s+R", resources)
        font_dict = objs.get(int(fm.group(1)), b"") if fm else resources
        for name, num in re.findall(rb"/(F\d+)\s+(\d+)\s+0\s+R", font_dict):
            font_names[name.decode()] = num

    for name, num in font_names.items():
        font_body = objs.get(int(num), b"")
        tm = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", font_body)
        if not tm:
            continue
        cmap = _stream_bytes(objs.get(int(tm.group(1)), b""))
        mapping = _parse_cmap(cmap)
        if mapping:
            maps[name] = mapping
    return maps


def _content_streams(objs: dict[int, bytes]) -> list[bytes]:
    """收集所有页面的内容流。"""
    streams: list[bytes] = []
    for body in objs.values():
        if b"/Type/Page" not in body and b"/Type /Page" not in body:
            continue
        for num in re.findall(rb"/Contents\s+(\d+)\s+0\s+R", body):
            streams.append(_stream_bytes(objs.get(int(num), b"")))
    return streams


def _decode_hex(hex_digits: str, mapping: dict[int, str]) -> str:
    """把内容流里的十六进制串按 CMap 还原成文本。

    `Identity-H` 编码下每个字形占 2 字节。
    """
    if len(hex_digits) % 4 != 0:
        return ""
    out: list[str] = []
    for i in range(0, len(hex_digits), 4):
        code = int(hex_digits[i : i + 4], 16)
        out.append(mapping.get(code, ""))
    return "".join(out)


def extract_text(data: bytes) -> str:
    """提取 PDF 里的可见文本，按绘制顺序用换行分隔。"""
    objs = _objects(data)
    maps = _font_maps(objs)

    lines: list[str] = []
    for content in _content_streams(objs):
        current: dict[int, str] = {}
        for m in _OP_RE.finditer(content):
            if m.group(1) is not None:
                current = maps.get(m.group(1).decode(), {})
            elif m.group(2) is not None:
                lines.append(_decode_hex(m.group(2).decode(), current))
            else:
                # TJ 数组：逐个字符串片段解码。
                parts = re.findall(rb"<([0-9A-Fa-f]*)>", m.group(3) or b"")
                lines.append(
                    "".join(_decode_hex(p.decode(), current) for p in parts)
                )
    return "\n".join(lines)


if __name__ == "__main__":  # pragma: no cover - 手动调试用
    import pathlib
    import sys

    path = pathlib.Path(sys.argv[1])
    print(extract_text(path.read_bytes()))
