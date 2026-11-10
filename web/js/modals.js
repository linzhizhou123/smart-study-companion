/* ==========================================================================
   智慧学伴 · modals
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { questions, records, issuesById, tags, students } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtScore = ZB.fmtScore;
  const fmtPct = ZB.fmtPct;
  const icon = ZB.icon;

  function openModal(title, subtitle, body) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal-overlay" id="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div>
        <div class="modal-body">${body}</div>
      </div>
    </div>`;
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.style.overflow = 'hidden';
  }
  ZB.openModal = openModal;

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
    document.body.style.overflow = '';
  }
  ZB.closeModal = closeModal;

  function answerBlock(qid) {
    const q = questions[qid] || {};
    if (state.role === 'teacher') {
      return `<div class="answer-open"><span class="ao-label">TEACHER ONLY · 参考答案</span><strong>${esc(q.参考答案 || '—')}</strong><p>${esc(q.参考解析 || '')}</p></div>`;
    }
    return `<div class="answer-lock"><div class="al-head"><span>${icon('lock')} 参考答案已隐藏</span><span>学生视图</span></div><p>学生端只显示题干、评分点和分步提示；切换到教师视图可核对参考答案。</p></div>`;
  }

  ZB.openQuestion = function (qid) {
    const q = questions[qid];
    if (!q) return;
    const points = q.评分点 || [];
    const body = `<div class="row" style="justify-content:space-between">
        <div><span class="qid-title">${esc(q.编号)}</span> <span class="chip">${esc(q.题型)}</span> <span class="chip">${fmtScore(q.满分)} 分</span> <span class="chip teal">${esc(q.指标编号)}</span></div>
        <span class="tag">${esc(q.主题编号)} · ${esc(q.可用节点?.join('、') || '')}</span>
      </div>
      <div class="stem">${esc(q.题干)}${q.选项 ? `<br><span class="muted">${esc(q.选项)}</span>` : ''}</div>
      <h4>评分点</h4>
      <div class="table-scroll"><table class="score-table"><thead><tr><th>评分点</th><th>描述</th><th>满分</th><th>知识点</th></tr></thead><tbody>
        ${points.map((p) => `<tr><td class="mono">${esc(p.编号)}</td><td>${esc(p.描述)}</td><td>${fmtScore(p.满分)}</td><td>${esc(p.知识点)}</td></tr>`).join('')}
      </tbody></table></div>
      <h4>关联信息</h4>
      <div class="kv">
        <div class="kv-row"><span>知识点</span><b>${esc((q.知识点 || []).join('、'))}</b></div>
        <div class="kv-row"><span>教材定位</span><b>${esc(q.教材定位 || '—')}</b></div>
        <div class="kv-row"><span>来源</span><b>${esc(q.来源 || '赛事新编')}</b></div>
        <div class="kv-row"><span>可用节点</span><b>${esc((q.可用节点 || []).join('、'))}</b></div>
      </div>
      ${answerBlock(qid)}`;
    openModal(`${q.编号} · ${q.题型}`, `${q.指标编号} · ${(q.知识点 || []).join(' / ')}`, body);
  };

  ZB.openRecord = function (rid) {
    const r = (records || []).find((x) => x.recordId === rid);
    if (!r) return;
    const q = questions[r.questionId] || {};
    const issueList = (r.issueIds || []).map((id) => issuesById[id]).filter(Boolean);
    const body = `<div class="row" style="justify-content:space-between">
        <div><span class="mono" style="font-size:18px;color:var(--teal-deep)">${esc(r.recordId)}</span> <span class="chip">${esc(r.studentId)}</span> <span class="chip">${esc(r.questionId)}</span> <span class="chip">${esc(r.node)}</span></div>
        <span class="status ${r.graded && r.usable ? 'status-secure' : r.pending ? 'status-developing' : r.unanswered ? 'status-limited' : 'status-needs_support'}">${r.graded && r.usable ? '已评分可用' : r.pending ? '待评分' : r.unanswered ? '未作答' : '已隔离'}</span>
      </div>
      <div class="grid-3" style="margin-top:14px">
        <div class="kv-row"><span>得分</span><b>${r.graded ? `${fmtScore(r.score)} / ${fmtScore(r.max)}` : '—'}</b></div>
        <div class="kv-row"><span>得分率</span><b>${fmtPct(r.rate)}</b></div>
        <div class="kv-row"><span>修订次数</span><b>${r.revisionCount || 0}</b></div>
      </div>
      <h4>学生最终作答</h4>
      <div class="quote">${esc(r.answer || '（空）')}</div>
      <h4>解答过程</h4>
      <div class="quote" style="white-space:pre-wrap">${esc(r.process || '（无过程记录）')}</div>
      <h4>评分点明细</h4>
      ${r.points && Object.keys(r.points).length ? `<div class="table-scroll"><table class="score-table"><thead><tr><th>评分点</th><th>得分</th><th>描述</th></tr></thead><tbody>${Object.entries(r.points).map(([pid, val]) => {
        const p = (q.评分点 || []).find((x) => x.编号 === pid);
        return `<tr><td class="mono">${esc(pid)}</td><td>${fmtScore(val)}/${fmtScore(p?.满分 || 1)}</td><td>${esc(p?.描述 || '')}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="small muted">该记录没有可用的评分点明细（待评分、未作答或明细与总分不一致）。</p>`}
      ${(r.versions || []).length ? `<h4>修订轨迹</h4><div class="revision-flow">${r.versions.map((v, idx) => `<span class="revision-node ${idx === r.versions.length - 1 ? 'final' : ''}">v${v.修订版本} · ${esc(v.评分状态)} · ${v.得分 == null ? '—' : fmtScore(v.得分)}</span>${idx < r.versions.length - 1 ? '<span class="revision-arrow">→</span>' : ''}`).join('')}</div>` : ''}
      ${issueList.length ? `<h4>关联数据问题</h4><div class="stack">${issueList.map((i) => `<div class="callout ${i.严重程度 === '高' ? 'danger' : i.严重程度 === '中' ? 'warn' : 'neutral'}"><strong>${esc(i.问题编号)} · ${esc(i.类型)}</strong><br>${esc(i.说明)}</div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn btn-secondary btn-sm" type="button" data-action="open-question" data-qid="${esc(r.questionId)}">打开题目与评分点</button></div>
      ${state.role === 'teacher' ? `<div class="answer-open" style="margin-top:12px"><span class="ao-label">TEACHER ONLY · 参考答案</span><strong>${esc(q.参考答案 || '—')}</strong><p>${esc(q.参考解析 || '')}</p></div>` : ''}`;
    openModal(`记录 ${r.recordId}`, `${r.studentId} · ${r.questionId} · ${r.node}`, body);
  };

  ZB.openHelp = function () {
    openModal('使用说明', '三条任务线，一个可核对的智能体', `<p>智慧学伴把赛题的三项任务做成了一个可直接浏览的网页：</p>
      <h4>01 · 学习内容与要求</h4><p>在“知识图谱”中查看三个主题、九个观察指标、54 道题、90 个评分点，以及课标、教材、前置依赖和必要联系。</p>
      <h4>02 · 学生学习情况分析</h4><p>在“学情总览”看班级与群体；在“个体诊断”看一名学生的主题、指标、评分点、修订和纵向变化。没有记录的地方会明确写“暂不能判断”。</p>
      <h4>03 · 个性化学习建议</h4><p>在“学习建议”查看按阶段组织的题目、评分点证据、分步提示、教材定位、完成条件和调整规则。学生端不直接给答案。</p>
      <h4>结果核对</h4><p>“典型案例”展示 D04、D14、D17 三条不同的证据链；“数据审计”摊开修订、待评分、未作答与异常记录。</p>
      <h4>快捷方式</h4><div class="kv"><div class="kv-row"><span>打开学伴</span><b>点击右上角“问学伴”或按 Ctrl/⌘ + K</b></div><div class="kv-row"><span>切换学生</span><b>顶部下拉框，或在诊断/建议页使用深链接</b></div><div class="kv-row"><span>教师视图</span><b>顶部“学生 / 教师”切换；教师可见参考答案与解析</b></div><div class="kv-row"><span>打印</span><b>右上角打印按钮，自动隐藏导航与交互控件</b></div></div>
      <div class="note gray" style="margin-top:14px">本页所有学生与作答记录均为赛事模拟数据，不对应真实学生。规则引擎负责计算与排序，自然语言层只做表达；没有 API Key 时也可离线运行。</div>`);
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-modal"]')) closeModal();
  });
})();
