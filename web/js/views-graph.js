/* ==========================================================================
   智慧学伴 · 知识图谱 / 题库 / 材料
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { themes, indicators, tags, questions, materials, prerequisites, connections, textbookIndex } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const icon = ZB.icon;
  const IND_ORDER = ['T01I1', 'T01I2', 'T01I3', 'T02I1', 'T02I2', 'T02I3', 'T03I1', 'T03I2', 'T03I3'];
  const COLORS = { T01: '#0f5a55', T02: '#bf8628', T03: '#c55338' };
  const FILLS = { T01: '#edf4f0', T02: '#fbf3e2', T03: '#fbece7' };

  function themeTabs() {
    return `<div class="segmented">${themes.map((t) => `<button type="button" class="${state.graphTheme === t.主题编号 ? 'active' : ''}" data-action="set-graph-theme" data-theme="${t.主题编号}">${esc(t.主题编号)} ${esc(t.主题名称)}</button>`).join('')}<button type="button" class="${state.graphTheme === 'ALL' ? 'active' : ''}" data-action="set-graph-theme" data-theme="ALL">全部</button></div>`;
  }

  function indicatorPos() {
    return {
      T01I1: [75, 170], T01I2: [75, 270], T01I3: [75, 370],
      T02I1: [405, 170], T02I2: [405, 270], T02I3: [405, 370],
      T03I1: [735, 170], T03I2: [735, 270], T03I3: [735, 370],
    };
  }

  function edgePath(a, b, strong) {
    const [x1, y1] = a;
    const [x2, y2] = b;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return `<path class="graph-edge ${strong ? 'strong' : ''}" d="M ${x1 + 100} ${y1 + 28} Q ${mx + 100} ${my} ${x2 + 100} ${y2 + 28}" marker-end="url(#arrow)"/>`;
  }

  function legend() {
    return `<div class="graph-legend"><span><i style="background:${COLORS.T01}"></i>T01 代数式与整式</span><span><i style="background:${COLORS.T02}"></i>T02 方程与方程组</span><span><i style="background:${COLORS.T03}"></i>T03 不等式</span><span><i style="background:var(--line-strong)"></i>箭头 = 前置依赖</span></div>`;
  }

  function svgGraph() {
    const pos = indicatorPos();
    const selected = state.graphIndicator;
    const isAll = state.graphTheme === 'ALL';
    const visible = (tid) => isAll || tid === state.graphTheme;
    const themeNodes = themes.map((t, idx) => {
      const x = [95, 425, 755][idx];
      const active = state.graphTheme === t.主题编号 || isAll;
      return `<g class="graph-node theme ${active ? '' : 'dim'} ${state.graphTheme === t.主题编号 ? 'selected' : ''}" data-action="set-graph-theme" data-theme="${esc(t.主题编号)}">
        <title>${esc(t.主题编号)} · ${esc(t.主题名称)} · ${(t.指标列表 || []).reduce((n, i) => n + (i.题目列表 || []).length, 0)} 题</title>
        <rect x="${x}" y="34" width="210" height="66" rx="14" fill="${FILLS[t.主题编号]}" stroke="${COLORS[t.主题编号]}" stroke-width="1.4"/>
        <text x="${x + 16}" y="59" class="gn-sub">${esc(t.主题编号)} · ${t.指标列表?.length || 3} INDICATORS</text>
        <text x="${x + 16}" y="80" class="gn-title">${esc(t.主题名称)}</text>
        <text x="${x + 194}" y="59" text-anchor="end" class="gn-count">${(t.指标列表 || []).reduce((n, i) => n + (i.题目列表 || []).length, 0)} 题</text>
      </g>`;
    }).join('');

    const indNodes = IND_ORDER.map((iid) => {
      const [x, y] = pos[iid];
      const meta = indicators[iid] || {};
      const themeId = iid.slice(0, 3);
      const visibleNode = visible(themeId);
      if (!visibleNode) return '';
      return `<g class="graph-node ${selected === iid ? 'selected' : (selected ? 'dim' : '')}" data-action="graph-indicator" data-iid="${esc(iid)}">
        <title>${esc(iid)} · ${esc(meta.观察指标 || '')} · ${(meta.题目列表 || []).length} 题</title>
        <rect x="${x}" y="${y}" width="200" height="56" rx="11" fill="#fffdf7" stroke="${COLORS[themeId]}" stroke-width="${selected === iid ? 2.4 : 1.1}"/>
        <rect x="${x}" y="${y}" width="5" height="56" rx="2.5" fill="${COLORS[themeId]}"/>
        <text x="${x + 15}" y="${y + 22}" class="gn-title">${esc(iid)} · ${esc(meta.观察指标 || '').slice(0, 7)}${(meta.观察指标 || '').length > 7 ? '…' : ''}</text>
        <text x="${x + 15}" y="${y + 41}" class="gn-sub">${(meta.题目列表 || []).length} 题 · ${(meta.前置指标 || []).length ? '前置 ' + meta.前置指标.join('、') : '无前置'}</text>
      </g>`;
    }).join('');

    const themeEdges = state.graphEdges ? `
      <path class="graph-edge strong" d="M 305 67 Q 365 67 425 67" marker-end="url(#arrow)"/>
      <path class="graph-edge strong" d="M 635 67 Q 695 67 755 67" marker-end="url(#arrow)"/>` : '';

    let indEdges = '';
    if (state.graphEdges) {
      Object.entries(prerequisites?.指标 || {}).forEach(([iid, pres]) => {
        pres.forEach((pre) => {
          if (!visible(iid.slice(0, 3)) || !visible(pre.slice(0, 3))) return;
          if (pos[iid] && pos[pre]) indEdges += edgePath(pos[pre], pos[iid], iid.slice(0, 3) === pre.slice(0, 3));
        });
      });
    }

    return `<div class="graph-canvas">
      <div class="spread" style="padding:4px 6px 0">
        <div class="row"><span class="tag teal">T01 → T02 → T03</span><span class="tag">${state.graphEdges ? '前置依赖已显示' : '前置依赖已隐藏'}</span></div>
        <button class="btn btn-secondary btn-sm" type="button" data-action="toggle-graph-edges">${state.graphEdges ? '隐藏连线' : '显示连线'}</button>
      </div>
      <svg viewBox="0 0 980 470" role="img" aria-label="主题与观察指标前置关系图">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#b9ad99"/></marker></defs>
        ${themeEdges}${indEdges}${themeNodes}${indNodes}
      </svg>
      ${legend()}
    </div>`;
  }

  function indicatorDetail() {
    const iid = state.graphIndicator;
    if (iid && indicators[iid]) {
      const meta = indicators[iid];
      const theme = themes.find((t) => t.主题编号 === meta.主题编号);
      const tagList = Object.values(tags).filter((t) => (t.指标编号 || []).includes(iid));
      return `<div class="detail-panel">
        <span class="kicker">${esc(meta.主题编号)} · ${esc(theme?.主题名称 || '')}</span>
        <h3>${esc(iid)} · ${esc(meta.观察指标)}</h3>
        <p class="dp-goal">${esc(theme?.主题目标 || '')}</p>
        <div class="detail-list">
          <div class="dl"><span>课标引用</span><b>${esc(meta.课标引用?.编号)} · ${esc(meta.课标引用?.['PDF页／印刷页'])}</b></div>
          <div class="dl"><span>教材页码</span><b>${esc((meta.教材页码 || []).join(' · '))}</b></div>
          <div class="dl"><span>前置指标</span><b>${esc((meta.前置指标 || []).join('、') || '无')}</b></div>
          <div class="dl"><span>题目数量</span><b>${(meta.题目列表 || []).length} 题</b></div>
          <div class="dl"><span>学习卡</span><b>${esc(meta.学习卡 || '—')}</b></div>
        </div>
        <div class="divider"></div>
        <div class="panel-head"><h3 style="font-size:14px">题目清单</h3><span class="tag">${(meta.题目列表 || []).length}</span></div>
        <div class="q-strip">${(meta.题目列表 || []).map((q) => `<button type="button" data-action="open-question" data-qid="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <div class="divider"></div>
        <div class="panel-head"><h3 style="font-size:14px">本指标知识点</h3><span class="tag">${tagList.length}</span></div>
        <div class="stack">${tagList.map((t) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(t.名称)}</strong><span class="small muted">${t.被考核次数} 次 · ${esc((t.题目 || []).join('、'))}</span></div><p>${esc(t.说明)}</p></div>`).join('')}</div>
      </div>`;
    }
    if (state.graphTheme === 'ALL') {
      return `<div class="detail-panel">
        <span class="kicker">ALL THEMES · 课程地图</span>
        <h3>三个主题，九个观察指标</h3>
        <p class="dp-goal">T01 → T02 → T03 是主题层面的前置关系；同一主题内部还有更细的指标依赖。点击左侧任意指标，查看它的题目、知识点和教材定位。</p>
        <div class="stack" style="margin-top:14px">${themes.map((t) => `<div class="evidence-box"><div class="ev-head"><strong>${esc(t.主题编号)} · ${esc(t.主题名称)}</strong><span class="small muted">${t.指标列表?.length || 3} 个指标</span></div><p>${esc(t.主题目标)}</p><div class="q-strip">${(t.指标列表 || []).map((i) => `<button type="button" data-action="graph-indicator" data-iid="${esc(i.指标编号)}">${esc(i.指标编号)}</button>`).join('')}</div></div>`).join('')}</div>
        <div class="divider"></div>
        <p class="small muted">必要联系</p>
        <div class="stack" style="margin-top:6px">${themes.map((t) => `<div class="callout"><strong>${esc(t.主题编号)}</strong><br>${esc(connections?.[t.主题编号] || '')}</div>`).join('')}</div>
      </div>`;
    }
    const theme = themes.find((t) => t.主题编号 === state.graphTheme) || themes[0];
    return `<div class="detail-panel">
      <span class="kicker">${esc(theme.主题编号)} · THEME</span>
      <h3>${esc(theme.主题名称)}</h3>
      <p class="dp-goal">${esc(theme.主题目标)}</p>
      <div class="detail-list">
        <div class="dl"><span>课标引用</span><b>${esc(theme.课标引用?.编号)} · ${esc(theme.课标引用?.['PDF页／印刷页'])}</b></div>
        <div class="dl"><span>教材位置</span><b>${esc((theme.教材位置 || []).join(' · '))}</b></div>
        <div class="dl"><span>前置主题</span><b>${esc((theme.前置主题 || []).join('、') || '无')}</b></div>
        <div class="dl"><span>指标数量</span><b>${(theme.指标列表 || []).length}</b></div>
      </div>
      <div class="divider"></div>
      <p class="small muted">必要联系</p>
      <p class="small" style="margin-top:5px;color:var(--ink-soft)">${esc(connections?.[theme.主题编号] || '')}</p>
      <div class="divider"></div>
      <div class="stack">${(theme.指标列表 || []).map((i) => `<button class="evidence-box" type="button" data-action="graph-indicator" data-iid="${esc(i.指标编号)}" style="text-align:left;border:1px solid var(--line)"><div class="ev-head"><strong>${esc(i.指标编号)} · ${esc(i.观察指标)}</strong></div><p>${(i.题目列表 || []).length} 题 · ${esc((i.前置指标 || []).join('、') || '无前置')}</p></button>`).join('')}</div>
    </div>`;
  }

  function filteredQuestions() {
    const search = String(state.graphSearch || '').trim().toLowerCase();
    const theme = state.graphTheme === 'ALL' ? '' : state.graphTheme;
    const type = state.graphType || '';
    const tag = state.graphTag || '';
    return Object.values(questions).filter((q) => {
      if (theme && q.主题编号 !== theme) return false;
      if (type && q.题型 !== type) return false;
      if (tag && !(q.知识点编号 || []).includes(tag)) return false;
      if (search) {
        const text = `${q.编号} ${q.题干} ${(q.知识点 || []).join(' ')} ${q.指标编号}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });
  }

  function questionTable() {
    const list = filteredQuestions();
    return `<div class="table-scroll"><table class="q-table"><thead><tr><th>题目</th><th>题型</th><th>题干</th><th>指标</th><th>知识点</th><th>节点</th></tr></thead><tbody>
      ${list.slice(0, 80).map((q) => `<tr data-action="open-question" data-qid="${esc(q.编号)}">
        <td class="qid">${esc(q.编号)}</td>
        <td class="td-nowrap">${esc(q.题型)}</td>
        <td class="qstem">${esc(ZB.truncate(q.题干, 70))}</td>
        <td class="td-nowrap">${esc(q.指标编号)}</td>
        <td>${(q.知识点 || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>
        <td class="td-nowrap">${esc((q.可用节点 || []).join('、'))}</td>
      </tr>`).join('')}
    </tbody></table>${list.length > 80 ? `<div class="table-empty">仅显示前 80 题，请用搜索缩小范围。</div>` : ''}</div>`;
  }

  function tagIndexTable() {
    const list = Object.values(tags);
    return `<div class="table-scroll"><table class="q-table"><thead><tr><th>知识点</th><th>说明</th><th>关联题目</th><th>考核次数</th><th>课程定位</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td><span class="cell-strong">${esc(t.名称)}</span><span class="cell-sub">${esc(t.编号)} · ${esc((t.指标编号 || []).join('、'))}</span></td><td>${esc(t.说明)}</td><td>${(t.题目 || []).map((q) => `<button class="chip qid" type="button" data-action="open-question" data-qid="${esc(q)}">${esc(q)}</button>`).join(' ')}</td><td class="td-center">${t.被考核次数}</td><td class="small muted">${esc(t.教材定位 || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  ZB.views.graphTableOnly = function () {
    return questionTable();
  };

  ZB.views.graph = function () {
    return `<div class="view">
      <div class="view-head">
        <div><span class="kicker">TASK 01 · 学习内容与要求</span><h1>知识图谱</h1><p>把主题、观察指标、前置依赖、题目与评分点串成一张图。每个节点都能回到课标、教材和具体题目。</p></div>
        <div class="view-head-actions">${themeTabs()}</div>
      </div>

      <div class="graph-layout">
        ${svgGraph()}
        ${indicatorDetail()}
      </div>

      <div class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>题库</h3><p>54 道题、90 个评分点；支持按主题、题型、知识点和关键词筛选。</p></div><span class="tag teal">${filteredQuestions().length} / ${Object.keys(questions).length}</span></div>
        <div class="library-filters" style="margin-bottom:10px">
          <input id="library-search" type="search" placeholder="搜索题目编号、题干或知识点…" value="${esc(state.graphSearch || '')}" aria-label="搜索题目">
          <select id="library-theme" aria-label="按主题筛选"><option value="">全部主题</option>${themes.map((t) => `<option value="${t.主题编号}" ${state.graphTheme === t.主题编号 ? 'selected' : ''}>${esc(t.主题编号)} ${esc(t.主题名称)}</option>`).join('')}</select>
          <select id="library-type" aria-label="按题型筛选"><option value="">全部题型</option>${['填空题', '选择题', '解答题'].map((t) => `<option value="${t}" ${state.graphType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="library-tag" aria-label="按知识点筛选"><option value="">全部知识点</option>${Object.values(tags).map((t) => `<option value="${t.编号}" ${state.graphTag === t.编号 ? 'selected' : ''}>${esc(t.名称)}</option>`).join('')}</select>
        </div>
        <div id="library-table">${questionTable()}</div>
      </div>

      <div class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>知识点索引</h3><p>29 个可聚合知识点；评分点级诊断就是按这张表跨题聚合。</p></div><span class="tag">${Object.keys(tags).length}</span></div>
        ${tagIndexTable()}
      </div>

      <div class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>配套材料</h3><p>3 张学习卡 + 教材切片；建议中的“教材定位”均指向这些材料。</p></div></div>
        <div class="material-grid">${(materials || []).slice(0, 12).map((m) => `<div class="material-card"><div class="mc-type">${esc(m.材料类型)} · ${esc(m.材料编号)}</div><h4>${esc(ZB.truncate(m.题干或内容, 32))}</h4><p>${esc(m.题干或内容)}</p><span class="source">${esc(m.来源 || '赛事新编')}</span></div>`).join('')}</div>
      </div>
    </div>`;
  };
})();
