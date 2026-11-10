/* ==========================================================================
   智慧学伴 · 学习建议
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { diagnostics, recs, questions, indicators, tags } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const fmtScore = ZB.fmtScore;
  const icon = ZB.icon;

  function difficulty(qid) {
    return Number(questions[qid]?.难度 || 1);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function itemMinutes(item) {
    return Number(item.预计分钟 || (difficulty(item.题目编号) >= 3 ? 8 : 3));
  }

  function recalculate(rec) {
    const learning = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
    const obs = rec.记录不足补充观察?.建议条目 || [];
    const all = learning.concat(obs);
    const counts = { 高: 0, 中: 0, 低: 0 };
    all.forEach((x) => { counts[x.优先级] = (counts[x.优先级] || 0) + 1; });
    const minutes = all.reduce((n, x) => n + itemMinutes(x), 0);
    rec.建议总览 = {
      ...(rec.建议总览 || {}),
      总建议数: all.length,
      优先级分布: counts,
      预计时间: Math.max(10, Math.round(minutes / 5) * 5) + ' 分钟',
      学习条目数: learning.length,
      补充观察条目数: obs.length,
    };
    rec.学习计划 = (rec.学习计划 || []).map((s) => ({
      ...s,
      预计分钟: (s.建议条目 || []).reduce((n, x) => n + itemMinutes(x), 0),
    })).filter((s) => (s.建议条目 || []).length);
    return rec;
  }

  function adjustPlan(original, feedback) {
    const rec = clone(original);
    const text = String(feedback || '').trim();
    const used = new Set((rec.学习计划 || []).flatMap((s) => s.建议条目 || []).map((x) => x.题目编号));
    let note = '';

    const keepLearning = (items) => {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      const keepIds = new Set(items.map((x) => x.题目编号));
      rec.学习计划 = rec.学习计划.map((s) => ({ ...s, 建议条目: s.建议条目.filter((x) => keepIds.has(x.题目编号)) })).filter((s) => s.建议条目.length);
      if (!items.length) rec.学习计划 = [];
      return flat;
    };

    if (/难|多|压力|做不完|跟不上/.test(text)) {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      const ordered = flat.slice().sort((a, b) => difficulty(a.题目编号) - difficulty(b.题目编号));
      keepLearning(ordered.slice(0, 2));
      if (rec.记录不足补充观察?.建议条目) rec.记录不足补充观察.建议条目 = rec.记录不足补充观察.建议条目.slice(0, 1);
      note = '把任务压缩为 2 道学习题 + 1 道观察题，优先保留基础步骤；没有删除任何诊断结论。';
    } else if (/简单|挑战|不够|无聊/.test(text)) {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      const advanced = flat.filter((x) => difficulty(x.题目编号) >= 3);
      keepLearning(advanced.length ? advanced : flat.slice(-2));
      if (rec.记录不足补充观察) rec.记录不足补充观察.建议条目 = [];
      note = '减少基础重复，保留综合题；如果仍觉得简单，可在同指标内换一道未做过的 3 分题。';
    } else if (/时间|忙|短|来不及/.test(text)) {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      keepLearning(flat.slice(0, 2));
      if (rec.记录不足补充观察) rec.记录不足补充观察.建议条目 = [];
      note = '按“时间不够”压缩为前 2 道学习题，补充观察顺延到下一次；核心证据与优先级不变。';
    } else if (/基础|先补|不会|从零/.test(text)) {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      const basics = flat.filter((x) => x.类型 === '基础补弱' || difficulty(x.题目编号) <= 1);
      keepLearning(basics.length ? basics : flat.slice(0, 2));
      note = '只保留基础步骤题；先确认 1 分题能独立做对，再回到综合题。';
    } else if (/换|重复|不喜欢|另一道/.test(text)) {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      if (flat.length) {
        const first = flat[0];
        const tagId = first.知识点编号;
        const pool = (tags[tagId]?.题目 || []).filter((q) => !used.has(q));
        const pool2 = pool.length ? pool : (indicators[first.指标编号]?.题目列表 || []).filter((q) => !used.has(q));
        if (pool2.length) {
          const replacement = pool2[0];
          first.题目编号 = replacement;
          first.题干 = questions[replacement]?.题干 || '';
          first.满分 = questions[replacement]?.满分 || 1;
          first.题型 = questions[replacement]?.题型 || '';
          first.教材定位 = questions[replacement]?.教材定位 || first.教材定位;
          note = `已把第一道题换成同知识点的 ${replacement}，保留同一评分点目标与提示方式。`;
        } else {
          note = '同知识点没有更多未使用题目；保留原题，但可以把提示顺序倒过来，让学生先自己说步骤。';
        }
      }
    } else {
      const flat = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
      keepLearning(flat.slice(0, 3));
      note = '已按反馈把学习任务压缩到前 3 条；诊断证据和优先级没有改变。';
    }

    rec.计划说明 = `已根据反馈调整：${note} 原始诊断依据仍然成立。`;
    return { rec: recalculate(rec), note };
  }

  ZB.applyFeedback = function (feedback) {
    const sid = state.sid;
    const original = recs[sid];
    if (!original) return;
    const text = String(feedback || '').trim();
    if (!text) { ZB.toast('请先输入或选择一个反馈'); return; }
    const { rec, note } = adjustPlan(original, text);
    state.planFeedback[sid] = { text, note, adjusted: rec, ts: Date.now() };
    ZB.persist();
    ZB.render();
    ZB.toast('已按反馈调整学习计划');
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('#plan-feedback-send')) {
      const input = document.getElementById('plan-feedback-input');
      ZB.applyFeedback(input ? input.value : '');
    }
  });

  function planOverview(rec) {
    const o = rec.建议总览 || {};
    return `<div class="plan-overview">
      <div class="plan-stat"><small>TOTAL</small><strong>${o.总建议数 || 0}</strong><p>学习 ${o.学习条目数 || 0} 条 + 观察 ${o.补充观察条目数 || 0} 条</p></div>
      <div class="plan-stat"><small>TIME</small><strong>${esc(o.预计时间 || '—')}</strong><p>按题目难度估算，可随反馈压缩</p></div>
      <div class="plan-stat"><small>PRIORITY</small><strong>${o.优先级分布?.高 || 0} / ${o.优先级分布?.中 || 0} / ${o.优先级分布?.低 || 0}</strong><p>高 / 中 / 低优先级条目</p></div>
      <div class="plan-stat"><small>EVIDENCE</small><strong>${rec.诊断依据?.有效证据数 ?? '—'}</strong><p>总体得分率 ${fmtPct(rec.诊断依据?.总体得分率)}</p></div>
    </div>`;
  }

  function itemEvidence(item) {
    const key = `plan-evidence-${item.题目编号}`;
    const open = !!state.expanded[key];
    return `<button class="text-link" type="button" data-action="toggle-expand" data-key="${key}">${open ? '收起证据' : '查看评分点证据'} ${icon('chevronDown')}</button>
      ${open ? `<div class="evidence-list">${(item.当前证据 || []).map((e) => `<div class="evidence-line ${Number(e.得分) < Number(e.满分) ? 'lost' : 'found'}">
        <span class="ev-q">${esc(e.评分点 || e.题目总分 || item.题目编号)}</span>
        <span class="ev-p">${esc(e.节点 || '')}</span>
        <span class="ev-s">${e.得分 != null ? `${fmtScore(e.得分)}/${fmtScore(e.满分)}` : ''}</span>
        <span class="ev-d">${esc(e.描述 || '')}</span>
      </div>`).join('')}</div>` : ''}`;
  }

  function teacherAnswer(item) {
    if (state.role !== 'teacher') return '';
    const q = questions[item.题目编号] || {};
    return `<div class="answer-open"><span class="ao-label">TEACHER ONLY · 参考答案</span><strong>${esc(q.参考答案 || '—')}</strong><p>${esc(q.参考解析 || '')}</p></div>`;
  }

  function planItem(item, index, isObservation = false) {
    const q = questions[item.题目编号] || {};
    const openKey = `plan-stem-${item.题目编号}`;
    const stemOpen = !!state.expanded[openKey];
    return `<div class="plan-item" style="${isObservation ? 'border-color:#e5cfa7;background:#fffdf7' : ''}">
      <div class="pi-top">
        <div>
          <div class="pi-idline">
            <span class="qid-big">${esc(item.题目编号)}</span>
            <span class="chip ${isObservation ? 'amber' : 'teal'}">${esc(item.类型 || item.阶段)}</span>
            <span class="chip">${esc(item.题型 || q.题型 || '')} · ${fmtScore(item.满分)} 分</span>
            <span class="chip ${item.优先级 === '高' ? 'red' : item.优先级 === '中' ? 'amber' : 'gray'}">${esc(item.优先级 || '中')}优先</span>
          </div>
          <div class="pi-stem">${esc(stemOpen ? item.题干 : ZB.truncate(item.题干, 92))}${String(item.题干 || '').length > 92 ? ` <button class="text-link" type="button" data-action="toggle-expand" data-key="${openKey}">${stemOpen ? '收起' : '展开'}</button>` : ''}</div>
        </div>
        <span class="tag ${isObservation ? 'amber' : 'teal'}">${esc(item.知识点 || '')}</span>
      </div>
      <div class="pi-reason">${esc(item.理由 || '')}</div>
      <div class="hint-box">
        <div class="hb-head"><strong>${isObservation ? '观察提示' : '分步提示'} · 不直接给答案</strong><span class="tag">${(item.分步提示 || []).length} 步</span></div>
        <ol>${(item.分步提示 || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
      </div>
      <div class="plan-meta">
        <div><small>教材定位</small><span>${esc(item.教材定位 || '—')}</span></div>
        <div><small>完成条件</small><span>${esc(item.完成条件 || '—')}</span></div>
        <div><small>后续调整</small><span>${esc(item.后续调整 || '—')}</span></div>
      </div>
      <div class="row" style="margin-top:10px">${itemEvidence(item)}<button class="text-link" type="button" data-action="open-question" data-qid="${esc(item.题目编号)}">打开题目 ${icon('external')}</button></div>
      ${teacherAnswer(item)}
    </div>`;
  }

  function stageTimeline(rec) {
    if (!(rec.学习计划 || []).length) return '';
    return `<div class="timeline">${rec.学习计划.map((stage, idx) => `<div class="stage">
      <div class="stage-rail"><div class="stage-num">${idx + 1}</div><div class="stage-line"></div></div>
      <div class="stage-card">
        <div class="sc-head">
          <div><h3>${esc(stage.阶段)}</h3><div class="sc-goal">${esc(stage.目标)}</div></div>
          <div class="stage-meta"><span class="tag">约 ${stage.预计分钟} 分钟</span><span class="tag">前置：${esc(stage.前置条件 || '无')}</span></div>
        </div>
        ${stage.建议条目.map((item, i) => planItem(item, i)).join('')}
      </div>
    </div>`).join('')}</div>`;
  }

  function observationZone(rec) {
    const obs = rec.记录不足补充观察 || {};
    const items = obs.建议条目 || [];
    if (!items.length) return '';
    return `<div class="observation-zone">
      <div class="oz-head">
        <div><h3>记录不足 · 补充观察</h3><p>${esc(obs.说明 || '')}</p></div>
        <span class="chip amber">${items.length} 条观察</span>
      </div>
      <div class="row" style="gap:5px;margin-bottom:4px">${(obs.指标 || []).map((x) => `<span class="tag amber">${esc(x.指标编号)} · ${esc(x.状态)}</span>`).join('')}</div>
      ${items.map((item) => `<div class="obs-item">
        <div class="oi-top"><strong>${esc(item.题目编号)} · ${esc(item.知识点)}</strong><span class="chip amber">${esc(item.指标编号)}</span></div>
        <p>${esc(item.理由)}</p>
        <p class="small muted"><b>提示：</b>${esc((item.分步提示 || []).join('；'))}</p>
        <p class="small muted"><b>后续：</b>${esc(item.后续调整)}</p>
        <button class="text-link" type="button" data-action="open-question" data-qid="${esc(item.题目编号)}">打开题目 ${icon('external')}</button>
      </div>`).join('')}
      <p class="small" style="margin-top:10px;color:var(--amber-ink)">${esc(obs.后续 || '')}</p>
    </div>`;
  }

  function adjustmentPanel(rec) {
    const fb = state.planFeedback[state.sid];
    return `<div class="adjust-card">
      <div class="card-head"><div><h3>这份建议合适吗？</h3><p>反馈只调整任务量与顺序，不改变诊断证据。所有调整都会写明依据。</p></div>${fb ? `<button class="btn btn-secondary btn-sm" type="button" data-action="reset-plan">恢复原计划</button>` : ''}</div>
      ${fb ? `<div class="adjust-result"><strong>已调整：</strong>${esc(fb.note)}<br><span class="small muted">原始反馈：“${esc(fb.text)}” · 可随时恢复原计划。</span></div>` : ''}
      <div class="adj-chips">
        <button type="button" data-action="apply-feedback" data-feedback="太难了，做不完">太难了</button>
        <button type="button" data-action="apply-feedback" data-feedback="太简单了，想挑战">太简单</button>
        <button type="button" data-action="apply-feedback" data-feedback="时间不够，压缩一点">时间不够</button>
        <button type="button" data-action="apply-feedback" data-feedback="先补基础，从最简单的开始">先补基础</button>
        <button type="button" data-action="apply-feedback" data-feedback="换一道题，不要重复">换一道</button>
      </div>
      <div class="adjust-form">
        <input id="plan-feedback-input" type="text" placeholder="也可以直接说：例如“晚上只有 15 分钟”“想先练符号”" aria-label="学习建议反馈">
        <button class="btn btn-primary btn-sm" type="button" id="plan-feedback-send">应用反馈</button>
      </div>
      <p class="small muted" style="margin-top:8px">可调整项：难度、题量、时间、顺序、替换题目。若反馈与证据冲突，系统会优先保留数据结论。</p>
    </div>`;
  }

  ZB.views.plan = function () {
    const diag = diagnostics[state.sid];
    const original = recs[state.sid];
    if (!diag || !original) return `<div class="empty-state"><strong>未找到该学生的学习建议</strong></div>`;
    const fb = state.planFeedback[state.sid];
    const rec = fb?.adjusted ? fb.adjusted : original;
    const overall = diag.总体;
    return `<div class="view">
      <div class="view-head">
        <div>
          <span class="kicker">TASK 03 · 个性化学习建议</span>
          <h1>学习建议</h1>
          <p>每条建议都对应具体题目、评分点证据、教材位置和完成条件；提示只指向步骤，不直接给答案。</p>
        </div>
        <div class="view-head-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-action="open-student" data-sid="${esc(state.sid)}">${icon('student')}回到诊断</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="print">${icon('print')}打印</button>
        </div>
      </div>

      <div class="student-banner" style="padding:16px 18px">
        <div class="student-avatar" style="width:50px;height:50px;border-radius:15px;font-size:18px">${esc(state.sid.replace(/^D0?/, ''))}</div>
        <div class="sb-main"><div class="row"><h1 style="font-size:23px">${esc(state.sid)} · ${esc(diag.所属班级)}</h1>${ZB.statusChip(overall.status, ZB.statusLabel(overall.status))}</div><p>${esc(rec.计划说明 || '')}</p></div>
        <div class="sb-stats"><div class="sb-stat"><small>总体得分率</small><strong>${fmtPct(overall.rate)}</strong></div><div class="sb-stat"><small>有效证据</small><strong>${overall.evidenceCount || 0}</strong></div></div>
      </div>

      ${planOverview(rec)}
      <div class="note teal">${esc(rec.建议总览?.生成依据 || '')}</div>

      ${(rec.学习计划 || []).length ? stageTimeline(rec) : `<div class="empty-state" style="margin-top:18px"><div class="es-mark">○</div><strong>当前以补充观察为主</strong><p>${esc(rec.计划说明 || '')} 没有足够的低分证据支持“补弱”，先收集证据，避免把记录空白误判为未掌握。</p></div>`}

      ${observationZone(rec)}
      ${adjustmentPanel(rec)}

      <div class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>调整规则</h3><p>这些规则对全班一致，不因学生而随意改变。</p></div></div>
        <div class="grid-2">${(rec.调整规则 || []).map((x) => `<div class="evidence-box"><div class="ev-head"><span class="tag amber">触发</span><strong>${esc(x.触发)}</strong></div><p>${esc(x.调整)}</p></div>`).join('')}</div>
        <div class="note gray" style="margin-top:12px">${esc(rec.教师复核提示 || '')}</div>
      </div>
    </div>`;
  };
})();
