/* ==========================================================================
   智慧学伴 · 学情总览
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { groups, comparison, diagnostics, students, indicators, themes, questions } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const icon = ZB.icon;

  const IND_ORDER = ['T01I1', 'T01I2', 'T01I3', 'T02I1', 'T02I2', 'T02I3', 'T03I1', 'T03I2', 'T03I3'];

  function classTabs() {
    return `<div class="segmented" role="group" aria-label="选择班级">
      ${['DC01', 'DC02', 'ALL'].map((c) => `<button type="button" class="${state.classFilter === c ? 'active' : ''}" data-action="set-class" data-cls="${c}">${c === 'ALL' ? '全部学生' : c}</button>`).join('')}
    </div>`;
  }

  function kpis(g) {
    const common = g.共性问题 || [];
    const diff = g.分化指标 || [];
    const coverage = g.记录覆盖不足 || [];
    return `<div class="kpi-grid">
      <div class="metric"><div class="m-label">STUDENTS</div><div class="m-value">${g.班级总览?.学生数 || 0}<small>人</small></div><div class="m-note">${state.classFilter === 'ALL' ? '两个模拟班合计' : state.classFilter + ' 模拟班'}</div></div>
      <div class="metric green"><div class="m-label">POOLED RATE</div><div class="m-value">${fmtPct(g.班级总览?.平均得分率)}<small>合并得分率</small></div><div class="m-note">${g.班级总览?.有效证据数 || 0} 条有效评分证据</div></div>
      <div class="metric amber"><div class="m-label">COMMON ISSUES</div><div class="m-value">${common.length}<small>个共性问题</small></div><div class="m-note">合并得分率低于 50% 且至少 5 名学生有证据</div></div>
      <div class="metric red"><div class="m-label">DIFFERENTIATION</div><div class="m-value">${diff.length}<small>个分化指标</small></div><div class="m-note">${coverage.length} 个指标存在记录覆盖不足</div></div>
    </div>`;
  }

  function compareChart() {
    const rows = IND_ORDER.map((iid) => {
      const a = groups.DC01?.指标诊断?.[iid] || {};
      const b = groups.DC02?.指标诊断?.[iid] || {};
      const diff = (a.rate != null && b.rate != null) ? (b.rate - a.rate) : null;
      const hot = comparison?.最大差距?.指标编号 === iid;
      return `<div class="compare-row ${hot ? 'hot' : ''}">
        <div class="cr-label"><strong>${esc(indicators[iid]?.观察指标 || iid)}</strong><small>${esc(iid)}${diff != null ? ` · 差 ${ZB.fmtDelta(diff)}` : ''}</small></div>
        <div class="compare-bars">
          <div class="compare-bar"><span>DC01</span>${ZB.bar(a.rate, '')}<b>${fmtPct(a.rate)}</b></div>
          <div class="compare-bar"><span>DC02</span>${ZB.bar(b.rate, 'amber')}<b>${fmtPct(b.rate)}</b></div>
        </div>
      </div>`;
    }).join('');
    return `<div class="compare-chart">${rows}</div>`;
  }

  function heatmap() {
    const rows = students.filter((s) => state.classFilter === 'ALL' || s.classId === state.classFilter);
    const head = IND_ORDER.map((iid) => `<div class="hm-head" title="${esc(indicators[iid]?.观察指标 || iid)}">${esc(iid)}</div>`).join('');
    const body = rows.map((s) => {
      const d = diagnostics[s.id];
      const cells = IND_ORDER.map((iid) => {
        const stat = d?.指标诊断?.[iid] || {};
        const cls = ZB.rateColorClass(stat.rate, stat.status);
        return `<div class="hm-cell ${cls}" data-action="open-student" data-sid="${esc(s.id)}" title="${esc(s.id)} · ${esc(iid)} · ${esc(ZB.statusLabel(stat.status))} · ${fmtPct(stat.rate)} · ${stat.evidenceCount || 0} 条证据">${stat.evidenceCount ? fmtPct(stat.rate) : '·'}</div>`;
      }).join('');
      return `<div class="hm-sid" data-action="open-student" data-sid="${esc(s.id)}">${esc(s.id)}</div>${cells}`;
    }).join('');
    return `<div class="heatmap-wrap"><div class="heatmap"><div></div>${head}${body}</div></div>
      <div class="legend">
        <span><i class="hm-secure"></i>掌握较好 ≥85%</span>
        <span><i class="hm-developing"></i>发展中 60–84%</span>
        <span><i class="hm-needs_support"></i>需巩固 &lt;60%</span>
        <span><i class="hm-limited"></i>记录不足</span>
        <span><i class="hm-no_evidence"></i>无记录</span>
        <span><i class="hm-not_measured"></i>本节点未测</span>
      </div>`;
  }

  function commonIssues(g) {
    const issues = g.共性问题 || [];
    if (!issues.length) {
      const rel = (g.相对薄弱指标 || []).slice(0, 3);
      return `<div class="empty-state" style="padding:22px"><div class="es-mark">✓</div><strong>没有严格的“共性问题”</strong><p>合并得分率没有低于 50% 且学生证据充分的指标。相对靠后的指标是：${rel.map((x) => `${esc(x.观察指标)}（${fmtPct(x.rate)}）`).join('；')}。</p></div>`;
    }
    const suggestions = g.群体级建议 || [];
    return `<div class="stack">${issues.map((x, idx) => {
      const sug = suggestions.find((s) => s.知识点编号 === (g.共性知识点?.[idx]?.知识点编号)) || suggestions[idx];
      return `<div class="issue-card">
        <div class="ic-head"><div><strong>${esc(x.观察指标)}</strong><div class="small muted">${esc(x.指标编号)} · ${x.学生证据数} 名学生有证据</div></div><div class="rate">${fmtPct(x.得分率)}</div></div>
        <p>${esc(x.说明)}</p>
        ${sug ? `<div class="ic-tags"><span class="tag teal">建议讲评 ${esc((sug.建议题目 || []).slice(0, 3).join('、'))}</span></div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function differentiation(g) {
    const items = g.分化指标 || [];
    if (!items.length) return `<div class="empty-state" style="padding:22px"><div class="es-mark">≈</div><strong>暂未发现明显分化</strong><p>学生得分率标准差均低于 20%，或有效学生数不足 5 人。</p></div>`;
    return `<div class="stack">${items.map((x) => {
      const lo = x.最低 ?? 0;
      const hi = x.最高 ?? 0;
      return `<div class="issue-card">
        <div class="ic-head"><div><strong>${esc(x.观察指标)}</strong><div class="small muted">${esc(x.指标编号)} · 标准差 ${fmtPct(x.标准差)}</div></div><div class="rate" style="color:var(--amber-ink)">${fmtPct(x.标准差)}</div></div>
        <p>${esc(x.说明)}</p>
        <div class="range-bar"><div class="range-fill" style="left:${Math.round(lo * 100)}%;width:${Math.max(2, Math.round((hi - lo) * 100))}%"></div></div>
        <div class="range-labels"><span>最低 ${fmtPct(lo)}</span><span>最高 ${fmtPct(hi)}</span></div>
      </div>`;
    }).join('')}</div>`;
  }

  function groupSuggestions(g) {
    const items = g.群体级建议 || [];
    if (!items.length) return `<div class="empty-state" style="padding:22px"><div class="es-mark">·</div><strong>暂无群体级讲评建议</strong><p>现有记录不足以支持一个覆盖全班的共同讲评主题。</p></div>`;
    return `<div class="stack">${items.map((x) => `<div class="issue-card">
      <div class="ic-head"><div><strong>${esc(x.知识点)}</strong><div class="small muted">${esc(x.知识点编号)} · ${x.被考核次数} 次考核 · ${fmtPct(x.得分率)}</div></div><span class="chip amber">${fmtPct(x.得分率)}</span></div>
      <p>${esc(x.说明)}</p>
      <div class="ic-tags">${(x.建议题目 || []).map((q) => `<button class="chip qid" type="button" data-action="open-question" data-qid="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`).join('')}</div>`;
  }

  ZB.views.analysis = function () {
    const g = groups[state.classFilter] || groups.ALL || groups.DC01;
    if (!g) return `<div class="empty-state"><strong>群体数据未加载</strong></div>`;
    return `<div class="view">
      <div class="view-head">
        <div>
          <span class="kicker">TASK 02 · 群体层面</span>
          <h1>学情总览</h1>
          <p>看清楚两件事：哪些指标是全班共同的坎，哪些指标班内差异已经拉开。所有比例都按已评分记录合并计算。</p>
        </div>
        <div class="view-head-actions">${classTabs()}<button class="btn btn-secondary btn-sm" type="button" data-action="print">${icon('print')}打印</button></div>
      </div>

      ${kpis(g)}
      <div class="note teal" style="margin-top:14px">${esc(g.叙述 || '')}</div>

      <div class="analysis-grid">
        <section class="card card-pad">
          <div class="card-head"><div><h3>两班指标对照</h3><p>合并得分率；橙色为 DC02。红色标签是本次最大差距指标。</p></div><span class="tag teal">${esc(comparison?.最大差距?.指标编号 || '—')}</span></div>
          ${compareChart()}
          <div class="note gray" style="margin-top:12px">${esc(comparison?.叙述 || '')}</div>
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>共性问题</h3><p>合并得分率 &lt;50%，且至少 5 名学生有证据。</p></div><span class="tag red">${(g.共性问题 || []).length}</span></div>
          ${commonIssues(g)}
        </section>
      </div>

      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>学生 × 指标热力图</h3><p>一行一个学生，一格一个指标；点击学生进入个体诊断。</p></div><span class="tag">${state.classFilter === 'ALL' ? students.length : students.filter((s) => s.classId === state.classFilter).length} 行</span></div>
        ${heatmap()}
      </section>

      <div class="analysis-grid">
        <section class="card card-pad">
          <div class="card-head"><div><h3>班内分化</h3><p>学生得分率标准差 ≥20%，说明“同一节课”对不同学生效果不同。</p></div><span class="tag amber">${(g.分化指标 || []).length}</span></div>
          ${differentiation(g)}
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>群体级讲评建议</h3><p>按评分点共性排序；题目编号可直接打开查看。</p></div><span class="tag teal">${(g.群体级建议 || []).length}</span></div>
          ${groupSuggestions(g)}
        </section>
      </div>

      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>记录覆盖不足</h3><p>这些指标只有部分学生有证据；群体结论只覆盖有证据的学生。</p></div><span class="tag">${(g.记录覆盖不足 || []).length}</span></div>
        ${(g.记录覆盖不足 || []).length ? `<div class="grid-3">${g.记录覆盖不足.map((x) => `<div class="issue-card"><div class="ic-head"><strong>${esc(x.观察指标)}</strong><span class="chip gray">${fmtPct(x.覆盖率)}</span></div><p>${esc(x.说明)}</p></div>`).join('')}</div>` : `<div class="empty-state" style="padding:22px"><div class="es-mark">✓</div><strong>覆盖充分</strong><p>每个指标都有至少一半学生具备有效证据。</p></div>`}
      </section>
    </div>`;
  };
})();
