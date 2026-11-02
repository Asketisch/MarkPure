#!/usr/bin/env python3
"""把 resources/icons/ 下的现成 PNG 组装成 Windows .ico 图标。

ICO 容器支持直接内嵌 PNG 数据（Windows Vista+ 原生支持 PNG entry），
而仓库里 16~256 各尺寸的 PNG 都有现成文件，因此不需要 Pillow 之类的
图像库做缩放——纯标准库按容器格式拼接即可。

用法：
    python3 scripts/make-ico.py                # 输出 resources/icons/markpure.ico
    python3 scripts/make-ico.py out.ico        # 输出到指定路径

产物提交进版本库（backend/apps/desktop/build.rs 经 winresource 在
Windows 构建时嵌入 exe），日常无需重新生成——只有图标本身变化时才重跑。
"""

import struct
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
ICON_DIR = PROJECT_DIR / "resources" / "icons"

# 256 用 0 表示（ICO 格式规定），所以这里直接写像素边长
SIZES = [16, 24, 32, 48, 64, 128, 256]


def build_ico() -> bytes:
    entries = []
    for size in SIZES:
        png = (ICON_DIR / f"{size}x{size}.png").read_bytes()
        entries.append((size, png))

    header = struct.pack("<HHH", 0, 1, len(entries))
    # 目录项定长 16 字节，数据区紧随其后
    offset = 6 + 16 * len(entries)
    directory = b""
    blob = b""
    for size, png in entries:
        edge = 0 if size >= 256 else size
        directory += struct.pack(
            "<BBBBHHII",
            edge,          # 宽（0 = 256）
            edge,          # 高
            0,             # 调色板色数（PNG entry 恒为 0）
            0,             # 保留
            1,             # 颜色平面数
            32,            # 位深
            len(png),      # 数据长度
            offset,        # 数据偏移
        )
        blob += png
        offset += len(png)
    return header + directory + blob


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ICON_DIR / "markpure.ico"
    data = build_ico()
    out.write_bytes(data)
    print(f"Wrote {out} ({len(data)} bytes, {len(SIZES)} sizes)")


if __name__ == "__main__":
    main()
