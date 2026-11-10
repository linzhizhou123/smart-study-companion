/* ==========================================================================
   智慧学伴 · core
   Data indexes, utilities, state, hash routing, shell, event delegation.
   ========================================================================== */
(function () {
  'use strict';

  const DATA = window.__APP_DATA__;
  const ZB = (window.ZB = {});

  if (!DATA) {
    document.getElementById('app').innerHTML =
      '<div class="boot-screen"><strong>数据未加载</strong><p>请使用构建后的单文件版本打开。</p></div>';
    return;
  }

  /* ----------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */
  const STATUS_LABELS = {
    secure: '掌握较好',
    developing: '发展中',
    needs_support: '需巩固',
    limited: '记录不足',
    no_evidence: '无记录',
    not_measured: '本节点未测',
  };
  const PATTERN_LABELS = {
    systemic: '系统性薄弱',
    within_question: '同题多步',
    single: '单次失误',
    mastered: '掌握较好',
    developing: '发展中',
  };
  const SEVERITY_LABELS = { high: '高', medium: '中', low: '低' };
  const ROLE_LABELS = { student: '学生', teacher: '教师' };
  const ROUTE_META = {
    home: ['工作台', '证据驱动 · 因材施教'],
    analysis: ['学情总览', '班级与群体'],
    student: ['个体诊断', '个体与评分点'],
    plan: ['学习建议', '可执行 · 可追溯'],
    graph: ['知识图谱', '课标 → 指标 → 题目'],
    cases: ['典型案例', '结果核对'],
    audit: ['数据审计', '先处理数据，再解释数据'],
  };
  const ROUTES = Object.keys(ROUTE_META);
  ZB.STATUS_LABELS = STATUS_LABELS;
  ZB.PATTERN_LABELS = PATTERN_LABELS;
  ZB.SEVERITY_LABELS = SEVERITY_LABELS;

  /* ----------------------------------------------------------------------
     Indexes
     ---------------------------------------------------------------------- */
  const questions = DATA.questions || {};
  const indicators = DATA.indicators || {};
  const themes = DATA.themes || [];
  const tags = DATA.tags || {};
  const students = DATA.students || [];
  const diagnostics = DATA.diagnostics || {};
  const recs = DATA.recommendations || {};
  const groups = DATA.groups || {};
  const records = DATA.records || [];
  const issues = DATA.issues || [];
  const cases = DATA.cases || {};
  const comparison = DATA.comparison || {};
  const prerequisites = DATA.prerequisites || {};
  const connections = DATA.connections || {};
  const textbookIndex = DATA.textbookIndex || {};
  const quality = DATA.quality || {};
  const fieldDesc = DATA.fieldDesc || [];
  const meta = DATA.meta || {};
  const nodes = DATA.nodes || [];

  const studentById = {};
  students.forEach((s) => (studentById[s.id] = s));
  const themeById = {};
  themes.forEach((t) => (themeById[t.主题编号] = t));
  const recordsByStudent = {};
  const recordsByQuestion = {};
  records.forEach((r) => {
    (recordsByStudent[r.studentId] = recordsByStudent[r.studentId] || []).push(r);
    (recordsByQuestion[r.questionId] = recordsByQuestion[r.questionId] || []).push(r);
  });
  const issuesById = {};
  issues.forEach((i) => (issuesById[i.问题编号] = i));

  ZB.DATA = DATA;
  ZB.index = {
    questions, indicators, themes, tags, students, diagnostics, recs, groups, comparison,
    records, issues, cases, meta, nodes, prerequisites, connections, textbookIndex, quality, fieldDesc,
    studentById, themeById,
    recordsByStudent, recordsByQuestion, issuesById,
  };

  /* ----------------------------------------------------------------------
     Utils
     ---------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  ZB.$ = $;
  ZB.$$ = $$;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  ZB.esc = esc;

  function fmtPct(rate, digits = 0) {
    if (rate == null || Number.isNaN(Number(rate))) return '—';
    return (Number(rate) * 100).toFixed(digits) + '%';
  }
  ZB.fmtPct = fmtPct;

  function fmtScore(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  }
  ZB.fmtScore = fmtScore;

  function fmtDelta(delta) {
    if (delta == null || Number.isNaN(Number(delta))) return '—';
    const n = Number(delta);
    return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%';
  }
  ZB.fmtDelta = fmtDelta;

  function deltaClass(delta) {
    if (delta == null) return 'flat';
    if (delta >= 0.1) return 'up';
    if (delta <= -0.1) return 'down';
    return 'flat';
  }
  ZB.deltaClass = deltaClass;

  function statusLabel(status) { return STATUS_LABELS[status] || status || '—'; }
  function patternLabel(p) { return PATTERN_LABELS[p] || p || '—'; }
  ZB.statusLabel = statusLabel;
  ZB.patternLabel = patternLabel;

  function statusChip(status, text) {
    return `<span class="status status-${esc(status)}">${esc(text || statusLabel(status))}</span>`;
  }
  ZB.statusChip = statusChip;

  function severityChip(sev) {
    const key = ({ 高: 'high', 中: 'medium', 低: 'low', high: 'high', medium: 'medium', low: 'low' })[sev] || 'low';
    return `<span class="sev sev-${key}">${esc(SEVERITY_LABELS[key])}</span>`;
  }
  ZB.severityChip = severityChip;

  function patternChip(p) {
    return `<span class="pattern pattern-${esc(p)}">${esc(patternLabel(p))}</span>`;
  }
  ZB.patternChip = patternChip;

  function truncate(text, len = 78) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return s.length > len ? s.slice(0, len) + '…' : s;
  }
  ZB.truncate = truncate;

  function rateColorClass(rate, status) {
    if (status && STATUS_LABELS[status] && status !== 'secure' && status !== 'developing' && status !== 'needs_support') {
      return 'hm-' + status;
    }
    if (rate == null) return 'hm-no_evidence';
    if (rate >= 0.85) return 'hm-secure';
    if (rate >= 0.6) return 'hm-developing';
    return 'hm-needs_support';
  }
  ZB.rateColorClass = rateColorClass;

  function bar(rate, cls = '') {
    const w = rate == null ? 0 : Math.max(0, Math.min(100, Math.round(rate * 100)));
    return `<div class="bar"><div class="bar-fill ${cls}" style="width:${w}%"></div></div>`;
  }
  ZB.bar = bar;

  function icon(name, cls = '') {
    const paths = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
      analysis: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
      student: '<circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 21c.8-4.2 3.6-6.5 7.5-6.5s6.7 2.3 7.5 6.5"/>',
      plan: '<path d="M6 3.5h9l4 4V21H6z"/><path d="M15 3.5V8h4"/><path d="M9 12h6M9 16h6"/>',
      graph: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M8.2 6h7.6M7.2 8.1l3.6 7.7M16.8 8.1l-3.6 7.7"/>',
      cases: '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/><path d="M4 11h16"/><path d="M10 11v3h4v-3"/>',
      audit: '<path d="M12 3l8 3v6c0 4.4-3.1 7.8-8 9-4.9-1.2-8-4.6-8-9V6z"/><path d="m8.5 12 2.3 2.3 4.8-5"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
      print: '<path d="M7 8V3h10v5"/><path d="M6 17H4V8h16v9h-2"/><path d="M7 14h10v7H7z"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
      arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
      arrowDown: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
      book: '<path d="M4 5.5c3-1.4 5.7-1.4 8 0v14c-2.3-1.4-5-1.4-8 0z"/><path d="M12 5.5c2.3-1.4 5-1.4 8 0v14c-3-1.4-5.7-1.4-8 0"/>',
      check: '<path d="m4 12 5 5L20 6"/>',
      spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
      shield: '<path d="M12 3l8 3v6c0 4.4-3.1 7.8-8 9-4.9-1.2-8-4.6-8-9V6z"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      chevronDown: '<path d="m6 9 6 6 6-6"/>',
      eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.2 8.5A7 7 0 0 1 19 9"/><path d="M17.8 15.5A7 7 0 0 1 5 15"/>',
      filter: '<path d="M4 5h16l-6 7v5l-4 2v-7z"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
      external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M19 14v6H4V5h6"/>',
      user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 21c.7-4 3.2-6 7-6s6.3 2 7 6"/>',
    };
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }
  ZB.icon = icon;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  ZB.toast = toast;

  /* ----------------------------------------------------------------------
     State & persistence
     ---------------------------------------------------------------------- */
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem('zhihui.state.v1') || '{}'); }
    catch (e) { return {}; }
  }
  const saved = loadSaved();
  const state = {
    route: 'home',
    routeArg: '',
    role: saved.role || 'student',
    sid: saved.sid && diagnostics[saved.sid] ? saved.sid : 'D04',
    node: saved.node || 'ALL',
    classFilter: saved.classFilter || 'DC01',
    graphTheme: saved.graphTheme || 'ALL',
    graphIndicator: saved.graphIndicator || null,
    graphEdges: saved.graphEdges !== false,
    graphSearch: '',
    graphType: '',
    graphTag: '',
    caseKey: saved.caseKey || 'case1_partial',
    scoreFilter: 'all',
    expanded: {},
    planFeedback: saved.planFeedback || {},
    chat: [],
    chatOpen: false,
    auditType: 'all',
    auditStatus: 'all',
    auditQuery: '',
    auditPage: 1,
  };
  ZB.state = state;

  function persist() {
    try {
      localStorage.setItem('zhihui.state.v1', JSON.stringify({
        role: state.role,
        sid: state.sid,
        node: state.node,
        classFilter: state.classFilter,
        graphTheme: state.graphTheme,
        graphIndicator: state.graphIndicator,
        graphEdges: state.graphEdges,
        caseKey: state.caseKey,
        planFeedback: state.planFeedback,
      }));
    } catch (e) { /* ignore quota */ }
  }
  ZB.persist = persist;

  /* ----------------------------------------------------------------------
     Routing
     ---------------------------------------------------------------------- */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return { route: 'home', arg: '' };
    const parts = raw.split('/');
    return { route: parts[0] || 'home', arg: decodeURIComponent(parts.slice(1).join('/') || '') };
  }

  function applyRoute() {
    // 清理可能在路由切换后才触发的搜索防抖，避免旧 DOM 被异步替换
    if (state._graphSearchTimer) {
      clearTimeout(state._graphSearchTimer);
      state._graphSearchTimer = null;
    }
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    const { route, arg } = parseHash();
    const previousRoute = state.route;
    state.route = ROUTES.includes(route) ? route : 'home';
    state.routeArg = arg || '';
    if ((state.route === 'student' || state.route === 'plan') && arg && diagnostics[arg]) {
      state.sid = arg;
      persist();
    }
    if (state.route === 'analysis' && ['DC01', 'DC02', 'ALL'].includes(arg)) {
      state.classFilter = arg;
      persist();
    }
    if (state.route === 'graph' && arg) {
      if (indicators[arg]) {
        state.graphIndicator = arg;
        state.graphTheme = arg.slice(0, 3);
      } else if (['T01', 'T02', 'T03'].includes(arg)) {
        state.graphTheme = arg;
      }
      persist();
    }
    if (state.route === 'cases' && arg && cases[arg]) {
      state.caseKey = arg;
      persist();
    }
    render(previousRoute !== state.route);
  }

  function navigate(route, arg = '') {
    if (!ROUTES.includes(route)) route = 'home';
    const hash = '#/' + route + (arg ? '/' + encodeURIComponent(arg) : '');
    if (location.hash === hash) applyRoute();
    else location.hash = hash;
  }
  ZB.navigate = navigate;

  function setStudent(sid, opts = {}) {
    if (!diagnostics[sid]) return;
    state.sid = sid;
    persist();
    if (opts.navigate !== false) {
      if (state.route === 'plan') navigate('plan', sid);
      else if (state.route === 'student') navigate('student', sid);
      else render();
    } else {
      render();
    }
  }
  ZB.setStudent = setStudent;

  /* ----------------------------------------------------------------------
     Shell
     ---------------------------------------------------------------------- */
  function navItem(key, num, label) {
    return `<button type="button" data-nav="${key}" data-nav-arg="" class="nav-btn">
      <span class="nav-num">${num}</span>
      <span class="nav-ico">${icon(key)}</span>
      <span>${label}</span>
    </button>`;
  }

  function studentOptions(selected) {
    const classes = ['DC01', 'DC02'];
    return classes.map((cls) => {
      const opts = students.filter((s) => s.classId === cls)
        .map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${s.id} · ${cls}</option>`)
        .join('');
      return `<optgroup label="${cls}">${opts}</optgroup>`;
    }).join('');
  }

  function shellHTML() {
    return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar" aria-label="主导航">
        <button class="brand" type="button" data-nav="home" aria-label="返回工作台">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
          <span class="brand-copy">
            <strong>数见</strong>
            <small>LEARNING EVIDENCE</small>
          </span>
        </button>
        <nav class="nav-list">
          ${navItem('home', '01', '工作台')}
          ${navItem('analysis', '02', '学情总览')}
          ${navItem('student', '03', '个体诊断')}
          ${navItem('plan', '04', '学习建议')}
          ${navItem('graph', '05', '知识图谱')}
          ${navItem('cases', '06', '典型案例')}
          ${navItem('audit', '07', '数据审计')}
        </nav>
        <div class="sidebar-foot">
          <div class="sidebar-card">
            <div class="mini-label">DATA SNAPSHOT</div>
            <strong>${esc(meta.dataVersion || 'ZHIHUI-XUEBAN')}</strong>
            <p>${esc(meta.studentCount || 40)} 名学生 · ${esc(meta.questionCount || 54)} 道题 · ${esc(meta.finalRecordCount || 799)} 条最终记录</p>
            <span class="sig"><span class="sig-dot"></span>离线规则引擎 · 可追溯</span>
          </div>
        </div>
      </aside>
      <div class="sidebar-scrim" id="sidebar-scrim"></div>
      <main class="main">
        <header class="topbar">
          <button class="menu-btn" type="button" data-action="toggle-sidebar" aria-label="打开导航">${icon('menu')}</button>
          <div class="topbar-title">
            <span class="eyebrow" id="page-eyebrow">证据驱动 · 因材施教</span>
            <h1 id="page-title">工作台</h1>
          </div>
          <div class="topbar-actions">
            <label class="field" style="gap:2px;min-width:130px">
              <span class="sr-only">当前学生</span>
              <select id="global-student" aria-label="当前学生">${studentOptions(state.sid)}</select>
            </label>
            <div class="role-switch" role="group" aria-label="切换视图角色">
              <button type="button" data-action="set-role" data-role="student" class="${state.role === 'student' ? 'active' : ''}">学生</button>
              <button type="button" data-action="set-role" data-role="teacher" class="${state.role === 'teacher' ? 'active' : ''}">教师</button>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-action="open-chat">${icon('chat')}问学伴</button>
            <button type="button" class="icon-btn" data-action="print" aria-label="打印当前页面">${icon('print')}</button>
          </div>
        </header>
        <div id="view-root" class="view-root" aria-live="polite"></div>
      </main>
    </div>
    <div id="modal-root"></div>
    <div class="drawer-overlay" id="drawer-overlay"></div>
    <aside class="chat-drawer" id="chat-drawer" aria-label="问学伴"></aside>`;
  }

  function ensureShell() {
    const app = $('#app');
    if (!app || !$('#view-root')) {
      app.innerHTML = shellHTML();
      bindShell();
    }
  }

  function bindShell() {
    const globalSelect = $('#global-student');
    if (globalSelect) {
      globalSelect.addEventListener('change', (e) => {
        setStudent(e.target.value);
        toast(`已切换至 ${e.target.value}`);
      });
    }
    const scrim = $('#sidebar-scrim');
    if (scrim) scrim.addEventListener('click', () => toggleSidebar(false));
  }

  function toggleSidebar(open) {
    const sidebar = $('#sidebar');
    const scrim = $('#sidebar-scrim');
    if (!sidebar) return;
    const next = open == null ? !sidebar.classList.contains('open') : open;
    sidebar.classList.toggle('open', next);
    if (scrim) scrim.classList.toggle('show', next);
  }
  ZB.toggleSidebar = toggleSidebar;

  function setActiveNav(route) {
    $$('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.nav === route);
    });
    const title = $('#page-title');
    const eyebrow = $('#page-eyebrow');
    const m = ROUTE_META[route] || ROUTE_META.home;
    if (title) title.textContent = m[0];
    if (eyebrow) eyebrow.textContent = m[1];
    document.title = `数见 · ${m[0]}`;
  }

  /* ----------------------------------------------------------------------
     Render
     ---------------------------------------------------------------------- */
  const views = (ZB.views = {});

  function render(scrollTop = false) {
    ensureShell();
    setActiveNav(state.route);
    const root = $('#view-root');
    if (!root) return;
    const view = views[state.route] || views.home;
    try {
      root.innerHTML = view();
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="empty-state"><div class="es-mark">!</div><strong>页面渲染失败</strong><p>${esc(err.message)}</p></div>`;
    }
    const globalSelect = $('#global-student');
    if (globalSelect) globalSelect.value = state.sid;
    $$('.role-switch button').forEach((b) => b.classList.toggle('active', b.dataset.role === state.role));
    if (typeof ZB.renderChat === 'function') ZB.renderChat();
    if (scrollTop) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  ZB.render = render;

  /* ----------------------------------------------------------------------
     Event delegation
     ---------------------------------------------------------------------- */
  function closestAction(el) {
    return el && el.closest ? el.closest('[data-action]') : null;
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      const key = nav.dataset.nav;
      const arg = nav.dataset.navArg || (
        key === 'student' || key === 'plan' ? state.sid :
        key === 'analysis' ? state.classFilter :
        key === 'graph' ? (state.graphIndicator || state.graphTheme) :
        key === 'cases' ? state.caseKey : ''
      );
      navigate(key, arg);
      toggleSidebar(false);
      return;
    }

    const actionEl = closestAction(event.target);
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const ds = actionEl.dataset;

    switch (action) {
      case 'toggle-sidebar':
        toggleSidebar();
        break;
      case 'print':
        window.print();
        break;
      case 'set-role':
        state.role = ds.role === 'teacher' ? 'teacher' : 'student';
        persist();
        render();
        toast(state.role === 'teacher' ? '已切换到教师视图：参考答案可见' : '已切换到学生视图：参考答案隐藏');
        break;
      case 'open-chat':
        if (typeof ZB.openChat === 'function') ZB.openChat();
        break;
      case 'close-chat':
        if (typeof ZB.closeChat === 'function') ZB.closeChat();
        break;
      case 'chat-prompt':
        if (typeof ZB.sendChat === 'function') ZB.sendChat(ds.prompt || '');
        break;
      case 'open-student':
        navigate('student', ds.sid || state.sid);
        break;
      case 'open-analysis':
        navigate('analysis', state.classFilter);
        break;
      case 'open-graph':
        navigate('graph', state.graphIndicator || state.graphTheme);
        break;
      case 'open-audit':
        navigate('audit');
        break;
      case 'open-plan':
        navigate('plan', ds.sid || state.sid);
        break;
      case 'open-case':
        navigate('cases', ds.caseKey || state.caseKey);
        break;
      case 'open-question':
        if (typeof ZB.openQuestion === 'function') ZB.openQuestion(ds.qid);
        break;
      case 'open-record':
        if (typeof ZB.openRecord === 'function') ZB.openRecord(ds.rid);
        break;
      case 'open-help':
        if (typeof ZB.openHelp === 'function') ZB.openHelp();
        break;
      case 'open-indicator':
        state.expanded.indicator = state.expanded.indicator === ds.iid ? null : ds.iid;
        render();
        break;
      case 'set-node':
        state.node = ds.node || 'ALL';
        persist();
        render();
        break;
      case 'set-class':
        state.classFilter = ds.cls || 'ALL';
        persist();
        if (state.route === 'analysis') navigate('analysis', state.classFilter);
        else render();
        break;
      case 'set-case':
        state.caseKey = ds.caseKey || 'case1_partial';
        persist();
        render();
        break;
      case 'set-graph-theme':
        state.graphTheme = ds.theme || 'T01';
        state.graphIndicator = null;
        persist();
        render();
        break;
      case 'graph-indicator':
        state.graphIndicator = ds.iid || null;
        if (ds.iid) state.graphTheme = ds.iid.slice(0, 3);
        persist();
        render();
        break;
      case 'toggle-graph-edges':
        state.graphEdges = !state.graphEdges;
        persist();
        render();
        break;
      case 'set-score-filter':
        state.scoreFilter = ds.filter || 'all';
        render();
        break;
      case 'toggle-expand': {
        const key = ds.key || 'x';
        state.expanded[key] = !state.expanded[key];
        render();
        break;
      }
      case 'apply-feedback':
        if (typeof ZB.applyFeedback === 'function') ZB.applyFeedback(ds.feedback || '');
        break;
      case 'reset-plan':
        delete state.planFeedback[state.sid];
        persist();
        render();
        toast('已恢复原始学习计划');
        break;
      case 'set-audit-type':
        state.auditType = ds.type || 'all';
        state.auditPage = 1;
        render();
        break;
      case 'set-audit-status':
        state.auditStatus = ds.status || 'all';
        state.auditPage = 1;
        render();
        break;
      case 'audit-page':
        state.auditPage = Math.max(1, Number(ds.page) || 1);
        render();
        break;
      case 'select-question-filter':
        if (ds.key && ds.value) {
          if (ds.key === 'theme') state.graphTheme = ds.value;
          if (ds.key === 'indicator') state.graphIndicator = ds.value;
          if (ds.key === 'type') state.graphType = ds.value;
          if (ds.key === 'tag') state.graphTag = ds.value;
          render();
        }
        break;
      case 'open-tag':
        state.graphTag = ds.tag || '';
        navigate('graph', state.graphIndicator || state.graphTheme);
        break;
      case 'open-student-from-cell':
        navigate('student', ds.sid);
        break;
      default:
        break;
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'global-student') {
      setStudent(el.value);
      toast(`已切换至 ${el.value}`);
    }
    if (el.id === 'audit-status-select') {
      state.auditStatus = el.value;
      state.auditPage = 1;
      render();
    }
    if (el.id === 'audit-type-select') {
      state.auditType = el.value;
      state.auditPage = 1;
      render();
    }
    if (el.id === 'library-search') {
      state.graphSearch = el.value;
      render();
    }
    if (el.id === 'library-theme') {
      state.graphTheme = el.value;
      render();
    }
    if (el.id === 'library-type') {
      state.graphType = el.value;
      render();
    }
    if (el.id === 'library-tag') {
      state.graphTag = el.value;
      render();
    }
  });

  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.id === 'audit-search') {
      state.auditQuery = el.value;
      state.auditPage = 1;
      const holder = $('#audit-record-table');
      if (holder && typeof ZB.views.auditTableOnly === 'function') {
        holder.innerHTML = ZB.views.auditTableOnly();
      }
    }
    if (el.id === 'library-search') {
      state.graphSearch = el.value;
      clearTimeout(state._graphSearchTimer);
      state._graphSearchTimer = setTimeout(() => {
        state._graphSearchTimer = null;
        if (state.route !== 'graph') return;
        const holder = $('#library-table');
        if (holder && document.body.contains(holder) && typeof ZB.views.graphTableOnly === 'function') {
          holder.innerHTML = ZB.views.graphTableOnly();
        }
      }, 180);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'home-ask' || form.id === 'chat-form') {
      event.preventDefault();
      const input = form.querySelector('input, textarea');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      if (input) input.value = '';
      if (typeof ZB.sendChat === 'function') ZB.sendChat(text);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (typeof ZB.closeChat === 'function') ZB.closeChat();
      if (typeof ZB.closeModal === 'function') ZB.closeModal();
      toggleSidebar(false);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (typeof ZB.openChat === 'function') ZB.openChat();
    }
  });

  window.addEventListener('hashchange', applyRoute);

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */
  ZB.init = function () {
    ensureShell();
    applyRoute();
    if (typeof ZB.initChat === 'function') ZB.initChat();
  };

})();
