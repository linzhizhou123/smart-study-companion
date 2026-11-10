/* ==========================================================================
   智慧学伴 · chat
   Offline, evidence-grounded conversational layer. No answers are exposed.
   ========================================================================== */
(function () {
  'use strict';
  const ZB = window.ZB;
  const { diagnostics, recs, groups, comparison, cases, questions, indicators, themes, tags, meta } = ZB.index;
  const state = ZB.state;
  const esc = ZB.esc;
  const fmtPct = ZB.fmtPct;
  const fmtScore = ZB.fmtScore;

  const QUICK_PROMPTS = [
    '分析 D04',
    'D17 的记录够吗？',
    '比较 DC01 和 DC02',
    '负号去括号为什么总错',
    '给我下一步学习计划',
  ];

  let typing = false;

  function initialMessage() {
    return {
      role: 'assistant',
      html: `<p><strong>你好，我是数见。</strong>我只依据已有作答证据说话：能定位到评分点、题目和教材位置；记录不够时会明确说“暂不能判断”。</p>
        <div class="chat-suggestion-grid">
          <button type="button" data-action="chat-prompt" data-prompt="分析 D04">分析 D04 的评分点问题</button>
          <button type="button" data-action="chat-prompt" data-prompt="D17 的记录够吗？">D17 的记录够吗？</button>
          <button type="button" data-action="chat-prompt" data-prompt="比较 DC01 和 DC02">比较两个班的差距</button>
        </div>`,
    };
  }

  function initChat() {
    if (!state.chat.length) state.chat.push(initialMessage());
    renderChat();
    const overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.addEventListener('click', closeChat);
  }
  ZB.initChat = initChat;

  function openChat(prompt) {
    state.chatOpen = true;
    const drawer = document.getElementById('chat-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    renderChat();
    if (prompt) sendChat(prompt);
    else {
      const input = document.getElementById('chat-input');
      if (input) setTimeout(() => input.focus(), 220);
    }
  }
  ZB.openChat = openChat;

  function closeChat() {
    if (!state.chatOpen) return;
    state.chatOpen = false;
    const drawer = document.getElementById('chat-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }
  ZB.closeChat = closeChat;

  function currentDiag(sid) {
    return diagnostics[sid] || diagnostics[state.sid] || null;
  }

  function actionsHTML(actions) {
    if (!actions || !actions.length) return '';
    return `<div class="chat-actions">${actions.map((a) =>
      `<button type="button" data-action="${esc(a.action)}" ${a.sid ? `data-sid="${esc(a.sid)}"` : ''} ${a.caseKey ? `data-case-key="${esc(a.caseKey)}"` : ''}>${esc(a.label)}</button>`
    ).join('')}</div>`;
  }

  function statRow(items) {
    return `<div class="chat-stat-row">${items.map((i) => `<span class="chat-stat">${esc(i)}</span>`).join('')}</div>`;
  }

  function topSystemic(diag, limit = 3) {
    return (diag.评分点级诊断?.['全部'] || []).filter((t) => t.模式 === 'systemic').slice(0, limit);
  }

  function limitedIndicators(diag) {
    return Object.values(diag.指标诊断 || {}).filter((x) => x.status === 'limited' || x.status === 'no_evidence');
  }

  function diagnosisAnswer(sid) {
    const d = currentDiag(sid);
    if (!d) return helpAnswer();
    const overall = d.总体;
    const sys = topSystemic(d, 3);
    const limited = limitedIndicators(d);
    let html = `<p><strong>${esc(sid)} · ${esc(d.所属班级)}</strong>　总体得分率 <strong>${fmtPct(overall.rate)}</strong>，基于 ${overall.evidenceCount} 条已评分证据、${overall.distinctQuestions} 道不同题目。</p>
      ${statRow([`待评分 ${d.记录概况.待评分数}`, `未作答 ${d.记录概况.未作答数}`, `覆盖指标 ${d.记录概况.覆盖指标数}/9`])}
      <p>${esc(d.诊断叙述?.摘要 || '')}</p>`;
    if (sys.length) {
      html += `<div class="chat-divider"></div><p><strong>最值得先看的评分点</strong></p><ul>${sys.map((t) =>
        `<li><strong>${esc(t.知识点)}</strong>：${t.被考核次数} 次考核，得分率 ${fmtPct(t.得分率)}，涉及 ${esc((t.关联题目 || []).join('、'))}。</li>`
      ).join('')}</ul>`;
    }
    if (limited.length) {
      html += `<p class="small muted" style="margin-top:6px">另有 ${limited.length} 个指标证据不足（≤1 道题），这些部分不能下“不会”的结论。</p>`;
    }
    html += actionsHTML([
      { label: '打开完整诊断', action: 'open-student', sid },
      { label: '查看学习建议', action: 'open-plan', sid },
    ]);
    return html;
  }

  function planAnswer(sid) {
    const rec = recs[sid];
    const d = currentDiag(sid);
    if (!rec) return diagnosisAnswer(sid);
    const stages = rec.学习计划 || [];
    let html = `<p><strong>${esc(sid)} 的下一步</strong>　${esc(rec.计划说明 || '')}</p>
      ${statRow([`共 ${rec.建议总览.总建议数} 条`, `预计 ${rec.建议总览.预计时间}`, `学习 ${rec.建议总览.学习条目数} 条`, `观察 ${rec.建议总览.补充观察条目数} 条`])}`;
    if (stages.length) {
      html += stages.map((st) => `<p style="margin-top:8px"><strong>${esc(st.阶段)}</strong> <span class="muted small">约 ${st.预计分钟} 分钟</span></p><ul>${st.建议条目.map((it) =>
        `<li><span style="font-family:var(--mono);color:var(--teal)">${esc(it.题目编号)}</span> ${esc(it.知识点)}：${esc(it.理由)}</li>`
      ).join('')}</ul>`).join('');
    } else {
      html += `<p>当前没有足够的低分证据支持“补弱”，建议以补充观察为主。${esc(rec.记录不足补充观察?.说明 || '')}</p>`;
    }
    const obs = rec.记录不足补充观察?.建议条目 || [];
    if (obs.length) {
      html += `<p class="small muted" style="margin-top:6px">另有 ${obs.length} 道补充观察题：${esc(obs.map((x) => x.题目编号).join('、'))}，目的是收集证据，不是判定薄弱。</p>`;
    }
    html += actionsHTML([
      { label: '打开学习建议', action: 'open-plan', sid },
      { label: '查看诊断依据', action: 'open-student', sid },
    ]);
    return html;
  }

  function recordAnswer(sid) {
    const d = currentDiag(sid);
    if (!d) return helpAnswer();
    const limited = limitedIndicators(d);
    const pending = d.记录概况.待评分数;
    const blank = d.记录概况.未作答数;
    let html = `<p><strong>${esc(sid)}</strong> 的最终记录 ${d.记录概况.最终记录数} 条：已评分 ${d.记录概况.已评分数} 条，待评分 ${pending} 条，未作答 ${blank} 条。</p>`;
    if (!limited.length) {
      html += `<p>大多数指标已有至少 2 道题的证据；仍建议结合课堂表现判断。</p>`;
    } else {
      html += `<p>以下指标目前只有 ≤1 道题的证据，<strong>暂不能判断</strong>，也不应按“不会”处理：</p><ul>${limited.map((x) =>
        `<li>${esc(x.观察指标)}（${x.指标编号}）：${x.evidenceCount} 条有效证据，覆盖 ${x.distinctQuestions} 道题。</li>`
      ).join('')}</ul>`;
      html += `<p>建议先做“补充观察”，而不是直接补弱。</p>`;
    }
    html += actionsHTML([
      { label: '查看学习建议', action: 'open-plan', sid },
      { label: '打开数据审计', action: 'open-audit' },
    ]);
    return html;
  }

  function revisionAnswer(sid) {
    const d = currentDiag(sid);
    if (!d) return helpAnswer();
    const rev = d.修订模式;
    if (!rev.有修订的题目数) return `<p><strong>${esc(sid)}</strong> 没有检测到同一作答事件的修订版本。</p>${actionsHTML([{ label: '打开诊断', action: 'open-student', sid }])}`;
    return `<p><strong>${esc(sid)}</strong> 的修订情况：${esc(rev.解读)}</p><ul>${rev.详情.map((x) =>
      `<li>${esc(x.题目编号)}：${x.修订次数} 次修订，${fmtScore(x.首次得分)} → ${fmtScore(x.最终得分)} 分（${esc(x.变化)}）。</li>`
    ).join('')}</ul>${actionsHTML([{ label: '打开诊断', action: 'open-student', sid }])}`;
  }

  function findTags(text) {
    const q = text.replace(/[，。？！、\s]/g, '');
    const found = new Set();
    for (const [id, t] of Object.entries(tags)) {
      const core = t.名称.replace(/[（(].*?[）)]/g, '').replace(/法则|处理|书写|判断|求值/g, '');
      if (core && q.includes(core)) found.add(id);
    }
    const aliases = [
      ['负号', ['K08', 'K23']], ['去括号', ['K06', 'K07', 'K08']],
      ['同类项', ['K05', 'K04']], ['合并', ['K04']], ['移项', ['K12', 'K21']],
      ['去分母', ['K14']], ['消元', ['K16', 'K17']], ['回代', ['K17']],
      ['变号', ['K23']], ['交集', ['K25']], ['公共解集', ['K25']],
      ['数轴', ['K24']], ['列不等式', ['K28']], ['列方程', ['K19']],
      ['检验', ['K15', 'K18', 'K20']], ['端点', ['K27']], ['取整', ['K29']],
    ];
    for (const [word, ids] of aliases) if (q.includes(word)) ids.forEach((id) => found.add(id));
    return Array.from(found);
  }

  function tagAnswer(sid, tagIds) {
    const d = currentDiag(sid);
    const allTags = d?.评分点级诊断?.['全部'] || [];
    const candidates = (Array.isArray(tagIds) ? tagIds : [tagIds])
      .map((id) => allTags.find((x) => x.知识点编号 === id) || { 知识点编号: id, 知识点: tags[id]?.名称 || id, 无证据: true })
      .sort((a, b) => {
        const rank = { systemic: 0, within_question: 1, single: 2, developing: 3, mastered: 4 };
        return (rank[a.模式] ?? 5) - (rank[b.模式] ?? 5) || (a.得分率 ?? 1) - (b.得分率 ?? 1);
      });
    if (!candidates.length) return `<p>没有找到对应知识点。</p>`;
    const withEvidence = candidates.filter((t) => !t.无证据).slice(0, 2);
    if (!withEvidence.length) {
      const metaTag = tags[candidates[0].知识点编号];
      return `<p>「${esc(metaTag?.名称 || candidates[0].知识点编号)}」对应 ${esc((metaTag?.题目 || []).join('、'))}；${esc(sid)} 目前没有这个知识点的有效评分点证据，暂不能判断。</p>${actionsHTML([{ label: '打开诊断', action: 'open-student', sid }])}`;
    }
    const weak = withEvidence.filter((t) => t.模式 === 'systemic' || t.模式 === 'within_question' || t.模式 === 'single' || (t.得分率 != null && t.得分率 < 0.6));
    if (!weak.length) {
      const top = topSystemic(d, 2);
      let note = `<p>现有证据不支持“这个知识点总错”：`;
      note += withEvidence.map((t) => `${esc(t.知识点)} ${fmtPct(t.得分率)}（${t.被考核次数} 次）`).join('；');
      note += `。</p>`;
      if (top.length) note += `<p>${esc(sid)} 更明显的跨题问题是：${top.map((t) => `${esc(t.知识点)}（${fmtPct(t.得分率)}）`).join('；')}。</p>`;
      return note + actionsHTML([{ label: '打开完整诊断', action: 'open-student', sid }, { label: '查看建议', action: 'open-plan', sid }]);
    }
    let html = '';
    withEvidence.forEach((t) => {
      html += `<p><strong>${esc(t.知识点)}</strong>　${esc(sid)} 在 ${t.被考核次数} 个评分点上得分率 <strong>${fmtPct(t.得分率)}</strong>，涉及 ${esc((t.关联题目 || []).join('、'))}。</p>`;
      if (t.模式 === 'systemic') html += `<p>这是跨题反复出现的问题：建议先补这一个步骤，而不是整套刷题。</p>`;
      else if (t.模式 === 'within_question') html += `<p>这是同一道题内的多步失分：建议把这道题拆开，按评分点逐步重做。</p>`;
      else if (t.模式 === 'mastered') html += `<p>现有证据显示这个知识点掌握较好，可以尝试变式。</p>`;
      html += `<div class="chat-evidence">${(t.证据 || []).slice(0, 4).map((e) =>
        `<div class="ce-line"><span>${esc(e.题目编号)} · ${esc(e.评分点)} · ${esc(e.节点编号)}</span><b>${fmtScore(e.得分)}/${fmtScore(e.满分)}</b></div>`
      ).join('')}</div>`;
    });
    html += actionsHTML([
      { label: '打开完整诊断', action: 'open-student', sid },
      { label: '查看建议', action: 'open-plan', sid },
    ]);
    return html;
  }

  function classAnswer() {
    const c = comparison || {};
    let html = `<p>${esc(c.叙述 || '两班对比数据暂不可用。')}</p>`;
    if (c.最大差距) {
      html += statRow([
        `${c.最大差距.指标编号}：DC01 ${fmtPct(c.最大差距.DC01)} / DC02 ${fmtPct(c.最大差距.DC02)}`,
      ]);
    }
    html += actionsHTML([{ label: '打开学情总览', action: 'open-analysis' }]);
    return html;
  }

  function caseAnswer() {
    const list = cases.list || [];
    const items = list.length ? list : [
      { type: '部分得分', studentId: 'D04', headline: '' },
      { type: '表现较好', studentId: 'D14', headline: '' },
      { type: '记录不足', studentId: 'D17', headline: '' },
    ];
    return `<p>本次选取的三类典型案例：</p><ul>${items.map((c) =>
      `<li><strong>${esc(c.type)}</strong> · ${esc(c.studentId)}：${esc(c.headline || c.reason || '')}</li>`
    ).join('')}</ul>${actionsHTML([{ label: '打开典型案例', action: 'open-case', caseKey: state.caseKey }])}`;
  }

  function curriculumAnswer() {
    return `<p>课程要求覆盖三个主题、9 个观察指标、54 道题和 90 个评分点。每个指标都能追到课标编号、教材页码和题目。</p><ul>${themes.map((t) =>
      `<li><strong>${esc(t.主题编号)} ${esc(t.主题名称)}</strong>：${t.指标列表.length} 个指标；教材 ${esc((t.教材位置 || []).join(' · '))}。</li>`
    ).join('')}</ul>${actionsHTML([{ label: '打开知识图谱', action: 'open-graph' }])}`;
  }

  function helpAnswer() {
    return `<p>我可以做四件事：</p><ul>
      <li><strong>看学生</strong>：例如“分析 D04”“D17 记录够吗”；</li>
      <li><strong>看知识点</strong>：例如“负号去括号为什么总错”“T02I3 怎么样”；</li>
      <li><strong>看班级</strong>：例如“比较 DC01 和 DC02”；</li>
      <li><strong>看下一步</strong>：例如“给我 D07 的学习计划”。</li>
    </ul><p class="small muted">所有回答都来自固定的规则引擎结果；没有记录的地方我会说“暂不能判断”。</p>`;
  }

  function answerQuery(text) {
    const sidMatch = text.match(/D\d{2}/i);
    const sid = sidMatch ? sidMatch[0].toUpperCase() : state.sid;
    if (!diagnostics[sid] && !/比较|案例|帮助|课程/.test(text)) {
      return `<p>我没有找到学生 <strong>${esc(sid)}</strong>。可选范围是 D01—D40。</p>`;
    }
    if (/比较|差距|两个班|DC01|DC02/i.test(text)) return classAnswer();
    if (/案例/.test(text)) return caseAnswer();
    if (/帮助|怎么用|能做什么|你是谁/.test(text)) return helpAnswer();
    if (/课程|要求|教材|知识图谱|主题|指标/.test(text) && !/为什么|诊断|分析/.test(text)) return curriculumAnswer();
    if (/记录|不足|没做|空白|证据够/.test(text)) return recordAnswer(sid);
    if (/修订|改过|版本|改对|改错/.test(text)) return revisionAnswer(sid);
    if (/建议|计划|下一步|练什么|怎么练|安排/.test(text)) return planAnswer(sid);
    const tagIds = findTags(text);
    if (tagIds.length) return tagAnswer(sid, tagIds);
    if (/为什么|诊断|分析|问题|薄弱|错|表现/.test(text)) return diagnosisAnswer(sid);
    return diagnosisAnswer(sid);
  }

  function renderChat() {
    const drawer = document.getElementById('chat-drawer');
    if (!drawer) return;
    const d = currentDiag(state.sid);
    const overall = d?.总体;
    drawer.innerHTML = `
      <div class="chat-head">
        <div class="ch-title">
          <span class="agent-orb">数</span>
          <div><strong>问学伴</strong><small>OFFLINE EVIDENCE ENGINE · 可追溯</small></div>
        </div>
        <button type="button" data-action="close-chat" aria-label="关闭">${ZB.icon('close')}</button>
      </div>
      <div class="chat-context">
        <span>CONTEXT</span>
        <b>${esc(state.sid)}</b>
        <span>·</span>
        <b>${esc(d?.所属班级 || '')}</b>
        <span>·</span>
        <b>${overall ? fmtPct(overall.rate) : '—'}</b>
        <span>·</span>
        <b>${state.role === 'teacher' ? '教师视图' : '学生视图'}</b>
      </div>
      <div class="chat-body" id="chat-body">
        ${state.chat.map((m) => `
          <div class="chat-msg ${m.role}">
            <div class="chat-avatar">${m.role === 'user' ? '我' : '数'}</div>
            <div class="chat-bubble">${m.html}</div>
          </div>`).join('')}
        ${typing ? `<div class="chat-msg assistant"><div class="chat-avatar">数</div><div class="chat-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>` : ''}
      </div>
      <div class="chat-foot">
        <div class="quick-prompts">
          ${QUICK_PROMPTS.slice(0, 3).map((p) => `<button type="button" data-action="chat-prompt" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}
        </div>
        <form class="chat-form" id="chat-form">
          <input type="text" id="chat-input" placeholder="问一个具体问题，例如：D04 为什么总在去括号上错？" autocomplete="off">
          <button class="btn btn-primary btn-sm" type="submit">发送</button>
        </form>
      </div>`;
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }
  ZB.renderChat = renderChat;

  function sendChat(text) {
    if (!text) return;
    if (!state.chatOpen) openChat();
    state.chat.push({ role: 'user', html: `<p>${esc(text)}</p>` });
    typing = true;
    renderChat();
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
    setTimeout(() => {
      const html = answerQuery(text);
      state.chat.push({ role: 'assistant', html });
      if (state.chat.length > 40) state.chat = state.chat.slice(-40);
      typing = false;
      renderChat();
    }, 380);
  }
  ZB.sendChat = sendChat;
})();
