"""
模块 B — 学情诊断引擎
=====================
个体 + 群体 + 评分点级诊断。核心原则：
- 只用已有证据说话；没有记录不等于未掌握；
- 待评分、未作答不进入得分率；
- 评分点明细与总分不一致时，明细不参与知识点聚合；
- 同时给出证据数量、覆盖题目数和置信程度，避免过度解读。
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Any, Iterable

import pandas as pd

from src.knowledge_graph import (
    INDICATOR_PREREQUISITES,
    KNOWLEDGE_TAGS,
    REQUIRED_CONNECTIONS,
    SCORE_POINT_TAGS,
    THEME_MATERIALS,
)


STATUS_LABELS = {
    "secure": "掌握较好",
    "developing": "发展中",
    "needs_support": "需巩固",
    "limited": "记录不足",
    "no_evidence": "无记录",
    "not_measured": "本节点未测",
}

SEVERITY_LABELS = {"high": "高", "medium": "中", "low": "低"}


# ---------------------------------------------------------------------------
# 聚合工具
# ---------------------------------------------------------------------------

def _valid(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["可用于统计"].astype(bool)] if "可用于统计" in df else df


def _graded(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["是否已评分"].astype(bool)] if "是否已评分" in df else df


def _rate(score: float, max_score: float) -> float | None:
    if max_score is None or max_score <= 0:
        return None
    return round(float(score) / float(max_score), 4)


def _fnum(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _status(evidence: int, distinct_questions: int, rate: float | None, in_scope: bool = True) -> str:
    if not in_scope:
        return "not_measured"
    if evidence <= 0 or rate is None:
        return "no_evidence"
    if distinct_questions <= 1 or evidence <= 1:
        return "limited"
    if rate >= 0.85:
        return "secure"
    if rate >= 0.6:
        return "developing"
    return "needs_support"


def _confidence(evidence: int, distinct_questions: int) -> str:
    if evidence >= 4 and distinct_questions >= 3:
        return "high"
    if evidence >= 2 and distinct_questions >= 2:
        return "medium"
    return "low"


def aggregate_records(df: pd.DataFrame, expected_questions: int | None = None) -> dict[str, Any]:
    """对一批最终记录做得分聚合。"""
    sub = _valid(df)
    graded = _graded(sub)
    score = float(graded["得分_num"].fillna(0).sum()) if len(graded) else 0.0
    max_score = float(graded["满分_num"].fillna(0).sum()) if len(graded) else 0.0
    rate = _rate(score, max_score)
    evidence = int(len(graded))
    distinct = int(graded["材料编号"].nunique()) if evidence else 0
    full = int(((graded["得分_num"] - graded["满分_num"]).abs() <= 1e-6).sum()) if evidence else 0
    zero = int((graded["得分_num"].abs() <= 1e-6).sum()) if evidence else 0
    partial = max(evidence - full - zero, 0)
    return {
        "recordCount": int(len(sub)),
        "evidenceCount": evidence,
        "distinctQuestions": distinct,
        "score": round(score, 4),
        "maxScore": round(max_score, 4),
        "rate": rate,
        "fullScoreCount": full,
        "partialScoreCount": partial,
        "zeroScoreCount": zero,
        "pendingCount": int(sub["是否待评分"].sum()) if len(sub) else 0,
        "unansweredCount": int(sub["是否未作答"].sum()) if len(sub) else 0,
        "invalidCount": int((~sub["可用于统计"]).sum()) if len(sub) else 0,
        "expectedQuestions": expected_questions,
        "coverage": round(distinct / expected_questions, 4) if expected_questions else None,
        "status": _status(evidence, distinct, rate),
        "confidence": _confidence(evidence, distinct),
    }


def _questions_by_indicator(kg: dict[str, Any]) -> dict[str, list[str]]:
    return {iid: list(meta["题目列表"]) for iid, meta in kg["指标索引"].items()}


def _node_in_scope(dfs: dict[str, Any], node_id: str, indicator_id: str) -> bool:
    node = dfs["node_by_id"].get(node_id)
    if node is None:
        return False
    qids = set(node.get("可用题目列表", []))
    return any(q in qids for q in dfs.get("indicator_questions", {}).get(indicator_id, []))


def _indicator_questions(dfs: dict[str, Any]) -> dict[str, list[str]]:
    if "indicator_questions" in dfs:
        return dfs["indicator_questions"]
    mapping: dict[str, list[str]] = defaultdict(list)
    for _, row in dfs["questions"].iterrows():
        if row.get("材料类型") == "题目":
            mapping[str(row.get("指标编号", ""))].append(row["材料编号"])
    dfs["indicator_questions"] = dict(mapping)
    return dfs["indicator_questions"]


def _theme_indicators(kg: dict[str, Any]) -> dict[str, list[str]]:
    return {tid: [i["指标编号"] for i in theme["指标列表"]] for tid, theme in
            {t["主题编号"]: t for t in kg["主题列表"]}.items()}


# ---------------------------------------------------------------------------
# 评分点级诊断
# ---------------------------------------------------------------------------

def diagnose_score_points(
    records: pd.DataFrame,
    kg: dict[str, Any],
    node: str | None = None,
    indicator: str | None = None,
) -> list[dict[str, Any]]:
    """按知识点标签聚合评分点，识别系统性问题与单次失误。"""
    df = _valid(records)
    if node:
        df = df[df["节点编号"] == node]
    if indicator:
        df = df[df["指标编号"] == indicator]
    df = _graded(df)
    if "评分点可用于统计" in df:
        df = df[df["评分点可用于统计"].astype(bool)]

    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "total": 0.0,
            "max": 0.0,
            "occurrences": 0,
            "questions": set(),
            "points": [],
            "nodeBreakdown": defaultdict(lambda: {"score": 0.0, "max": 0.0, "occurrences": 0}),
        }
    )

    question_lookup = kg["题库"]
    for _, row in df.iterrows():
        qid = row["材料编号"]
        qmeta = question_lookup.get(qid, {})
        point_meta = {p["编号"]: p for p in qmeta.get("评分点", [])}
        for pid, value in (row["评分点_dict"] or {}).items():
            tag_id = SCORE_POINT_TAGS.get(pid)
            if not tag_id:
                continue
            pm = point_meta.get(pid, {})
            point_max = float(pm.get("满分", 1.0))
            bucket = buckets[tag_id]
            bucket["total"] += float(value)
            bucket["max"] += point_max
            bucket["occurrences"] += 1
            bucket["questions"].add(qid)
            bucket["points"].append(
                {
                    "评分点": pid,
                    "题目编号": qid,
                    "节点编号": row["节点编号"],
                    "记录编号": row["记录编号"],
                    "得分": float(value),
                    "满分": point_max,
                    "描述": pm.get("描述", ""),
                    "学生作答": row.get("学生最终作答", ""),
                    "解答过程": row.get("解答过程", ""),
                    "评分状态": row["评分状态"],
                }
            )
            nb = bucket["nodeBreakdown"][row["节点编号"]]
            nb["score"] += float(value)
            nb["max"] += point_max
            nb["occurrences"] += 1

    results = []
    for tag_id, bucket in buckets.items():
        total = bucket["total"]
        max_score = bucket["max"]
        rate = _rate(total, max_score)
        occ = bucket["occurrences"]
        questions = sorted(bucket["questions"])
        if rate is not None and rate < 0.5 and occ >= 2:
            # 跨题连续失分才算“系统性薄弱”；同一道题多个评分点失分单独标注
            if len(questions) >= 2:
                pattern = "systemic"
                severity = "high" if (occ >= 3 or rate == 0) else "medium"
            else:
                pattern = "within_question"
                severity = "medium"
        elif rate is not None and rate < 0.5 and occ == 1:
            pattern = "single"
            severity = "low"
        elif rate is not None and rate >= 0.85:
            pattern = "mastered"
            severity = "low"
        else:
            pattern = "developing"
            severity = "low"
        meta = KNOWLEDGE_TAGS.get(tag_id, {})
        results.append(
            {
                "知识点编号": tag_id,
                "知识点": meta.get("名称", tag_id),
                "说明": meta.get("说明", ""),
                "主题编号": meta.get("主题", ""),
                "指标编号": kg["知识点索引"].get(tag_id, {}).get("指标编号", []),
                "得分率": rate,
                "得分": round(total, 4),
                "满分": round(max_score, 4),
                "被考核次数": occ,
                "题目数": len(questions),
                "关联题目": questions,
                "关联评分点": [p["评分点"] for p in bucket["points"]],
                "模式": pattern,
                "严重程度": severity,
                "节点分布": {
                    nid: {**vals, "得分率": _rate(vals["score"], vals["max"])}
                    for nid, vals in bucket["nodeBreakdown"].items()
                },
                "证据": sorted(
                    bucket["points"],
                    key=lambda p: (p["节点编号"], p["题目编号"], p["评分点"]),
                ),
            }
        )

    results.sort(
        key=lambda r: (
            {"high": 0, "medium": 1, "low": 2}.get(r["严重程度"], 3),
            {"systemic": 0, "single": 1, "developing": 2, "mastered": 3}.get(r["模式"], 4),
            r["得分率"] if r["得分率"] is not None else 1,
        )
    )
    return results


def untested_tags(kg: dict[str, Any], tested: Iterable[str]) -> list[dict[str, Any]]:
    tested_set = set(tested)
    out = []
    for tag_id, meta in KNOWLEDGE_TAGS.items():
        if tag_id in tested_set:
            continue
        index = kg["知识点索引"].get(tag_id, {})
        out.append(
            {
                "知识点编号": tag_id,
                "知识点": meta["名称"],
                "说明": meta["说明"],
                "主题编号": meta["主题"],
                "关联题目": index.get("题目", []),
                "被考核次数": 0,
                "状态": "记录空白",
            }
        )
    return out


# ---------------------------------------------------------------------------
# 修订版本追踪
# ---------------------------------------------------------------------------

def analyze_revisions(
    student_id: str,
    final_records: pd.DataFrame,
    versions_map: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    df = _valid(final_records)
    details = []
    improved = worsened = same = pending_to_graded = 0
    for _, row in df.iterrows():
        event_id = row["作答事件编号"]
        versions = versions_map.get(event_id, [])
        if len(versions) <= 1:
            continue
        first = versions[0]
        last = versions[-1]
        first_score = first.get("得分")
        last_score = last.get("得分")
        if first.get("评分状态") == "待评分" and last.get("评分状态") == "已评分":
            pending_to_graded += 1
        change = "unknown"
        if first_score is not None and last_score is not None:
            if last_score > first_score + 1e-6:
                change = "improved"
                improved += 1
            elif last_score < first_score - 1e-6:
                change = "worsened"
                worsened += 1
            else:
                change = "same"
                same += 1
        # 第几次修订后达到满分
        full_at = None
        max_score = row["满分_num"]
        for v in versions:
            if v.get("得分") is not None and max_score is not None and abs(v["得分"] - max_score) <= 1e-6:
                full_at = v["修订版本"]
                break
        details.append(
            {
                "题目编号": row["材料编号"],
                "节点编号": row["节点编号"],
                "修订次数": len(versions) - 1,
                "首次评分状态": first.get("评分状态"),
                "最终评分状态": last.get("评分状态"),
                "首次得分": first_score,
                "最终得分": last_score,
                "满分": row["满分_num"],
                "变化": change,
                "最终答案": last.get("学生最终作答", row.get("学生最终作答", "")),
                "版本轨迹": versions,
                "达到满分版本": full_at,
                "评分点": row["评分点_dict"],
                "最终记录编号": row["记录编号"],
            }
        )
    return {
        "有修订的题目数": len(details),
        "改对题数": improved,
        "改错题数": worsened,
        "持平题数": same,
        "待评分转已评分": pending_to_graded,
        "详情": details,
        "解读": _revision_interpretation(details, improved, worsened),
    }


def _revision_interpretation(details: list[dict[str, Any]], improved: int, worsened: int) -> str:
    if not details:
        return "本生没有检测到同一作答事件的修订版本。"
    parts = [f"共 {len(details)} 道题出现修订"]
    if improved:
        parts.append(f"{improved} 道修订后得分提高")
    if worsened:
        parts.append(f"{worsened} 道修订后得分反而下降，说明改动未必等于改对，需要回看改动步骤")
    if not improved and not worsened:
        parts.append("修订前后得分持平")
    return "；".join(parts) + "。"


# ---------------------------------------------------------------------------
# 纵向对比
# ---------------------------------------------------------------------------

def _interpret_change(delta: float | None) -> str:
    if delta is None:
        return "记录不足，暂不能比较"
    if delta >= 0.1:
        return "有进步"
    if delta <= -0.1:
        return "有所退步，需要关注"
    return "基本持平"


def longitudinal_comparison(
    records: pd.DataFrame,
    kg: dict[str, Any],
    dfs: dict[str, Any],
) -> dict[str, Any]:
    df = _valid(records)
    theme_indicators = _theme_indicators(kg)
    indicators: dict[str, Any] = {}
    for iid in kg["指标索引"]:
        n01 = aggregate_records(df[(df["节点编号"] == "N01") & (df["指标编号"] == iid)])
        n02 = aggregate_records(df[(df["节点编号"] == "N02") & (df["指标编号"] == iid)])
        if n01["evidenceCount"] == 0 and n02["evidenceCount"] == 0:
            continue
        change = None
        if n01["rate"] is not None and n02["rate"] is not None:
            change = round(n02["rate"] - n01["rate"], 4)
        indicators[iid] = {
            "指标编号": iid,
            "观察指标": kg["指标索引"][iid]["观察指标"],
            "N01": n01,
            "N02": n02,
            "变化": change,
            "解读": _interpret_change(change),
            "仅单节点有证据": bool((n01["evidenceCount"] == 0) != (n02["evidenceCount"] == 0)),
        }

    tags: dict[str, Any] = {}
    for node in ("N01", "N02"):
        for item in diagnose_score_points(df, kg, node=node):
            tag = item["知识点编号"]
            tags.setdefault(tag, {"知识点编号": tag, "知识点": item["知识点"], "N01": None, "N02": None})
            tags[tag][node] = {
                "得分率": item["得分率"],
                "被考核次数": item["被考核次数"],
                "关联题目": item["关联题目"],
            }
    tag_changes = {}
    for tag, vals in tags.items():
        if vals["N01"] and vals["N02"] and vals["N01"]["得分率"] is not None and vals["N02"]["得分率"] is not None:
            delta = round(vals["N02"]["得分率"] - vals["N01"]["得分率"], 4)
            tag_changes[tag] = {**vals, "变化": delta, "解读": _interpret_change(delta)}
        else:
            tag_changes[tag] = {**vals, "变化": None, "解读": "仅单节点有评分点证据"}

    return {
        "指标": indicators,
        "知识点": tag_changes,
        "说明": "只比较同一指标在两个节点都有已评分证据的部分；只有一个节点有记录时，不强行判定进步或退步。",
    }


# ---------------------------------------------------------------------------
# 交叉关联
# ---------------------------------------------------------------------------

def cross_topic_analysis(student_diag: dict[str, Any], kg: dict[str, Any]) -> list[dict[str, Any]]:
    chains = []
    indicators = student_diag["指标诊断"]
    for iid, meta in kg["指标索引"].items():
        target = indicators.get(iid, {})
        target_rate = target.get("rate")
        target_status = target.get("status")
        if target_status not in {"needs_support", "developing"} or target.get("evidenceCount", 0) < 1:
            continue
        for pre in meta.get("前置指标", []):
            pre_stat = indicators.get(pre, {})
            pre_rate = pre_stat.get("rate")
            pre_status = pre_stat.get("status")
            if pre_status in {"needs_support"} and pre_rate is not None:
                chains.append(
                    {
                        "类型": "前置薄弱",
                        "目标指标": iid,
                        "目标名称": meta["观察指标"],
                        "目标得分率": target_rate,
                        "前置指标": pre,
                        "前置名称": kg["指标索引"].get(pre, {}).get("观察指标", pre),
                        "前置得分率": pre_rate,
                        "说明": f"{meta['观察指标']}目前得分率 {target_rate:.0%}，而前置的{kg['指标索引'].get(pre, {}).get('观察指标', pre)}为 {pre_rate:.0%}。建议先稳定前置技能，再回到目标指标；两者是否存在因果关系，需要结合更多作答过程确认。",
                        "严重程度": "高" if target_rate is not None and target_rate < 0.4 else "中",
                        "关联题目": sorted(set(meta.get("题目列表", [])) | set(kg["指标索引"].get(pre, {}).get("题目", [])))[:6],
                    }
                )
            elif pre_status in {"limited", "no_evidence"}:
                chains.append(
                    {
                        "类型": "前置记录不足",
                        "目标指标": iid,
                        "目标名称": meta["观察指标"],
                        "目标得分率": target_rate,
                        "前置指标": pre,
                        "前置名称": kg["指标索引"].get(pre, {}).get("观察指标", pre),
                        "前置得分率": pre_rate,
                        "说明": f"{meta['观察指标']}已有低分证据，但前置的{kg['指标索引'].get(pre, {}).get('观察指标', pre)}只有 {pre_stat.get('evidenceCount', 0)} 条有效证据，暂不能确认是否由前置知识导致。建议先补一次前置观察。",
                        "严重程度": "中",
                        "关联题目": sorted(set(meta.get("题目列表", [])) | set(kg["指标索引"].get(pre, {}).get("题目", [])))[:6],
                    }
                )
    chains.sort(key=lambda x: (0 if x["严重程度"] == "高" else 1, x["目标指标"]))
    return chains


# ---------------------------------------------------------------------------
# 个体诊断
# ---------------------------------------------------------------------------

def diagnose_individual(
    student_id: str,
    dfs: dict[str, Any],
    kg: dict[str, Any],
    records: pd.DataFrame | None = None,
) -> dict[str, Any]:
    final = dfs["records_final"]
    if records is None:
        records = final[final["学生编号"] == student_id].copy()
    records = records.copy()
    student = dfs["student_by_id"].get(student_id, {})
    q_ind = _indicator_questions(dfs)
    theme_inds = _theme_indicators(kg)
    all_indicator_ids = list(kg["指标索引"].keys())

    # 总体
    total_expected = len(kg["题库"])
    overall = aggregate_records(records, total_expected)
    if overall["evidenceCount"] < 5:
        overall_status = "limited" if overall["evidenceCount"] > 0 else "no_evidence"
    else:
        overall_status = _status(overall["evidenceCount"], overall["distinctQuestions"], overall["rate"])
    overall["status"] = overall_status

    # 主题
    themes = {}
    for tid, meta in {t["主题编号"]: t for t in kg["主题列表"]}.items():
        theme_records = records[records["主题编号"] == tid]
        expected = sum(len(q_ind.get(i, [])) for i in theme_inds.get(tid, []))
        stats = aggregate_records(theme_records, expected)
        stats["主题编号"] = tid
        stats["主题名称"] = meta["主题名称"]
        themes[tid] = stats

    # 指标（全部）
    indicators = {}
    for iid, meta in kg["指标索引"].items():
        sub = records[records["指标编号"] == iid]
        expected = len(q_ind.get(iid, []))
        stats = aggregate_records(sub, expected)
        stats.update(
            {
                "指标编号": iid,
                "观察指标": meta["观察指标"],
                "主题编号": meta["主题编号"],
                "前置指标": meta["前置指标"],
                "教材页码": meta["教材页码"],
                "状态标签": STATUS_LABELS.get(stats["status"], stats["status"]),
            }
        )
        # 本指标内的知识点
        tags = diagnose_score_points(sub, kg, indicator=iid)
        stats["知识点诊断"] = tags
        indicators[iid] = stats

    # 节点诊断
    nodes: dict[str, Any] = {}
    for nid in dfs["node_by_id"]:
        node_records = records[records["节点编号"] == nid]
        node_overall = aggregate_records(node_records)
        node_overall["status"] = (
            "limited" if 0 < node_overall["evidenceCount"] < 5 else
            ("no_evidence" if node_overall["evidenceCount"] == 0 else
             _status(node_overall["evidenceCount"], node_overall["distinctQuestions"], node_overall["rate"]))
        )
        node_themes = {}
        for tid, meta in {t["主题编号"]: t for t in kg["主题列表"]}.items():
            sub = node_records[node_records["主题编号"] == tid]
            node_themes[tid] = aggregate_records(sub)
            node_themes[tid]["主题名称"] = meta["主题名称"]
        node_indicators = {}
        for iid, meta in kg["指标索引"].items():
            sub = node_records[node_records["指标编号"] == iid]
            expected = len(q_ind.get(iid, []))
            in_scope = _node_in_scope(dfs, nid, iid)
            stats = aggregate_records(sub, expected)
            # 未测到的指标不能因“0 条记录”判为无记录
            if not in_scope:
                stats["status"] = "not_measured"
            elif stats["evidenceCount"] == 0:
                stats["status"] = "no_evidence"
            else:
                stats["status"] = _status(stats["evidenceCount"], stats["distinctQuestions"], stats["rate"])
            stats.update(
                {
                    "指标编号": iid,
                    "观察指标": meta["观察指标"],
                    "主题编号": meta["主题编号"],
                    "在测范围内": in_scope,
                    "状态标签": STATUS_LABELS.get(stats["status"], stats["status"]),
                }
            )
            node_indicators[iid] = stats
        nodes[nid] = {
            "节点编号": nid,
            "节点说明": dfs["node_by_id"][nid].get("说明", ""),
            "模拟测验日期": dfs["node_by_id"][nid].get("模拟测验日期", ""),
            "总体": node_overall,
            "主题诊断": node_themes,
            "指标诊断": node_indicators,
        }

    # 评分点级诊断
    score_all = diagnose_score_points(records, kg)
    score_n01 = diagnose_score_points(records, kg, node="N01")
    score_n02 = diagnose_score_points(records, kg, node="N02")
    tested_tags = {x["知识点编号"] for x in score_all}
    score_points = {
        "全部": score_all,
        "N01": score_n01,
        "N02": score_n02,
        "未测知识点": untested_tags(kg, tested_tags),
    }

    # 修订
    revisions = analyze_revisions(student_id, records, dfs["records_versions"])

    # 纵向
    longitudinal = longitudinal_comparison(records, kg, dfs)

    # 记录概况
    record_profile = {
        "最终记录数": int(len(records)),
        "有效记录数": int((records["可用于统计"]).sum()),
        "已评分数": int(records["是否已评分"].sum()),
        "待评分数": int(records["是否待评分"].sum()),
        "未作答数": int(records["是否未作答"].sum()),
        "覆盖题目数": int(records["材料编号"].nunique()),
        "覆盖指标数": int(records[records["是否已评分"]]["指标编号"].nunique()),
        "覆盖主题数": int(records[records["是否已评分"]]["主题编号"].nunique()),
        "记录是否充分": "充分" if overall["evidenceCount"] >= 12 else ("偏少" if overall["evidenceCount"] >= 5 else "不足"),
        "说明": (
            "有效证据达到 12 条以上，可做较稳定的指标判断。"
            if overall["evidenceCount"] >= 12
            else "有效证据偏少，以下判断需要结合更多记录确认；没有记录的指标只代表空白，不代表未掌握。"
        ),
    }

    diag = {
        "学生编号": student_id,
        "所属班级": student.get("模拟班级编号", ""),
        "年级": student.get("年级", "7"),
        "总体": overall,
        "主题诊断": themes,
        "指标诊断": indicators,
        "节点诊断": nodes,
        "评分点级诊断": score_points,
        "修订模式": revisions,
        "纵向对比": longitudinal,
        "记录概况": record_profile,
    }

    # 交叉关联 / 优先级
    diag["交叉关联"] = cross_topic_analysis(diag, kg)
    diag["建议优先级排序依据"] = build_priority_basis(diag, kg)
    diag["诊断叙述"] = build_diagnosis_narrative(diag, kg)
    return diag


def _weak_indicators(diag: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for iid, stat in diag["指标诊断"].items():
        if stat["status"] == "needs_support" and stat["evidenceCount"] >= 1:
            out.append({"指标编号": iid, **stat})
    out.sort(key=lambda x: (x["rate"] if x["rate"] is not None else 1, -x["evidenceCount"]))
    return out


def _limited_indicators(diag: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for iid, stat in diag["指标诊断"].items():
        if stat["status"] in {"limited", "no_evidence"}:
            out.append({"指标编号": iid, **stat})
    out.sort(key=lambda x: (x["evidenceCount"], x["指标编号"]))
    return out


def build_priority_basis(diag: dict[str, Any], kg: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for tag in diag["评分点级诊断"]["全部"]:
        if tag["模式"] == "systemic":
            items.append(
                {
                    "优先级": 1 if tag["严重程度"] == "high" else 2,
                    "类型": "系统性薄弱点",
                    "原因": f"{tag['知识点']}在 {tag['被考核次数']} 个评分点上只有 {tag['得分率']:.0%} 的得分率，涉及题目 {'、'.join(tag['关联题目'])}。",
                    "知识点编号": tag["知识点编号"],
                    "指标编号": tag["指标编号"],
                    "关联题目": tag["关联题目"],
                    "严重程度": tag["严重程度"],
                }
            )
        elif tag["模式"] == "within_question":
            items.append(
                {
                    "优先级": 2,
                    "类型": "同题多步失分",
                    "原因": f"{tag['知识点']}在 {tag['关联题目'][0]} 的 {tag['被考核次数']} 个评分点上连续失分（得分率 {tag['得分率']:.0%}）。这道题的步骤需要拆开重练，而不是换更多同类题。",
                    "知识点编号": tag["知识点编号"],
                    "指标编号": tag["指标编号"],
                    "关联题目": tag["关联题目"],
                    "严重程度": "中",
                }
            )
    for chain in diag["交叉关联"]:
        items.append(
            {
                "优先级": 2 if chain["严重程度"] == "高" else 3,
                "类型": "前置关联",
                "原因": chain["说明"],
                "知识点编号": "",
                "指标编号": [chain["目标指标"], chain["前置指标"]],
                "关联题目": chain["关联题目"],
                "严重程度": chain["严重程度"],
            }
        )
    for stat in _limited_indicators(diag):
        items.append(
            {
                "优先级": 3,
                "类型": "记录不足",
                "原因": f"{stat['观察指标']}目前只有 {stat['evidenceCount']} 条有效证据，覆盖 {stat['distinctQuestions']} 道题，暂不能判断掌握程度；应补充观察而不是直接补弱。",
                "知识点编号": "",
                "指标编号": [stat["指标编号"]],
                "关联题目": kg["指标索引"].get(stat["指标编号"], {}).get("题目", [])[:4],
                "严重程度": "中",
            }
        )
    for stat in diag["指标诊断"].values():
        if stat["status"] == "secure" and stat["evidenceCount"] >= 2 and diag["总体"]["evidenceCount"] >= 5:
            items.append(
                {
                    "优先级": 4,
                    "类型": "表现较好",
                    "原因": f"{stat['观察指标']}得分率 {stat['rate']:.0%}，有 {stat['evidenceCount']} 条有效证据，可以安排同主题的变式或迁移任务。",
                    "知识点编号": "",
                    "指标编号": [stat["指标编号"]],
                    "关联题目": kg["指标索引"].get(stat["指标编号"], {}).get("题目", [])[:4],
                    "严重程度": "低",
                }
            )
    # 去重：同类型+同指标+同原因
    seen = set()
    unique = []
    for item in sorted(items, key=lambda x: (x["优先级"], -{"高": 3, "中": 2, "低": 1}.get(x["严重程度"], 0))):
        key = (item["类型"], tuple(item["指标编号"]) if isinstance(item["指标编号"], list) else item["指标编号"], item["原因"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def build_diagnosis_narrative(diag: dict[str, Any], kg: dict[str, Any]) -> dict[str, Any]:
    overall = diag["总体"]
    lines = []
    if overall["evidenceCount"] == 0:
        lines.append(f"{diag['学生编号']}目前没有已评分的作答证据，暂时不能对掌握情况下结论。")
    else:
        lines.append(
            f"{diag['学生编号']}共有 {diag['记录概况']['最终记录数']} 条最终记录，其中 {overall['evidenceCount']} 条已评分，"
            f"总体得分率 {overall['rate']:.0%}（{overall['score']:g}/{overall['maxScore']:g} 分）。"
        )
    if diag["记录概况"]["待评分数"] or diag["记录概况"]["未作答数"]:
        lines.append(
            f"另有 {diag['记录概况']['待评分数']} 条待评分、{diag['记录概况']['未作答数']} 条未作答；"
            "这些记录不进入得分率，也不按答错处理。"
        )
    weak = _weak_indicators(diag)
    if weak:
        top = weak[:2]
        lines.append(
            "需要优先巩固的是：" + "；".join(
                f"{x['观察指标']}（{x['rate']:.0%}，{x['evidenceCount']} 条证据）" for x in top
            ) + "。"
        )
    systemic = [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"]
    if systemic:
        s = systemic[0]
        lines.append(
            f"评分点级证据显示，{s['知识点']}在 {s['被考核次数']} 次考核中得分率仅 {s['得分率']:.0%}，"
            f"涉及 {'、'.join(s['关联题目'])}，属于系统性问题，而不是某一道题的偶发失误。"
        )
    limited = _limited_indicators(diag)
    if limited:
        names = "、".join(x["观察指标"] for x in limited[:3])
        lines.append(f"以下指标的有效证据不超过 1 道题，暂不能判断：{names}。这些部分更适合先做补充观察。")
    strong = [x for x in diag["指标诊断"].values() if x["status"] == "secure" and x["evidenceCount"] >= 2]
    # 记录总体不足时，不把“少数题全对”写成“表现稳定”
    if strong and diag["总体"]["evidenceCount"] >= 5:
        lines.append("表现较稳的指标：" + "、".join(x["观察指标"] for x in strong[:3]) + "。")
    elif strong:
        lines.append("部分指标在现有少量题目上全部正确，但总有效证据不足 5 条，暂不作为“已掌握”的结论。")
    return {"摘要": "".join(lines), "要点": lines}


# ---------------------------------------------------------------------------
# 群体诊断
# ---------------------------------------------------------------------------

def diagnose_group(
    class_id: str,
    dfs: dict[str, Any],
    kg: dict[str, Any],
    student_diagnostics: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    students = dfs["students"]
    if class_id == "ALL":
        class_students = students["学生编号"].tolist()
    else:
        class_students = students[students["模拟班级编号"] == class_id]["学生编号"].tolist()
    records = dfs["records_final"][dfs["records_final"]["学生编号"].isin(class_students)]
    q_ind = _indicator_questions(dfs)
    theme_inds = _theme_indicators(kg)

    overall = aggregate_records(records)
    themes = {}
    for tid, meta in {t["主题编号"]: t for t in kg["主题列表"]}.items():
        expected = sum(len(q_ind.get(i, [])) for i in theme_inds[tid])
        themes[tid] = aggregate_records(records[records["主题编号"] == tid], expected)
        themes[tid]["主题名称"] = meta["主题名称"]

    indicators = {}
    for iid, meta in kg["指标索引"].items():
        sub = records[records["指标编号"] == iid]
        stats = aggregate_records(sub, len(q_ind.get(iid, [])))
        student_rates = []
        for sid in class_students:
            d = (student_diagnostics or {}).get(sid)
            if not d:
                continue
            stat = d["指标诊断"].get(iid, {})
            if stat.get("evidenceCount", 0) > 0 and stat.get("rate") is not None:
                student_rates.append(stat["rate"])
        mean = round(statistics.fmean(student_rates), 4) if student_rates else None
        std = round(statistics.pstdev(student_rates), 4) if len(student_rates) >= 2 else 0.0
        coverage = round(len(student_rates) / len(class_students), 4) if class_students else 0
        flags = []
        if stats["rate"] is not None and stats["rate"] < 0.5 and len(student_rates) >= 5:
            flags.append("common_issue")
        if std >= 0.2 and len(student_rates) >= 5:
            flags.append("differentiation")
        if coverage < 0.5:
            flags.append("coverage_gap")
        indicators[iid] = {
            **stats,
            "指标编号": iid,
            "观察指标": meta["观察指标"],
            "主题编号": meta["主题编号"],
            "学生证据数": len(student_rates),
            "学生得分率均值": mean,
            "学生得分率标准差": std,
            "学生得分率最低": round(min(student_rates), 4) if student_rates else None,
            "学生得分率最高": round(max(student_rates), 4) if student_rates else None,
            "覆盖率": coverage,
            "flags": flags,
            "状态标签": STATUS_LABELS.get(stats["status"], stats["status"]),
        }

    common_issues = []
    for iid, stat in indicators.items():
        if "common_issue" in stat["flags"]:
            common_issues.append(
                {
                    "指标编号": iid,
                    "观察指标": stat["观察指标"],
                    "得分率": stat["rate"],
                    "学生证据数": stat["学生证据数"],
                    "说明": f"全班在该指标上的合并得分率为 {stat['rate']:.0%}（{stat['学生证据数']} 名学生有证据），低于 50%。",
                }
            )
    common_issues.sort(key=lambda x: x["得分率"] if x["得分率"] is not None else 1)

    differentiation = []
    for iid, stat in indicators.items():
        if "differentiation" in stat["flags"]:
            differentiation.append(
                {
                    "指标编号": iid,
                    "观察指标": stat["观察指标"],
                    "标准差": stat["学生得分率标准差"],
                    "最低": stat["学生得分率最低"],
                    "最高": stat["学生得分率最高"],
                    "说明": f"学生得分率标准差 {stat['学生得分率标准差']:.0%}，最高与最低相差 {(stat['学生得分率最高'] or 0) - (stat['学生得分率最低'] or 0):.0%}，说明班内差异较大。",
                }
            )
    differentiation.sort(key=lambda x: -(x["标准差"] or 0))

    coverage_gaps = [
        {
            "指标编号": iid,
            "观察指标": stat["观察指标"],
            "覆盖率": stat["覆盖率"],
            "说明": f"只有 {stat['学生证据数']}/{len(class_students)} 名学生在该指标有有效证据，群体结论只能覆盖这部分学生。",
        }
        for iid, stat in indicators.items() if "coverage_gap" in stat["flags"]
    ]

    # 班级评分点级
    class_tags = diagnose_score_points(records, kg)
    common_tags = [t for t in class_tags if t["模式"] == "systemic" and t["被考核次数"] >= 5]
    common_tags.sort(key=lambda x: (x["得分率"] if x["得分率"] is not None else 1, -x["被考核次数"]))

    group_suggestions = []
    for tag in common_tags[:5]:
        questions = tag["关联题目"]
        group_suggestions.append(
            {
                "知识点编号": tag["知识点编号"],
                "知识点": tag["知识点"],
                "得分率": tag["得分率"],
                "被考核次数": tag["被考核次数"],
                "建议题目": questions,
                "说明": f"全班在{tag['知识点']}上共 {tag['被考核次数']} 次考核、得分率 {tag['得分率']:.0%}。可先用 {'、'.join(questions[:2])} 做课堂共性问题讲评，再用 {'、'.join(questions[2:4])} 做变式检测。",
            }
        )

    narrative = _group_narrative(class_id, len(class_students), overall, common_issues, differentiation, coverage_gaps)

    return {
        "班级编号": class_id,
        "班级总览": {
            "学生数": len(class_students),
            "平均得分率": overall["rate"],
            "有效证据数": overall["evidenceCount"],
            "主题平均": {tid: t["rate"] for tid, t in themes.items()},
            "主题详情": themes,
            "总体": overall,
        },
        "指标诊断": indicators,
        "共性问题": common_issues,
        "相对薄弱指标": sorted(
            [x for x in indicators.values() if x["rate"] is not None and x["学生证据数"] >= 3],
            key=lambda x: x["rate"],
        )[:4],
        "分化指标": differentiation,
        "记录覆盖不足": coverage_gaps,
        "班级评分点诊断": class_tags,
        "共性知识点": common_tags[:8],
        "群体级建议": group_suggestions,
        "叙述": narrative,
    }


def _group_narrative(
    class_id: str,
    student_count: int,
    overall: dict[str, Any],
    common_issues: list[dict[str, Any]],
    differentiation: list[dict[str, Any]],
    coverage_gaps: list[dict[str, Any]],
) -> str:
    parts = [
        f"{class_id}共有 {student_count} 名模拟学生，合并得分率 {overall['rate']:.0%}（{overall['evidenceCount']} 条有效评分记录）。"
        if overall["rate"] is not None else f"{class_id}共有 {student_count} 名学生，目前没有可用的已评分记录。"
    ]
    if common_issues:
        parts.append(
            "共性问题集中在：" + "；".join(
                f"{x['观察指标']}（{x['得分率']:.0%}）" for x in common_issues[:3]
            ) + "。"
        )
    else:
        parts.append("未发现合并得分率低于 50% 且有足够学生证据的共性指标。")
    if differentiation:
        parts.append(
            "班内差异较大的是：" + "；".join(
                f"{x['观察指标']}（标准差 {x['标准差']:.0%}）" for x in differentiation[:2]
            ) + "。建议分层安排。"
        )
    if coverage_gaps:
        parts.append(
            "以下指标只有部分学生有证据，群体结论需谨慎：" + "、".join(x["观察指标"] for x in coverage_gaps[:3]) + "。"
        )
    return "".join(parts)


def compare_classes(
    group_dc01: dict[str, Any],
    group_dc02: dict[str, Any],
    kg: dict[str, Any],
) -> dict[str, Any]:
    indicators = {}
    for iid in kg["指标索引"]:
        a = group_dc01["指标诊断"].get(iid, {})
        b = group_dc02["指标诊断"].get(iid, {})
        diff = None
        if a.get("rate") is not None and b.get("rate") is not None:
            diff = round(b["rate"] - a["rate"], 4)
        indicators[iid] = {
            "指标编号": iid,
            "观察指标": kg["指标索引"][iid]["观察指标"],
            "DC01": a.get("rate"),
            "DC02": b.get("rate"),
            "差值_DC02减DC01": diff,
            "DC01证据": a.get("evidenceCount", 0),
            "DC02证据": b.get("evidenceCount", 0),
            "有比较意义": bool(a.get("evidenceCount", 0) >= 5 and b.get("evidenceCount", 0) >= 5),
        }
    comparable = [v for v in indicators.values() if v["有比较意义"] and v["差值_DC02减DC01"] is not None]
    comparable.sort(key=lambda x: -abs(x["差值_DC02减DC01"]))
    biggest = comparable[0] if comparable else None

    tag_gap = None
    tag_map = {}
    for g, cls in ((group_dc01, "DC01"), (group_dc02, "DC02")):
        for tag in g.get("班级评分点诊断", []):
            tag_map.setdefault(tag["知识点编号"], {"知识点编号": tag["知识点编号"], "知识点": tag["知识点"], "DC01": None, "DC02": None, "DC01证据": 0, "DC02证据": 0})
            tag_map[tag["知识点编号"]][cls] = tag["得分率"]
            tag_map[tag["知识点编号"]][f"{cls}证据"] = tag["被考核次数"]
    gaps = []
    for v in tag_map.values():
        if v["DC01"] is not None and v["DC02"] is not None and v["DC01证据"] >= 5 and v["DC02证据"] >= 5:
            v["差值"] = round(v["DC02"] - v["DC01"], 4)
            gaps.append(v)
    gaps.sort(key=lambda x: -abs(x["差值"]))
    tag_gap = gaps[0] if gaps else None

    if biggest:
        direction = "高" if biggest["差值_DC02减DC01"] > 0 else "低"
        narrative = (
            f"两班差距最大的指标是{biggest['观察指标']}：DC02 比 DC01 {direction} "
            f"{abs(biggest['差值_DC02减DC01']):.0%}（DC01 {biggest['DC01']:.0%}，DC02 {biggest['DC02']:.0%}）。"
        )
        if tag_gap:
            narrative += (
                f"在评分点层面，差距最明显的是{tag_gap['知识点']}（DC02 比 DC01 "
                f"{'高' if tag_gap['差值'] > 0 else '低'} {abs(tag_gap['差值']):.0%}）。"
                "这是基于现有模拟记录的相关观察，具体原因还需要结合课堂观察确认，不能仅凭差距推断教学因果。"
            )
        else:
            narrative += "现有记录不足以进一步定位到具体评分点。"
    else:
        narrative = "两个班在多数指标上缺乏可比的足够证据，暂不做班级差距排序。"

    return {"指标对比": indicators, "最大差距": biggest, "评分点差距": tag_gap, "叙述": narrative}


# ---------------------------------------------------------------------------
# 典型案例
# ---------------------------------------------------------------------------

def select_typical_cases(student_diagnostics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    partial_candidates = []
    strong_candidates = []
    limited_candidates = []
    for sid, diag in student_diagnostics.items():
        overall = diag["总体"]
        systemic = [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"]
        high = [x for x in systemic if x["严重程度"] == "high"]
        evidence = overall["evidenceCount"]
        rate = overall["rate"] or 0
        if evidence >= 12 and 0.35 <= rate <= 0.8 and systemic:
            score = len(high) * 3 + len(systemic) + diag["修订模式"]["有修订的题目数"] * 0.5 + (1 - abs(rate - 0.55))
            partial_candidates.append((score, sid, diag))
        if evidence >= 15 and rate >= 0.8 and not high:
            strong_candidates.append((rate + evidence / 1000, sid, diag))
        limited = [x for x in diag["指标诊断"].values() if x["status"] in {"limited", "no_evidence"}]
        if evidence <= 10 or len(limited) >= 2:
            score = (10 - evidence) + len(limited) * 1.5
            limited_candidates.append((score, sid, diag))

    # 部分得分案例优先选“有修订、得分率接近及格线”的学生：
    # 这样既能展示评分点定位，又能展示修订过程与数据核对。
    preferred_partial = [
        c for c in partial_candidates
        if c[2]["修订模式"]["有修订的题目数"] > 0 and 0.50 <= (c[2]["总体"]["rate"] or 0) <= 0.72
    ]
    if preferred_partial:
        partial_candidates = preferred_partial
    partial_candidates.sort(key=lambda x: -x[0])
    strong_candidates.sort(key=lambda x: -x[0])
    limited_candidates.sort(key=lambda x: -x[0])

    # 避免同一学生重复
    used = set()
    def pick(cands):
        for _, sid, diag in cands:
            if sid not in used:
                used.add(sid)
                return sid, diag
        return None, None

    p_sid, p_diag = pick(partial_candidates)
    s_sid, s_diag = pick(strong_candidates)
    l_sid, l_diag = pick(limited_candidates)

    def reason(diag, kind):
        if not diag:
            return ""
        overall = diag["总体"]
        if kind == "partial":
            sys = [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"]
            rev = diag["修订模式"]["有修订的题目数"]
            rev_text = f"并有 {rev} 道题出现修订" if rev else "且记录完整"
            return f"总体得分率 {overall['rate']:.0%}，有 {len(sys)} 个系统性薄弱知识点，{rev_text}，适合展示“部分得分→评分点定位→分步建议”的完整链路。"
        if kind == "strong":
            return f"总体得分率 {overall['rate']:.0%}，{overall['evidenceCount']} 条有效证据，没有高严重度的系统性问题，可用于设计变式与迁移任务。"
        return f"只有 {overall['evidenceCount']} 条有效证据，多个指标没有记录或只有 1 道题，适合展示“记录不足不等于未掌握”的处理方式。"

    return {
        "case1_partial": {"学生编号": p_sid, "类型": "部分得分", "选取理由": reason(p_diag, "partial")},
        "case2_strong": {"学生编号": s_sid, "类型": "表现较好", "选取理由": reason(s_diag, "strong")},
        "case3_limited": {"学生编号": l_sid, "类型": "记录不足", "选取理由": reason(l_diag, "limited")},
        "诊断": {
            p_sid: p_diag,
            s_sid: s_diag,
            l_sid: l_diag,
        },
    }
