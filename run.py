"""
智慧学伴 · 一键运行
===================
用法：
    python run.py                    # 完整流水线 + 生成网页数据
    python run.py --llm              # 有 WENXIN_API_KEY 时额外润色
    python run.py --ask "分析 D04"    # 命令行追问
    python run.py --student D07 --ask "为什么负号去括号总错"

输出：
    output/knowledge_graph.json
    output/diagnostics_individual.json
    output/diagnostics_group.json
    output/recommendations.json
    output/quality_report.json
    output/typical_cases.json
    output/field_descriptions.md
    output/web_data.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.agent import TeachingAgent


def main() -> int:
    parser = argparse.ArgumentParser(description="智慧学伴 · 学情诊断与个性化学习智能体")
    parser.add_argument("--data-dir", default=None, help="数据目录，默认项目 data/")
    parser.add_argument("--llm", action="store_true", help="启用文心一言润色（需配置环境变量）")
    parser.add_argument("--ask", default=None, help="运行后追加一个命令行追问")
    parser.add_argument("--student", default=None, help="追问时默认使用的学生编号")
    parser.add_argument("--no-run", action="store_true", help="只加载并追问，不跑完整流水线")
    args = parser.parse_args()

    agent = TeachingAgent(args.data_dir)

    if args.no_run:
        # 仍然需要诊断与建议，才能回答问题
        agent.run(use_llm=False)
    else:
        agent.run(use_llm=args.llm)

    # 构建单文件网页
    try:
        from build_web import build
        path = build()
        print(f"\n网页已生成：{path}")
    except Exception as exc:
        print(f"\n网页构建失败：{exc}")

    if args.ask:
        print("\n" + "=" * 60)
        print(f"问：{args.ask}")
        print("-" * 60)
        print(agent.ask(args.ask, student_id=args.student))
        print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
