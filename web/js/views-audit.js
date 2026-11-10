/* ==========================================================================
   智慧学伴 · 数据审计
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { quality, issues, records, students, fieldDesc, nodes } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtScore = ZB.fmtScore;
  const icon = ZB.icon;

  const PAGE_SIZE = 30;

  const TYPE_ORDER = ['全部', '节点题目不符', '分值越界', '评分点与总分不一致', '评分点缺失', '待评分', '未作答', '时间与节点不一致', '引用异常'];

  function kpiCards() {
    const q = quality || {};
    return `<div class="kpi-grid">
      <div class="metric"><div class="m-label">RAW ROWS</div><div class="m-value">${q.原始行数 || 806}<small>行</small></div><div class="m-note">原始作答记录</div></div>
      <div class="metric green"><div class="m-label">UNIQUE EVENTS</div><div class="m-value">${q.唯一作答事件数 || 799}<small>个</small></div><div class="m-note">按作答事件去重后的最终记录</div></div>
      <div class="metric amber"><div class="m-label">REVISIONS</div><div class="m-value">${q.修订事件数 || 7}<small>个事件</small></div><div class="m-note">只保留最高修订版本，旧版本进入轨迹</div></div>
      <div class="metric red"><div class="m-label">ISOLATED</div><div class="m-value">${q.被隔离记录数 || 3}<small>条</small></div><div class="m-note">超满分 2 条 + 节点不符 1 条；不参与统计</div></div>
    </div>`;
  }

  function funnel() {
    const q = quality || {};
    const raw = q.原始行数 || 806;
    const rows = [
      ['原始记录', raw, 'bar-fill'],
      ['唯一事件', q.唯一作答事件数 || 799, 'bar-fill green'],
      ['已评分', q.已评分数 || 790, 'bar-fill'],
      ['可统计', q.可统计记录数 || 787, 'bar-fill green'],
    ];
    return `<div class="funnel">${rows.map(([label, value, cls]) => `<div class="funnel-row"><span>${label}</span><div class="bar"><div class="${cls}" style="width:${Math.round(value / raw * 100)}%"></div></div><b>${value}</b></div>`).join('')}
      <div class="funnel-row"><span>待评分 / 未作答</span><div class="bar"><div class="bar-fill amber" style="width:${Math.round(((q.待评分数 || 4) + (q.未作答数 || 5)) / raw * 100)}%"></div></div><b>${(q.待评分数 || 4)} + ${(q.未作答数 || 5)}</b></div>
    </div>`;
  }

  function issueFiltered() {
    let list = issues || [];
    if (state.auditType && state.auditType !== 'all') {
      list = list.filter((i) => i.类型 === state.auditType);
    }
    return list;
  }

  function issueTable() {
    const list = issueFiltered();
    return `<div class="table-scroll"><table class="issue-table"><thead><tr><th>编号</th><th>类型</th><th>严重度</th><th>学生</th><th>题目</th><th>节点</th><th>说明</th><th></th></tr></thead><tbody>
      ${list.map((i) => `<tr>
        <td class="mono">${esc(i.问题编号)}</td>
        <td><span class="chip ${i.严重程度 === '高' ? 'red' : i.严重程度 === '中' ? 'amber' : 'gray'}">${esc(i.类型)}</span></td>
        <td>${ZB.severityChip(i.严重程度)}</td>
        <td class="mono">${esc(i.学生编号 || '—')}</td>
        <td class="mono">${esc(i.题目编号 || '—')}</td>
        <td class="mono">${esc(i.节点编号 || '—')}</td>
        <td>${esc(i.说明)}</td>
        <td>${i.记录编号 ? `<button class="text-link" type="button" data-action="open-record" data-rid="${esc(i.记录编号)}">记录</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>${list.length ? '' : `<div class="table-empty"><strong>没有匹配的问题</strong><p>换一个类型看看。</p></div>`}</div>`;
  }

  function revisionTable() {
    const list = (records || []).filter((r) => r.revisionCount > 0);
    if (!list.length) return `<div class="table-empty"><strong>没有修订事件</strong></div>`;
    return `<div class="table-scroll"><table class="issue-table"><thead><tr><th>学生</th><th>题目</th><th>节点</th><th>版本轨迹</th><th>最终得分</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr>
        <td class="mono">${esc(r.studentId)}</td>
        <td class="mono">${esc(r.questionId)}</td>
        <td class="mono">${esc(r.node)}</td>
        <td>${(r.versions || []).map((v) => `<span class="tag">v${v.修订版本} ${v.评分状态} ${v.得分 == null ? '—' : fmtScore(v.得分)}</span>`).join(' → ')}</td>
        <td><b>${fmtScore(r.score)}/${fmtScore(r.max)}</b></td>
        <td><button class="text-link" type="button" data-action="open-record" data-rid="${esc(r.recordId)}">查看</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  function pendingTable() {
    const list = (records || []).filter((r) => r.pending || r.unanswered);
    if (!list.length) return `<div class="table-empty"><strong>没有待评分或未作答记录</strong></div>`;
    return `<div class="table-scroll"><table class="issue-table"><thead><tr><th>学生</th><th>题目</th><th>节点</th><th>状态</th><th>说明</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td class="mono">${esc(r.studentId)}</td><td class="mono">${esc(r.questionId)}</td><td class="mono">${esc(r.node)}</td><td><span class="chip ${r.pending ? 'amber' : 'gray'}">${r.pending ? '待评分' : '未作答'}</span></td><td>${r.pending ? '不进入得分率，需教师补评分' : '记录空白，不算答错'}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function coverageTable() {
    const list = quality?.按学生记录覆盖 || [];
    return `<div class="table-scroll"><table class="record-table"><thead><tr><th>学生</th><th>最终记录</th><th>已评分</th><th>待评分</th><th>未作答</th><th>题目数</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td class="mono">${esc(r.学生编号)}</td><td>${r.最终记录数}</td><td>${r.已评分数}</td><td>${r.待评分数}</td><td>${r.未作答数}</td><td>${r.题目数}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function filteredRecords() {
    let list = records || [];
    if (state.auditStatus && state.auditStatus !== 'all') {
      if (state.auditStatus === 'graded') list = list.filter((r) => r.graded && r.usable);
      else if (state.auditStatus === 'pending') list = list.filter((r) => r.pending);
      else if (state.auditStatus === 'unanswered') list = list.filter((r) => r.unanswered);
      else if (state.auditStatus === 'isolated') list = list.filter((r) => !r.usable);
    }
    const q = String(state.auditQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter((r) => `${r.recordId} ${r.studentId} ${r.questionId} ${r.node} ${r.answer}`.toLowerCase().includes(q));
    }
    return list;
  }

  function recordTableOnly() {
    const list = filteredRecords();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const page = Math.min(state.auditPage, pages);
    const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return `<div class="table-caption"><strong>最终记录</strong><span>${list.length} 条 · 第 ${page}/${pages} 页</span></div>
      <div class="table-scroll"><table class="record-table record-explorer"><thead><tr><th>记录</th><th>学生</th><th>题目</th><th>节点</th><th>状态</th><th>得分</th><th>修订</th><th>可用</th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-action="open-record" data-rid="${esc(r.recordId)}">
        <td class="rid">${esc(r.recordId)}</td><td class="mono">${esc(r.studentId)}</td><td class="mono">${esc(r.questionId)}</td><td>${esc(r.node)}</td>
        <td><span class="chip ${r.graded && r.usable ? 'green' : r.pending ? 'amber' : r.unanswered ? 'gray' : 'red'}">${r.graded && r.usable ? '已评分' : r.pending ? '待评分' : r.unanswered ? '未作答' : '已隔离'}</span></td>
        <td>${r.graded ? `${fmtScore(r.score)}/${fmtScore(r.max)}` : '—'}</td>
        <td>${r.revisionCount || 0}</td><td>${r.usable ? '是' : '否'}</td>
      </tr>`).join('')}
      </tbody></table></div>
      <div class="pagination"><span class="page-info">每页 ${PAGE_SIZE} 条</span><div class="row"><button class="btn btn-secondary btn-sm" type="button" data-action="audit-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn btn-secondary btn-sm" type="button" data-action="audit-page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>`;
  }
  ZB.views.auditTableOnly = recordTableOnly;

  function dataDictionary() {
    return `<div class="table-scroll"><table class="dict-table"><thead><tr><th>数据表</th><th>字段名</th><th>类型</th><th>含义</th><th>取值 / 格式</th><th>为空时</th></tr></thead><tbody>
      ${(fieldDesc || []).map((f) => `<tr><td class="mono">${esc(f.数据表)}</td><td class="mono">${esc(f.字段名)}</td><td>${esc(f.类型)}</td><td>${esc(f.含义)}</td><td class="small">${esc(f['取值或格式'] || f.取值或格式 || '—')}</td><td class="small">${esc(f.为空时 || '—')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  ZB.views.audit = function () {
    const q = quality || {};
    return `<div class="view">
      <div class="view-head">
        <div><span class="kicker">DATA QUALITY · 先处理数据</span><h1>数据审计</h1><p>数据不是“干净的事实”。这里把修订、待评分、未作答、超满分和节点不符全部摊开，再决定哪些进入统计。</p></div>
        <div class="view-head-actions"><button class="btn btn-secondary btn-sm" type="button" data-action="print">${icon('print')}打印</button></div>
      </div>

      ${kpiCards()}

      <div class="audit-grid">
        <section class="card card-pad">
          <div class="card-head"><div><h3>数据漏斗</h3><p>从原始 806 行到 787 条可统计记录。</p></div></div>
          ${funnel()}
          <div class="note gray" style="margin-top:14px">已评分 ${q.已评分数 || 790} 条中包含 3 条被隔离记录；可统计 = 已评分且通过引用/分值/节点校验。</div>
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>处理原则</h3><p>这些规则在诊断与建议中一致执行。</p></div></div>
          <div class="stack">
            <div class="callout"><strong>同一事件只留最高修订版本</strong><br>旧版本不删除，进入修订轨迹，用于判断“改对需要几次”。</div>
            <div class="callout warn"><strong>待评分 ≠ 答错</strong><br>待评分保留状态，不进入得分率；需要教师补充评分。</div>
            <div class="callout neutral"><strong>未作答 ≠ 未掌握</strong><br>记录空白只代表没有证据，不直接判为不会。</div>
            <div class="callout danger"><strong>超满分与节点不符隔离</strong><br>保留原始值，但不进入统计；在问题清单中单独列出。</div>
          </div>
        </section>
      </div>

      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>问题清单</h3><p>${q.问题数 || (issues || []).length} 条；点击“记录”可查看原始作答。</p></div><span class="tag red">${(issues || []).length}</span></div>
        <div class="filter-row">
          <button class="filter-pill ${!state.auditType || state.auditType === 'all' ? 'active' : ''}" type="button" data-action="set-audit-type" data-type="all">全部</button>
          ${TYPE_ORDER.filter((x) => x !== '全部').map((t) => `<button class="filter-pill ${state.auditType === t ? 'active' : ''}" type="button" data-action="set-audit-type" data-type="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        ${issueTable()}
      </section>

      <div class="audit-grid">
        <section class="card card-pad">
          <div class="card-head"><div><h3>修订轨迹</h3><p>7 个多版本事件；有的改对，有的改错，有的从待评分转为已评分。</p></div><span class="tag amber">${(records || []).filter((r) => r.revisionCount > 0).length}</span></div>
          ${revisionTable()}
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>待评分与未作答</h3><p>不进入得分率，但会影响“记录是否充分”的判断。</p></div><span class="tag">${(records || []).filter((r) => r.pending || r.unanswered).length}</span></div>
          ${pendingTable()}
        </section>
      </div>

      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>原始记录检索</h3><p>按记录号、学生、题目、节点或作答内容搜索；点击行查看评分点明细。</p></div></div>
        <div class="audit-toolbar">
          <div class="field"><label for="audit-search">搜索</label><input id="audit-search" type="search" placeholder="例如 D04、Q015、Q043P2…" value="${esc(state.auditQuery || '')}"></div>
          <div class="field"><label for="audit-status-select">状态</label><select id="audit-status-select"><option value="all" ${state.auditStatus === 'all' ? 'selected' : ''}>全部</option><option value="graded" ${state.auditStatus === 'graded' ? 'selected' : ''}>已评分可用</option><option value="pending" ${state.auditStatus === 'pending' ? 'selected' : ''}>待评分</option><option value="unanswered" ${state.auditStatus === 'unanswered' ? 'selected' : ''}>未作答</option><option value="isolated" ${state.auditStatus === 'isolated' ? 'selected' : ''}>已隔离</option></select></div>
          <span class="small muted" style="align-self:center">共 ${(records || []).length} 条最终记录</span>
        </div>
        <div id="audit-record-table" style="margin-top:12px">${recordTableOnly()}</div>
      </section>

      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>学生记录覆盖</h3><p>最终记录、已评分、待评分、未作答与题目数。</p></div></div>
        ${coverageTable()}
      </section>
      <section class="card card-pad" style="margin-top:18px">
        <div class="card-head"><div><h3>数据字典</h3><p>来自赛事字段说明；字段含义与为空时的处理方式。</p></div></div>
        ${dataDictionary()}
      </section>
    </div>`;
  };
})();
