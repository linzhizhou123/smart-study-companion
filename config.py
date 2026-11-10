"""
智慧学伴 · 全局配置
====================
路径、数据文件定位与 LLM 配置。所有密钥均从环境变量读取，不写入代码。
"""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ZHIHUI_DATA_DIR", PROJECT_ROOT / "data"))
OUTPUT_DIR = Path(os.environ.get("ZHIHUI_OUTPUT_DIR", PROJECT_ROOT / "output"))
WEB_DIR = PROJECT_ROOT / "web"
DIST_DIR = PROJECT_ROOT / "dist"

# 数据文件（赛事公开数据）
DATA_FILES = {
    "course_requirements": "课程要求.csv",
    "questions": "题目与材料.csv",
    "students": "模拟学生.csv",
    "records": "作答记录.csv",
    "nodes": "测验节点.csv",
    "field_desc": "字段说明.csv",
}

# 文心一言 / 千帆配置
LLM_API_KEY = os.environ.get("WENXIN_API_KEY", "")
LLM_SECRET_KEY = os.environ.get("WENXIN_SECRET_KEY", "")
LLM_MODEL = os.environ.get("WENXIN_MODEL", "ernie-4.0-turbo-128k")
LLM_ENDPOINT = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions"
LLM_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
LLM_TIMEOUT = 60
LLM_ENABLED = bool(LLM_API_KEY and LLM_SECRET_KEY)


def find_source_root() -> Path:
    """定位源数据目录。

    优先使用项目 data/；其次按赛题环境可能出现的微信文件目录搜索。
    找不到时返回 PROJECT_ROOT/data，由 data_loader 给出更清晰的错误。
    """
    if (DATA_DIR / DATA_FILES["records"]).exists():
        return DATA_DIR
    candidates = [
        Path.home() / "Documents" / "xwechat_files",
        Path.home() / "Desktop",
    ]
    for base in candidates:
        if not base.exists():
            continue
        for root, _dirs, files in os.walk(base):
            if DATA_FILES["records"] in files and DATA_FILES["questions"] in files:
                return Path(root)
    return DATA_DIR


SOURCE_ROOT = find_source_root()


def ensure_dirs() -> None:
    for p in (OUTPUT_DIR, DIST_DIR, DATA_DIR / "textbooks"):
        p.mkdir(parents=True, exist_ok=True)
