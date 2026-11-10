"""
数据加载与清洗（唯一入口）
==========================
输入：赛事公开 CSV
输出：统一的 DataFrame / dict，以及可审计的数据质量报告。

核心规则
--------
1. 同一「作答事件编号」只保留修订版本最大的一条作为最终答案；
2. 「评分点得分」解析为 {评分点: 得分}；
3. 已评分参与统计；待评分、未作答不进入得分率；
4. 未作答不等于答错，只表示记录空白；
5. 学生、题目、节点引用异常单独列出，并在统计中隔离。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd

from config import DATA_FILES


# ---------------------------------------------------------------------------
# 基础解析
# ---------------------------------------------------------------------------

_POINT_SCORE_RE = re.compile(
    r"^\s*(Q\d{3}P\d+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$", re.IGNORECASE
)
_QUESTION_POINT_RE = re.compile(
    r"^\s*(Q\d{3}P\d+)\s*(.*?)\s*(\d+(?:\.\d+)?)\s*分\s*$", re.IGNORECASE
)


def parse_score_point_scores(text: Any) -> dict[str, float]:
    """解析 'Q015P1=1；Q015P2=1；Q015P3=0'。"""
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return {}
    result: dict[str, float] = {}
    for part in re.split(r"[；;]", str(text)):
        part = part.strip()
        if not part:
            continue
        m = _POINT_SCORE_RE.match(part)
        if m:
            result[m.group(1).upper()] = float(m.group(2))
    return result


def parse_question_points(text: Any) -> list[dict[str, Any]]:
    """解析题目表里的评分点说明。

    例：'Q006P1 写出周长关系 1分\\nQ006P2 正确列出周长算式 1分'
    """
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return []
    points: list[dict[str, Any]] = []
    for line in str(text).replace("\r", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _QUESTION_POINT_RE.match(line)
        if m:
            points.append(
                {
                    "编号": m.group(1).upper(),
                    "描述": m.group(2).strip() or "评分点",
                    "满分": float(m.group(3)),
                }
            )
        else:
            # 兼容只有编号、没有“几（分）”的情况
            m2 = re.match(r"^\s*(Q\d{3}P\d+)\s*(.*?)\s*$", line, re.IGNORECASE)
            if m2:
                points.append(
                    {
                        "编号": m2.group(1).upper(),
                        "描述": m2.group(2).strip() or "评分点",
                        "满分": 1.0,
                    }
                )
    return points


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"缺少数据文件：{path}")
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str, keep_default_na=False)


def _num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


# ---------------------------------------------------------------------------
# 加载
# ---------------------------------------------------------------------------

def load_all_data(source_root: str | Path | None = None) -> dict[str, Any]:
    """加载全部 CSV，返回原始 DataFrame 与派生索引。"""
    root = Path(source_root) if source_root else Path(__file__).resolve().parents[1] / "data"
    dfs: dict[str, Any] = {}
    for key, filename in DATA_FILES.items():
        dfs[key] = _read_csv(root / filename)

    dfs["records_raw"] = dfs["records"].copy()
    dfs["source_root"] = str(root)

    # 解析题目评分点
    questions = dfs["questions"].copy()
    questions["评分点列表"] = questions["评分点"].apply(parse_question_points)
    questions["满分_num"] = _num(questions["满分"])
    dfs["questions"] = questions

    # 学生与班级
    students = dfs["students"].copy()
    students["班级"] = students["模拟班级编号"]
    dfs["students"] = students

    # 节点可用题目
    nodes = dfs["nodes"].copy()
    nodes["可用题目列表"] = nodes["可用题目编号"].apply(
        lambda x: [q.strip() for q in re.split(r"[、,，;；\s]+", str(x)) if q.strip()]
    )
    dfs["nodes"] = nodes

    # 基础索引
    dfs["question_by_id"] = {
        row["材料编号"]: row for _, row in questions.iterrows()
    }
    dfs["student_by_id"] = {
        row["学生编号"]: row for _, row in students.iterrows()
    }
    dfs["node_by_id"] = {row["节点编号"]: row for _, row in nodes.iterrows()}
    dfs["point_meta"] = _build_point_meta(questions)
    return dfs


def _build_point_meta(questions: pd.DataFrame) -> dict[str, dict[str, Any]]:
    meta: dict[str, dict[str, Any]] = {}
    for _, row in questions.iterrows():
        qid = row["材料编号"]
        for point in row.get("评分点列表", []) or []:
            meta[point["编号"]] = {
                **point,
                "题目编号": qid,
                "指标编号": row.get("指标编号", ""),
                "主题编号": row.get("主题编号", ""),
                "满分": point.get("满分", 1.0),
            }
    return meta


# ---------------------------------------------------------------------------
# 作答记录清洗
# ---------------------------------------------------------------------------

def clean_records(dfs: dict[str, Any]) -> dict[str, Any]:
    """清洗作答记录，产出最终事件、全部版本、问题清单和质量统计。"""
    raw = dfs["records_raw"].copy()
    raw["修订版本_num"] = _num(raw["修订版本"]).fillna(1).astype(int)
    raw["得分_num"] = _num(raw["得分"])
    raw["满分_num"] = _num(raw["满分"])
    raw["评分点_dict"] = raw["评分点得分"].apply(parse_score_point_scores)
    raw["记录状态"] = raw["评分状态"].fillna("").str.strip()

    # 同一事件全部版本按修订版本升序
    raw = raw.sort_values(["作答事件编号", "修订版本_num"], kind="stable").reset_index(drop=True)
    version_counts = raw.groupby("作答事件编号")["修订版本_num"].agg(["count", "max"])
    version_map: dict[str, list[dict[str, Any]]] = {}
    for event_id, group in raw.groupby("作答事件编号", sort=False):
        versions = []
        for _, row in group.sort_values("修订版本_num").iterrows():
            versions.append(
                {
                    "记录编号": row["记录编号"],
                    "修订版本": int(row["修订版本_num"]),
                    "评分状态": row["记录状态"],
                    "得分": None if pd.isna(row["得分_num"]) else float(row["得分_num"]),
                    "满分": None if pd.isna(row["满分_num"]) else float(row["满分_num"]),
                    "学生最终作答": row["学生最终作答"],
                    "评分点得分": row["评分点_dict"],
                    "模拟提交时间": row["模拟提交时间"],
                }
            )
        version_map[event_id] = versions

    # 保留修订版本最大的记录
    final = (
        raw.sort_values("修订版本_num", ascending=False)
        .drop_duplicates("作答事件编号", keep="first")
        .copy()
        .sort_values(["学生编号", "节点编号", "材料编号"])
        .reset_index(drop=True)
    )
    final["修订次数"] = final["作答事件编号"].map(version_counts["count"]).sub(1).astype(int)
    final["版本轨迹"] = final["作答事件编号"].map(version_map)
    final["是否已评分"] = (final["记录状态"] == "已评分") & final["得分_num"].notna() & (final["满分_num"] > 0)
    final["是否待评分"] = final["记录状态"] == "待评分"
    final["是否未作答"] = final["记录状态"] == "未作答"
    final["得分率"] = final.apply(
        lambda r: (r["得分_num"] / r["满分_num"]) if r["是否已评分"] and r["满分_num"] else None,
        axis=1,
    )

    # 引用校验 / 异常标记
    issues: list[dict[str, Any]] = []
    issue_no = 0

    def add_issue(record_id: str, kind: str, severity: str, detail: str, student: str = "", question: str = "", node: str = "") -> None:
        nonlocal issue_no
        issue_no += 1
        issues.append(
            {
                "问题编号": f"QI{issue_no:03d}",
                "记录编号": record_id,
                "学生编号": student,
                "题目编号": question,
                "节点编号": node,
                "类型": kind,
                "严重程度": severity,
                "说明": detail,
            }
        )

    student_ids = set(dfs["student_by_id"])
    question_ids = set(dfs["question_by_id"])
    node_ids = set(dfs["node_by_id"])
    node_available = {
        nid: set(row["可用题目列表"]) for nid, row in dfs["node_by_id"].items()
    }
    point_meta = dfs["point_meta"]

    final["引用有效"] = True
    final["节点题目相符"] = True
    final["分值合规"] = True
    final["评分点合规"] = True
    final["评分点可用于统计"] = True
    final["可用于统计"] = True

    for idx, row in final.iterrows():
        rid = row["记录编号"]
        sid = row["学生编号"]
        qid = row["材料编号"]
        nid = row["节点编号"]
        ok = True

        if sid not in student_ids:
            final.at[idx, "引用有效"] = False
            ok = False
            add_issue(rid, "引用异常", "高", f"学生编号 {sid} 不在模拟学生表中", sid, qid, nid)
        if qid not in question_ids:
            final.at[idx, "引用有效"] = False
            ok = False
            add_issue(rid, "引用异常", "高", f"题目编号 {qid} 不在题目与材料表中", sid, qid, nid)
        elif dfs["question_by_id"][qid].get("材料类型") != "题目":
            final.at[idx, "引用有效"] = False
            ok = False
            add_issue(rid, "引用异常", "中", f"材料 {qid} 不是题目类材料", sid, qid, nid)

        if nid not in node_ids:
            final.at[idx, "引用有效"] = False
            ok = False
            add_issue(rid, "引用异常", "高", f"节点编号 {nid} 不在测验节点表中", sid, qid, nid)
        elif qid in question_ids and qid not in node_available.get(nid, set()):
            final.at[idx, "节点题目相符"] = False
            ok = False
            add_issue(
                rid,
                "节点题目不符",
                "中",
                f"题目 {qid} 未列入 {nid} 的可用题目范围（节点说明：{dfs['node_by_id'][nid].get('说明','')}）",
                sid,
                qid,
                nid,
            )

        if row["是否已评分"] and row["得分_num"] is not None:
            if row["得分_num"] < 0 or row["得分_num"] > row["满分_num"]:
                final.at[idx, "分值合规"] = False
                ok = False
                add_issue(
                    rid,
                    "分值越界",
                    "高",
                    f"得分 {row['得分_num']} 超出 [0, {row['满分_num']}] 范围，保留原始值但不参与统计",
                    sid,
                    qid,
                    nid,
                )

        if row["是否已评分"]:
            points = row["评分点_dict"]
            if not points:
                final.at[idx, "评分点合规"] = False
                final.at[idx, "评分点可用于统计"] = False
                ok = False
                add_issue(rid, "评分点缺失", "中", "状态为已评分，但没有可解析的评分点得分", sid, qid, nid)
            else:
                q_points = {
                    p["编号"]: p["满分"]
                    for p in (dfs["question_by_id"].get(qid, {}).get("评分点列表", []) or [])
                }
                unknown = [p for p in points if p not in q_points]
                if unknown:
                    final.at[idx, "评分点合规"] = False
                    final.at[idx, "评分点可用于统计"] = False
                    ok = False
                    add_issue(
                        rid,
                        "评分点异常",
                        "中",
                        f"评分点 {', '.join(unknown)} 不属于题目 {qid}",
                        sid,
                        qid,
                        nid,
                    )
                point_sum = sum(points.values())
                if abs(point_sum - float(row["得分_num"])) > 1e-6:
                    final.at[idx, "评分点可用于统计"] = False
                    add_issue(
                        rid,
                        "评分点与总分不一致",
                        "低",
                        f"评分点求和 {point_sum:g} 与得分 {row['得分_num']:g} 不一致；总分参与指标统计，评分点明细不参与知识点聚合",
                        sid,
                        qid,
                        nid,
                    )

        final.at[idx, "可用于统计"] = bool(ok)

    # 节点日期与提交时间一致性（用于发现错挂节点）
    for idx, row in final.iterrows():
        nid = row["节点编号"]
        if nid not in node_ids:
            continue
        node_date = str(dfs["node_by_id"][nid].get("模拟测验日期", ""))[:10]
        ts = str(row["模拟提交时间"])[:10]
        if node_date and ts and ts[:7] != node_date[:7]:
            # 仅标记，不改变原始节点；若同时节点题目不符，则已隔离
            add_issue(
                row["记录编号"],
                "时间与节点不一致",
                "低",
                f"提交日期 {ts} 与 {nid} 的模拟测验日期 {node_date} 不在同一月份",
                row["学生编号"],
                row["材料编号"],
                nid,
            )

    # 待评分 / 未作答本身是合法状态，单独记录
    for idx, row in final.iterrows():
        if row["是否待评分"]:
            add_issue(
                row["记录编号"],
                "待评分",
                "低",
                "最终版本仍为待评分，不进入得分率；需要教师补充评分后才能判断",
                row["学生编号"],
                row["材料编号"],
                row["节点编号"],
            )
        if row["是否未作答"]:
            add_issue(
                row["记录编号"],
                "未作答",
                "低",
                "记录空白，不按答错处理；不作为未掌握的直接证据",
                row["学生编号"],
                row["材料编号"],
                row["节点编号"],
            )

    # 记录覆盖概况
    per_student = (
        final.groupby("学生编号")
        .agg(
            最终记录数=("记录编号", "count"),
            已评分数=("是否已评分", "sum"),
            待评分数=("是否待评分", "sum"),
            未作答数=("是否未作答", "sum"),
            题目数=("材料编号", "nunique"),
        )
        .reset_index()
    )
    per_indicator = []
    for sid, group in final.groupby("学生编号"):
        for iid, qids in _indicator_questions(dfs).items():
            sub = group[group["材料编号"].isin(qids) & group["可用于统计"]]
            graded = sub[sub["是否已评分"]]
            per_indicator.append(
                {
                    "学生编号": sid,
                    "指标编号": iid,
                    "记录数": int(len(sub)),
                    "已评分数": int(len(graded)),
                    "题目数": int(graded["材料编号"].nunique()),
                    "待评分数": int(sub["是否待评分"].sum()),
                    "未作答数": int(sub["是否未作答"].sum()),
                }
            )

    quality = {
        "原始行数": int(len(raw)),
        "唯一作答事件数": int(raw["作答事件编号"].nunique()),
        "修订事件数": int((version_counts["count"] > 1).sum()),
        "修订记录数": int((version_counts["count"] - 1).clip(lower=0).sum()),
        "最终记录数": int(len(final)),
        "已评分数": int(final["是否已评分"].sum()),
        "待评分数": int(final["是否待评分"].sum()),
        "未作答数": int(final["是否未作答"].sum()),
        "可统计记录数": int((final["是否已评分"] & final["可用于统计"]).sum()),
        "被隔离记录数": int((~final["可用于统计"]).sum()),
        "问题数": len(issues),
        "问题类型分布": {},
        "按学生记录覆盖": per_student.to_dict(orient="records"),
        "按指标记录覆盖": per_indicator,
    }
    for issue in issues:
        quality["问题类型分布"][issue["类型"]] = quality["问题类型分布"].get(issue["类型"], 0) + 1

    # 给记录补充展示字段
    final["学生班级"] = final["学生编号"].map(
        {sid: row.get("模拟班级编号", "") for sid, row in dfs["student_by_id"].items()}
    )
    final["题目题型"] = final["材料编号"].map(
        {qid: row.get("题型", "") for qid, row in dfs["question_by_id"].items()}
    )
    final["指标编号"] = final["材料编号"].map(
        {qid: row.get("指标编号", "") for qid, row in dfs["question_by_id"].items()}
    )
    final["主题编号"] = final["材料编号"].map(
        {qid: row.get("主题编号", "") for qid, row in dfs["question_by_id"].items()}
    )

    return {
        "records_raw": raw,
        "records_final": final,
        "records_versions": version_map,
        "issues": issues,
        "quality": quality,
        "version_counts": version_counts,
    }


def _indicator_questions(dfs: dict[str, Any]) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for _, row in dfs["questions"].iterrows():
        if row.get("材料类型") != "题目":
            continue
        iid = str(row.get("指标编号", "")).strip()
        if not iid:
            continue
        mapping.setdefault(iid, []).append(row["材料编号"])
    return mapping


# ---------------------------------------------------------------------------
# 数据量校验
# ---------------------------------------------------------------------------

def validate_data(dfs: dict[str, Any], cleaned: dict[str, Any]) -> None:
    """启动时关键校验。不符合时抛出 AssertionError，便于尽早发现问题。"""
    assert len(dfs["students"]) == 40, f"应有 40 名学生，实际 {len(dfs['students'])}"
    assert len(dfs["questions"][dfs["questions"]["材料类型"] == "题目"]) == 54, "应有 54 道题目"
    assert len(dfs["nodes"]) == 2, f"应有 2 个测验节点，实际 {len(dfs['nodes'])}"
    assert len(dfs["records_raw"]) >= 700, f"原始记录应有 800 条左右，实际 {len(dfs['records_raw'])}"
    assert cleaned["quality"]["唯一作答事件数"] >= 700, "清洗后的唯一作答事件不足"
    assert len(dfs["course_requirements"]) == 9, "应有 9 个观察指标"
    # 关键引用
    assert not cleaned["records_final"]["学生编号"].isna().any(), "存在空学生编号"
    # 每个学生至少有一条最终记录
    assert cleaned["records_final"]["学生编号"].nunique() == 40, "并非所有学生都有记录"


def load_and_clean(source_root: str | Path | None = None) -> dict[str, Any]:
    dfs = load_all_data(source_root)
    cleaned = clean_records(dfs)
    validate_data(dfs, cleaned)
    dfs.update(cleaned)
    return dfs
