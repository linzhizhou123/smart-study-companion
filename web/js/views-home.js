/* ==========================================================================
   智慧学伴 · 工作台
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { diagnostics, recs, groups, cases, meta, themes, indicators, questions } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const icon = ZB.icon;

  function caseList() {
    const list = cases.list || [];
    if (list.length) return list;
    return [
      { caseKey: 'case1_partial', type: '部分得分', studentId: 'D04', headline: '从部分得分定位到具体评分点。' },
      { caseKey: 'case2_strong', type: '表现较好', studentId: 'D14', headline: '用变式检验迁移。' },
      { caseKey: 'case3_limited', type: '记录不足', studentId: 'D17', headline: '记录空白不等于未掌握。' },
    ];
  }

  function caseCard(c) {
    const d = diagnostics[c.studentId];
    const overall = d?.总体 || {};
    return `<button class="case-card" type="button" data-action="open-case" data-case-key="${esc(c.caseKey)}">
      <div class="case-top">
        <span class="case-type">${esc(c.type)}</span>
        ${ZB.statusChip(overall.status || 'limited', ZB.statusLabel(overall.status))}
      </div>
      <div class="case-id">${esc(c.studentId)}</div>
      <p>${esc(c.headline || c.reason || '')}</p>
      <div class="case-foot">
        <span>${overall.evidenceCount != null ? `${overall.evidenceCount} 条证据` : '查看案例'} · ${fmtPct(overall.rate)}</span>
        <b>查看 →</b>
      </div>
    </button>`;
  }

  function classPulse() {
    return ['DC01', 'DC02'].map((cid) => {
      const g = groups[cid];
      if (!g) return '';
      const themesRates = g.班级总览?.主题平均 || {};
      return `<div class="pulse-class">
        <div class="pc-head"><strong>${esc(cid)}</strong><span>${fmtPct(g.班级总览?.平均得分率)} · ${g.班级总览?.学生数 || 0} 人</span></div>
        <div class="pulse-themes">
          ${['T01', 'T02', 'T03'].map((tid) => `<div class="pt"><small>${esc(tid)}</small><b>${fmtPct(themesRates[tid])}</b></div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function agentPreview() {
    const d = diagnostics[state.sid];
    if (!d) return '';
    const systemic = (d.评分点级诊断?.['全部'] || []).filter((x) => x.模式 === 'systemic').slice(0, 2);
    const limited = Object.values(d.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence');
    return `<div class="agent-preview">
      <div class="preview-label">CURRENT SNAPSHOT · ${esc(state.sid)}</div>
      <div class="preview-row">
        <strong>${esc(d.总体.status === 'limited' ? '记录不足，先观察' : systemic[0]?.知识点 || '表现较稳')}</strong>
        <div class="bar"><div class="bar-fill" style="width:${Math.round((d.总体.rate || 0) * 100)}%"></div></div>
        <span class="num">${fmtPct(d.总体.rate)}</span>
      </div>
      <p class="small" style="color:rgba(243,236,220,.6);margin-top:9px;line-height:1.7">
        ${systemic.length
          ? `跨题反复失分：${systemic.map((x) => `${esc(x.知识点)}（${fmtPct(x.得分率)}）`).join('；')}。`
          : `目前没有跨题系统性低分证据；${limited.length ? `${limited.length} 个指标记录不足。` : '可以安排变式与迁移。'}`}
      </p>
    </div>`;
  }

  ZB.views.home = function () {
    const d = diagnostics[state.sid];
    const overall = d?.总体 || {};
    const caseItems = caseList();
    const totalStudents = meta.studentCount || 40;
    const totalQuestions = meta.questionCount || 54;
    const usable = meta.usableGradedCount || 787;
    const issueCount = meta.issueCount || 16;

    return `<div class="view">
      <section class="hero">
        <div class="hero-copy">
          <span class="hero-badge"><span class="live-dot"></span>证据驱动 · 因材施教 · 七年级数学</span>
          <h1>看见每一分，<br><em>再给下一步。</em></h1>
          <p>智慧学伴把课程要求、54 道题、90 个评分点和 40 名学生的作答证据连成一条可核对的链路：先定位具体步骤，再决定练什么、怎么练、练完看什么。</p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-nav="student" data-nav-arg="${esc(state.sid)}">${icon('student')}打开 ${esc(state.sid)} 的诊断</button>
            <button class="btn btn-secondary" type="button" data-nav="cases" data-nav-arg="case1_partial">看三个典型案例 ${icon('arrow')}</button>
          </div>
          <div class="hero-foot">
            <div><strong>${totalStudents}</strong><span>模拟学生</span></div>
            <div><strong>${totalQuestions}</strong><span>道题目</span></div>
            <div><strong>${usable}</strong><span>条有效评分</span></div>
            <div><strong>${issueCount}</strong><span>条质量提示</span></div>
          </div>
        </div>
        <div class="agent-card">
          <div class="agent-card-head">
            <div class="agent-title"><span class="agent-orb">数</span>问学伴</div>
            <span class="agent-live"><span class="live-dot"></span>LOCAL ENGINE</span>
          </div>
          <div class="agent-context">
            <div class="ctx"><small>当前学生</small><strong>${esc(state.sid)} · ${esc(d?.所属班级 || '')}</strong></div>
            <div class="ctx"><small>总体得分率</small><strong>${fmtPct(overall.rate)}</strong></div>
            <div class="ctx"><small>有效证据</small><strong>${overall.evidenceCount ?? '—'} 条</strong></div>
          </div>
          <form class="agent-ask" id="home-ask">
            <input type="text" placeholder="问一个具体问题，例如：D04 为什么总在去括号上错？" aria-label="向学伴提问">
            <button class="btn btn-amber btn-sm" type="submit">发送</button>
          </form>
          <div class="quick-prompts">
            <button type="button" data-action="chat-prompt" data-prompt="分析 D04">分析 D04</button>
            <button type="button" data-action="chat-prompt" data-prompt="D17 的记录够吗？">D17 记录够吗</button>
            <button type="button" data-action="chat-prompt" data-prompt="比较 DC01 和 DC02">比较两个班</button>
          </div>
          ${agentPreview()}
          <div class="agent-preview" style="border-top:1px solid rgba(255,255,255,.1);margin-top:14px;padding-top:14px">
            <div class="preview-label">TRACEABLE BY DESIGN</div>
            <p class="small" style="color:rgba(243,236,220,.62);margin-top:7px;line-height:1.7">每条建议都能回指题目、评分点和教材；没有记录时只写“暂不能判断”。</p>
            <div class="quick-prompts">
              <button type="button" data-nav="graph" data-nav-arg="ALL">知识图谱</button>
              <button type="button" data-nav="audit">数据审计</button>
            </div>
          </div>
        </div>
      </section>

      <section class="kpi-grid">
        <div class="metric">
          <div class="m-label">EVIDENCE BASE</div>
          <div class="m-value">${esc(meta.finalRecordCount || 799)}<small>条最终记录</small></div>
          <div class="m-note">原始 ${esc(meta.rawRecordCount || 806)} 行，按作答事件保留最高修订版本</div>
        </div>
        <div class="metric green">
          <div class="m-label">GRADED & USABLE</div>
          <div class="m-value">${esc(usable)}<small>条可统计</small></div>
          <div class="m-note">待评分 ${esc(meta.pendingCount || 4)} 条、未作答 ${esc(meta.unansweredCount || 5)} 条不进入得分率</div>
        </div>
        <div class="metric amber">
          <div class="m-label">SCORE POINTS</div>
          <div class="m-value">${esc(meta.scorePointCount || 90)}<small>个评分点</small></div>
          <div class="m-note">映射到 ${esc(meta.tagCount || 29)} 个可聚合知识点，支持跨题连续失分识别</div>
        </div>
        <div class="metric red">
          <div class="m-label">DATA WARNINGS</div>
          <div class="m-value">${esc(issueCount)}<small>条提示</small></div>
          <div class="m-note">修订、待评分、未作答、超满分与节点不符均单独列出</div>
        </div>
      </section>

      <div class="home-grid">
        <section class="card card-pad">
          <div class="card-head">
            <div><h3>先看三个学生</h3><p>同一套规则，三种不同的“下一步”。</p></div>
            <button class="text-link" type="button" data-nav="cases" data-nav-arg="case1_partial">全部案例 ${icon('arrow')}</button>
          </div>
          <div class="case-strip">${caseItems.map(caseCard).join('')}</div>
        </section>
        <section class="card card-pad">
          <div class="card-head">
            <div><h3>班级脉搏</h3><p>主题层面的合并得分率；点开可看指标与热力图。</p></div>
            <button class="text-link" type="button" data-nav="analysis" data-nav-arg="DC01">学情总览 ${icon('arrow')}</button>
          </div>
          <div class="pulse-row">${classPulse()}</div>
          <hr class="divider">
          <div class="quality-list">
            <div><span>修订事件</span><b>${esc(ZB.DATA.quality?.修订事件数 || 7)} 个</b></div>
            <div><span>被隔离记录</span><b>${esc(meta.isolatedCount || 3)} 条</b></div>
            <div><span>数据版本</span><b>${esc(meta.dataVersion || '')}</b></div>
          </div>
        </section>
      </div>

      <div class="home-grid">
        <section class="card card-pad">
          <div class="card-head">
            <div><h3>课程地图</h3><p>三个主题、九个观察指标，全部能追到课标与教材。</p></div>
            <button class="text-link" type="button" data-nav="graph" data-nav-arg="T01">知识图谱 ${icon('arrow')}</button>
          </div>
          <div class="course-map">${themes.map((t) => {
            const qCount = (t.指标列表 || []).reduce((n, i) => n + (i.题目列表 || []).length, 0);
            return `<button class="course-card" type="button" data-nav="graph" data-nav-arg="${esc(t.主题编号)}">
              <div class="cc-num">${esc(t.主题编号)} · ${qCount} 题</div>
              <h3>${esc(t.主题名称)}</h3>
              <p>${esc(t.主题目标)}</p>
              <div class="cc-tags">${(t.指标列表 || []).slice(0, 3).map((i) => `<span class="tag">${esc(i.指标编号)}</span>`).join('')}</div>
            </button>`;
          }).join('')}</div>
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>它怎么得出一个结论</h3><p>所有计算由规则引擎完成，自然语言只做包装。</p></div></div>
          <div class="steps">
            <div class="step"><span class="s-num">1</span><div><strong>清洗与对齐</strong><p>同一事件保留最高修订版本；待评分、未作答不判错；异常记录隔离。</p></div></div>
            <div class="step"><span class="s-num">2</span><div><strong>评分点级诊断</strong><p>按知识点聚合 90 个评分点，识别跨题系统性薄弱与同题多步失分。</p></div></div>
            <div class="step"><span class="s-num">3</span><div><strong>规则驱动建议</strong><p>按前置依赖排序，选具体题目、给分步提示、设完成条件与调整规则。</p></div></div>
            <div class="step"><span class="s-num">4</span><div><strong>人工复核</strong><p>教师可查看证据、参考答案与数据审计；学生端不直接给答案。</p></div></div>
          </div>
        </section>
      </div>
    </div>`;
  };
})();
