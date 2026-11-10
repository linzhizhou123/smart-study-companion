/* ==========================================================================
   智慧学伴 · 个体诊断
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { diagnostics, indicators, themes, students, questions, recordsByStudent } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const fmtScore = ZB.fmtScore;
  const fmtDelta = ZB.fmtDelta;
  const icon = ZB.icon;
  const IND_ORDER = ['T01I1', 'T01I2', 'T01I3', 'T02I1', 'T02I2', 'T02I3', 'T03I1', 'T03I2', 'T03I3'];

  function recordFor(sid, qid, node) {
    return (recordsByStudent[sid] || []).find((r) => r.questionId === qid && (!node || r.node === node));
  }

  function scoreTagsForNode(diag) {
    if (state.node === 'ALL') return diag.评分点级诊断?.['全部'] || [];
    const summaries = diag.评分点级诊断?.[state.node] || [];
    const full = diag.评分点级诊断?.['全部'] || [];
    return summaries.map((s) => {
      const f = full.find((x) => x.知识点编号 === s.知识点编号);
      return { ...s, 证据: (f?.证据 || []).filter((e) => e.节点编号 === state.node) };
    });
  }

  function nodeTabs() {
    return `<div class="segmented" role="group" aria-label="选择测验节点">
      <button type="button" data-action="set-node" data-node="ALL" class="${state.node === 'ALL' ? 'active' : ''}">全部</button>
      <button type="button" data-action="set-node" data-node="N01" class="${state.node === 'N01' ? 'active' : ''}">N01 上学期</button>
      <button type="button" data-action="set-node" data-node="N02" class="${state.node === 'N02' ? 'active' : ''}">N02 下学期</button>
    </div>`;
  }

  function evidenceHTML(tag, diag) {
    const evidence = tag.证据 || [];
    if (!evidence.length) return `<p class="small muted">本节点没有该知识点的评分点证据。</p>`;
    return `<div class="evidence-list">${evidence.map((e) => {
      const rec = recordFor(diag.学生编号, e.题目编号, e.节点编号);
      const lost = Number(e.得分) < Number(e.满分);
      return `<div class="evidence-line ${lost ? 'lost' : 'found'}">
        <button class="ev-q" type="button" data-action="open-question" data-qid="${esc(e.题目编号)}" style="border:0;background:none;padding:0;text-align:left">${esc(e.题目编号)}</button>
        <span class="ev-p">${esc(e.评分点)}</span>
        <span class="ev-s">${esc(e.节点编号)} · ${fmtScore(e.得分)}/${fmtScore(e.满分)}</span>
        <span class="ev-d">${esc(e.描述 || '')}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function studentHeader(diag, overall) {
    const student = students.find((s) => s.id === diag.学生编号) || {};
    const profile = diag.记录概况 || {};
    const isLimited = overall.status === 'limited' || overall.status === 'no_evidence';
    return `<div class="student-banner">
      <div class="student-avatar">${esc(diag.学生编号.replace(/^D0?/, ''))}</div>
      <div class="sb-main">
        <div class="row" style="gap:8px">
          <h1>${esc(diag.学生编号)} · ${esc(diag.所属班级)}</h1>
          ${ZB.statusChip(overall.status, ZB.statusLabel(overall.status))}
          <span class="tag">${esc(student.grade || '7')} 年级</span>
        </div>
        <p>${esc(profile.说明 || '')}</p>
        ${isLimited ? `<div class="note red student-note">当前有效证据不足，以下所有比例只描述“已有证据”，不代表完整掌握情况。没有记录的指标不会自动判为薄弱。</div>` : ''}
      </div>
      <div class="sb-stats">
        <div class="sb-stat"><small>总体得分率</small><strong>${fmtPct(overall.rate)}</strong></div>
        <div class="sb-stat"><small>有效证据</small><strong>${overall.evidenceCount ?? 0}</strong></div>
        <div class="sb-stat"><small>覆盖题目</small><strong>${profile.覆盖题目数 ?? 0}</strong></div>
        <div class="sb-stat"><small>记录状态</small><strong style="font-size:14px;font-family:var(--sans)">${esc(profile.记录是否充分 || '—')}</strong></div>
      </div>
    </div>`;
  }

  function themePanel(diag, themeData, indicatorData) {
    return `<div class="card card-pad">
      <div class="card-head"><div><h3>主题表现</h3><p>${state.node === 'ALL' ? '两个节点合并' : state.node + ' 节点'}；主题得分率只统计已评分记录。</p></div></div>
      ${themes.map((t) => {
        const stats = themeData?.[t.主题编号] || {};
        const themeInds = (t.指标列表 || []).map((x) => x.指标编号);
        const allNotMeasured = themeInds.every((iid) => indicatorData?.[iid]?.status === 'not_measured');
        const status = allNotMeasured ? 'not_measured' : (stats.status || 'no_evidence');
        return `<div class="theme-row">
          <div class="tr-main"><strong>${esc(t.主题名称)}</strong><p>${esc(t.主题目标)}</p>
            <div class="inline-list" style="margin-top:7px">${themeInds.map((iid) => `<span class="tag">${esc(iid)}</span>`).join('')}</div>
          </div>
          <div class="tr-rate">
            ${ZB.bar(stats.rate, status === 'needs_support' ? 'red' : status === 'secure' ? 'green' : '')}
            <b>${fmtPct(stats.rate)}</b>
            ${ZB.statusChip(status, ZB.statusLabel(status))}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function topTagsForIndicator(diag, iid) {
    const tags = (diag.评分点级诊断?.['全部'] || []).filter((t) => (t.指标编号 || []).includes(iid));
    return tags
      .filter((t) => t.模式 === 'systemic' || t.模式 === 'within_question' || t.模式 === 'single')
      .slice(0, 2);
  }

  function indicatorGrid(diag, indicatorData) {
    return `<div class="indicator-grid">${IND_ORDER.map((iid) => {
      const stat = indicatorData?.[iid] || {};
      const meta = indicators[iid] || {};
      const selected = state.expanded.indicator === iid;
      const weak = topTagsForIndicator(diag, iid);
      return `<button class="ind-card ${selected ? 'selected' : ''}" type="button" data-action="open-indicator" data-iid="${esc(iid)}">
        <div class="ic-top"><span class="iid">${esc(iid)}</span>${ZB.statusChip(stat.status, ZB.statusLabel(stat.status))}</div>
        <h4>${esc(meta.观察指标 || iid)}</h4>
        <div class="ic-rate"><strong>${fmtPct(stat.rate)}</strong><span>${stat.evidenceCount || 0} 条证据 · ${stat.distinctQuestions || 0} 题</span></div>
        ${ZB.bar(stat.rate, stat.status === 'needs_support' ? 'red' : stat.status === 'secure' ? 'green' : stat.status === 'limited' ? 'gray' : '')}
        <div class="ic-tags">${weak.length ? weak.map((t) => `<span class="chip ${t.模式 === 'systemic' ? 'red' : 'amber'}">${esc(t.知识点)} ${fmtPct(t.得分率)}</span>`).join('') : `<span class="tag">置信 ${stat.confidence === 'high' ? '高' : stat.confidence === 'medium' ? '中' : '低'}</span>`}</div>
      </button>`;
    }).join('')}</div>`;
  }

  function indicatorDetail(diag, indicatorData, iid) {
    if (!iid) return '';
    const stat = indicatorData?.[iid] || {};
    const meta = indicators[iid] || {};
    const tags = (diag.评分点级诊断?.['全部'] || []).filter((t) => (t.指标编号 || []).includes(iid));
    const qids = meta.题目列表 || [];
    return `<div class="ind-detail">
      <div class="spread" style="align-items:flex-start">
        <div><h3>${esc(iid)} · ${esc(meta.观察指标 || '')}</h3><p>${esc(meta.教材页码?.join(' · ') || '')}　·　${esc(meta.前置指标?.length ? '前置：' + meta.前置指标.join('、') : '无前置指标')}</p></div>
        <button class="btn btn-secondary btn-sm" type="button" data-action="open-indicator" data-iid="${esc(iid)}">收起</button>
      </div>
      <div class="grid-3" style="margin-top:12px">
        <div class="kv-row"><span>得分率</span><b>${fmtPct(stat.rate)}</b></div>
        <div class="kv-row"><span>有效证据</span><b>${stat.evidenceCount || 0} 条</b></div>
        <div class="kv-row"><span>覆盖题目</span><b>${stat.distinctQuestions || 0} / ${qids.length} 题</b></div>
      </div>
      <div class="grid-2" style="margin-top:12px;align-items:start">
        <div class="panel">
          <div class="panel-head"><h3>题目表现</h3></div>
          <div class="table-scroll"><table class="q-table"><thead><tr><th>题目</th><th>节点</th><th>状态</th><th>得分</th></tr></thead><tbody>
            ${qids.map((qid) => {
              const rec = recordFor(diag.学生编号, qid, state.node === 'ALL' ? null : state.node);
              const st = rec ? (rec.graded ? '已评分' : rec.pending ? '待评分' : '未作答') : '无记录';
              return `<tr data-action="open-question" data-qid="${esc(qid)}"><td class="qid">${esc(qid)}</td><td>${esc(rec?.node || '—')}</td><td>${esc(st)}</td><td>${rec?.graded ? `${fmtScore(rec.score)}/${fmtScore(rec.max)}` : '—'}</td></tr>`;
            }).join('')}
          </tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>本指标内的知识点</h3></div>
          ${tags.length ? `<div class="stack">${tags.map((t) => `<div class="evidence-box"><div class="ev-head">${ZB.patternChip(t.模式)} ${ZB.severityChip(t.严重程度)} <strong>${esc(t.知识点)}</strong><span class="small muted">${fmtPct(t.得分率)} · ${t.被考核次数} 次</span></div><p>${esc((t.关联题目 || []).join('、'))}</p></div>`).join('')}</div>` : `<p class="small muted">本节点还没有该指标的评分点证据。</p>`}
        </div>
      </div>
    </div>`;
  }

  function scorePointSection(diag) {
    const filters = [
      ['all', '全部'],
      ['systemic', '系统性薄弱'],
      ['within_question', '同题多步'],
      ['single', '单次失误'],
      ['mastered', '掌握较好'],
      ['untested', '未测'],
    ];
    const all = scoreTagsForNode(diag);
    const untested = (diag.评分点级诊断?.['未测知识点'] || []);
    let rows = all;
    if (state.scoreFilter !== 'all') {
      if (state.scoreFilter === 'untested') rows = [];
      else rows = all.filter((t) => t.模式 === state.scoreFilter);
    }
    const tableRows = rows.map((t) => {
      const key = `tag-${t.知识点编号}`;
      const open = !!state.expanded[key];
      return `<tr data-action="toggle-expand" data-key="${key}" style="cursor:pointer">
        <td><span class="tag-name">${esc(t.知识点)}</span><span class="cell-sub">${esc(t.知识点编号)} · ${esc((t.指标编号 || []).join('、'))}</span></td>
        <td><b>${fmtPct(t.得分率)}</b><span class="cell-sub">${t.被考核次数} 次考核</span></td>
        <td>${esc((t.关联题目 || []).join('、'))}</td>
        <td>${ZB.patternChip(t.模式)}</td>
        <td>${ZB.severityChip(t.严重程度)}</td>
        <td style="width:30px;text-align:right">${open ? '−' : '+'}</td>
      </tr>
      ${open ? `<tr><td colspan="6">${evidenceHTML(t, diag)}</td></tr>` : ''}`;
    }).join('');

    return `<section class="card card-pad" style="margin-top:18px">
      <div class="card-head"><div><h3>评分点级诊断</h3><p>${state.node === 'ALL' ? '两个节点合计' : state.node + ' 节点'}。把“整道题不会”拆成“哪一步不会”。</p></div>
        <div class="segmented">${filters.map(([k, label]) => `<button type="button" class="${state.scoreFilter === k ? 'active' : ''}" data-action="set-score-filter" data-filter="${k}">${label}</button>`).join('')}</div>
      </div>
      ${rows.length ? `<div class="table-scroll"><table class="score-table"><thead><tr><th>知识点</th><th>得分率</th><th>关联题目</th><th>模式</th><th>程度</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>` : `<div class="empty-state" style="padding:24px"><div class="es-mark">·</div><strong>${state.scoreFilter === 'untested' ? '未测知识点清单见下方' : '当前筛选没有匹配的知识点'}</strong><p>可以切换到“全部”查看已有证据，或查看未测知识点。</p></div>`}
      ${untested.length ? `<div class="divider"></div><p class="small muted" style="margin-bottom:7px">未测知识点（记录空白，不代表未掌握）：</p><div class="tag-cloud">${untested.slice(0, 14).map((t) => `<span class="chip gray" title="${esc(t.关联题目?.join('、') || '')}">${esc(t.知识点)}</span>`).join('')}${untested.length > 14 ? `<span class="chip gray">+${untested.length - 14}</span>` : ''}</div>` : ''}
    </section>`;
  }

  function revisionPanel(diag) {
    const rev = diag.修订模式 || {};
    const details = rev.详情 || [];
    if (!details.length) {
      return `<section class="card card-pad"><div class="card-head"><div><h3>修订版本</h3><p>同一作答事件只保留最高修订版本；这里展示学生改过几次。</p></div></div><div class="empty-state" style="padding:20px"><div class="es-mark">·</div><strong>没有检测到修订</strong><p>该生没有同一作答事件的多版本记录。</p></div></section>`;
    }
    return `<section class="card card-pad">
      <div class="card-head"><div><h3>修订版本</h3><p>${esc(rev.解读 || '')}</p></div><span class="tag amber">${rev.有修订的题目数} 题</span></div>
      <div class="stack">${details.map((d) => {
        const worse = d.变化 === 'worsened';
        const better = d.变化 === 'improved';
        return `<div class="evidence-box">
          <div class="ev-head"><button class="chip qid" type="button" data-action="open-question" data-qid="${esc(d.题目编号)}">${esc(d.题目编号)}</button><span class="chip ${worse ? 'red' : better ? 'green' : 'gray'}">${worse ? '修订后得分下降' : better ? '修订后得分提高' : '修订后持平'}</span><span class="small muted">${d.修订次数} 次修订</span></div>
          <div class="revision-flow">
            ${(d.版本轨迹 || []).map((v, idx) => `<span class="revision-node ${idx === (d.版本轨迹 || []).length - 1 ? 'final' : ''}">v${v.修订版本} · ${v.评分状态} · ${v.得分 == null ? '—' : fmtScore(v.得分)}</span>${idx < (d.版本轨迹 || []).length - 1 ? '<span class="revision-arrow">→</span>' : ''}`).join('')}
          </div>
          <p>首次 ${fmtScore(d.首次得分)} → 最终 ${fmtScore(d.最终得分)}（满分 ${fmtScore(d.满分)}）。最终答案：<span class="mono">${esc(d.最终答案 || '—')}</span></p>
        </div>`;
      }).join('')}</div>
    </section>`;
  }

  function longitudinalPanel(diag) {
    const items = Object.values(diag.纵向对比?.指标 || {}).filter((x) => x.N01?.evidenceCount && x.N02?.evidenceCount);
    const tagsChanged = Object.values(diag.纵向对比?.知识点 || {})
      .filter((x) => x.变化 != null)
      .sort((a, b) => Math.abs(b.变化) - Math.abs(a.变化))
      .slice(0, 6);
    if (!items.length && !tagsChanged.length) {
      return `<section class="card card-pad"><div class="card-head"><div><h3>节点纵向对比</h3><p>只比较同一指标在两个节点都有已评分证据的部分。</p></div></div><div class="empty-state" style="padding:20px"><div class="es-mark">↕</div><strong>暂无可比的两节点证据</strong><p>该生只在单个节点有记录，不能据此判断进步或退步。</p></div></section>`;
    }
    return `<section class="card card-pad">
      <div class="card-head"><div><h3>节点纵向对比</h3><p>N01 → N02；只在两边都有证据时比较，不强行解读单节点。</p></div><span class="tag">${items.length} 个指标可比</span></div>
      <div class="long-grid">${items.map((x) => `<div class="long-card">
        <div class="lc-top"><strong>${esc(x.观察指标)}</strong><span class="delta ${ZB.deltaClass(x.变化)}">${fmtDelta(x.变化)}</span></div>
        <div class="long-bars"><span>N01</span>${ZB.bar(x.N01.rate, 'amber')}<span>${fmtPct(x.N01.rate)}</span></div>
        <div class="long-bars"><span>N02</span>${ZB.bar(x.N02.rate, '')}<span>${fmtPct(x.N02.rate)}</span></div>
        <p class="small muted" style="margin-top:5px">${esc(x.解读 || '')}</p>
      </div>`).join('')}</div>
      ${tagsChanged.length ? `<div class="divider"></div><p class="small muted" style="margin-bottom:7px">知识点层面的变化（按变化幅度排序）：</p><div class="grid-2">${tagsChanged.map((x) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(x.知识点)}</strong><span class="delta ${ZB.deltaClass(x.变化)}">${fmtDelta(x.变化)}</span></div><p>N01 ${fmtPct(x.N01?.得分率)} → N02 ${fmtPct(x.N02?.得分率)}；${esc((x.N02?.关联题目 || []).join('、'))}</p></div>`).join('')}</div>` : ''}
    </section>`;
  }

  function crossPanel(diag) {
    const chains = diag.交叉关联 || [];
    if (!chains.length) return '';
    return `<section class="card card-pad">
      <div class="card-head"><div><h3>交叉关联</h3><p>用前置依赖解释“为什么这个指标可能补不动”，措辞保持可验证，不把相关当因果。</p></div><span class="tag amber">${chains.length}</span></div>
      <div class="stack">${chains.map((c) => `<div class="issue-card">
        <div class="ic-head"><div><strong>${esc(c.目标指标)} · ${esc(c.目标名称)}</strong><span class="cell-sub">${esc(c.类型)} · 目标 ${fmtPct(c.目标得分率)} / 前置 ${fmtPct(c.前置得分率)}</span></div>${ZB.severityChip(c.严重程度)}</div>
        <p>${esc(c.说明)}</p>
        <div class="ic-tags">${(c.关联题目 || []).slice(0, 5).map((q) => `<button class="chip qid" type="button" data-action="open-question" data-qid="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      </div>`).join('')}</div>
    </section>`;
  }

  function recordGaps(diag) {
    const limited = Object.values(diag.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence');
    if (!limited.length) return '';
    return `<section class="card card-pad">
      <div class="card-head"><div><h3>记录空白与待补充观察</h3><p>这些指标只有 ≤1 道题的证据，不能写成“不会”。</p></div><span class="tag gray">${limited.length}</span></div>
      <div class="grid-3">${limited.map((x) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(x.观察指标)}</strong>${ZB.statusChip(x.status, ZB.statusLabel(x.status))}</div><p>${esc(x.指标编号)} · ${x.evidenceCount} 条有效证据 · 覆盖 ${x.distinctQuestions} 道题</p></div>`).join('')}</div>
    </section>`;
  }

  ZB.views.student = function () {
    const diag = diagnostics[state.sid];
    if (!diag) return `<div class="empty-state"><strong>未找到学生</strong><p>请从顶部选择 D01—D40。</p></div>`;
    const nodeData = state.node === 'ALL' ? null : diag.节点诊断?.[state.node];
    const overall = nodeData ? nodeData.总体 : diag.总体;
    const themeData = nodeData ? nodeData.主题诊断 : diag.主题诊断;
    const indicatorData = nodeData ? nodeData.指标诊断 : diag.指标诊断;
    const nodeInfo = nodeData ? `<span class="tag amber">${esc(state.node)} · ${esc(nodeData.模拟测验日期)}</span><span class="small muted">${esc(nodeData.节点说明)}</span>` : `<span class="tag">全部节点合并</span>`;

    return `<div class="view">
      <div class="view-head">
        <div>
          <span class="kicker">TASK 02 · 个体层面</span>
          <h1>个体诊断</h1>
          <p>先看“有什么证据”，再看“证据说明什么”。评分点级诊断会把整道题的失分拆到具体步骤。</p>
        </div>
        <div class="view-head-actions">${nodeTabs()}<button class="btn btn-primary btn-sm" type="button" data-action="open-plan" data-sid="${esc(state.sid)}">${icon('plan')}学习建议</button></div>
      </div>

      ${studentHeader(diag, overall)}
      <div class="row" style="margin-top:10px">${nodeInfo}</div>
      <div class="note teal" style="margin-top:12px">${esc(diag.诊断叙述?.摘要 || '')}</div>

      <div class="grid-2" style="margin-top:18px;align-items:start">
        ${themePanel(diag, themeData, indicatorData)}
        <div class="card card-pad">
          <div class="card-head"><div><h3>记录概况</h3><p>证据数量本身就是结论的一部分。</p></div></div>
          <div class="kv">
            <div class="kv-row"><span>最终记录</span><b>${diag.记录概况?.最终记录数 ?? 0} 条</b></div>
            <div class="kv-row"><span>已评分</span><b>${diag.记录概况?.已评分数 ?? 0} 条</b></div>
            <div class="kv-row"><span>待评分</span><b>${diag.记录概况?.待评分数 ?? 0} 条（不计入得分率）</b></div>
            <div class="kv-row"><span>未作答</span><b>${diag.记录概况?.未作答数 ?? 0} 条（不算答错）</b></div>
            <div class="kv-row"><span>覆盖指标</span><b>${diag.记录概况?.覆盖指标数 ?? 0} / 9</b></div>
          </div>
          <div class="divider"></div>
          <div class="row" style="gap:7px">
            <button class="btn btn-secondary btn-sm" type="button" data-action="open-chat">${icon('chat')}问为什么</button>
            <button class="btn btn-ghost btn-sm" type="button" data-nav="analysis" data-nav-arg="${esc(diag.所属班级)}">看班级位置 ${icon('arrow')}</button>
          </div>
        </div>
      </div>

      <div class="section-head"><div><span class="kicker">INDICATORS</span><h2>九个观察指标</h2><p>点击任意指标查看题目表现与本指标内的知识点。状态同时考虑得分率、题目数和证据量。</p></div></div>
      ${indicatorGrid(diag, indicatorData)}
      ${indicatorDetail(diag, indicatorData, state.expanded.indicator)}

      ${scorePointSection(diag)}

      <div class="grid-2" style="margin-top:18px;align-items:start">
        ${revisionPanel(diag)}
        ${longitudinalPanel(diag)}
      </div>
      <div class="grid-2" style="margin-top:18px;align-items:start">
        ${crossPanel(diag)}
        ${recordGaps(diag)}
      </div>

      <div class="row" style="margin-top:22px;justify-content:space-between">
        <span class="small muted">所有结论均可追溯到题目编号与评分点；点击任意题目可查看题干与评分点。</span>
        <button class="btn btn-primary" type="button" data-action="open-plan" data-sid="${esc(state.sid)}">${icon('arrow')}为 ${esc(state.sid)} 安排下一步</button>
      </div>
    </div>`;
  };
})();
