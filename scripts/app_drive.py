#!/usr/bin/env python3
"""驱动**真实桌面应用**（MarkPure release 二进制）的测试脚本。

与 `scripts/test_backend.py`（走 `mt_harness` 的 IPC 通道）不同，
这里操作的是真正的 WKWebView 应用：原生菜单栏、真实事件循环、
真实的文件监视、真实的 `evaluate_script` IPC 桥。

## 为什么需要它

headless Chrome 里的显示层测试绕过了整个原生壳：原生菜单、窗口
管理、事件循环驱动的文件监视、`mt://` 协议、真实剪贴板……这些路径
在浏览器里根本不存在。而 WKWebView 的 AX 树是空的，AppleScript 读
不到控件——所以这里靠**截图 + 坐标点击**驱动。

## 用法

```bash
python3 scripts/app_drive.py launch          # 启动应用（隔离配置目录）
python3 scripts/app_drive.py shot out.png    # 截图
python3 scripts/app_drive.py click 640 400   # 点击坐标
python3 scripts/app_drive.py key cmd+p       # 按键（cmd/ctrl/shift/alt 修饰）
python3 scripts/app_drive.py text "hello"    # 输入文字
python3 scripts/app_drive.py probe           # 打印窗口几何
```

脚本只做「输入注入」；**判断对错靠人/模型看截图**。
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time

APP_NAME = "markpure"

# 截图坐标 → 逻辑坐标的换算系数。
#
# `screencapture` 抓的是物理像素（Retina 屏为 2x），而 CGEvent 用的是
# 逻辑点。截图读出来的图会被缩放到 2000 宽显示，因此：
#   逻辑点 = 显示坐标 × (屏幕逻辑宽 / 2000)
# 下面 `display_scale()` 按实际屏幕算，不写死 0.864。
DISPLAY_IMAGE_WIDTH = 2000.0


def display_scale() -> float:
    """截图（显示宽度 2000）坐标 → 逻辑点 的换算系数。"""
    width_pt = float(
        subprocess.run(
            ["osascript", "-e", 'tell application "Finder" to get width of window of desktop'],
            capture_output=True,
            text=True,
        ).stdout.strip()
        or 0
    )
    if width_pt <= 0:
        return 0.864
    return width_pt / DISPLAY_IMAGE_WIDTH
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
RELEASE_BIN = REPO_ROOT / "target" / "release" / "markpure"

# 应用的测试用配置目录与工作区——与用户的真实设置完全隔离。
TEST_HOME = pathlib.Path(os.environ.get("MARKPURE_APP_TEST_HOME", "/tmp/markpure-app-test"))
CONFIG_DIR = TEST_HOME / "config"
WORKSPACE = TEST_HOME / "workspace"

# JXA 辅助：合成鼠标事件。macOS 的 System Events 没有「按坐标点击」，
# 但 JXA 能通过 ObjC 桥调用 CoreGraphics。
_JXA_CLICK = """
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function sleep(sec) { $.NSThread.sleepForTimeInterval(sec); }
function post(type, x, y, count) {
  var pt = $.CGPointMake(x, y);
  var ev = $.CGEventCreateMouseEvent(null, type, pt, 0);
  try {
    if (count > 1) { $.CGEventSetIntegerValueField(ev, $.kCGMouseEventClickState, count); }
  } catch (e) {}
  $.CGEventPost(0, ev);
}
function clickAt(x, y, count) {
  // 顺序与真实鼠标一致：先移动过去（让 hover 生效），再按下，
  // 停一小会儿后抬起。三个事件若在同一瞬间投递，AppKit 的按钮
  // 不会响应——事件时间戳相同会被当成「零时长的点击」。
  post(5, x, y, 1);
  sleep(0.08);
  post(1, x, y, 1);
  sleep(0.08);
  post(2, x, y, count);
  sleep(0.06);
}
clickAt(X, Y, COUNT);
"""

# JXA 辅助：滚轮。direction 为 1（上）/ -1（下）。
_JXA_SCROLL = """
ObjC.import('CoreGraphics');
function scrollAt(x, y, dir) {
  var pt = $.CGPointMake(x, y);
  var ev = $.CGEventCreateScrollWheelEvent(null, 0, 1, dir * 40);
  $.CGEventPost(0, ev);
}
scrollAt(X, Y, DIR);
"""


def _osascript(script: str, lang: str = "AppleScript") -> str:
    """执行 AppleScript（默认）或 JXA（`lang="JavaScript"`）。

    注意 `osascript -e` **默认按 AppleScript 解析**——JXA 必须显式
    指定 `-l JavaScript`，否则报的是莫名其妙的语法错误。
    """
    result = subprocess.run(
        ["osascript", "-l", lang, "-e", script],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError(f"osascript failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _key_script(combo: str) -> str:
    """把 `cmd+shift+p` 这样的组合键转成 AppleScript `keystroke` 片段。"""
    parts = combo.lower().split("+")
    mods = []
    key = parts[-1]
    for mod in parts[:-1]:
        if mod in ("cmd", "command"):
            mods.append("command down")
        elif mod in ("ctrl", "control"):
            mods.append("control down")
        elif mod in ("shift",):
            mods.append("shift down")
        elif mod in ("alt", "option"):
            mods.append("option down")
        else:
            raise ValueError(f"unknown modifier: {mod}")
    using = " using {" + ", ".join(mods) + "}" if mods else ""
    if len(key) == 1:
        body = f'keystroke "{key}"{using}'
    elif key.startswith("f") and key[1:].isdigit():
        body = f"key code {102 + int(key[1:])}" + using
    elif key == "enter":
        body = "key code 36" + using
    elif key == "escape":
        body = "key code 53" + using
    elif key == "tab":
        body = "key code 48" + using
    elif key == "comma":
        body = "key code 43" + using
    elif key == "space":
        body = "key code 49" + using
    elif key == "left":
        body = "key code 123" + using
    elif key == "right":
        body = "key code 124" + using
    elif key == "up":
        body = "key code 126" + using
    elif key == "down":
        body = "key code 125" + using
    elif key == "delete":
        body = "key code 51" + using
    else:
        raise ValueError(f"unknown key: {key}")
    return body


def ensure_workspace() -> pathlib.Path:
    """准备一个内容丰富的测试工作区。"""
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    rich = WORKSPACE / "功能测试.md"
    if not rich.exists():
        rich.write_text(
            """# 一级标题

这是一段**中文**正文，包含 `行内代码`、*斜体*、[链接](https://example.com)。

## 二级标题

- 列表项一
- 列表项二
  - 嵌套项

1. 有序一
2. 有序二

- [ ] 未完成任务
- [x] 已完成任务

> 引用块内容

```python
print("hello")
```

| 列一 | 列二 |
| --- | --- |
| 值 A | 值 B |
| 值 C | 值 D |

![替代文字](https://example.com/a.png)

脚注引用[^1]

[^1]: 脚注内容
""",
            encoding="utf-8",
        )
    (WORKSPACE / "另一个文档.md").write_text("# 另一个文档\n\n第二个文件的内容。\n", encoding="utf-8")
    return WORKSPACE


def launch(workspace: pathlib.Path | None = None) -> None:
    """启动真实应用（后台），使用隔离的配置目录。"""
    ensure_workspace()
    ws = str(workspace or WORKSPACE)
    env = dict(os.environ)
    env["MARKPURE_CONFIG_DIR"] = str(CONFIG_DIR)
    env["MARKPURE_STARTUP_LOG"] = "1"
    subprocess.Popen(
        [str(RELEASE_BIN)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=open("/tmp/markpure-app-stderr.log", "wb"),
        start_new_session=True,
    )
    time.sleep(2.5)
    print(f"launched: workspace={ws} config={CONFIG_DIR}")


def activate() -> None:
    """把应用切到前台。"""
    _osascript(
        f'tell application "System Events" to set frontmost of process "{APP_NAME}" to true'
    )
    time.sleep(0.4)


def shot(path: str, front: bool = False) -> None:
    """截图（整个主屏）。

    默认**不**切前台——应用的自绘菜单（下拉、弹出层）会因失焦而
    关闭，切前台就拍不到了。需要「确保拍到应用本身」时用
    `front=True`。
    """
    if front:
        try:
            activate()
        except Exception:
            pass
    subprocess.run(
        ["screencapture", "-x", "-o", path],
        check=True,
        timeout=20,
    )
    print(f"saved {path}")


def click(x: int, y: int, displayed: bool = False, double: bool = False) -> None:
    """在屏幕坐标 (x, y) 处点击。先把应用置前台——否则点击会落到
    遮挡在上面的其他窗口上（真实桌面测试里很常见）。

    `displayed=True` 表示坐标取自截图（显示宽度 2000），会自动换算成
    逻辑点——这样可以直接用「看图 → 报坐标」的方式驱动。
    """
    if displayed:
        k = display_scale()
        x = int(round(x * k))
        y = int(round(y * k))
    try:
        activate()
    except Exception:
        pass
    count = 2 if double else 1
    _osascript(
        _JXA_CLICK.replace("X", str(x))
        .replace("Y", str(y))
        .replace("COUNT", str(count)),
        lang="JavaScript",
    )
    time.sleep(0.35)


def scroll(x: int, y: int, direction: int = -1) -> None:
    """在 (x, y) 处滚轮。direction=-1 向下。"""
    _osascript(
        _JXA_SCROLL.replace("X", str(x)).replace("Y", str(y)).replace("DIR", str(direction)),
        lang="JavaScript",
    )
    time.sleep(0.3)


def key(combo: str) -> None:
    """按键，如 `cmd+p`、`escape`、`f5`。"""
    body = _key_script(combo)
    _osascript(
        f'tell application "System Events" to tell process "{APP_NAME}" to {body}'
    )
    time.sleep(0.5)


def text(value: str) -> None:
    """输入文字（走剪贴板粘贴，中文可靠）。"""
    pbcopy = subprocess.Popen(["pbcopy"], stdin=subprocess.PIPE)
    pbcopy.communicate(value.encode("utf-8"))
    time.sleep(0.2)
    _osascript(
        f'tell application "System Events" to tell process "{APP_NAME}" '
        f'to keystroke "v" using command down'
    )
    time.sleep(0.4)


def window_origin() -> tuple[float, float]:
    """应用窗口左上角的**逻辑点**坐标。"""
    script = (
        f'tell application "System Events" to tell process "{APP_NAME}" '
        "to get position of window 1"
    )
    raw = _osascript(script)
    x, y = [float(v) for v in raw.split(",")[:2]]
    return x, y


def click_window(dx: float, dy: float) -> None:
    """以**应用窗口左上角**为原点点击（坐标取自窗口截图）。

    窗口位置会变（用户拖动、其他应用抢焦点），因此相对坐标比绝对
    坐标可靠。`dx` / `dy` 是截图像素（显示宽度 2000 的那张图）里
    相对于窗口左上角的偏移。
    """
    ox, oy = window_origin()
    # 截图显示宽度 2000 ↔ 屏幕逻辑宽度（从窗口几何推不出来，用
    # 主显示器宽度）。取 1.1574 是 2000/1728（Retina 逻辑宽）。
    k = DISPLAY_IMAGE_WIDTH / 1728.0
    click(int(round(ox + dx / k)), int(round(oy + dy / k)))


def probe() -> dict:
    """打印窗口几何与进程信息。"""
    script = (
        f'tell application "System Events" to tell process "{APP_NAME}" '
        "to get {name, position, size} of every window"
    )
    try:
        windows = _osascript(script)
    except RuntimeError as exc:
        print(f"probe failed: {exc}")
        return {}
    print(windows)
    return {"windows": windows}


# 窗口内 HTML 菜单栏与导出子菜单的坐标（截图显示宽度 2000）。
_MENU_FILE = (310, 167)
_MENU_EXPORT = (330, 410)
_EXPORT_ITEMS = {"html": (600, 417), "pdf": (600, 455), "word": (600, 491), "png": (600, 527)}
_DIALOG_SAVE_BUTTON = (1101, 505)


def export(kind: str, filename: str) -> None:
    """走一遍完整导出流程：File → Export → 填文件名 → Save。"""
    activate()
    click(*_MENU_FILE, displayed=True)
    time.sleep(0.5)
    click(*_MENU_EXPORT, displayed=True)
    time.sleep(0.8)
    if kind not in _EXPORT_ITEMS:
        raise ValueError(f"unknown export kind: {kind}")
    click(*_EXPORT_ITEMS[kind], displayed=True)
    time.sleep(1.2)
    text(filename)
    time.sleep(0.5)
    click(*_DIALOG_SAVE_BUTTON, displayed=True)
    time.sleep(2.0)
    print(f"exported {kind} as {filename}")


def command(query: str) -> None:
    """通过命令面板执行一条命令（避开坐标依赖）。

    流程：⌘⇧P 打开面板 → 粘贴查询 → 等候 → 回车（面板的首个候选
    会被选中；查询会过滤到唯一命令时它就是唯一候选）。
    """
    activate()
    key("cmd+shift+p")
    time.sleep(1.0)
    text(query)
    time.sleep(1.2)
    key("enter")
    time.sleep(1.5)
    print(f"command executed: {query}")


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd = argv[0]
    if cmd == "launch":
        launch()
    elif cmd == "shot":
        shot(
            argv[1] if len(argv) > 1 else "/tmp/markpure-shot.png",
            front=(len(argv) > 2 and argv[2] == "front"),
        )
    elif cmd == "command":
        command(argv[1])
    elif cmd == "clickw":
        click_window(float(argv[1]), float(argv[2]))
    elif cmd == "click":
        click(
            int(argv[1]),
            int(argv[2]),
            displayed=(len(argv) > 3 and argv[3] != "double"),
            double=(len(argv) > 3 and argv[3] == "double"),
        )
    elif cmd == "scale":
        print(f"display_scale = {display_scale():.4f}")
    elif cmd == "scroll":
        scroll(int(argv[1]), int(argv[2]), int(argv[3]) if len(argv) > 3 else -1)
    elif cmd == "key":
        activate()
        key(argv[1])
    elif cmd == "text":
        activate()
        text(argv[2] if len(argv) > 2 else argv[1])
    elif cmd == "probe":
        probe()
    elif cmd == "export":
        export(argv[1], argv[2])
    elif cmd == "workspace":
        print(ensure_workspace())
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
