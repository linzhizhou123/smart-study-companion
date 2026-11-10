"""
模块 C — 学习建议生成
=====================
规则驱动、确定性输出。每条建议都对应：
具体题目编号 + 评分点证据 + 教材定位 + 分步提示（不直接给答案）+ 完成条件 + 后续调整。

关键约定
--------
- “记录不足”只生成补充观察，不写成“补弱”；
- 先补前置技能，再进入综合题；
- 学习计划最多 5 道题，补充观察按证据缺口动态增减；
- 提示语只指向操作步骤，不出现参考答案。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from src.diagnostics import STATUS_LABELS, _limited_indicators
from src.knowledge_graph import SOLUTION_HINTS, TAG_HINTS


MINUTES_BY_DIFFICULTY = {1: 3, 2: 5, 3: 8}
PRIORITY_RANK = {"高": 0, "中": 1, "低": 2}


# ---------------------------------------------------------------------------
# 记录与题目状态
# ---------------------------------------------------------------------------

def _student_records(dfs: dict[str, Any], student_id: str) -> pd.DataFrame:
    df = dfs["records_final"]
    return df[(df["学生编号"] == student_id) & (df["可用于统计"])].copy()


def _question_records(records: pd.DataFrame, qid: str) -> pd.DataFrame:
    return records[records["材料编号"] == qid]


def _question_state(records: pd.DataFrame, qid: str) -> str:
    sub = _question_records(records, qid)
    if len(sub) == 0:
        return "no_record"
    if sub["是否已评分"].any():
        return "graded"
    if sub["是否待评分"].any():
        return "pending"
    return "unanswered"


def _question_score(records: pd.DataFrame, qid: str) -> tuple[float, float] | None:
    sub = _question_records(records, qid)
    graded = sub[sub["是否已评分"]]
    if len(graded) == 0:
        return None
    return float(graded["得分_num"].sum()), float(graded["满分_num"].sum())


def _tag_points_for_question(tag: dict[str, Any], qid: str) -> list[dict[str, Any]]:
    return [e for e in tag.get("证据", []) if e["题目编号"] == qid]


def _tag_question_candidates(tag: dict[str, Any], kg: dict[str, Any]) -> list[str]:
    index = kg["知识点索引"].get(tag["知识点编号"], {})
    return list(index.get("题目", tag.get("关联题目", [])))


def _difficulty(qid: str, kg: dict[str, Any]) -> int:
    return int(kg["题库"].get(qid, {}).get("难度", 1))


def _sort_questions_for_tag(tag: dict[str, Any], records: pd.DataFrame, kg: dict[str, Any]) -> dict[str, list[str]]:
    lost, unseen, full = [], [], []
    for qid in _tag_question_candidates(tag, kg):
        points = _tag_points_for_question(tag, qid)
        if points:
            score = sum(p["得分"] for p in points)
            max_score = sum(p["满分"] for p in points)
            if score < max_score - 1e-6:
                lost.append(qid)
            else:
                full.append(qid)
        else:
            state = _question_state(records, qid)
            if state in {"no_record", "unanswered", "pending"}:
                unseen.append(qid)
            else:
                full.append(qid)
    lost.sort(key=lambda q: (_difficulty(q, kg), q))
    unseen.sort(key=lambda q: (_difficulty(q, kg), q))
    full.sort(key=lambda q: (_difficulty(q, kg), q))
    return {"lost": lost, "unseen": unseen, "full": full}


def _ordered_picks(tag: dict[str, Any], records: pd.DataFrame, kg: dict[str, Any], limit: int = 4) -> list[str]:
    """按“已失分 → 未作答 → 已做对”排序，返回该知识点的候选题目。"""
    buckets = _sort_questions_for_tag(tag, records, kg)
    ordered: list[str] = []
    for bucket in (buckets["lost"], buckets["unseen"], buckets["full"]):
        for q in bucket:
            if q not in ordered:
                ordered.append(q)
    return ordered[:limit]


def _pick_for_systemic(tag: dict[str, Any], records: pd.DataFrame, kg: dict[str, Any], limit: int = 2) -> list[str]:
    return _ordered_picks(tag, records, kg, limit=limit)


def _pick_for_within(tag: dict[str, Any], records: pd.DataFrame, kg: dict[str, Any]) -> list[str]:
    qids = tag.get("关联题目", [])
    return [qids[0]] if qids else _pick_for_systemic(tag, records, kg, limit=1)


def _pick_observation_probes(
    indicator_id: str,
    records: pd.DataFrame,
    kg: dict[str, Any],
    used: set[str],
) -> list[str]:
    """为记录不足的指标挑 1 道最有信息量的观察题。

    优先：未作答的 3 分解答题（一次能拿到多个评分点证据）→ 未作答的基础题 →
    待评分题 → 已做过的题（换一道不同题）。
    """
    meta = kg["指标索引"].get(indicator_id, {})
    qids = [q for q in meta.get("题目列表", []) if q not in used]
    if not qids:
        qids = list(meta.get("题目列表", []))

    def state_rank(q: str) -> int:
        state = _question_state(records, q)
        return {"no_record": 0, "unanswered": 1, "pending": 2, "graded": 3}.get(state, 4)

    qids.sort(key=lambda q: (state_rank(q), -_difficulty(q, kg), q))
    # 优先 3 分解答题，其次是未作答基础题
    for q in qids:
        if state_rank(q) <= 1 and _difficulty(q, kg) >= 3:
            return [q]
    for q in qids:
        if state_rank(q) <= 1:
            return [q]
    for q in qids:
        if state_rank(q) == 2:
            return [q]
    return qids[:1]


# ---------------------------------------------------------------------------
# 条目构建
# ---------------------------------------------------------------------------

def _textbook_ref(qid: str, tag_id: str | None, kg: dict[str, Any]) -> str:
    q = kg["题库"].get(qid, {})
    if q.get("教材定位"):
        return q["教材定位"]
    if tag_id and kg["知识点索引"].get(tag_id, {}).get("教材定位"):
        return kg["知识点索引"][tag_id]["教材定位"]
    theme_id = q.get("主题编号")
    material = kg["教材索引"].get(theme_id, {})
    return f"{material.get('教材','')} · {material.get('教材页码范围','')}"


def _hints_for(qid: str, tag_id: str | None, kg: dict[str, Any]) -> list[str]:
    if qid in SOLUTION_HINTS:
        return list(SOLUTION_HINTS[qid])
    if tag_id and tag_id in TAG_HINTS:
        return list(TAG_HINTS[tag_id])[:4]
    return ["先读题，圈出已知量和所求量。", "回忆本知识点对应的规则，写下第一步。", "做完后把结果代回题目或原式检查。"]


def _evidence_sentence(tag: dict[str, Any], qid: str) -> str:
    points = _tag_points_for_question(tag, qid)
    if not points:
        return "这道题你还没有有效作答记录，用来检验该知识点能否迁移。"
    lost = [p for p in points if p["得分"] < p["满分"] - 1e-6]
    full = [p for p in points if p["得分"] >= p["满分"] - 1e-6]
    if not lost:
        return "这道题此前已做对，可以作为变式或限时复现。"
    pieces = [f"{p['评分点']}（{p['节点编号']} {p['得分']:g}/{p['满分']:g}）" for p in lost]
    sentence = "你在 " + "、".join(pieces) + " 失分"
    if full:
        sentence += "；同一题的其他考核点此前已做对"
    return sentence + "。"


def _make_item(
    qid: str,
    tag: dict[str, Any] | None,
    records: pd.DataFrame,
    kg: dict[str, Any],
    stage: str,
    reason_prefix: str = "",
    observation: bool = False,
    priority: str = "中",
) -> dict[str, Any]:
    q = kg["题库"].get(qid, {})
    tag_id = tag["知识点编号"] if tag else ((q.get("知识点编号") or [""])[0])
    tag_name = tag["知识点"] if tag else ((q.get("知识点") or ["综合"])[0])
    if observation:
        reason = reason_prefix or f"该指标目前证据不足，用 {qid} 做一次补充观察，先判断真实水平。"
    else:
        reason = (reason_prefix + " " if reason_prefix else "") + _evidence_sentence(tag, qid) if tag else reason_prefix
        reason = reason.strip()

    evidence = []
    if tag:
        for p in _tag_points_for_question(tag, qid):
            evidence.append(
                {
                    "评分点": p["评分点"],
                    "节点": p["节点编号"],
                    "得分": p["得分"],
                    "满分": p["满分"],
                    "描述": p["描述"],
                    "学生作答": p.get("学生作答", ""),
                }
            )
    else:
        score = _question_score(records, qid)
        if score:
            evidence.append({"题目总分": f"{score[0]:g}/{score[1]:g}"})

    difficulty = _difficulty(qid, kg)
    completion = (
        f"独立完成 {qid}，对应评分点正确；若仍错，回到 {_textbook_ref(qid, tag_id, kg)} 的对应例题。"
        if not observation
        else f"完成 {qid}，记录作答过程与用时；教师根据结果决定下一步。"
    )
    follow_up = (
        "若基础题正确、解答题达到 2/3 以上 → 可判断该指标基础可用，进入下一阶段；"
        "若基础题仍错 → 先补该指标的基础步骤，暂不扩展到综合题。"
        if observation
        else f"若本题对应评分点正确 → 进入下一题；若仍错 → 回看 {_textbook_ref(qid, tag_id, kg)}，"
        "把出错的那一步单独重做，并举一个同类小例子。"
    )

    return {
        "题目编号": qid,
        "题型": q.get("题型", ""),
        "题干": q.get("题干", ""),
        "满分": q.get("满分", 1),
        "主题编号": q.get("主题编号", ""),
        "指标编号": q.get("指标编号", ""),
        "知识点编号": tag_id,
        "知识点": tag_name,
        "阶段": stage,
        "优先级": priority,
        "理由": reason,
        "分步提示": _hints_for(qid, tag_id, kg),
        "教材定位": _textbook_ref(qid, tag_id, kg),
        "完成条件": completion,
        "后续调整": follow_up,
        "当前证据": evidence,
        "预计分钟": 3 if observation else MINUTES_BY_DIFFICULTY.get(difficulty, 5),
        "类型": "补充观察" if observation else ("基础补弱" if difficulty <= 1 else "综合巩固"),
        "不直接给答案": True,
    }


# ---------------------------------------------------------------------------
# 观察建议
# ---------------------------------------------------------------------------

def _build_observation(
    diag: dict[str, Any],
    records: pd.DataFrame,
    kg: dict[str, Any],
    used: set[str],
    max_items: int,
) -> dict[str, Any]:
    limited = _limited_indicators(diag)
    limited.sort(key=lambda x: (x["evidenceCount"], x["指标编号"]))
    # 先保证每个主题至少有一个观察指标，再补充同主题的其他缺口
    by_theme: dict[str, dict[str, Any]] = {}
    for stat in limited:
        theme = kg["指标索引"][stat["指标编号"]]["主题编号"]
        by_theme.setdefault(theme, stat)
    ordered_stats = list(by_theme.values()) + [s for s in limited if s not in by_theme.values()]
    selected: list[dict[str, Any]] = []
    for stat in ordered_stats:
        if len(selected) >= max_items:
            break
        iid = stat["指标编号"]
        if any(item["指标编号"] == iid for item in selected):
            continue
        qid = _pick_observation_probes(iid, records, kg, used)[0]
        if not qid or qid in used:
            continue
        item = _make_item(
            qid,
            None,
            records,
            kg,
            stage="补充观察",
            reason_prefix=(
                f"{stat['观察指标']}目前只有 {stat['evidenceCount']} 条有效证据、覆盖 {stat['distinctQuestions']} 道题，"
                "暂不能判断掌握程度。先做这道题收集证据，不表示你已经不会。"
            ),
            observation=True,
            priority="中",
        )
        # 补充观察卡片用指标名称，而不是题目碰巧排序第一的知识点
        item["知识点"] = stat["观察指标"]
        item["知识点编号"] = ""
        selected.append(item)
        used.add(qid)

    indicators = []
    for stat in limited:
        if any(item["指标编号"] == stat["指标编号"] for item in selected):
            indicators.append(
                {
                    "指标编号": stat["指标编号"],
                    "观察指标": stat["观察指标"],
                    "现有证据": stat["evidenceCount"],
                    "覆盖题目": stat["distinctQuestions"],
                    "状态": STATUS_LABELS.get(stat["status"], stat["status"]),
                }
            )
    return {
        "说明": (
            "以下指标的有效证据不超过 1 道题。这里安排的是“补充观察”，目的是收集证据、判断真实水平，"
            "不是判定薄弱，也不是要求一次性刷完整个主题。"
        ),
        "指标": indicators,
        "建议条目": selected,
        "后续": "完成观察题后，按得分调整：基础题正确且解答题≥2/3 → 进入对应主题的常规学习；基础题仍错 → 回到学习卡/教材例题补基础步骤；若仍无记录 → 保持“暂不能判断”，不强行给结论。",
    }


# ---------------------------------------------------------------------------
# 主生成函数
# ---------------------------------------------------------------------------

def generate_recommendations(
    student_id: str,
    diag: dict[str, Any],
    dfs: dict[str, Any],
    kg: dict[str, Any],
) -> dict[str, Any]:
    records = _student_records(dfs, student_id)
    used: set[str] = set()

    systemic = [t for t in diag["评分点级诊断"]["全部"] if t["模式"] == "systemic"]
    within = [t for t in diag["评分点级诊断"]["全部"] if t["模式"] == "within_question"]
    systemic.sort(
        key=lambda t: (
            {"high": 0, "medium": 1, "low": 2}.get(t["严重程度"], 3),
            -(t["被考核次数"] or 0),
            t["得分率"] if t["得分率"] is not None else 1,
        )
    )
    within.sort(key=lambda t: (t["得分率"] if t["得分率"] is not None else 1, -t["被考核次数"]))

    # 收集学习候选（题目, 标签, 优先级）
    candidates: list[tuple[str, dict[str, Any] | None, str, str]] = []
    # 每个系统性知识点先各取一道“首选”，再轮转取第二道，保证覆盖不同知识点
    tag_picks: list[tuple[dict[str, Any], list[str]]] = []
    for tag in systemic[:3]:
        picks = _ordered_picks(tag, records, kg, limit=4)
        if picks:
            tag_picks.append((tag, picks))
    for round_index in range(2):
        for tag, picks in tag_picks:
            if len(candidates) >= 5:
                break
            if round_index >= len(picks):
                continue
            qid = picks[round_index]
            if qid in used:
                continue
            used.add(qid)
            candidates.append(
                (
                    qid,
                    tag,
                    "高" if tag["严重程度"] == "high" else "中",
                    f"「{tag['知识点']}」在 {len(tag['关联题目'])} 道题、{tag['被考核次数']} 个评分点上反复失分（得分率 {tag['得分率']:.0%}）。",
                )
            )
        if len(candidates) >= 5:
            break
    for tag in within[:1]:
        for qid in _pick_for_within(tag, records, kg):
            if qid in used:
                continue
            used.add(qid)
            candidates.append(
                (
                    qid,
                    tag,
                    "中",
                    f"「{tag['知识点']}」在 {qid} 一道题的多个评分点上连续失分，先把这道题的步骤拆开重练。",
                )
            )

    # 没有补弱候选时，才安排“变式提升”
    enrichment: tuple[str, dict[str, Any] | None, str] | None = None
    if not candidates:
        strong_indicators = [
            x for x in diag["指标诊断"].values()
            if x["status"] == "secure" and x["evidenceCount"] >= 2
        ]
        if diag["总体"]["evidenceCount"] >= 5 and strong_indicators:
            strong_indicators.sort(key=lambda x: -(x["rate"] or 0))
            for stat in strong_indicators:
                for qid in kg["指标索引"][stat["指标编号"]].get("题目列表", []):
                    if qid in used:
                        continue
                    if _question_state(records, qid) in {"no_record", "unanswered"} and _difficulty(qid, kg) >= 3:
                        enrichment = (qid, None, f"{stat['观察指标']}得分率 {stat['rate']:.0%}，用这道未做过的综合题检验迁移，而不是重复练同类基础题。")
                        break
                if enrichment:
                    break
        if not enrichment and diag["总体"]["evidenceCount"] >= 5:
            for qid, q in kg["题库"].items():
                if qid in used:
                    continue
                if q.get("难度", 1) >= 3 and _question_state(records, qid) in {"no_record", "unanswered"}:
                    enrichment = (qid, None, "用一道未做过的综合题检验迁移。")
                    break

    # 如果候选中没有 1 分基础题，补一道同标签的基础题作为入口
    if candidates and not any(_difficulty(c[0], kg) <= 1 for c in candidates):
        top_tag = candidates[0][1]
        if top_tag:
            for qid in _ordered_picks(top_tag, records, kg, limit=6):
                if qid in used:
                    continue
                if _difficulty(qid, kg) <= 1:
                    used.add(qid)
                    candidates.append(
                        (
                            qid,
                            top_tag,
                            "高" if top_tag["严重程度"] == "high" else "中",
                            f"先用一道基础题进入「{top_tag['知识点']}」，降低起点，再处理后面的综合题。",
                        )
                    )
                    break

    # 学习条目最多 5 道；保留轮转顺序，再按“基础题优先”排阶段
    candidates = candidates[:5]
    if enrichment:
        used.add(enrichment[0])

    # 阶段编排：先基础题，再综合题；最后一道作为迁移/收尾
    basics = [c for c in candidates if _difficulty(c[0], kg) <= 1]
    advanced = [c for c in candidates if _difficulty(c[0], kg) > 1]
    ordered = basics[:2] + advanced + basics[2:]
    ordered = ordered[:5]

    plan_items: list[dict[str, Any]] = []
    for idx, (qid, tag, priority, prefix) in enumerate(ordered):
        if idx < 2:
            stage = "第1阶段 · 基础补弱"
        elif idx < 4:
            stage = "第2阶段 · 综合巩固"
        else:
            stage = "第3阶段 · 变式提升"
        item = _make_item(qid, tag, records, kg, stage=stage, reason_prefix=prefix, priority=priority)
        plan_items.append(item)

    if enrichment:
        qid, tag, prefix = enrichment
        plan_items.append(
            _make_item(
                qid,
                tag,
                records,
                kg,
                stage="第3阶段 · 变式提升",
                reason_prefix=prefix,
                priority="低",
            )
        )

    # 时间预算：单次学习任务控制在约 30-40 分钟；超出时先删最后一道变式题
    while len(plan_items) > 4 and sum(it["预计分钟"] for it in plan_items) > 40:
        plan_items.pop()

    # 组装阶段
    stages: list[dict[str, Any]] = []
    for name, goal, prerequisite in [
        ("第1阶段 · 基础补弱", "先解决跨题反复出现的关键步骤，用最短的题把步骤做对。", "无"),
        ("第2阶段 · 综合巩固", "把基础步骤放回 3 分解答题中，保持步骤完整、符号正确。", "第1阶段完成，或对应基础题已独立做对"),
        ("第3阶段 · 变式提升", "用未做过的综合题检验迁移，并补上记录空白。", "第2阶段完成，或对应指标已有稳定证据"),
    ]:
        items = [it for it in plan_items if it["阶段"] == name]
        if not items:
            continue
        stages.append(
            {
                "阶段": name,
                "目标": goal,
                "前置条件": prerequisite,
                "预计分钟": sum(it["预计分钟"] for it in items),
                "建议条目": items,
            }
        )

    # 观察条目数量：学习任务多则少安排观察，避免一次任务过载
    if len(plan_items) >= 4:
        obs_max = 3
    elif len(plan_items) >= 1:
        obs_max = 4
    else:
        obs_max = 5
    observation = _build_observation(diag, records, kg, used, max_items=obs_max)

    all_items = plan_items + observation["建议条目"]
    priority_counts = {"高": 0, "中": 0, "低": 0}
    for item in all_items:
        priority_counts[item["优先级"]] = priority_counts.get(item["优先级"], 0) + 1
    total_minutes = sum(item["预计分钟"] for item in all_items)
    total_minutes = max(10, int(round(total_minutes / 5.0) * 5))

    overview = {
        "总建议数": len(all_items),
        "优先级分布": priority_counts,
        "预计时间": f"{total_minutes} 分钟",
        "学习条目数": len(plan_items),
        "补充观察条目数": len(observation["建议条目"]),
        "生成依据": (
            "先按评分点级诊断的系统性问题排序，再考虑前置依赖，最后加入记录不足的补充观察和已掌握指标的变式。"
            "所有条目都对应具体题目和评分点，不直接给出答案。"
        ),
    }

    adjustment_rules = [
        {"触发": "基础题仍错", "调整": "不进入下一阶段；回到该知识点学习卡和教材例题，把出错步骤单独重做。"},
        {"触发": "解答题得分 < 2/3", "调整": "保留当前阶段的第二道题，暂不推进到变式题；增加一道同评分点基础题。"},
        {"触发": "解答题得分 ≥ 2/3 且基础题正确", "调整": "进入下一阶段；可在同指标内换一道未做过的变式题。"},
        {"触发": "补充观察题仍无记录或待评分", "调整": "保持“暂不能判断”，不生成补弱结论；先补记录或请教师评分。"},
        {"触发": "学生反馈“太难/太多”", "调整": "把 3 分解答题替换为同知识点的 1 分基础题，学习条目控制在 2 条以内。"},
        {"触发": "学生反馈“太简单/想挑战”", "调整": "跳过基础题，直接选同主题未做过的 3 分综合题，并增加一题跨指标变式。"},
    ]

    if plan_items:
        plan_note = "本计划先补跨题反复出现的关键步骤，再用综合题巩固，最后做变式。"
    else:
        plan_note = "当前没有足够的低分证据支持“补弱”；先做补充观察，避免把记录空白误判为未掌握。"

    return {
        "学生编号": student_id,
        "建议总览": overview,
        "计划说明": plan_note,
        "学习计划": stages,
        "记录不足补充观察": observation,
        "调整规则": adjustment_rules,
        "教师复核提示": "建议条目中的参考答案仅在教师模式下展示；学生端只显示分步提示，不直接给答案。",
        "诊断依据": {
            "总体得分率": diag["总体"]["rate"],
            "有效证据数": diag["总体"]["evidenceCount"],
            "系统性问题": [
                {
                    "知识点": t["知识点"],
                    "得分率": t["得分率"],
                    "被考核次数": t["被考核次数"],
                    "关联题目": t["关联题目"],
                }
                for t in systemic
            ],
            "记录不足指标": [
                {
                    "指标编号": x["指标编号"],
                    "观察指标": x["观察指标"],
                    "有效证据": x["evidenceCount"],
                }
                for x in _limited_indicators(diag)
            ],
        },
    }


def generate_all_recommendations(
    student_diagnostics: dict[str, dict[str, Any]],
    dfs: dict[str, Any],
    kg: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        sid: generate_recommendations(sid, diag, dfs, kg)
        for sid, diag in student_diagnostics.items()
    }
