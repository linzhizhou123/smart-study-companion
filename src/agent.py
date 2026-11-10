"""
智能体编排层（主入口）
======================
串联：数据加载 → 知识图谱 → 个体/群体诊断 → 学习建议 → 典型案例 → 输出。

设计原则：
- 规则引擎负责所有计算与排序；
- LLM 仅在显式开启时做自然语言润色，失败自动回退；
- 所有输出可追溯到具体题目、评分点和教材位置。
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from config import DATA_DIR, OUTPUT_DIR
from src.data_loader import load_and_clean
from src.diagnostics import (
    compare_classes,
    diagnose_group,
    diagnose_individual,
    select_typical_cases,
)
from src.knowledge_graph import build_knowledge_graph
from src.llm_formatter import answer_question, format_diagnosis, format_recommendation
from src.recommendation import generate_all_recommendations


DATA_VERSION = "ZHIHUI-XUEBAN-20261110"


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    if hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            pass
    if isinstance(obj, set):
        return sorted(obj)
    return str(obj)


def _clean_json(obj: Any) -> Any:
    """递归清理 NaN / numpy 类型，保证 JSON 可被浏览器读取。"""
    if isinstance(obj, dict):
        return {str(k): _clean_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_clean_json(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return round(obj, 6)
    if isinstance(obj, (int, str, bool)) or obj is None:
        return obj
    if hasattr(obj, "item"):
        try:
            return _clean_json(obj.item())
        except Exception:
            pass
    return str(obj)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_clean_json(data), ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )


def _slim_theme(theme: dict[str, Any]) -> dict[str, Any]:
    theme = dict(theme)
    indicators = []
    for ind in theme.get("指标列表", []):
        ind = dict(ind)
        ind.pop("题目详情", None)
        indicators.append(ind)
    theme["指标列表"] = indicators
    return theme


def _records_for_web(dfs: dict[str, Any]) -> list[dict[str, Any]]:
    final = dfs["records_final"]
    versions = dfs["records_versions"]
    issues_by_record: dict[str, list[str]] = {}
    for issue in dfs["issues"]:
        issues_by_record.setdefault(issue["记录编号"], []).append(issue["问题编号"])
    out = []
    for _, row in final.iterrows():
        record = {
            "recordId": row["记录编号"],
            "studentId": row["学生编号"],
            "questionId": row["材料编号"],
            "node": row["节点编号"],
            "eventId": row["作答事件编号"],
            "revision": int(row["修订版本_num"]),
            "revisionCount": int(row["修订次数"]),
            "status": row["评分状态"],
            "score": None if pd.isna(row["得分_num"]) else float(row["得分_num"]),
            "max": None if pd.isna(row["满分_num"]) else float(row["满分_num"]),
            "answer": row["学生最终作答"],
            "process": row["解答过程"],
            "points": row["评分点_dict"],
            "rate": None if row["得分率"] is None or pd.isna(row["得分率"]) else float(row["得分率"]),
            "usable": bool(row["可用于统计"]),
            "graded": bool(row["是否已评分"]),
            "pending": bool(row["是否待评分"]),
            "unanswered": bool(row["是否未作答"]),
            "issueIds": issues_by_record.get(row["记录编号"], []),
        }
        if record["revisionCount"] > 0:
            record["versions"] = versions.get(row["作答事件编号"], [])
        out.append(record)
    return out


def _core_stats(stat: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "recordCount", "evidenceCount", "distinctQuestions", "score", "maxScore", "rate",
        "fullScoreCount", "partialScoreCount", "zeroScoreCount", "pendingCount",
        "unansweredCount", "coverage", "status", "confidence", "状态标签",
        "指标编号", "观察指标", "主题编号", "前置指标", "教材页码", "在测范围内",
    ]
    return {k: stat[k] for k in keys if k in stat}


def _min_stats(stat: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "evidenceCount", "distinctQuestions", "score", "maxScore", "rate",
        "pendingCount", "unansweredCount", "status", "confidence", "状态标签",
        "指标编号", "观察指标", "主题编号", "前置指标", "在测范围内",
    ]
    return {k: stat[k] for k in keys if k in stat}


def _slim_tag_summary(tag: dict[str, Any]) -> dict[str, Any]:
    out = {
        k: tag[k]
        for k in (
            "知识点编号", "知识点", "说明", "主题编号", "指标编号", "得分率", "得分",
            "满分", "被考核次数", "题目数", "关联题目", "模式", "严重程度",
        )
        if k in tag
    }
    return out


def _slim_tag(tag: dict[str, Any]) -> dict[str, Any]:
    out = {
        k: tag[k]
        for k in (
            "知识点编号", "知识点", "说明", "主题编号", "指标编号", "得分率", "得分",
            "满分", "被考核次数", "题目数", "关联题目", "模式", "严重程度", "节点分布",
        )
        if k in tag
    }
    out["证据"] = [
        {k: e[k] for k in ("评分点", "题目编号", "节点编号", "得分", "满分", "描述") if k in e}
        for e in tag.get("证据", [])
    ]
    return out


def _slim_diag(diag: dict[str, Any]) -> dict[str, Any]:
    indicators = {}
    for iid, stat in diag.get("指标诊断", {}).items():
        indicators[iid] = _min_stats(stat)
    nodes = {}
    for nid, node in diag.get("节点诊断", {}).items():
        nodes[nid] = {
            "节点编号": node.get("节点编号"),
            "节点说明": node.get("节点说明"),
            "模拟测验日期": node.get("模拟测验日期"),
            "总体": _min_stats(node.get("总体", {})),
            "主题诊断": {tid: _min_stats(v) for tid, v in node.get("主题诊断", {}).items()},
            "指标诊断": {iid: _min_stats(v) for iid, v in node.get("指标诊断", {}).items()},
        }
    score = {"全部": [_slim_tag(t) for t in diag.get("评分点级诊断", {}).get("全部", [])]}
    for section in ("N01", "N02"):
        score[section] = [_slim_tag_summary(t) for t in diag.get("评分点级诊断", {}).get(section, [])]
    score["未测知识点"] = diag.get("评分点级诊断", {}).get("未测知识点", [])
    long_ind = {}
    for iid, item in diag.get("纵向对比", {}).get("指标", {}).items():
        long_ind[iid] = {
            "指标编号": iid,
            "观察指标": item.get("观察指标"),
            "N01": {k: item.get("N01", {}).get(k) for k in ("rate", "evidenceCount", "distinctQuestions", "status")},
            "N02": {k: item.get("N02", {}).get(k) for k in ("rate", "evidenceCount", "distinctQuestions", "status")},
            "变化": item.get("变化"),
            "解读": item.get("解读"),
            "仅单节点有证据": item.get("仅单节点有证据"),
        }
    long_tag = {}
    for tid, item in diag.get("纵向对比", {}).get("知识点", {}).items():
        long_tag[tid] = {
            "知识点编号": tid,
            "知识点": item.get("知识点"),
            "N01": ({k: item.get("N01", {}).get(k) for k in ("得分率", "被考核次数", "关联题目")} if item.get("N01") else None),
            "N02": ({k: item.get("N02", {}).get(k) for k in ("得分率", "被考核次数", "关联题目")} if item.get("N02") else None),
            "变化": item.get("变化"),
            "解读": item.get("解读"),
        }
    return {
        "学生编号": diag.get("学生编号"),
        "所属班级": diag.get("所属班级"),
        "年级": diag.get("年级"),
        "总体": diag.get("总体"),
        "主题诊断": diag.get("主题诊断"),
        "指标诊断": indicators,
        "节点诊断": nodes,
        "评分点级诊断": score,
        "修订模式": diag.get("修订模式"),
        "纵向对比": {"指标": long_ind, "知识点": long_tag, "说明": diag.get("纵向对比", {}).get("说明")},
        "交叉关联": diag.get("交叉关联"),
        "建议优先级排序依据": diag.get("建议优先级排序依据"),
        "记录概况": diag.get("记录概况"),
        "诊断叙述": diag.get("诊断叙述"),
    }


def _slim_group(group: dict[str, Any]) -> dict[str, Any]:
    indicators = {iid: dict(_core_stats(stat), flags=stat.get("flags", []),
                            studentEvidence=stat.get("学生证据数"),
                            studentMean=stat.get("学生得分率均值"),
                            studentStd=stat.get("学生得分率标准差"),
                            studentMin=stat.get("学生得分率最低"),
                            studentMax=stat.get("学生得分率最高"),
                            coverageRatio=stat.get("覆盖率"))
                for iid, stat in group.get("指标诊断", {}).items()}
    class_tags = [
        {k: t[k] for k in ("知识点编号", "知识点", "得分率", "被考核次数", "题目数", "关联题目", "模式", "严重程度") if k in t}
        for t in group.get("班级评分点诊断", [])
    ]
    return {
        "班级编号": group.get("班级编号"),
        "班级总览": group.get("班级总览"),
        "指标诊断": indicators,
        "共性问题": group.get("共性问题"),
        "相对薄弱指标": [
            {k: t[k] for k in ("指标编号", "观察指标", "rate", "学生证据数", "学生得分率标准差") if k in t}
            for t in group.get("相对薄弱指标", [])
        ],
        "分化指标": group.get("分化指标"),
        "记录覆盖不足": group.get("记录覆盖不足"),
        "班级评分点诊断": class_tags,
        "共性知识点": [
            {k: t[k] for k in ("知识点编号", "知识点", "得分率", "被考核次数", "关联题目", "模式", "严重程度") if k in t}
            for t in group.get("共性知识点", [])
        ],
        "群体级建议": group.get("群体级建议"),
        "叙述": group.get("叙述"),
    }


def _slim_cases(cases: dict[str, Any]) -> dict[str, Any]:
    out = {"list": cases.get("list", [])}
    for key in ("case1_partial", "case2_strong", "case3_limited"):
        case = cases.get(key, {})
        out[key] = {
            "学生编号": case.get("学生编号"),
            "类型": case.get("类型"),
            "选取理由": case.get("选取理由"),
        }
    return out


def _node_list(dfs: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for _, row in dfs["nodes"].iterrows():
        out.append(
            {
                "nodeId": row["节点编号"],
                "date": row["模拟测验日期"],
                "topics": row["已教及测量主题"],
                "description": row["说明"],
                "availableQuestions": row["可用题目列表"],
            }
        )
    return out


def _field_descriptions_md() -> str:
    return """# 智慧学伴 · 输出字段说明

> 数据版本：ZHIHUI-XUEBAN-20261110
> 学生、作答记录均为赛事模拟数据；本说明用于核对输出字段与计算口径。

## 一、文件清单

| 文件 | 内容 | 对应任务 |
|------|------|----------|
| `knowledge_graph.json` | 主题、指标、题目、评分点、知识点、前置关系、教材定位 | 任务 1 学习内容与要求 |
| `diagnostics_individual.json` | D01—D40 个体诊断，含节点、指标、评分点、修订、纵向、交叉关联 | 任务 2 学情分析 |
| `diagnostics_group.json` | DC01、DC02、ALL 群体诊断与两班对比 | 任务 2 群体分析 |
| `recommendations.json` | D01—D40 个性化学习建议与补充观察 | 任务 3 学习建议 |
| `quality_report.json` | 数据质量、修订、待评分、未作答、异常记录 | 任务 2 数据说明 |
| `typical_cases.json` | 三类典型案例的选择理由与结构化核对信息 | 结果核对 |
| `web_data.json` | 单页智能体使用的合并数据（前端只读） | 演示 |
| `field_descriptions.md` | 本文件 | 提交说明 |

## 二、knowledge_graph.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `主题列表` | array | T01/T02/T03，含主题目标、课标引用、教材位置、前置主题、指标列表 |
| `指标索引` | object | 9 个观察指标；含观察指标、课标引用、教材页码、前置指标、题目列表 |
| `题库` | object | 54 道题；含题干、选项、满分、评分点、知识点、教材定位、可用节点、参考答案（仅教师端展示） |
| `材料` | array | 3 张学习卡 + 8 份教材切片索引 |
| `评分点→知识点` | object | 90 个评分点到 29 个知识点的完整映射 |
| `知识点索引` | object | 每个知识点的说明、关联题目、关联评分点、被考核次数、教材定位 |
| `前置关系` | object | 指标级与主题级前置依赖 |
| `必要联系` | object | 三个主题之间的必要联系说明 |

## 三、diagnostics_individual.json

顶层为 `D01`—`D40` 的对象映射。

| 字段 | 类型 | 说明 |
|------|------|------|
| `总体` | object | `score`、`maxScore`、`rate`、`evidenceCount`、`distinctQuestions`、`status`、`confidence` |
| `主题诊断` | object | T01/T02/T03 的得分率、证据数、状态 |
| `指标诊断` | object | 9 个指标的得分率、证据数、覆盖题目数、状态、知识点诊断 |
| `节点诊断` | object | N01/N02 的总体、主题、指标；未测指标标记 `not_measured` |
| `评分点级诊断` | object | `全部`/`N01`/`N02` 的知识点聚合；`模式` 为 `systemic`/`within_question`/`single`/`mastered`/`developing` |
| `修订模式` | object | 有修订题目数、改对/改错/持平、版本轨迹、解读 |
| `纵向对比` | object | 指标与知识点的 N01→N02 变化；单节点证据不做强行比较 |
| `交叉关联` | array | 目标指标与前置指标的关联，含“前置薄弱/前置记录不足” |
| `建议优先级排序依据` | array | 系统性问题、同题多步、记录不足、表现较好的排序依据 |
| `记录概况` | object | 最终记录、有效/待评分/未作答、覆盖题目/指标/主题、记录是否充分 |
| `诊断叙述` | object | 确定性模板生成的中文摘要与要点 |

> 计算口径：得分率 = 已评分记录的得分之和 / 满分之和；待评分、未作答不计入分母；评分点明细与总分不一致时，总分用于指标统计，明细不参与知识点聚合。

## 四、diagnostics_group.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `DC01`/`DC02`/`ALL` | object | 班级总览、指标诊断、共性问题、分化指标、记录覆盖不足、班级评分点诊断、群体建议 |
| `两班对比` | object | 指标对比、最大差距、评分点差距、叙述 |

指标诊断中的 `学生得分率标准差` 用于识别班内分化；`覆盖率` = 有证据学生数 / 班级学生数。

## 五、recommendations.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `建议总览` | object | 总建议数、优先级分布、预计时间、学习条目数、补充观察条目数 |
| `学习计划` | array | 按阶段组织；每阶段含目标、前置条件、预计分钟、建议条目 |
| `建议条目` | object | 题目编号、题型、题干、满分、知识点、理由、分步提示、教材定位、完成条件、后续调整、当前证据 |
| `记录不足补充观察` | object | 仅针对证据 ≤1 道题的指标；目的是收集证据，不是补弱 |
| `调整规则` | array | 教师/学生反馈后的调整条件 |
| `诊断依据` | object | 总体得分率、有效证据数、系统性问题、记录不足指标 |

> 建议端不输出参考答案；参考答案只在教师视图的材料库中展示。分步提示为启发式语言，不直接给答案。

## 六、quality_report.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `原始行数` | int | 806 条原始作答行 |
| `唯一作答事件数` | int | 799 个作答事件 |
| `修订事件数` | int | 7 个存在多版本的事件 |
| `最终记录数` | int | 799 条最终记录 |
| `已评分数` | int | 790 条已评分 |
| `待评分数` | int | 4 条最终仍待评分 |
| `未作答数` | int | 5 条记录空白 |
| `可统计记录数` | int | 787 条已评分且通过校验 |
| `被隔离记录数` | int | 3 条（超满分 2 条 + 节点不符 1 条） |
| `问题数` | int | 16 条数据问题 |
| `按学生记录覆盖` | array | 每名学生的记录数、已评分数、待评分、未作答、题目数 |
| `按指标记录覆盖` | array | 每名学生 × 每个指标的记录覆盖 |

## 七、typical_cases.json

| 字段 | 类型 | 说明 |
|------|------|------|
| `case1_partial` | object | 部分得分案例（D04）：学生编号、类型、选取理由 |
| `case2_strong` | object | 表现较好案例（D14） |
| `case3_limited` | object | 记录不足案例（D17） |
| `list` | array | 三个案例的展示顺序与重点 |

## 八、数据清洗口径

| 规则 | 处理方式 |
|------|----------|
| 同一作答事件多版本 | 只保留修订版本最大的一条为最终答案；其余版本进入 `versions` 供修订分析 |
| 待评分 | 保留状态，不进入得分率，不判为答错 |
| 未作答 | 保留状态，算记录空白，不算答错 |
| 超满分/负分 | 保留原始值，隔离出统计，列入质量报告 |
| 评分点之和与总分不一致 | 总分参与指标统计；评分点明细不参与知识点聚合 |
| 节点与题目不符 | 隔离出统计，列入质量报告 |
| 引用异常 | 单独列出，不参与统计 |
"""


# ---------------------------------------------------------------------------
# 智能体
# ---------------------------------------------------------------------------

class TeachingAgent:
    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else DATA_DIR
        self.dfs = load_and_clean(self.data_dir)
        self.kg = build_knowledge_graph(self.dfs)
        self.student_diagnostics: dict[str, dict[str, Any]] = {}
        self.groups: dict[str, dict[str, Any]] = {}
        self.comparison: dict[str, Any] = {}
        self.recommendations: dict[str, dict[str, Any]] = {}
        self.cases: dict[str, Any] = {}
        self.generated_at = datetime.now().astimezone().isoformat(timespec="seconds")

    # ------------------------------------------------------------------
    # 主流程
    # ------------------------------------------------------------------
    def run(self, use_llm: bool = False) -> dict[str, Any]:
        print("[1/6] 数据加载与清洗完成")
        print(
            f"      原始 {self.dfs['quality']['原始行数']} 行 → 唯一事件 "
            f"{self.dfs['quality']['唯一作答事件数']} 条；已评分 "
            f"{self.dfs['quality']['已评分数']} 条，待评分 "
            f"{self.dfs['quality']['待评分数']} 条，未作答 "
            f"{self.dfs['quality']['未作答数']} 条；隔离 "
            f"{self.dfs['quality']['被隔离记录数']} 条。"
        )

        print("[2/6] 构建知识图谱")
        print(
            f"      {len(self.kg['主题列表'])} 个主题、{len(self.kg['指标索引'])} 个指标、"
            f"{len(self.kg['题库'])} 道题、{len(self.kg['评分点→知识点'])} 个评分点、"
            f"{len(self.kg['知识点索引'])} 个知识点。"
        )

        print("[3/6] 个体诊断（40 名学生）")
        for sid in self.dfs["student_by_id"]:
            self.student_diagnostics[sid] = diagnose_individual(sid, self.dfs, self.kg)
        print(f"      完成 {len(self.student_diagnostics)} 名学生的个体诊断。")

        print("[4/6] 群体诊断与两班对比")
        for class_id in ("DC01", "DC02", "ALL"):
            self.groups[class_id] = diagnose_group(class_id, self.dfs, self.kg, self.student_diagnostics)
        self.comparison = compare_classes(self.groups["DC01"], self.groups["DC02"], self.kg)
        print(
            f"      DC01 {self.groups['DC01']['班级总览']['学生数']} 人；"
            f"DC02 {self.groups['DC02']['班级总览']['学生数']} 人。"
        )

        print("[5/6] 生成个性化学习建议")
        self.recommendations = generate_all_recommendations(self.student_diagnostics, self.dfs, self.kg)
        print(f"      完成 {len(self.recommendations)} 份学习建议。")

        print("[6/6] 选取典型案例并写输出")
        raw_cases = select_typical_cases(self.student_diagnostics)
        case_list = []
        case_payload: dict[str, Any] = {}
        for key, label in (
            ("case1_partial", "部分得分"),
            ("case2_strong", "表现较好"),
            ("case3_limited", "记录不足"),
        ):
            case = dict(raw_cases.get(key, {}))
            sid = case.get("学生编号")
            if sid and sid in self.student_diagnostics:
                case["诊断"] = self.student_diagnostics[sid]
                case["学习建议"] = self.recommendations.get(sid)
                case_payload[key] = case
                case_list.append(
                    {
                        "key": key.replace("case", "").replace("_partial", "").replace("_strong", "").replace("_limited", ""),
                        "caseKey": key,
                        "type": label,
                        "studentId": sid,
                        "reason": case.get("选取理由", ""),
                        "headline": self._case_headline(sid, label),
                    }
                )
        self.cases = {"list": case_list, **case_payload}

        if use_llm:
            self.enrich_with_llm()

        self.write_outputs()
        return self.student_diagnostics

    # ------------------------------------------------------------------
    def _case_headline(self, sid: str, label: str) -> str:
        diag = self.student_diagnostics[sid]
        overall = diag["总体"]
        if label == "部分得分":
            systemic = [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"]
            if systemic:
                return f"{sid} 得分率 {overall['rate']:.0%}，在「{systemic[0]['知识点']}」上跨题反复失分。"
            return f"{sid} 得分率 {overall['rate']:.0%}，适合做评分点级定位。"
        if label == "表现较好":
            return f"{sid} 得分率 {overall['rate']:.0%}，{overall['evidenceCount']} 条有效证据，适合做变式与迁移。"
        return f"{sid} 只有 {overall['evidenceCount']} 条有效证据，先补充观察，不把记录空白当成未掌握。"

    # ------------------------------------------------------------------
    def enrich_with_llm(self) -> None:
        """可选：用文心一言把诊断/建议润色成自然语言。没有 Key 时自动跳过。"""
        try:
            from src.llm_client import WenxinClient
            client = WenxinClient()
        except Exception as exc:  # pragma: no cover
            print(f"      LLM 初始化失败，保留模板文本：{exc}")
            return
        if not client.available:
            print("      LLM 未配置，保留模板文本（规则引擎结果不受影响）。")
            return
        print("      LLM 已配置，开始润色（每名学生最多 2 次调用）...")
        import json as _json
        from src.llm_formatter import DIAGNOSTIC_FORMATTER_PROMPT, RECOMMENDATION_FORMATTER_PROMPT
        for sid, diag in list(self.student_diagnostics.items())[:40]:
            try:
                prompt = DIAGNOSTIC_FORMATTER_PROMPT.replace(
                    "{diagnostics_json}", _json.dumps(_clean_json(diag), ensure_ascii=False)
                )
                diag["LLM诊断报告"] = client.chat("你是智慧学伴，只依据给定数据回答，不猜测。", prompt)
                rec = self.recommendations.get(sid)
                if rec:
                    rprompt = RECOMMENDATION_FORMATTER_PROMPT.replace(
                        "{recommendation_json}", _json.dumps(_clean_json(rec), ensure_ascii=False)
                    )
                    rec["LLM建议文本"] = client.chat("你是智慧学伴，不直接给答案。", rprompt)
            except Exception as exc:
                print(f"      {sid} LLM 润色失败，保留模板文本：{exc}")
                break

    # ------------------------------------------------------------------
    def ask(self, query: str, student_id: str | None = None) -> str:
        import re
        m = re.search(r"D\d{2}", query.upper())
        sid = m.group(0) if m else (student_id or "D04")
        diag = self.student_diagnostics.get(sid)
        rec = self.recommendations.get(sid)
        group = self.groups.get("ALL")
        if "DC01" in query or "DC02" in query or "比较" in query:
            group = self.groups.get("DC01") if "DC01" in query else self.groups.get("DC02")
            group = group or self.groups.get("ALL")
        return answer_question(
            query,
            sid,
            diag,
            rec,
            self.kg,
            group=group,
            comparison=self.comparison,
            cases=self.cases,
        )

    # ------------------------------------------------------------------
    def build_web_data(self) -> dict[str, Any]:
        students = []
        for _, row in self.dfs["students"].iterrows():
            students.append(
                {
                    "id": row["学生编号"],
                    "classId": row["模拟班级编号"],
                    "grade": row["年级"],
                }
            )
        quality = dict(self.dfs["quality"])
        quality.pop("按指标记录覆盖", None)
        field_desc = self.dfs["field_desc"].to_dict(orient="records")
        meta = {
            "dataVersion": DATA_VERSION,
            "generatedAt": self.generated_at,
            "source": "赛事公开模拟学情数据（40 名学生、54 道题、806 条原始作答记录）",
            "studentCount": 40,
            "questionCount": len(self.kg["题库"]),
            "indicatorCount": len(self.kg["指标索引"]),
            "themeCount": len(self.kg["主题列表"]),
            "tagCount": len(self.kg["知识点索引"]),
            "scorePointCount": len(self.kg["评分点→知识点"]),
            "rawRecordCount": self.dfs["quality"]["原始行数"],
            "uniqueEventCount": self.dfs["quality"]["唯一作答事件数"],
            "finalRecordCount": self.dfs["quality"]["最终记录数"],
            "gradedCount": self.dfs["quality"]["已评分数"],
            "usableGradedCount": self.dfs["quality"]["可统计记录数"],
            "pendingCount": self.dfs["quality"]["待评分数"],
            "unansweredCount": self.dfs["quality"]["未作答数"],
            "isolatedCount": self.dfs["quality"]["被隔离记录数"],
            "issueCount": self.dfs["quality"]["问题数"],
            "llmEnabled": False,
            "engine": "rules+nlg-offline",
        }
        themes = [_slim_theme(t) for t in self.kg["主题列表"]]
        return {
            "meta": meta,
            "themes": themes,
            "indicators": self.kg["指标索引"],
            "questions": self.kg["题库"],
            "materials": self.kg["材料"],
            "tags": self.kg["知识点索引"],
            "scorePointTags": self.kg["评分点→知识点"],
            "prerequisites": self.kg["前置关系"],
            "connections": self.kg["必要联系"],
            "textbookIndex": self.kg["教材索引"],
            "students": students,
            "nodes": _node_list(self.dfs),
            "diagnostics": {sid: _slim_diag(d) for sid, d in self.student_diagnostics.items()},
            "recommendations": self.recommendations,
            "groups": {cid: _slim_group(g) for cid, g in self.groups.items()},
            "comparison": self.comparison,
            "cases": _slim_cases(self.cases),
            "quality": quality,
            "issues": self.dfs["issues"],
            "records": _records_for_web(self.dfs),
            "fieldDesc": field_desc,
        }

    # ------------------------------------------------------------------
    def write_outputs(self) -> None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        write_json(
            OUTPUT_DIR / "knowledge_graph.json",
            {"数据版本": DATA_VERSION, **{k: v for k, v in self.kg.items() if k != "数据版本"}},
        )
        write_json(OUTPUT_DIR / "diagnostics_individual.json", self.student_diagnostics)
        write_json(
            OUTPUT_DIR / "diagnostics_group.json",
            {
                "DC01": self.groups["DC01"],
                "DC02": self.groups["DC02"],
                "ALL": self.groups["ALL"],
                "两班对比": self.comparison,
            },
        )
        write_json(OUTPUT_DIR / "recommendations.json", self.recommendations)
        write_json(
            OUTPUT_DIR / "quality_report.json",
            {
                "数据版本": DATA_VERSION,
                "质量统计": self.dfs["quality"],
                "问题清单": self.dfs["issues"],
            },
        )
        write_json(OUTPUT_DIR / "typical_cases.json", self.cases)
        write_json(OUTPUT_DIR / "web_data.json", self.build_web_data())
        (OUTPUT_DIR / "field_descriptions.md").write_text(_field_descriptions_md(), encoding="utf-8")
        print(f"      输出已写入：{OUTPUT_DIR}")
