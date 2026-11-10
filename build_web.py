"""
构建单文件网页
==============
把 output/web_data.json、样式与脚本内联进一个可直接双击打开的 HTML。

用法：
    python build_web.py
"""

from __future__ import annotations

import json
from pathlib import Path

from config import DIST_DIR, OUTPUT_DIR, WEB_DIR


JS_FILES = [
    "core.js",
    "chat.js",
    "views-home.js",
    "views-analysis.js",
    "views-student.js",
    "views-plan.js",
    "views-graph.js",
    "views-cases.js",
    "views-audit.js",
    "modals.js",
    "boot.js",
]


def _read_js() -> str:
    parts = []
    for name in JS_FILES:
        path = WEB_DIR / "js" / name
        if not path.exists():
            raise FileNotFoundError(f"缺少脚本：{path}")
        parts.append(f"/* ===== {name} ===== */\n" + path.read_text(encoding="utf-8"))
    return "\n\n".join(parts)


def build() -> Path:
    data_path = OUTPUT_DIR / "web_data.json"
    if not data_path.exists():
        raise FileNotFoundError("缺少 output/web_data.json，请先运行 python run.py")

    data = json.loads(data_path.read_text(encoding="utf-8"))
    template = (WEB_DIR / "template.html").read_text(encoding="utf-8")
    css = (WEB_DIR / "app.css").read_text(encoding="utf-8")
    js = _read_js()

    data_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # 避免 JSON 字符串中出现 </script> 提前结束脚本标签
    data_json = data_json.replace("</", "<\\/")

    html = (
        template
        .replace("__CSS__", css)
        .replace("__DATA__", data_json)
        .replace("__JS__", js)
    )

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    out = DIST_DIR / "数见-智慧学伴.html"
    out.write_text(html, encoding="utf-8")
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

    # 独立典型案例页：复用同一个单文件应用，打开后自动进入案例视图
    cases_html = html.replace(
        "</body>",
        "<script>window.addEventListener('load',function(){if(location.hash.indexOf('#/cases')!==0){location.hash='#/cases/case1_partial';}});</script></body>",
    )
    (OUTPUT_DIR / "typical_cases.html").write_text(cases_html, encoding="utf-8")

    size_mb = out.stat().st_size / 1024 / 1024
    print(f"      单文件网页：{out}（{size_mb:.1f} MB）")
    print(f"      典型案例页：{OUTPUT_DIR / 'typical_cases.html'}")
    return out


if __name__ == "__main__":
    build()
