/* ==========================================================================
   智慧学伴 · 典型案例
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { cases, diagnostics, recs, questions, themes, indicators, recordsByStudent } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const fmtScore = ZB.fmtScore;
  const icon = ZB.icon;

  const FALLBACK = [
    { caseKey: 'case1_partial', type: '部分得分', studentId: 'D04', headline: '从部分得分定位到具体评分点。' },
    { caseKey: 'case2_strong', type: '表现较好', studentId: 'D14', headline: '用变式检验迁移。' },
    { caseKey: 'case3_limited', type: '记录不足', studentId: 'D17', headline: '记录空白不等于未掌握。' },
  ];

  function caseList() {
    return (cases.list && cases.list.length) ? cases.list : FALLBACK;
  }

  function activeCase() {
    const meta = cases[state.caseKey] || {};
    const item = caseList().find((c) => c.caseKey === state.caseKey) || caseList()[0];
    return { ...item, ...meta };
  }

  function caseTabs() {
    return `<div class="case-selector">${caseList().map((c) => {
      const d = diagnostics[c.studentId];
      const overall = d?.总体 || {};
      return `<button class="case-tab ${state.caseKey === c.caseKey ? 'active' : ''}" type="button" data-action="set-case" data-case-key="${esc(c.caseKey)}">
        <div class="ct-type">${esc(c.type)}</div>
        <div class="ct-main"><strong>${esc(c.studentId)}</strong><b>${fmtPct(overall.rate)}</b></div>
        <p>${esc(c.headline || c.reason || '')}</p>
      </button>`;
    }).join('')}</div>`;
  }

  function keyRecords(c, diag) {
    const studentRecords = recordsByStudent[c.studentId] || [];
    const qids = new Set();
    const sys = (diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic');
    sys.forEach((t) => (t.关联题目 || []).forEach((q) => qids.add(q)));
    // 记录不足的指标：优先展示学生真正做过的那道题，而不是随便取第一题
    Object.values(diag.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence').forEach((x) => {
      const rec = studentRecords.find((r) => questions[r.questionId]?.指标编号 === x.指标编号);
      if (rec) qids.add(rec.questionId);
      else (indicators[x.指标编号]?.题目列表 || []).slice(0, 1).forEach((q) => qids.add(q));
    });
    // 强项案例补充几道已评分题，避免整张表都是“无记录”
    if (qids.size < 6) {
      studentRecords
        .slice()
        .sort((a, b) => (Number(b.graded) - Number(a.graded)) || ((b.score || 0) - (a.score || 0)))
        .forEach((r) => { if (qids.size < 8) qids.add(r.questionId); });
    }
    if (!qids.size) studentRecords.slice(0, 6).forEach((r) => qids.add(r.questionId));
    return Array.from(qids).slice(0, 8).map((qid) => {
      const rec = studentRecords.find((r) => r.questionId === qid);
      return { qid, rec };
    });
  }

  function performanceSection(c, diag) {
    const rows = keyRecords(c, diag);
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>已有表现</h3><p>先看原始证据：题目、节点、得分、评分点。没有记录的地方单独说明。</p></div><span class="tag">${rows.length} 道关键题</span></div>
      <div class="table-scroll"><table class="trace-table"><thead><tr><th>题目</th><th>节点</th><th>状态</th><th>得分</th><th>评分点</th><th>学生作答</th></tr></thead><tbody>
        ${rows.map(({ qid, rec }) => `<tr>
          <td><button class="chip qid" type="button" data-action="open-question" data-qid="${esc(qid)}">${esc(qid)}</button></td>
          <td>${esc(rec?.node || '—')}</td>
          <td>${esc(rec ? (rec.graded ? '已评分' : rec.pending ? '待评分' : rec.unanswered ? '未作答' : rec.status) : '无记录')}</td>
          <td>${rec?.graded ? `${fmtScore(rec.score)}/${fmtScore(rec.max)}` : '—'}</td>
          <td class="small">${rec?.points ? Object.entries(rec.points).map(([k, v]) => `${esc(k)}=${fmtScore(v)}`).join('；') : '—'}</td>
          <td class="small">${esc(ZB.truncate(rec?.answer || '—', 34))}</td>
        </tr>`).join('')}
      </tbody></table></div>
      ${(diag.修订模式?.详情 || []).length ? `<div class="note amber" style="margin-top:12px"><strong>修订：</strong>${esc(diag.修订模式.解读)} ${diag.修订模式.详情.map((d) => `${esc(d.题目编号)} ${fmtScore(d.首次得分)}→${fmtScore(d.最终得分)}`).join('；')}</div>` : ''}
    </div>`;
  }

  function diagnosisSection(diag) {
    const sys = (diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic');
    const within = (diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'within_question');
    const limited = Object.values(diag.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence');
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>学情诊断</h3><p>先给结论，再给证据；记录不足时明确说“暂不能判断”。</p></div>${ZB.statusChip(diag.总体.status, ZB.statusLabel(diag.总体.status))}</div>
      <div class="note teal">${esc(diag.诊断叙述?.摘要 || '')}</div>
      ${sys.length ? `<div class="divider"></div><p class="small muted">评分点级：跨题系统性薄弱</p><div class="stack">${sys.map((t) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(t.知识点)}</strong><span class="chip red">${fmtPct(t.得分率)}</span><span class="small muted">${t.被考核次数} 次 · ${esc((t.关联题目 || []).join('、'))}</span></div><p>${esc(t.说明)}</p></div>`).join('')}</div>` : ''}
      ${within.length ? `<div class="divider"></div><p class="small muted">评分点级：同题多步失分</p><div class="stack">${within.map((t) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(t.知识点)}</strong><span class="chip amber">${fmtPct(t.得分率)}</span><span class="small muted">${esc((t.关联题目 || []).join('、'))}</span></div><p>${esc(t.说明)}</p></div>`).join('')}</div>` : ''}
      ${limited.length ? `<div class="divider"></div><p class="small muted">记录不足：不能直接判为未掌握</p><div class="grid-3">${limited.map((x) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(x.观察指标)}</strong>${ZB.statusChip(x.status, ZB.statusLabel(x.status))}</div><p>${x.evidenceCount} 条证据 · 覆盖 ${x.distinctQuestions} 道题</p></div>`).join('')}</div>` : ''}
      ${(diag.交叉关联 || []).length ? `<div class="divider"></div><p class="small muted">交叉关联</p><div class="stack">${diag.交叉关联.map((c) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(c.目标指标)} ← ${esc(c.前置指标)}</strong>${ZB.severityChip(c.严重程度)}</div><p>${esc(c.说明)}</p></div>`).join('')}</div>` : ''}
    </div>`;
  }

  function requirementSection(diag) {
    const themeIds = new Set();
    const tagList = [...(diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic' || t.模式 === 'within_question')];
    tagList.forEach((t) => (t.指标编号 || []).forEach((iid) => themeIds.add(iid.slice(0, 3))));
    Object.values(diag.指标诊断 || {}).forEach((x) => {
      if (x.status === 'secure' || x.status === 'needs_support' || x.status === 'limited' || x.status === 'no_evidence') {
        themeIds.add(x.指标编号.slice(0, 3));
      }
    });
    if (!themeIds.size) ['T01', 'T02', 'T03'].forEach((t) => themeIds.add(t));
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>学习要求</h3><p>这个案例涉及的主题、观察指标与课标/教材定位。</p></div><span class="tag">${themeIds.size} 个主题</span></div>
      <div class="grid-3">${Array.from(themeIds).map((tid) => {
        const t = themes.find((x) => x.主题编号 === tid) || {};
        return `<div class="material-card"><div class="mc-type">${esc(tid)} · ${esc(t.课标引用?.编号 || '')}</div><h4>${esc(t.主题名称 || tid)}</h4><p>${esc(t.主题目标 || '')}</p><span class="source">${esc((t.教材位置 || []).join(' · '))}</span></div>`;
      }).join('')}</div>
    </div>`;
  }

  function planSection(c, rec) {
    if (!rec) return '';
    const items = (rec.学习计划 || []).flatMap((s) => s.建议条目 || []);
    const obs = rec.记录不足补充观察?.建议条目 || [];
    const chosen = items.slice(0, 3);
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>教学建议</h3><p>${esc(rec.计划说明 || '')}</p></div><button class="text-link" type="button" data-action="open-plan" data-sid="${esc(c.studentId)}">完整计划 ${icon('arrow')}</button></div>
      ${chosen.length ? `<div class="stack">${chosen.map((it) => `<div class="evidence-box"><div class="ev-head"><span class="chip qid">${esc(it.题目编号)}</span><strong>${esc(it.知识点)}</strong><span class="chip ${it.优先级 === '高' ? 'red' : 'amber'}">${esc(it.优先级)}优先</span></div><p><strong>理由：</strong>${esc(it.理由)}</p><p><strong>提示：</strong>${esc((it.分步提示 || []).slice(0, 3).join('；'))}</p><p class="small muted"><strong>教材：</strong>${esc(it.教材定位)}</p></div>`).join('')}</div>` : `<div class="note amber">${esc(rec.计划说明 || '')}</div>`}
      ${obs.length ? `<div class="divider"></div><p class="small muted">补充观察：${obs.map((x) => `${esc(x.题目编号)}（${esc(x.指标编号)}）`).join('、')}</p><p class="small" style="margin-top:4px">${esc(rec.记录不足补充观察.说明)}</p>` : ''}
    </div>`;
  }

  function traceSection(c, diag, rec) {
    const rows = [];
    const sys = (diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic').slice(0, 3);
    sys.forEach((t) => rows.push([
      `「${t.知识点}」是跨题系统性问题`,
      `${(t.关联题目 || []).join('、')} 共 ${t.被考核次数} 个评分点，得分率 ${fmtPct(t.得分率)}`,
      ZB.index.tags[t.知识点编号]?.教材定位 || '对应教材页码',
    ]));
    const limited = Object.values(diag.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence').slice(0, 2);
    limited.forEach((x) => rows.push([
      `${x.观察指标}暂不能判断`,
      `只有 ${x.evidenceCount} 条有效证据、覆盖 ${x.distinctQuestions} 道题`,
      '补充观察题（见学习建议）',
    ]));
    const items = (rec?.学习计划 || []).flatMap((s) => s.建议条目 || []).slice(0, 2);
    items.forEach((it) => rows.push([
      `建议练习 ${it.题目编号}`,
      it.理由,
      it.教材定位,
    ]));
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>结果核对</h3><p>每一条结论都能回到证据与材料；这是本案例可复核的部分。</p></div><span class="tag teal">${rows.length} 条</span></div>
      <div class="table-scroll"><table class="trace-table"><thead><tr><th>结论 / 建议</th><th>证据</th><th>材料或下一步</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  }

  ZB.views.cases = function () {
    const c = activeCase();
    const diag = diagnostics[c.studentId];
    const rec = recs[c.studentId];
    if (!diag) return `<div class="empty-state"><strong>案例数据未加载</strong></div>`;
    const overall = diag.总体;
    const items = caseList();
    return `<div class="view">
      <div class="view-head">
        <div><span class="kicker">RESULT CHECK · 三个案例</span><h1>典型案例</h1><p>同一套规则在三种学生身上的表现：部分得分、表现较好、记录不足。每个案例都展示“学习要求—已有表现—诊断—建议—核对”。</p></div>
        <div class="view-head-actions"><button class="btn btn-secondary btn-sm" type="button" data-action="open-student" data-sid="${esc(c.studentId)}">${icon('student')}打开完整诊断</button><button class="btn btn-primary btn-sm" type="button" data-action="open-plan" data-sid="${esc(c.studentId)}">${icon('plan')}完整建议</button></div>
      </div>

      ${caseTabs()}

      <div class="case-hero">
        <div>
          <div class="ch-type">${esc(c.type)} · CASE</div>
          <h2>${esc(c.studentId)} · ${esc(diag.所属班级)}</h2>
          <p>${esc(c.选取理由 || c.headline || '')}</p>
          <div class="row" style="margin-top:12px">${ZB.statusChip(overall.status, ZB.statusLabel(overall.status))}<span class="tag" style="border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e8dcc6">${esc(diag.记录概况?.记录是否充分 || '')}</span></div>
        </div>
        <div class="ch-stats">
          <div class="ch-stat"><small>总体得分率</small><strong>${fmtPct(overall.rate)}</strong></div>
          <div class="ch-stat"><small>有效证据</small><strong>${overall.evidenceCount || 0}</strong></div>
          <div class="ch-stat"><small>覆盖题目</small><strong>${diag.记录概况?.覆盖题目数 || 0}</strong></div>
        </div>
      </div>

      <div class="trace-flow">
        <div class="trace-step"><small>01 · 要求</small><strong>这门课要求什么</strong><p>主题目标、指标、课标与教材位置。</p></div>
        <div class="trace-step"><small>02 · 表现</small><strong>学生实际做了什么</strong><p>题目、得分、评分点、作答与修订。</p></div>
        <div class="trace-step"><small>03 · 诊断</small><strong>证据说明什么</strong><p>系统性、单次、同题多步或记录不足。</p></div>
        <div class="trace-step"><small>04 · 建议</small><strong>下一步做什么</strong><p>具体题目、分步提示、教材与调整规则。</p></div>
      </div>

      <div class="case-section">${requirementSection(diag)}</div>
      <div class="case-section">${performanceSection(c, diag)}</div>
      <div class="case-section">${diagnosisSection(diag)}</div>
      <div class="case-section">${planSection(c, rec)}</div>
      <div class="case-section">${traceSection(c, diag, rec)}</div>

      <div class="case-section">
        <div class="cs-head"><span class="cs-num">↔</span><div><h3>三个案例的差异</h3><div class="cs-sub">同一个智能体，不同的证据基础，导出不同的下一步。</div></div></div>
        <div class="case-compare">${items.map((x) => {
          const d = diagnostics[x.studentId];
          const r = recs[x.studentId];
          const sys = d ? (d.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic').length : 0;
          return `<button class="cc" type="button" data-action="set-case" data-case-key="${esc(x.caseKey)}" style="text-align:left"><strong>${esc(x.type)} · ${esc(x.studentId)}</strong><p>${fmtPct(d?.总体?.rate)} · ${d?.总体?.evidenceCount || 0} 条证据 · ${sys} 个系统性问题 · ${r?.建议总览?.补充观察条目数 || 0} 条观察</p><p>${esc(x.headline || '')}</p></button>`;
        }).join('')}</div>
      </div>
    </div>`;
  };
})();
