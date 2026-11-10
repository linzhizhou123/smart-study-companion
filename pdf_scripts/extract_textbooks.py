"""
教材切片预处理
==============
把 data/pdf/B01—B08.pdf 提取为 data/textbooks/B01—B08.txt。
运行一次即可；网页与诊断直接使用题目表中的教材定位，不依赖全文。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "data" / "pdf"
OUT_DIR = ROOT / "data" / "textbooks"


def extract_one(pdf_path: Path, out_path: Path) -> int:
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    text = "\n\n".join(pages)
    out_path.write_text(text, encoding="utf-8")
    return len(pages)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(PDF_DIR.glob("B*.pdf"))
    if not pdfs:
        print(f"没有找到教材 PDF：{PDF_DIR}")
        return 1
    for pdf in pdfs:
        out = OUT_DIR / (pdf.stem + ".txt")
        count = extract_one(pdf, out)
        print(f"{pdf.name} -> {out.name}（{count} 页）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
