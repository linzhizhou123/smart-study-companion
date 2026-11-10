"""
LLM 包装层 + 离线自然语言层
===========================
规则引擎产出结构化 JSON；本模块负责把它翻译成老师口吻的中文。
没有 LLM Key 时使用确定性模板，保证离线也能完整运行、不产生幻觉。

调用原则（对应 spec 第 7.1 节）：
- 得分率、评分点、题目顺序、班级统计全部由规则引擎计算；
- LLM 只做表达润色、追问回答、建议调整说明。
"""

from __future__ import annotations

import json
import re
from typing import Any

from src.diagnostics import STATUS_LABELS
from src.knowledge_graph import KNOWLEDGE_TAGS


DIAGNOSTIC_FORMATTER_PROMPT = """你是一名七年级数学教育专家，正在为一名学生生成学情诊断报告。

你将收到一份【结构化学情诊断数据】，请把它转化为自然语言的诊断报告，要求：

1. **诚实优先**：数据不足就说“暂不能确定”，绝不猜测
2. **定位具体**：不说“整式化简不好”，要说“在负号去括号这一点上，三次全错”
3. **用老师的语气**：像班主任跟你谈话，自然、专业、不生硬
4. **结构清晰**：先用一两句话总结，再分点说具体发现，最后提需要进一步观察的地方
5. **不超出数据范围**：诊断里提到的每一个“问题”，都必须有对应的数据支撑（如“Q015的P3评分点得0分”）
6. **中文输出**：用简体中文，适合学生和家长阅读

【结构化数据】
{diagnostics_json}

请生成诊断报告："""

RECOMMENDATION_FORMATTER_PROMPT = """你是一名七年级数学老师，请把下面的学习建议翻译成自然语言。

**核心要求**：
- 不要直接给答案，要用引导性的提示语
- 提示要分步骤，每一步指向一个具体操作
- 语气像老师在辅导学生思考，而不是在念答案

**原建议数据**：
{recommendation_json}

**分步提示语（必须改写，不能用原JSON里的提示语原样输出）**：
- 原提示只是示例，请用你自己的话重新组织
- 保持启发式风格，比如“先想一想括号前这个负号要做什么”
- 不要出现“答案是”、“正确解是”这类直接给答案的话

请输出自然语言版本的建议："""

INTERACTIVE_PROMPT = """你是“智慧学伴”智能体，一个七年级数学的学习助手。

**你的角色设定**：
- 你能看到学生的所有答题记录、评分点得分、测验节点变化
- 你能引用具体的题目编号（如Q015）和评分点（如P3）
- 你从不猜测——如果数据不足，就诚实说明

**当前情境**：
- 学生编号：{student_id}
- 用户当前在问：{user_question}
- 可用的诊断数据：{diagnostics_json}

**回答要求**：
1. 先直接回答用户的问题
2. 用具体数据/评分点/题目编号支撑你的判断
3. 如果数据不足以回答，说明为什么不足，以及需要什么补充数据
4. 最后可以主动问“要不要我进一步分析XXX方面？”
"""

ADJUSTMENT_PROMPT = """用户对当前学习建议提出了反馈：

**当前建议**：{current_recommendation_json}
**用户反馈**：“{user_feedback}”

请分析用户反馈的意图，然后：
1. 解释你理解的用户需求是什么
2. 说明原建议可能有什么不足
3. 生成调整后的建议（保持所有JSON结构，但可以改顺序、改题目、改提示）
4. 说明调整的依据是什么

如果用户的反馈是合理的，接受并调整；如果用户的反馈在数据上没有依据，礼貌解释并给出数据支撑。"""


# ---------------------------------------------------------------------------
# 确定性模板
# ---------------------------------------------------------------------------

def _pct(rate: float | None) -> str:
    return "—" if rate is None else f"{rate:.0%}"


def _systemic(diag: dict[str, Any]) -> list[dict[str, Any]]:
    return [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"]


def _limited(diag: dict[str, Any]) -> list[dict[str, Any]]:
    return [x for x in diag["指标诊断"].values() if x["status"] in {"limited", "no_evidence"}]


def format_diagnosis(diag: dict[str, Any], kg: dict[str, Any] | None = None) -> str:
    """把个体诊断转成自然语言报告。"""
    s = diag["学生编号"]
    overall = diag["总体"]
    lines = [diag["诊断叙述"]["摘要"]]

    systemic = _systemic(diag)
    if systemic:
        lines.append("\n\n### 评分点级的发现")
        for tag in systemic[:4]:
            lines.append(
                f"- **{tag['知识点']}**：{tag['被考核次数']} 个评分点、得分率 {_pct(tag['得分率'])}，"
                f"涉及 {'、'.join(tag['关联题目'])}。这不是“整道题都不会”，而是同一步骤反复出错。"
            )
            for e in tag["证据"][:3]:
                lines.append(
                    f"  - {e['题目编号']} 的 {e['评分点']}：{e['得分']:g}/{e['满分']:g}。"
                )

    within = [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "within_question"]
    if within:
        lines.append("\n### 同题多步失分")
        for tag in within[:2]:
            lines.append(
                f"- **{tag['知识点']}**：在 {'、'.join(tag['关联题目'])} 一道题的多个评分点上连续失分"
                f"（{_pct(tag['得分率'])}）。建议把这道题的步骤拆开重做。"
            )

    revision = diag["修订模式"]
    if revision["有修订的题目数"]:
        lines.append("\n### 修订情况")
        lines.append(revision["解读"])
        for item in revision["详情"][:3]:
            lines.append(
                f"- {item['题目编号']}：{item['修订次数']} 次修订，"
                f"{item['首次得分']} → {item['最终得分']}（{item['变化']}）。"
            )

    limited = _limited(diag)
    if limited:
        lines.append("\n### 需要进一步观察")
        for stat in limited[:4]:
            lines.append(
                f"- {stat['观察指标']}：目前只有 {stat['evidenceCount']} 条有效证据、覆盖 {stat['distinctQuestions']} 道题。"
                "暂不能判断，不能把“没记录”当成“不会”。"
            )

    strong = [x for x in diag["指标诊断"].values() if x["status"] == "secure" and x["evidenceCount"] >= 2]
    if strong and overall["evidenceCount"] >= 5:
        lines.append("\n### 可以保持的部分")
        for stat in strong[:3]:
            lines.append(f"- {stat['观察指标']}：{_pct(stat['rate'])}，有 {stat['evidenceCount']} 条证据。")
    lines.append(f"\n> 以上判断基于 {overall['evidenceCount']} 条已评分证据；待评分和未作答不计入得分率。")
    return "\n".join(lines)


def format_recommendation(rec: dict[str, Any]) -> str:
    lines = [f"# {rec['学生编号']} 的学习建议", rec["计划说明"]]
    overview = rec["建议总览"]
    lines.append(
        f"\n共 {overview['总建议数']} 条建议，预计 {overview['预计时间']}；"
        f"其中学习任务 {overview['学习条目数']} 条、补充观察 {overview['补充观察条目数']} 条。"
    )
    for stage in rec["学习计划"]:
        lines.append(f"\n## {stage['阶段']}（约 {stage['预计分钟']} 分钟）")
        lines.append(f"目标：{stage['目标']}。前置：{stage['前置条件']}。")
        for item in stage["建议条目"]:
            lines.append(f"\n### {item['题目编号']} · {item['知识点']}")
            lines.append(f"理由：{item['理由']}")
            lines.append("分步提示（不直接给答案）：")
            for i, hint in enumerate(item["分步提示"], 1):
                lines.append(f"{i}. {hint}")
            lines.append(f"教材定位：{item['教材定位']}")
            lines.append(f"完成条件：{item['完成条件']}")
            lines.append(f"后续调整：{item['后续调整']}")
    obs = rec["记录不足补充观察"]
    if obs["建议条目"]:
        lines.append("\n## 记录不足 · 补充观察")
        lines.append(obs["说明"])
        for item in obs["建议条目"]:
            lines.append(f"- {item['题目编号']}（{item['指标编号']}）：{item['理由']}")
            lines.append(f"  提示：{'；'.join(item['分步提示'])}")
    return "\n".join(lines)


def format_group(group: dict[str, Any], comparison: dict[str, Any] | None = None) -> str:
    lines = [f"# {group['班级编号']} 群体学情", group["叙述"]]
    if group["共性问题"]:
        lines.append("\n## 共性问题")
        for item in group["共性问题"]:
            lines.append(f"- {item['观察指标']}：{_pct(item['得分率'])}，{item['学生证据数']} 名学生有证据。")
    if group["分化指标"]:
        lines.append("\n## 分化指标")
        for item in group["分化指标"]:
            lines.append(f"- {item['观察指标']}：标准差 {_pct(item['标准差'])}，最低 {_pct(item['最低'])}，最高 {_pct(item['最高'])}。")
    if group["记录覆盖不足"]:
        lines.append("\n## 记录覆盖不足")
        for item in group["记录覆盖不足"]:
            lines.append(f"- {item['观察指标']}：覆盖率 {_pct(item['覆盖率'])}。")
    if group["群体级建议"]:
        lines.append("\n## 群体级建议")
        for item in group["群体级建议"]:
            lines.append(f"- {item['说明']}")
    if comparison:
        lines.append("\n## 两班对比")
        lines.append(comparison["叙述"])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 交互式追问（离线版本）
# ---------------------------------------------------------------------------

def _top_systemic(diag: dict[str, Any], limit: int = 3) -> list[dict[str, Any]]:
    return [x for x in diag["评分点级诊断"]["全部"] if x["模式"] == "systemic"][:limit]


def _find_tag(query: str) -> str | None:
    for tag_id, meta in KNOWLEDGE_TAGS.items():
        if meta["名称"] in query:
            return tag_id
    for tag_id, meta in KNOWLEDGE_TAGS.items():
        # 宽松匹配：去掉“法则/处理/求值”等后缀
        core = re.sub(r"（.*?）|法则|处理|求值|书写|判断", "", meta["名称"])
        if core and core in query:
            return tag_id
    return None


def answer_question(
    query: str,
    student_id: str | None,
    diag: dict[str, Any] | None,
    rec: dict[str, Any] | None,
    kg: dict[str, Any],
    group: dict[str, Any] | None = None,
    comparison: dict[str, Any] | None = None,
    cases: dict[str, Any] | None = None,
) -> str:
    q = query.strip()
    if not q:
        return "你可以直接问：某个学生为什么这样诊断、下一步练什么、两个班差在哪里，或者某个知识点/评分点的情况。"

    # 学生编号
    m = re.search(r"D\d{2}", q.upper())
    sid = m.group(0) if m else student_id

    if ("比较" in q or "差别" in q or "差距" in q or ("DC01" in q and "DC02" in q)) and comparison:
        return comparison.get("叙述", "两班对比数据暂不可用。")

    if "案例" in q and cases:
        lines = ["本次选取的三个典型案例："]
        for key in ("case1_partial", "case2_strong", "case3_limited"):
            c = cases.get(key, {})
            lines.append(f"- {c.get('类型')}：{c.get('学生编号')}。{c.get('选取理由')}")
        return "\n".join(lines)

    if diag is None:
        if group:
            return format_group(group, comparison)
        return "请先指定一个学生编号（D01—D40），我才能引用具体作答证据。"

    if "修订" in q:
        rev = diag["修订模式"]
        lines = [f"{diag['学生编号']} 的修订情况：{rev['解读']}"]
        for item in rev["详情"]:
            lines.append(f"- {item['题目编号']}：{item['修订次数']} 次修订，{item['首次得分']} → {item['最终得分']}。")
        if not rev["详情"]:
            lines.append("没有检测到同一作答事件的修订版本。")
        return "\n".join(lines)

    if "记录" in q or "不足" in q or "没做" in q:
        limited = _limited(diag)
        if not limited:
            return f"{diag['学生编号']} 目前没有明显的记录不足指标；已评分证据 {diag['总体']['evidenceCount']} 条。"
        lines = [f"{diag['学生编号']} 有 {len(limited)} 个指标记录不足，不能直接判断掌握情况："]
        for stat in limited[:6]:
            lines.append(f"- {stat['观察指标']}：{stat['evidenceCount']} 条有效证据，覆盖 {stat['distinctQuestions']} 道题。")
        lines.append("建议先做补充观察，而不是直接补弱。")
        return "\n".join(lines)

    if "建议" in q or "计划" in q or "下一步" in q or "练什么" in q:
        if rec:
            lines = [f"{diag['学生编号']} 的建议概要：{rec['计划说明']}"]
            for stage in rec["学习计划"]:
                lines.append(f"\n{stage['阶段']}（约 {stage['预计分钟']} 分钟）")
                for item in stage["建议条目"]:
                    lines.append(f"- {item['题目编号']}（{item['知识点']}）：{item['理由']}")
            obs = rec["记录不足补充观察"]
            if obs["建议条目"]:
                lines.append(f"\n补充观察 {len(obs['建议条目'])} 条：" + "、".join(x["题目编号"] for x in obs["建议条目"]))
            return "\n".join(lines)
        return "学习建议尚未生成。"

    tag_id = _find_tag(q)
    if tag_id:
        tag = next((x for x in diag["评分点级诊断"]["全部"] if x["知识点编号"] == tag_id), None)
        if tag:
            lines = [
                f"{diag['学生编号']} 在「{tag['知识点']}」上的表现：得分率 {_pct(tag['得分率'])}，"
                f"被考核 {tag['被考核次数']} 次，涉及 {'、'.join(tag['关联题目'])}。",
            ]
            for e in tag["证据"][:5]:
                lines.append(f"- {e['题目编号']} {e['评分点']}：{e['得分']:g}/{e['满分']:g}（{e['节点编号']}）。")
            if tag["模式"] == "systemic":
                lines.append("这是跨题反复出现的问题，建议先补这一个步骤，而不是刷整套题。")
            elif tag["模式"] == "within_question":
                lines.append("这是同一道题内的多步失分，建议把这道题拆步骤重做。")
            elif tag["模式"] == "mastered":
                lines.append("现有证据显示这个知识点掌握较好，可以尝试变式。")
            return "\n".join(lines)
        return f"「{q}」对应知识点 {tag_id}，但{diag['学生编号']}目前没有该知识点的评分点证据，暂不能判断。"

    if "为什么" in q or "诊断" in q or "分析" in q or sid:
        return format_diagnosis(diag, kg)

    if group:
        return format_group(group, comparison)
    return "我可以基于现有作答证据回答：学生的评分点级问题、记录是否足够、下一步建议、班级差异，以及某个知识点的具体表现。"


def format_with_llm_or_fallback(
    kind: str,
    structured: dict[str, Any],
    client: Any = None,
) -> str:
    """有 LLM 时润色，没有时回退到确定性模板。"""
    if client is not None and getattr(client, "available", False):
        prompt_map = {
            "diagnosis": DIAGNOSTIC_FORMATTER_PROMPT,
            "recommendation": RECOMMENDATION_FORMATTER_PROMPT,
            "interactive": INTERACTIVE_PROMPT,
            "adjustment": ADJUSTMENT_PROMPT,
        }
        prompt = prompt_map.get(kind, INTERACTIVE_PROMPT)
        # 将模板占位符替换为结构化 JSON；不把 JSON 直接拼进用户问题
        user = prompt.replace("{diagnostics_json}", json.dumps(structured, ensure_ascii=False))
        user = user.replace("{recommendation_json}", json.dumps(structured, ensure_ascii=False))
        try:
            return client.chat("你是智慧学伴，只依据给定数据回答，不猜测。", user)
        except Exception:
            pass
    if kind == "diagnosis":
        return format_diagnosis(structured)
    if kind == "recommendation":
        return format_recommendation(structured)
    return "（离线模式）已根据规则引擎结果生成回答。"
