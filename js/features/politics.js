// 考研政治模块：选择题错题 + 纯知识点双形态卡片、自测重做判分、智能粘贴拆题、原题截图压缩存取与 FLIP 详情
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

const POLITICS_SUBJECT_STYLES = {
  '马原':     'bg-rose-50 text-rose-700 border-rose-200/80',
  '毛中特':   'bg-red-50 text-red-700 border-red-200/80',
  '习思':     'bg-amber-50 text-amber-800 border-amber-200/80',
  '史纲':     'bg-orange-50 text-orange-700 border-orange-200/80',
  '思修法基': 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  '时政':     'bg-sky-50 text-sky-700 border-sky-200/80'
};

let politicsQuizMode = false;   // 全局「🙈 自测重做」模式开关
const politicsQuizState = {};   // { [id]: { active, selected: [], submitted, isCorrect, revealed } }
const politicsImageUrlCache = {}; // { [imageId]: objectUrl }

// 弹窗草稿态
let politicsDraftKind = 'choice'; // 'choice' | 'knowledge'
let politicsDraftOptions = [];
let politicsDraftWrong = [];
let politicsDraftCorrect = [];
let politicsDraftImage = { mode: 'keep', existingId: '', blob: null, previewUrl: '', mime: '', size: 0 };
let polPreviewTimer = null;
let politicsViewerCtx = null;

// =========================================================================
// 1. 科目下拉填充与统计卡片
// =========================================================================
function getPoliticsSubjects() {
  return (appData.politics && Array.isArray(appData.politics.subjects) && appData.politics.subjects.length)
    ? appData.politics.subjects
    : POLITICS_SUBJECTS;
}

function getPoliticsRecords() {
  return (appData.politics && Array.isArray(appData.politics.records))
    ? appData.politics.records
    : [];
}

function populatePoliticsSubjectFilter() {
  const sel = document.getElementById('filter-subject-politics');
  if (!sel) return;
  const prev = sel.value;
  const subs = getPoliticsSubjects();
  sel.innerHTML = '<option value="">全部科目</option>' +
    subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (subs.includes(prev)) sel.value = prev;
}

function renderPoliticsStats() {
  const container = document.getElementById('stats-politics');
  if (!container) return;
  const list = getPoliticsRecords();
  const total = list.length;
  const choiceCount = list.filter(r => r.cardKind === 'choice').length;
  const knowCount = total - choiceCount;
  const pending = list.filter(r => r.status !== '已掌握').length;
  const highFreq = list.filter(r => (Number(r.forgetCount) || 1) >= 3).length;

  const totalPractice = list.reduce((a, r) => a + (Number(r.practiceCount) || 0), 0);
  const totalCorrect = list.reduce((a, r) => a + (Number(r.practiceCorrectCount) || 0), 0);
  const accText = totalPractice > 0 ? `${Math.round((totalCorrect / totalPractice) * 100)}%` : '—';
  const accSub = totalPractice > 0 ? `自测 ${totalCorrect}/${totalPractice} 次` : '点「自测重做」刷错题';

  const cards = [
    { label: `政治记录（选${choiceCount} · 知${knowCount}）`, value: total, color: 'text-rose-600', bg: 'bg-rose-50', icon: '📕' },
    { label: '未掌握（待解决/复习中）', value: pending, color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
    { label: `自测正确率 · ${accSub}`, value: accText, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: '🎯' },
    { label: '高频易忘（≥3次）', value: highFreq, color: 'text-red-600', bg: 'bg-red-50', icon: '🔥' }
  ];

  container.innerHTML = cards.map((c, i) => `
    <div class="stat-card bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm flex items-center justify-between" style="--stagger:${i}">
      <div class="min-w-0 pr-2">
        <div class="text-xs font-medium text-slate-500 mb-1 truncate" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</div>
        <div class="text-2xl sm:text-3xl font-extrabold ${c.color} tracking-tight tabular-nums">${c.value}</div>
      </div>
      <div class="w-11 h-11 rounded-2xl ${c.bg} flex items-center justify-center text-xl shrink-0">${c.icon}</div>
    </div>
  `).join('');
}

// =========================================================================
// 2. 筛选、排序与全局自测模式切换
// =========================================================================
function getFilteredPoliticsRecords() {
  const subjectVal = (document.getElementById('filter-subject-politics')?.value) || '';
  const kindVal = (document.getElementById('filter-kind-politics')?.value) || '';
  const statusVal = (document.getElementById('filter-status-politics')?.value) || '';
  const sortVal = (document.getElementById('sort-politics')?.value) || 'forgetDesc';
  const kw = (document.getElementById('search-politics')?.value || '').trim().toLowerCase();

  let list = [...getPoliticsRecords()];
  if (subjectVal) list = list.filter(r => r.subject === subjectVal);
  if (kindVal === 'single') list = list.filter(r => r.cardKind === 'choice' && r.questionType !== 'multi');
  else if (kindVal === 'multi') list = list.filter(r => r.cardKind === 'choice' && r.questionType === 'multi');
  else if (kindVal === 'knowledge') list = list.filter(r => r.cardKind === 'knowledge');
  if (statusVal) list = list.filter(r => r.status === statusVal);
  if (kw) {
    list = list.filter(r => {
      const optStr = (r.options || []).map(o => `${o.key} ${o.text}`).join(' ').toLowerCase();
      return (r.topic || '').toLowerCase().includes(kw) ||
        (r.stem || '').toLowerCase().includes(kw) ||
        optStr.includes(kw) ||
        (r.analysis || '').toLowerCase().includes(kw) ||
        (r.source || '').toLowerCase().includes(kw) ||
        (r.errorReason || '').toLowerCase().includes(kw) ||
        (r.subject || '').toLowerCase().includes(kw);
    });
  }

  list.sort((a, b) => {
    if (sortVal === 'forgetDesc') {
      const diff = (b.forgetCount || 1) - (a.forgetCount || 1);
      if (diff !== 0) return diff;
      return slashToIso(b.dateStr).localeCompare(slashToIso(a.dateStr));
    }
    if (sortVal === 'dateDesc') {
      return slashToIso(b.dateStr).localeCompare(slashToIso(a.dateStr)) || (b.createdAt || 0) - (a.createdAt || 0);
    }
    if (sortVal === 'accuracyAsc') {
      const rateA = a.practiceCount > 0 ? a.practiceCorrectCount / a.practiceCount : -1;
      const rateB = b.practiceCount > 0 ? b.practiceCorrectCount / b.practiceCount : -1;
      if (rateA !== rateB) return rateA - rateB;
      return (b.forgetCount || 1) - (a.forgetCount || 1);
    }
    return slashToIso(b.firstDateStr || b.dateStr).localeCompare(slashToIso(a.firstDateStr || a.dateStr));
  });
  return list;
}

function togglePoliticsQuizMode() {
  politicsQuizMode = !politicsQuizMode;
  // 切换全局自测时重置每张卡片的临时作答态
  Object.keys(politicsQuizState).forEach(k => delete politicsQuizState[k]);
  updatePoliticsQuizBtnUI();
  renderPolitics();
  showToast(politicsQuizMode ? '已进入「自测重做」模式：答案与解析已遮挡，点击选项即可判分！' : '已退出自测模式，恢复错题复盘视图', 'info');
}

function updatePoliticsQuizBtnUI() {
  const btn = document.getElementById('politicsQuizToggleBtn');
  if (!btn) return;
  if (politicsQuizMode) {
    btn.className = 'btn-tactile inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-xs';
    btn.textContent = '👁️ 退出自测';
  } else {
    btn.className = 'btn-tactile inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100';
    btn.textContent = '🙈 自测重做';
  }
}

function getPolQuizState(id) {
  if (!politicsQuizState[id]) {
    politicsQuizState[id] = { active: false, selected: [], submitted: false, isCorrect: null, revealed: false };
  }
  return politicsQuizState[id];
}

function isPolCardInQuiz(id) {
  const st = politicsQuizState[id];
  return Boolean(politicsQuizMode || (st && st.active));
}

// 单张卡片临时开启/重置自测重做
function startCardPoliticsQuiz(id) {
  politicsQuizState[id] = { active: true, selected: [], submitted: false, isCorrect: null, revealed: false };
  renderPolitics();
}

function exitCardPoliticsQuiz(id) {
  delete politicsQuizState[id];
  renderPolitics();
}

function revealPoliticsCardAnswer(id) {
  const st = getPolQuizState(id);
  st.revealed = true;
  renderPolitics();
}

function togglePoliticsKnowledgeReveal(id) {
  const st = getPolQuizState(id);
  st.revealed = !st.revealed;
  renderPolitics();
}

// 在自测模式下点选选项
async function pickPoliticsQuizOption(id, key) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec || rec.cardKind !== 'choice') return;
  const st = getPolQuizState(id);
  if (st.submitted || st.revealed) return;

  if (rec.questionType === 'multi') {
    if (st.selected.includes(key)) {
      st.selected = st.selected.filter(k => k !== key);
    } else {
      st.selected = [...st.selected, key].sort();
    }
    renderPolitics();
  } else {
    // 单选题点选即判分
    st.selected = [key];
    await submitPoliticsQuiz(id);
  }
}

// 提交判定（单选自动调用，多选点按钮调用）
async function submitPoliticsQuiz(id) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec || rec.cardKind !== 'choice') return;
  const st = getPolQuizState(id);
  if (!st.selected.length) {
    showToast('请先选择至少一个选项', 'warning');
    return;
  }
  const chosen = [...st.selected].sort().join('');
  const correct = [...(rec.correctAnswer || [])].sort().join('');
  st.submitted = true;
  st.isCorrect = Boolean(correct && chosen === correct);

  rec.practiceCount = (Number(rec.practiceCount) || 0) + 1;
  if (st.isCorrect) {
    rec.practiceCorrectCount = (Number(rec.practiceCorrectCount) || 0) + 1;
  }
  await persistModule('politics', true);
  renderPolitics(id);

  if (st.isCorrect) {
    showToast(`🎉 答对了！正确答案就是 ${correct}`, 'success');
  } else {
    showToast(`❌ 再巩固一下：你选了 ${chosen}，正确答案是 ${correct || '未设'}`, 'warning');
  }
}

// 自测答错后一键「+1 遗忘并更新最新错选」
async function recordPoliticsQuizMistake(id) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;
  const st = politicsQuizState[id];
  if (st && Array.isArray(st.selected) && st.selected.length) {
    rec.wrongAnswer = [...st.selected].sort();
  }
  await incrementPoliticsForget(id);
}

// =========================================================================
// 3. 选项渲染辅助（还原刷题错题视觉 + 自测交互态）
// =========================================================================
function buildChoiceOptionsHtml(rec, forViewer = false) {
  const options = Array.isArray(rec.options) ? rec.options : [];
  if (!options.length) return '';

  const inQuiz = !forViewer && isPolCardInQuiz(rec.id);
  const st = getPolQuizState(rec.id);
  const hideAnswer = inQuiz && !st.submitted && !st.revealed;
  const correctSet = new Set(rec.correctAnswer || []);
  const wrongSet = new Set((inQuiz && st.submitted) ? st.selected : (rec.wrongAnswer || []));

  const rowsHtml = options.map(opt => {
    const key = opt.key;
    const text = opt.text || '';
    if (hideAnswer) {
      const selected = st.selected.includes(key);
      return `
        <button type="button" onclick="event.stopPropagation(); pickPoliticsQuizOption('${rec.id}','${key}')"
          class="pol-opt-row pol-opt-interactive w-full text-left ${selected ? 'pol-opt-selected' : 'pol-opt-neutral'}">
          <span class="pol-opt-key ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200'}">${escapeHtml(key)}</span>
          <span class="flex-1 text-sm text-slate-800 leading-snug break-words">${escapeHtml(text || '（空选项）')}</span>
          ${selected ? '<span class="text-xs font-bold text-blue-600 shrink-0">已选</span>' : ''}
        </button>`;
    }

    const isCorrect = correctSet.has(key);
    const isWrongPicked = wrongSet.has(key) && !isCorrect;
    const isRightPicked = wrongSet.has(key) && isCorrect;
    const isMissedMulti = rec.questionType === 'multi' && isCorrect && wrongSet.size > 0 && !isRightPicked;

    let rowCls = 'pol-opt-neutral';
    let keyCls = 'bg-white text-slate-600 border-slate-200';
    let markHtml = '';

    if (isWrongPicked) {
      rowCls = 'pol-opt-wrong';
      keyCls = 'bg-rose-600 text-white border-rose-600';
      markHtml = '<span class="pol-mark pol-mark-wrong" title="错选">✕</span>';
    } else if (isMissedMulti) {
      rowCls = 'pol-opt-missed';
      keyCls = 'bg-emerald-600 text-white border-emerald-600';
      markHtml = '<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700 shrink-0">漏选 ✓</span>';
    } else if (isCorrect) {
      rowCls = 'pol-opt-correct';
      keyCls = 'bg-emerald-600 text-white border-emerald-600';
      markHtml = '<span class="pol-mark pol-mark-correct" title="正确答案">✓</span>';
    }

    return `
      <div class="pol-opt-row ${rowCls}">
        <span class="pol-opt-key ${keyCls}">${escapeHtml(key)}</span>
        <span class="flex-1 text-sm text-slate-800 leading-snug break-words">${escapeHtml(text || '（空选项）')}</span>
        ${markHtml}
      </div>`;
  }).join('');

  // 下方状态/判分条
  let footerBar = '';
  if (hideAnswer) {
    const selStr = st.selected.length ? st.selected.join('') : '未选';
    footerBar = `
      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50/80 border border-amber-200/80 text-xs" onclick="event.stopPropagation()">
        <span class="text-amber-800 font-medium">${rec.questionType === 'multi' ? `多选作答中 · 已选：<b>${escapeHtml(selStr)}</b>` : '单选题 · 点击上方选项立即判分'}</span>
        <div class="flex items-center gap-1.5">
          ${rec.questionType === 'multi'
            ? `<button type="button" onclick="submitPoliticsQuiz('${rec.id}')" class="btn-tactile px-3 py-1 rounded-lg font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-xs">✅ 提交判定</button>`
            : ''}
          <button type="button" onclick="revealPoliticsCardAnswer('${rec.id}')" class="btn-tactile px-2.5 py-1 rounded-lg font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100">👁️ 看答案</button>
          ${!politicsQuizMode ? `<button type="button" onclick="exitCardPoliticsQuiz('${rec.id}')" class="btn-tactile px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100">退出</button>` : ''}
        </div>
      </div>`;
  } else {
    const myAnsStr = (inQuiz && st.submitted ? st.selected : (rec.wrongAnswer || [])).join('') || '—';
    const rightAnsStr = (rec.correctAnswer || []).join('') || '—';

    // 自测刚提交后的结果反馈条
    let quizBanner = '';
    if (inQuiz && st.submitted) {
      if (st.isCorrect) {
        quizBanner = `
          <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs" onclick="event.stopPropagation()">
            <span class="font-bold text-emerald-700">🎉 本次自测答对了！</span>
            <div class="flex items-center gap-1.5">
              ${rec.status !== '已掌握'
                ? `<button type="button" onclick="changePoliticsStatus('${rec.id}','已掌握')" class="btn-tactile px-2.5 py-1 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-700">🟢 标为已掌握</button>`
                : ''}
              <button type="button" onclick="startCardPoliticsQuiz('${rec.id}')" class="btn-tactile px-2.5 py-1 rounded-lg font-semibold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100">🔄 再测一次</button>
            </div>
          </div>`;
      } else {
        quizBanner = `
          <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs" onclick="event.stopPropagation()">
            <span class="font-bold text-rose-700">❌ 答错了（你选 ${escapeHtml(myAnsStr)} · 正解 ${escapeHtml(rightAnsStr)}）</span>
            <div class="flex items-center gap-1.5">
              <button type="button" onclick="recordPoliticsQuizMistake('${rec.id}')" class="btn-tactile px-2.5 py-1 rounded-lg font-semibold bg-rose-600 text-white hover:bg-rose-700">⚡ +1 遗忘</button>
              <button type="button" onclick="startCardPoliticsQuiz('${rec.id}')" class="btn-tactile px-2.5 py-1 rounded-lg font-semibold bg-white text-rose-700 border border-rose-200 hover:bg-rose-100">🔄 重测</button>
            </div>
          </div>`;
      }
    }

    // 仿截图底部汇总条：你的答案 | 正确答案 | 全站正确率 | 自测重做入口
    const summaryCells = `
      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-slate-50/90 border border-slate-200/75 text-xs">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span class="text-slate-500">${inQuiz && st.submitted ? '本次作答' : '你的错选'}：<b class="text-sm font-extrabold ${inQuiz && st.submitted && st.isCorrect ? 'text-emerald-600' : 'text-rose-600'} ml-0.5">${escapeHtml(myAnsStr)}</b></span>
          <span class="text-slate-500">正确答案：<b class="text-sm font-extrabold text-emerald-600 ml-0.5">${escapeHtml(rightAnsStr)}</b></span>
          ${rec.siteAccuracy ? `<span class="text-slate-500">全站正确率：<b class="text-sm font-bold text-emerald-700 ml-0.5">${escapeHtml(rec.siteAccuracy)}</b></span>` : ''}
          ${rec.practiceCount > 0 ? `<span class="text-slate-400">自测 ${rec.practiceCorrectCount}/${rec.practiceCount}</span>` : ''}
        </div>
        ${!forViewer ? `
          <button type="button" onclick="event.stopPropagation(); ${inQuiz ? `startCardPoliticsQuiz('${rec.id}')` : `startCardPoliticsQuiz('${rec.id}')`}"
            class="btn-tactile px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 shrink-0" title="隐藏答案重新做一遍">
            🎯 ${inQuiz ? '再测' : '重做'}
          </button>` : ''}
      </div>`;

    footerBar = quizBanner + summaryCells;
  }

  return `<div class="space-y-1.5">${rowsHtml}</div>${footerBar}`;
}

// =========================================================================
// 4. 政治主视图渲染（大卡片 / 紧凑表格 + 分页）
// =========================================================================
function renderPolitics(popRecordId = null) {
  renderPoliticsStats();
  updateViewModeButtons('politics');
  updatePoliticsQuizBtnUI();

  const list = getFilteredPoliticsRecords();
  const container = document.getElementById('records-container-politics');
  const pagEl = document.getElementById('pagination-politics');
  if (!container || !pagEl) return;

  if (!list.length) {
    pagEl.innerHTML = '';
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/80 rounded-2xl p-14 text-center shadow-sm">
        <div class="text-4xl mb-3">📕</div>
        <div class="text-slate-600 font-semibold mb-1">暂无匹配的政治错题或知识点</div>
        <div class="text-xs text-slate-400">点击右上角「＋ 新增政治错题/知识点」，支持一键粘贴拆题干选项与粘贴原题截图</div>
      </div>`;
    return;
  }

  const ps = pageState.politics;
  const totalPages = Math.max(1, Math.ceil(list.length / ps.size));
  ps.page = Math.min(Math.max(1, ps.page), totalPages);
  const start = (ps.page - 1) * ps.size;
  const pageList = list.slice(start, start + ps.size);
  renderPaginationBar('politics', list.length, totalPages, pagEl);

  if (viewModes.politics === 'card') {
    container.innerHTML = `<div class="knowledge-grid">${pageList.map((r, idx) => {
      const fc = Number(r.forgetCount) || 1;
      const isHigh = fc >= 3;
      const accentClass = r.status === '已掌握'
        ? 'accent-success'
        : (isHigh || r.status === '待解决' ? 'accent-danger' : 'accent-warning');

      const fcColor = fc >= 3 ? 'text-rose-600' : (fc === 2 ? 'text-amber-600' : 'text-blue-600');
      const statusStyle = r.status === '已掌握'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : (r.status === '复习中' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200');
      const subBadge = POLITICS_SUBJECT_STYLES[r.subject] || 'bg-rose-50 text-rose-700 border-rose-200/80';
      const kindBadge = r.cardKind === 'knowledge'
        ? '<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70">📝 知识点</span>'
        : (r.questionType === 'multi'
          ? '<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/70">☑️ 多选题</span>'
          : '<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200/70">🔘 单选题</span>');

      const popClass = popRecordId === r.id ? 'animate-pop' : '';
      const inQuiz = isPolCardInQuiz(r.id);
      const st = getPolQuizState(r.id);
      const hideChoiceAnalysis = r.cardKind === 'choice' && inQuiz && !st.submitted && !st.revealed;
      const maskKnowledge = r.cardKind === 'knowledge' && politicsQuizMode && !st.revealed;

      // 带图卡片：构建自适应图文舞台（文字少且空间够时直接展开清晰渲染图片，空间不足时自动折叠为紧凑条）
      const buildMediaStageHtml = (isChoiceCard) => {
        const hasText = Boolean(r.analysis && r.analysis.trim());
        const maskThis = !isChoiceCard && maskKnowledge;
        const noteHtml = hasText
          ? `<div class="k-card-note pol-stage-note bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
               <div class="md-body text-slate-700">${renderMarkdown(r.analysis)}</div>
               <span class="k-card-more">🔍 点击查看详情</span>
             </div>`
          : '';
        const imgSlotHtml = `
          <div class="pol-img-slot" data-pol-img-slot="${escapeHtml(r.imageId)}" onclick="event.stopPropagation(); openPoliticsLightbox('${escapeHtml(r.imageId)}')">
            <div class="pol-img-expanded hidden" title="点击查看大图">
              <img data-pol-img="${escapeHtml(r.imageId)}" alt="原题截图" class="pol-img-full" />
              <span class="pol-img-zoom-pill">🔍 查看大图</span>
            </div>
            <div class="pol-img-compact flex items-center gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-blue-300 transition-colors">
              <img data-pol-img="${escapeHtml(r.imageId)}" alt="原题截图" class="w-14 h-10 object-cover rounded-lg border border-slate-200 bg-white cursor-zoom-in shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-slate-700">🖼️ 已附原题截图</div>
                <div class="text-[11px] text-slate-400">独立存于 assets/ · 点击查看大图</div>
              </div>
              <span class="text-xs font-semibold text-blue-600 shrink-0 pr-1">查看 ›</span>
            </div>
          </div>`;
        return `
          <div class="pol-media-stage ${isChoiceCard ? 'pol-choice-stage' : ''} ${maskThis ? 'pol-quiz-masked cursor-pointer' : ''}"
            ${maskThis ? `onclick="event.stopPropagation(); togglePoliticsKnowledgeReveal('${r.id}')"` : ''}>
            <div class="pol-stage-inner ${maskThis ? 'pol-blur-content' : ''}">
              ${noteHtml}
              ${imgSlotHtml}
            </div>
            ${maskThis ? '<div class="pol-mask-tip">🙈 自测遮挡 · 点击揭晓知识点与配图</div>' : ''}
          </div>`;
      };

      const bodyHtml = r.cardKind === 'choice'
        ? `
          ${r.topic ? `<div class="text-xs font-bold text-rose-700/90 flex items-center gap-1"><span>🎯</span><span class="truncate" title="${escapeHtml(r.topic)}">${escapeHtml(r.topic)}</span></div>` : ''}
          <div class="pol-stem-clamp text-[15px] font-semibold text-slate-900 leading-[1.65] break-words">${escapeHtml(r.stem || r.topic)}</div>
          ${buildChoiceOptionsHtml(r, false)}
          ${hideChoiceAnalysis
            ? `<div class="rounded-xl border border-dashed border-amber-200 bg-amber-50/40 px-3.5 py-2.5 text-xs text-amber-700 text-center">🔒 答案解析${r.imageId ? '与原题截图' : ''}已隐藏，提交答案或点击「👁️ 看答案」后揭晓</div>`
            : (r.imageId
              ? buildMediaStageHtml(true)
              : `<div class="k-card-note bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                   ${r.analysis
                     ? `<div class="md-body text-slate-700">${renderMarkdown(r.analysis)}</div><span class="k-card-more">🔍 点击查看详情</span>`
                     : `<div class="text-slate-400 italic cursor-pointer hover:text-rose-600 transition-colors" onclick="event.stopPropagation();openPoliticsModal('${r.id}')">暂无答案解析 / 考点笔记，点击编辑补充...</div>`}
                 </div>`)}
        `
        : `
          <h3 class="k-card-title text-[19px] font-bold text-slate-900 leading-[1.4] tracking-tight break-words">${escapeHtml(r.topic)}</h3>
          ${r.imageId
            ? buildMediaStageHtml(false)
            : `<div class="k-card-note pol-know-note bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${maskKnowledge ? 'pol-quiz-masked cursor-pointer' : ''}"
                 ${maskKnowledge ? `onclick="event.stopPropagation(); togglePoliticsKnowledgeReveal('${r.id}')"` : ''}>
                 ${r.analysis
                   ? `<div class="md-body text-slate-700 ${maskKnowledge ? 'pol-blur-content' : ''}">${renderMarkdown(r.analysis)}</div>${maskKnowledge ? '<div class="pol-mask-tip">🙈 自测遮挡 · 点击揭晓知识点要点</div>' : '<span class="k-card-more">🔍 点击查看详情</span>'}`
                   : `<div class="text-slate-400 italic cursor-pointer hover:text-rose-600 transition-colors" onclick="event.stopPropagation();openPoliticsModal('${r.id}')">暂无知识点笔记，点击编辑补充...</div>`}
               </div>`}
        `;

      return `
        <article class="k-card ${accentClass} cursor-pointer flex flex-col gap-3" data-pol-id="${r.id}" onclick="politicsCardClick(event,'${r.id}')" style="--stagger:${idx}" title="点击卡片查看完整详情">
          <!-- Top Row -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="px-2.5 py-0.5 rounded-lg text-xs font-bold border ${subBadge}">${escapeHtml(r.subject)}</span>
              ${kindBadge}
              ${r.errorReason ? `<span class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 text-slate-600">${escapeHtml(r.errorReason)}</span>` : ''}
              ${r.source ? `<span class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(r.source)}</span>` : ''}
            </div>
            <select onchange="changePoliticsStatus('${r.id}',this.value)"
              class="px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer outline-none transition-colors ${statusStyle}">
              <option value="待解决" ${r.status === '待解决' ? 'selected' : ''}>🔴 待解决</option>
              <option value="复习中" ${r.status === '复习中' ? 'selected' : ''}>🟡 复习中</option>
              <option value="已掌握" ${r.status === '已掌握' ? 'selected' : ''}>🟢 已掌握</option>
            </select>
          </div>

          ${bodyHtml}

          <!-- Bottom Stack -->
          <div class="mt-auto flex flex-col gap-2.5 pt-1">
            <div class="flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-rose-50/40 border border-slate-200/70 rounded-xl px-4 py-2.5">
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">累计遗忘</span>
                <span class="text-2xl font-extrabold ${fcColor} ${popClass} inline-block tabular-nums">${fc}</span>
                <span class="text-xs text-slate-400">次</span>
                ${isHigh ? `<span class="ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">高频易忘</span>` : ''}
              </div>
              <button onclick="incrementPoliticsForget('${r.id}')"
                class="btn-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold bg-white text-rose-600 border border-rose-200 hover:bg-rose-600 hover:text-white hover:border-rose-600 shadow-xs">
                <span>⚡ +1 遗忘</span>
              </button>
            </div>

            ${forgetTrailHtml(r)}

            <div class="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-500">
                <span>最近：<b class="text-slate-700 font-semibold">${escapeHtml(r.dateStr || '-')}</b></span>
                <span class="text-slate-300">|</span>
                <span>首次：${escapeHtml(r.firstDateStr || r.dateStr || '-')}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <button onclick="pushPoliticsToTodo('${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100">📅 加入待办</button>
                <button onclick="openPoliticsModal('${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">✏️ 编辑</button>
                <button onclick="deletePoliticsRecord('${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-rose-50 text-rose-600 hover:bg-rose-100">🗑️ 删除</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join('')}</div>`;
  } else {
    // 紧凑表格视图
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-slate-50/90 text-slate-500 text-xs font-semibold border-b border-slate-200">
                <th class="py-3.5 px-3.5 whitespace-nowrap">科目</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">形态</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">考点 / 题干</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">错选 → 正解</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">错因 / 来源</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">状态</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">遗忘次数</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">日期</th>
                <th class="py-3.5 px-3.5 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${pageList.map(r => {
                const fc = Number(r.forgetCount) || 1;
                const fcColor = fc >= 3 ? 'text-rose-600' : (fc === 2 ? 'text-amber-600' : 'text-blue-600');
                const statusStyle = r.status === '已掌握'
                  ? 'bg-emerald-50 text-emerald-700'
                  : (r.status === '复习中' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700');
                const subBadge = POLITICS_SUBJECT_STYLES[r.subject] || 'bg-rose-50 text-rose-700 border-rose-200';
                const kindText = r.cardKind === 'knowledge' ? '知识点' : (r.questionType === 'multi' ? '多选' : '单选');
                const ansCell = r.cardKind === 'choice'
                  ? (politicsQuizMode
                    ? '<span class="text-xs text-amber-600 font-semibold">🙈 自测遮挡</span>'
                    : `<span class="font-bold text-rose-600">${escapeHtml((r.wrongAnswer || []).join('') || '—')}</span> <span class="text-slate-300">→</span> <span class="font-bold text-emerald-600">${escapeHtml((r.correctAnswer || []).join('') || '—')}</span>`)
                  : '<span class="text-xs text-slate-400">—</span>';
                const popClass = popRecordId === r.id ? 'animate-pop' : '';
                return `
                  <tr class="hover:bg-rose-50/25 transition-colors cursor-pointer" data-pol-id="${r.id}" onclick="politicsCardClick(event,'${r.id}')" title="点击查看完整详情">
                    <td class="py-3 px-3.5 whitespace-nowrap"><span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${subBadge}">${escapeHtml(r.subject)}</span></td>
                    <td class="py-3 px-3.5 whitespace-nowrap text-xs font-semibold text-slate-600">${kindText}${r.imageId ? ' 🖼️' : ''}</td>
                    <td class="py-3 px-3.5 max-w-[300px]">
                      <div class="tbl-topic font-semibold text-slate-800 break-words">${escapeHtml(r.topic || r.stem)}</div>
                      ${r.cardKind === 'choice' && r.stem && r.stem !== r.topic ? `<div class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(r.stem)}</div>` : ''}
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap text-xs">${ansCell}</td>
                    <td class="py-3 px-3.5 whitespace-nowrap text-xs text-slate-500">
                      <div>${escapeHtml(r.errorReason || '-')}</div>
                      ${r.source ? `<div class="text-[11px] text-indigo-500">${escapeHtml(r.source)}</div>` : ''}
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap">
                      <select onchange="changePoliticsStatus('${r.id}',this.value)" class="px-2.5 py-1 rounded-full text-xs font-semibold border-0 cursor-pointer ${statusStyle}">
                        <option value="待解决" ${r.status === '待解决' ? 'selected' : ''}>待解决</option>
                        <option value="复习中" ${r.status === '复习中' ? 'selected' : ''}>复习中</option>
                        <option value="已掌握" ${r.status === '已掌握' ? 'selected' : ''}>已掌握</option>
                      </select>
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap">
                      <div class="flex items-center gap-2">
                        <span class="font-extrabold text-base ${fcColor} ${popClass} inline-block min-w-[20px] text-center">${fc}</span>
                        <button onclick="incrementPoliticsForget('${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white">+1 遗忘</button>
                      </div>
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap text-xs">
                      <div class="font-medium text-slate-700">${escapeHtml(r.dateStr || '-')}</div>
                      <div class="text-slate-400">首次: ${escapeHtml(r.firstDateStr || r.dateStr || '-')}</div>
                    </td>
                    <td class="py-3 px-3.5 whitespace-nowrap">
                      <div class="flex items-center gap-1.5">
                        <button onclick="pushPoliticsToTodo('${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-blue-50 text-blue-700 hover:bg-blue-100">📅 待办</button>
                        <button onclick="openPoliticsModal('${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-slate-100 text-slate-700 hover:bg-slate-200">编辑</button>
                        <button onclick="deletePoliticsRecord('${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-rose-50 text-rose-600 hover:bg-rose-100">删除</button>
                      </div>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  renderMathIn(container);
  ensurePoliticsStageObserver();
  hydratePoliticsImages(container);
  layoutPoliticsMediaStages(container);
  requestAnimationFrame(() => layoutPoliticsMediaStages(container));
}

// =========================================================================
// 5. 常规操作：+1 遗忘 / 状态变更 / 删除 / 一键加入政治待办
// =========================================================================
async function incrementPoliticsForget(id) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;
  rec.forgetCount = (Number(rec.forgetCount) || 1) + 1;
  rec.dateStr = isoToSlash(todayISO());
  if (!Array.isArray(rec.forgetEvents)) rec.forgetEvents = [];
  rec.forgetEvents.push(Date.now());
  if (rec.status === '已掌握') rec.status = '复习中';
  await persistModule('politics', true);
  renderPolitics(id);
  showToast(`「${rec.topic}」遗忘次数 +1（当前 ${rec.forgetCount} 次）`, 'info');
}

async function changePoliticsStatus(id, newStatus) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;
  rec.status = newStatus;
  await persistModule('politics', true);
  renderPolitics();
}

async function deletePoliticsRecord(id) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;
  const ok = await showConfirm({
    title: '删除政治记录',
    message: `确定要删除「${rec.topic}」吗？删除前系统会自动在历史快照中留存备份。`,
    okText: '确认删除',
    danger: true
  });
  if (!ok) return;

  await createSnapshot('删除政治记录前备份');
  appData.politics.records = appData.politics.records.filter(r => r.id !== id);
  delete politicsQuizState[id];
  await persistModule('politics', true);
  renderPolitics();
  showToast('已删除政治记录（可通过历史快照恢复）', 'info');
}

async function pushPoliticsToTodo(id) {
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;
  const kindTag = rec.cardKind === 'choice' ? (rec.questionType === 'multi' ? '多选错题' : '单选错题') : '知识点';
  const ansTip = rec.cardKind === 'choice' && rec.correctAnswer.length
    ? `正解：${rec.correctAnswer.join('')}${rec.wrongAnswer.length ? `（曾错选 ${rec.wrongAnswer.join('')}）` : ''}`
    : '';
  appData.todos.push({
    id: genId('todo'),
    dateStr: todayISO(),
    title: `复习【政治·${rec.subject}】${rec.topic}`,
    category: '政治',
    priority: (rec.forgetCount || 1) >= 3 ? '高' : '中',
    completed: false,
    note: [kindTag, ansTip, rec.source ? `来源：${rec.source}` : ''].filter(Boolean).join(' · '),
    createdAt: Date.now()
  });
  await persistModule('todos', true);
  renderTodos();
  showToast(`已将「${rec.topic}」加入今日待办（政治分类）`, 'success');
}

// =========================================================================
// 6. 图片资产加载、Canvas 压缩、弹窗粘贴/上传与全屏灯箱
// =========================================================================
async function loadPoliticsImageUrl(imageId) {
  if (!imageId) return '';
  if (politicsImageUrlCache[imageId]) return politicsImageUrlCache[imageId];
  let asset = await idbGetAsset(imageId);
  if (!asset && dirHandle && typeof readAssetFromBoundDir === 'function') {
    asset = await readAssetFromBoundDir(imageId);
    if (asset && asset.blob) await idbPutAsset(asset);
  }
  if (!asset || !asset.blob) return '';
  const url = URL.createObjectURL(asset.blob);
  politicsImageUrlCache[imageId] = url;
  return url;
}

let politicsStageObserver = null;
let politicsStageRaf = 0;

function ensurePoliticsStageObserver() {
  if (politicsStageObserver || typeof ResizeObserver !== 'function') return;
  const container = document.getElementById('records-container-politics');
  if (!container) return;
  politicsStageObserver = new ResizeObserver(() => {
    if (politicsStageRaf) cancelAnimationFrame(politicsStageRaf);
    politicsStageRaf = requestAnimationFrame(() => {
      politicsStageRaf = 0;
      layoutPoliticsMediaStages(container);
    });
  });
  politicsStageObserver.observe(container);
}

// 根据卡片实际可用高度与文字占用高度，自动决定是否直接在卡片内展开渲染原图；空间不足时优雅折叠为紧凑条
function layoutPoliticsMediaStages(root = document) {
  if (!root || !root.querySelectorAll) return;
  const stages = root.querySelectorAll('.pol-media-stage');
  stages.forEach(stage => {
    const stageH = stage.clientHeight;
    const stageW = stage.clientWidth;
    if (!stageH || !stageW) return;

    const noteEl = stage.querySelector('.pol-stage-note');
    const slot = stage.querySelector('.pol-img-slot');
    if (!slot) return;
    const expandedEl = slot.querySelector('.pol-img-expanded');
    const compactEl = slot.querySelector('.pol-img-compact');
    const fullImg = expandedEl ? expandedEl.querySelector('img') : null;

    // 计算文字区自然完整高度
    let noteNaturalH = 0;
    if (noteEl) {
      const body = noteEl.querySelector('.md-body');
      const cs = getComputedStyle(noteEl);
      const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      noteNaturalH = body ? Math.ceil(body.scrollHeight + padV) : noteEl.scrollHeight;
    }

    const gap = noteEl ? 10 : 0;
    const remainingH = stageH - noteNaturalH - gap;

    // 剩余高度 >= 104px 且图片等比缩放后清晰可读 -> 直接展开大图；否则自动折叠为紧凑条
    let canExpand = remainingH >= 104;
    if (canExpand && fullImg && fullImg.naturalWidth > 0 && fullImg.naturalHeight > 0) {
      const innerW = Math.max(120, stageW - 14);
      const innerH = Math.max(80, remainingH - 14);
      const scale = Math.min(innerW / fullImg.naturalWidth, innerH / fullImg.naturalHeight, 1);
      const renderedW = fullImg.naturalWidth * scale;
      const renderedH = fullImg.naturalHeight * scale;
      if (renderedW < Math.min(fullImg.naturalWidth, 110) || renderedH < Math.min(fullImg.naturalHeight, 64)) {
        canExpand = false;
      }
    }

    if (canExpand) {
      slot.classList.add('is-expanded');
      if (expandedEl) expandedEl.classList.remove('hidden');
      if (compactEl) compactEl.classList.add('hidden');
      if (noteEl) noteEl.classList.remove('pol-note-fill');
    } else {
      slot.classList.remove('is-expanded');
      if (expandedEl) expandedEl.classList.add('hidden');
      if (compactEl) compactEl.classList.remove('hidden');
      if (noteEl) noteEl.classList.add('pol-note-fill');
    }
  });
  if (typeof markNoteOverflows === 'function') markNoteOverflows(root);
}

async function hydratePoliticsImages(root) {
  if (!root || !root.querySelectorAll) return;
  const imgs = root.querySelectorAll('img[data-pol-img]');
  for (const img of imgs) {
    const id = img.getAttribute('data-pol-img');
    if (!id) continue;
    const url = await loadPoliticsImageUrl(id);
    if (url) {
      if (img.classList.contains('pol-img-full')) {
        img.onload = () => {
          const card = img.closest('article.k-card');
          layoutPoliticsMediaStages(card || root);
        };
      }
      img.src = url;
    } else {
      img.alt = '图片未在本地找到';
      img.classList.add('opacity-40');
    }
  }
  layoutPoliticsMediaStages(root);
}

function compressImageToBlob(fileOrBlob, maxWidth = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            canvas.toBlob(fb => fb ? resolve(fb) : reject(new Error('压缩失败')), 'image/jpeg', quality);
          }
        }, 'image/webp', quality);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function setPoliticsDraftImageFromFile(fileOrBlob) {
  if (!fileOrBlob || !String(fileOrBlob.type || '').startsWith('image/')) {
    showToast('请选择或粘贴有效的图片文件', 'warning');
    return;
  }
  try {
    const compressed = await compressImageToBlob(fileOrBlob);
    if (politicsDraftImage.previewUrl && politicsDraftImage.mode === 'new') {
      URL.revokeObjectURL(politicsDraftImage.previewUrl);
    }
    const previewUrl = URL.createObjectURL(compressed);
    politicsDraftImage = {
      mode: 'new',
      existingId: politicsDraftImage.existingId,
      blob: compressed,
      previewUrl,
      mime: compressed.type || 'image/webp',
      size: compressed.size
    };
    renderPoliticsDraftImageBox();
    showToast(`已载入并压缩原题截图（${formatBytes(compressed.size)}）`, 'success');
  } catch {
    showToast('图片处理失败，请重试', 'error');
  }
}

function clearPoliticsDraftImage() {
  if (politicsDraftImage.previewUrl && politicsDraftImage.mode === 'new') {
    URL.revokeObjectURL(politicsDraftImage.previewUrl);
  }
  politicsDraftImage = {
    mode: 'clear',
    existingId: politicsDraftImage.existingId,
    blob: null,
    previewUrl: '',
    mime: '',
    size: 0
  };
  renderPoliticsDraftImageBox();
}

function onPoliticsImageFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (file) setPoliticsDraftImageFromFile(file);
  event.target.value = '';
}

function onPoliticsImageDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) setPoliticsDraftImageFromFile(file);
}

async function renderPoliticsDraftImageBox() {
  const box = document.getElementById('pol-image-preview-wrap');
  const emptyBox = document.getElementById('pol-image-empty-wrap');
  const imgEl = document.getElementById('pol-image-preview');
  const infoEl = document.getElementById('pol-image-info');
  if (!box || !emptyBox || !imgEl || !infoEl) return;

  let url = '';
  let info = '';
  if (politicsDraftImage.mode === 'new' && politicsDraftImage.previewUrl) {
    url = politicsDraftImage.previewUrl;
    info = `新截图 · ${formatBytes(politicsDraftImage.size)}（保存后存入独立 assets/）`;
  } else if (politicsDraftImage.mode === 'keep' && politicsDraftImage.existingId) {
    url = await loadPoliticsImageUrl(politicsDraftImage.existingId);
    info = `已保存截图 · ${politicsDraftImage.existingId}`;
  }

  if (url) {
    imgEl.src = url;
    infoEl.textContent = info;
    box.classList.remove('hidden');
    emptyBox.classList.add('hidden');
  } else {
    imgEl.src = '';
    box.classList.add('hidden');
    emptyBox.classList.remove('hidden');
  }
}

// 弹窗打开时支持直接 Ctrl+V 粘贴剪贴板原题截图
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('politicsModal');
  if (!modal || !modal.classList.contains('open')) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) setPoliticsDraftImageFromFile(file);
      return;
    }
  }
});

async function openPoliticsLightbox(imageId) {
  const url = await loadPoliticsImageUrl(imageId);
  if (!url) {
    showToast('未找到该原题截图文件（请检查是否已同步目录 assets/）', 'warning');
    return;
  }
  const lb = document.getElementById('politicsLightbox');
  const img = document.getElementById('politicsLightboxImg');
  if (!lb || !img) return;
  img.src = url;
  lb.classList.add('open');
}

function closePoliticsLightbox() {
  const lb = document.getElementById('politicsLightbox');
  if (lb) lb.classList.remove('open');
}

// =========================================================================
// 7. 新增 / 编辑弹窗（双形态切换 + 智能粘贴拆题 + 选项快捷标正/错 + Markdown 分屏）
// =========================================================================
function switchPoliticsModalKind(kind) {
  politicsDraftKind = kind === 'knowledge' ? 'knowledge' : 'choice';
  const btnChoice = document.getElementById('pol-kind-btn-choice');
  const btnKnow = document.getElementById('pol-kind-btn-knowledge');
  const choiceArea = document.getElementById('pol-choice-fields');
  const topicLabel = document.getElementById('pol-topic-label');
  const topicInput = document.getElementById('pol-topic');
  const analysisLabel = document.getElementById('pol-analysis-label');

  const isChoice = politicsDraftKind === 'choice';
  if (btnChoice) {
    btnChoice.className = `btn-tactile flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${isChoice ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}`;
  }
  if (btnKnow) {
    btnKnow.className = `btn-tactile flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${!isChoice ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}`;
  }
  if (choiceArea) choiceArea.classList.toggle('hidden', !isChoice);
  if (topicLabel) topicLabel.textContent = isChoice ? '核心考点摘要（可选，留空自动提取题干首句）' : '知识点标题 *';
  if (topicInput) topicInput.placeholder = isChoice ? '例如：马克思主义中国化时代化理论成果的共同点' : '例如：重要会议帽子题对比 / 土地政策时间轴';
  if (analysisLabel) analysisLabel.textContent = isChoice ? '答案解析 / 避坑笔记' : '知识点详解 / 易混对比';
}

function onPoliticsQTypeChange() {
  const qType = document.getElementById('pol-qtype')?.value || 'single';
  if (qType === 'single') {
    if (politicsDraftCorrect.length > 1) politicsDraftCorrect = [politicsDraftCorrect[0]];
    if (politicsDraftWrong.length > 1) politicsDraftWrong = [politicsDraftWrong[0]];
  }
  renderPoliticsOptionRows();
}

function renderPoliticsOptionRows() {
  const container = document.getElementById('pol-options-container');
  if (!container) return;
  container.innerHTML = politicsDraftOptions.map((opt, idx) => {
    const isCorrect = politicsDraftCorrect.includes(opt.key);
    const isWrong = politicsDraftWrong.includes(opt.key);
    return `
      <div class="flex items-center gap-2">
        <span class="w-7 h-8 rounded-lg bg-slate-100 border border-slate-200 text-xs font-extrabold text-slate-700 flex items-center justify-center shrink-0">${escapeHtml(opt.key)}</span>
        <input type="text" value="${escapeHtml(opt.text)}" oninput="updatePoliticsOptionText(${idx}, this.value)" placeholder="输入选项 ${opt.key} 内容..."
          class="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-slate-200 text-sm focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 outline-none" />
        <button type="button" onclick="togglePoliticsDraftAnswer('correct','${opt.key}')"
          class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-bold border shrink-0 ${isCorrect ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'}"
          title="标记为正确答案">✓ 正解</button>
        <button type="button" onclick="togglePoliticsDraftAnswer('wrong','${opt.key}')"
          class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-bold border shrink-0 ${isWrong ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:border-rose-300 hover:text-rose-700'}"
          title="标记为我的错选">✗ 错选</button>
        ${politicsDraftOptions.length > 2
          ? `<button type="button" onclick="removePoliticsOptionRow(${idx})" class="btn-tactile w-7 h-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 shrink-0" title="删除选项">✕</button>`
          : ''}
      </div>`;
  }).join('');
}

function updatePoliticsOptionText(idx, val) {
  if (politicsDraftOptions[idx]) politicsDraftOptions[idx].text = val;
}

function togglePoliticsDraftAnswer(which, key) {
  const qType = document.getElementById('pol-qtype')?.value || 'single';
  const arr = which === 'correct' ? politicsDraftCorrect : politicsDraftWrong;
  let next;
  if (qType === 'single') {
    next = arr.includes(key) ? [] : [key];
  } else {
    next = arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key].sort();
  }
  if (which === 'correct') politicsDraftCorrect = next;
  else politicsDraftWrong = next;
  renderPoliticsOptionRows();
  schedulePoliticsDraftSave();
}

function addPoliticsOptionRow() {
  if (politicsDraftOptions.length >= 6) {
    showToast('最多支持 A~F 共 6 个选项', 'warning');
    return;
  }
  const nextKey = String.fromCharCode(65 + politicsDraftOptions.length);
  politicsDraftOptions.push({ key: nextKey, text: '' });
  renderPoliticsOptionRows();
}

function removePoliticsOptionRow(idx) {
  const oldKeys = politicsDraftOptions.map(o => o.key);
  const removed = politicsDraftOptions.splice(idx, 1)[0];
  const keyMap = {};
  politicsDraftOptions.forEach((o, i) => {
    const newKey = String.fromCharCode(65 + i);
    keyMap[o.key] = newKey;
    o.key = newKey;
  });
  if (removed) {
    politicsDraftCorrect = politicsDraftCorrect
      .filter(k => k !== removed.key && keyMap[k])
      .map(k => keyMap[k])
      .sort();
    politicsDraftWrong = politicsDraftWrong
      .filter(k => k !== removed.key && keyMap[k])
      .map(k => keyMap[k])
      .sort();
  }
  void oldKeys;
  renderPoliticsOptionRows();
}

// ⚡ 智能粘贴拆题解析器（支持苍盾/粉笔/考研帮/网页复制的整段题目文本）
function parsePoliticsSmartPaste() {
  const inputEl = document.getElementById('pol-smart-paste');
  if (!inputEl) return;
  const raw = inputEl.value.replace(/\r\n?/g, '\n').trim();
  if (!raw) {
    showToast('请先粘贴整段政治选择题文本', 'warning');
    return;
  }

  let text = raw;
  let detectedType = /多选题|多项选择/.test(text) ? 'multi' : (/单选题|单项选择/.test(text) ? 'single' : '');

  // 1) 提取答案解析（放在末尾的解析块）
  let detectedAnalysis = '';
  const analysisMatch = text.match(/(?:^|\n)\s*(?:答案解析|解析|考点解析)[：:\s]*([\s\S]+)$/);
  if (analysisMatch) {
    detectedAnalysis = analysisMatch[1].trim();
    text = text.slice(0, analysisMatch.index).trim();
  }

  // 2) 提取你的答案 / 正确答案 / 全站正确率（兼容同行、换行、顿号/逗号分隔如 A、B、C）
  let detectedWrong = [];
  let detectedCorrect = [];
  let detectedAcc = '';

  const wrongMatch = text.match(/(?:你的答案|我的答案|错选)[：:\s]*([A-Fa-f](?:[\s,，、]*[A-Fa-f]){0,5})(?![A-Za-z])/);
  if (wrongMatch) {
    detectedWrong = normalizeAnswerArray(wrongMatch[1]);
    text = text.replace(wrongMatch[0], '');
  }
  const rightMatch = text.match(/(?:正确答案|参考答案|标准答案|(?:^|\n)\s*答案)[：:\s]*([A-Fa-f](?:[\s,，、]*[A-Fa-f]){0,5})(?![A-Za-z])/);
  if (rightMatch) {
    detectedCorrect = normalizeAnswerArray(rightMatch[1]);
    text = text.replace(rightMatch[0], '');
  }
  const accMatch = text.match(/(?:全站)?正确率[：:\s]*(\d+(?:\.\d+)?%)/);
  if (accMatch) {
    detectedAcc = accMatch[1];
    text = text.replace(accMatch[0], '');
  }

  // 清理界面噪声行
  text = text
    .replace(/(?:单选|多选)题?\s*\d+\s*\/\s*\d+/g, '')
    .replace(/^(?:收藏|报错|答题卡|研友笔记|答案解析).*$/gm, '')
    .trim();

  // 3) 拆分选项 A ~ F（支持按行或同行）
  const optRegex = /(?:^|[\n\s])[\(（]?([A-F])[\)）]?[\.、．:：\s]+/g;
  const matches = [];
  let m;
  while ((m = optRegex.exec(text)) !== null) {
    const letter = m[1];
    // 保证顺序合理（首个必须是 A，后续按字母递增，避免误命中题干英文缩写）
    const expectedCode = 65 + matches.length;
    if (letter.charCodeAt(0) === expectedCode) {
      matches.push({ key: letter, index: m.index, contentStart: optRegex.lastIndex });
    }
  }

  let stem = text;
  let parsedOpts = [];
  if (matches.length >= 2) {
    stem = text.slice(0, matches[0].index).trim();
    for (let i = 0; i < matches.length; i++) {
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const optText = text.slice(matches[i].contentStart, end).replace(/\s+/g, ' ').trim();
      parsedOpts.push({ key: matches[i].key, text: optText });
    }
  }

  // 回填表单
  if (detectedCorrect.length > 1) detectedType = 'multi';
  if (detectedType) {
    const qtEl = document.getElementById('pol-qtype');
    if (qtEl) qtEl.value = detectedType;
  }
  if (stem) {
    document.getElementById('pol-stem').value = stem;
    const topicEl = document.getElementById('pol-topic');
    if (topicEl && !topicEl.value.trim()) {
      const cleanFirst = stem.replace(/^\d+[\.、．\s]+/, '').split(/[。？！\n]/)[0].trim();
      topicEl.value = cleanFirst.slice(0, 32);
    }
  }
  if (parsedOpts.length >= 2) {
    politicsDraftOptions = parsedOpts;
  }
  if (detectedCorrect.length) politicsDraftCorrect = detectedCorrect;
  if (detectedWrong.length) politicsDraftWrong = detectedWrong;
  if (detectedAcc) document.getElementById('pol-site-accuracy').value = detectedAcc;
  if (detectedAnalysis && !document.getElementById('pol-analysis').value.trim()) {
    document.getElementById('pol-analysis').value = detectedAnalysis;
    polNoteRefreshPreview();
  }
  renderPoliticsOptionRows();
  schedulePoliticsDraftSave();

  const summary = [
    parsedOpts.length ? `拆出 ${parsedOpts.length} 个选项` : '已填入题干',
    detectedCorrect.length ? `正解 ${detectedCorrect.join('')}` : '',
    detectedWrong.length ? `错选 ${detectedWrong.join('')}` : '',
    detectedAcc ? `正确率 ${detectedAcc}` : ''
  ].filter(Boolean).join(' · ');
  showToast(`智能拆题完成：${summary}`, 'success');
}

// Markdown 解析编辑器辅助
function polNoteSwitchTab(mode) {
  const ta = document.getElementById('pol-analysis');
  const pv = document.getElementById('pol-analysis-preview');
  const toolbar = document.getElementById('pol-note-toolbar');
  const flex = document.getElementById('pol-note-flex');
  const panel = document.getElementById('politicsModalPanel');
  if (!ta || !pv || !toolbar || !flex || !panel) return;
  const m = ['edit', 'split', 'preview'].includes(mode) ? mode : 'edit';
  ta.classList.toggle('hidden', m === 'preview');
  toolbar.classList.toggle('hidden', m === 'preview');
  pv.classList.toggle('hidden', m === 'edit');
  flex.classList.toggle('md-split', m === 'split');
  panel.classList.toggle('md-wide', m === 'split');
  ['edit', 'split', 'preview'].forEach(k => {
    const btn = document.getElementById('pol-note-tab-' + k);
    if (btn) btn.classList.toggle('md-tab-active', k === m);
  });
  if (m !== 'edit') polNoteRefreshPreview();
}

function polNoteLivePreview() {
  clearTimeout(polPreviewTimer);
  polPreviewTimer = setTimeout(polNoteRefreshPreview, 90);
}

function polNoteRefreshPreview() {
  const pv = document.getElementById('pol-analysis-preview');
  const ta = document.getElementById('pol-analysis');
  if (!pv || !ta || pv.classList.contains('hidden')) return;
  pv.innerHTML = renderMarkdown(ta.value) || '<p class="md-p text-slate-400 italic">（暂无解析/笔记，切回「编辑」写下避坑总结…）</p>';
  renderMathIn(pv);
}

function polNoteWrapSel(before, after, placeholder) {
  mdEditorWrapSel(document.getElementById('pol-analysis'), before, after, placeholder, polNoteLivePreview);
}

function polNoteInsert(text) {
  mdEditorInsert(document.getElementById('pol-analysis'), text, polNoteLivePreview);
}

function polNotePrefixLines(prefix, autoNum) {
  mdEditorPrefixLines(document.getElementById('pol-analysis'), prefix, autoNum, polNoteLivePreview);
}

function polNoteKeydown(e) {
  mdEditorHandleKeydown(e, document.getElementById('pol-analysis'), polNoteLivePreview);
}

let politicsModalInitialSnap = '';
let politicsDraftTimer = null;
let politicsDraftListenerBound = false;

function getPoliticsModalSnapshot() {
  return {
    id: document.getElementById('pol-id').value,
    cardKind: politicsDraftKind,
    subject: document.getElementById('pol-subject').value,
    errorReason: document.getElementById('pol-error-reason').value,
    source: document.getElementById('pol-source').value,
    qtype: document.getElementById('pol-qtype').value,
    siteAccuracy: document.getElementById('pol-site-accuracy').value,
    stem: document.getElementById('pol-stem').value,
    options: politicsDraftOptions.map(o => ({ key: o.key, text: o.text })),
    wrong: [...politicsDraftWrong],
    correct: [...politicsDraftCorrect],
    topic: document.getElementById('pol-topic').value,
    status: document.getElementById('pol-status').value,
    forgetCount: document.getElementById('pol-forgetCount').value,
    date: document.getElementById('pol-date').value,
    analysis: document.getElementById('pol-analysis').value,
    imgMode: politicsDraftImage.mode
  };
}

function getPoliticsDraftKey(id) {
  return `pol_${id || 'new'}`;
}

function schedulePoliticsDraftSave() {
  clearTimeout(politicsDraftTimer);
  politicsDraftTimer = setTimeout(() => {
    const modal = document.getElementById('politicsModal');
    if (!modal || !modal.classList.contains('open')) return;
    const snap = getPoliticsModalSnapshot();
    const hasContent = snap.topic.trim() || snap.stem.trim() || snap.analysis.trim() || snap.options.some(o => o.text.trim());
    if (JSON.stringify(snap) !== politicsModalInitialSnap && hasContent) {
      saveEditorDraft(getPoliticsDraftKey(snap.id), snap);
    }
  }, 450);
}

function bindPoliticsDraftAutoSave() {
  if (politicsDraftListenerBound) return;
  const modal = document.getElementById('politicsModal');
  if (!modal) return;
  politicsDraftListenerBound = true;
  modal.addEventListener('input', schedulePoliticsDraftSave);
  modal.addEventListener('change', schedulePoliticsDraftSave);
}

function restorePoliticsDraft() {
  const id = document.getElementById('pol-id').value;
  const draft = loadEditorDraft(getPoliticsDraftKey(id));
  if (!draft || !draft.payload) return;
  const p = draft.payload;
  switchPoliticsModalKind(p.cardKind || 'choice');
  const subSel = document.getElementById('pol-subject');
  if (p.subject && [...subSel.options].some(o => o.value === p.subject)) subSel.value = p.subject;
  const reasonSel = document.getElementById('pol-error-reason');
  if (p.errorReason && [...reasonSel.options].some(o => o.value === p.errorReason)) reasonSel.value = p.errorReason;
  document.getElementById('pol-source').value = p.source || '';
  document.getElementById('pol-qtype').value = p.qtype || 'single';
  document.getElementById('pol-site-accuracy').value = p.siteAccuracy || '';
  document.getElementById('pol-stem').value = p.stem || '';
  if (Array.isArray(p.options) && p.options.length) {
    politicsDraftOptions = p.options.map(o => ({ key: o.key, text: o.text || '' }));
  }
  politicsDraftWrong = Array.isArray(p.wrong) ? [...p.wrong] : [];
  politicsDraftCorrect = Array.isArray(p.correct) ? [...p.correct] : [];
  document.getElementById('pol-topic').value = p.topic || '';
  if (p.status) document.getElementById('pol-status').value = p.status;
  if (p.forgetCount) document.getElementById('pol-forgetCount').value = p.forgetCount;
  if (p.date) document.getElementById('pol-date').value = p.date;
  document.getElementById('pol-analysis').value = p.analysis || '';
  renderPoliticsOptionRows();
  polNoteRefreshPreview();
  const banner = document.getElementById('pol-draft-banner');
  if (banner) banner.classList.add('hidden');
  showToast('已恢复上次未保存的政治卡片草稿', 'success');
}

function dismissPoliticsDraft() {
  const id = document.getElementById('pol-id').value;
  clearEditorDraft(getPoliticsDraftKey(id));
  const banner = document.getElementById('pol-draft-banner');
  if (banner) banner.classList.add('hidden');
}

// 打开新增 / 编辑政治卡片弹窗
function openPoliticsModal(id = '', defaultKind = 'choice') {
  bindPoliticsDraftAutoSave();
  document.getElementById('pol-id').value = id;
  const subSel = document.getElementById('pol-subject');
  subSel.innerHTML = getPoliticsSubjects().map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const reasonSel = document.getElementById('pol-error-reason');
  reasonSel.innerHTML = POLITICS_ERROR_REASONS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

  const smartPasteEl = document.getElementById('pol-smart-paste');
  if (smartPasteEl) smartPasteEl.value = '';
  if (typeof toggleModalEditorFullscreen === 'function') {
    toggleModalEditorFullscreen('politicsModalPanel', 'pol-note-fullscreen-btn', false);
  }
  polNoteSwitchTab('split');

  if (id) {
    const rec = getPoliticsRecords().find(r => r.id === id);
    if (!rec) return;
    document.getElementById('politicsModalTitle').textContent = '✏️ 编辑政治记录';
    switchPoliticsModalKind(rec.cardKind);
    subSel.value = rec.subject;
    document.getElementById('pol-qtype').value = rec.questionType || 'single';
    reasonSel.value = POLITICS_ERROR_REASONS.includes(rec.errorReason) ? rec.errorReason : POLITICS_ERROR_REASONS[0];
    document.getElementById('pol-topic').value = rec.topic || '';
    document.getElementById('pol-stem').value = rec.stem || '';
    document.getElementById('pol-source').value = rec.source || '';
    document.getElementById('pol-site-accuracy').value = rec.siteAccuracy || '';
    document.getElementById('pol-status').value = rec.status || '待解决';
    document.getElementById('pol-forgetCount').value = rec.forgetCount || 1;
    document.getElementById('pol-date').value = slashToIso(rec.dateStr);
    document.getElementById('pol-analysis').value = rec.analysis || '';
    politicsDraftOptions = (rec.options && rec.options.length)
      ? rec.options.map(o => ({ key: o.key, text: o.text }))
      : [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }];
    politicsDraftCorrect = [...(rec.correctAnswer || [])];
    politicsDraftWrong = [...(rec.wrongAnswer || [])];
    politicsDraftImage = { mode: 'keep', existingId: rec.imageId || '', blob: null, previewUrl: '', mime: '', size: 0 };
    document.getElementById('pol-forget-history').innerHTML = forgetHistoryHtml(rec);
    document.getElementById('pol-forget-history-wrap').classList.remove('hidden');
  } else {
    document.getElementById('politicsModalTitle').textContent = '📕 新增政治错题 / 知识点';
    switchPoliticsModalKind(defaultKind);
    subSel.value = getPoliticsSubjects()[0];
    document.getElementById('pol-qtype').value = 'single';
    reasonSel.value = '概念混淆';
    document.getElementById('pol-topic').value = '';
    document.getElementById('pol-stem').value = '';
    document.getElementById('pol-source').value = '';
    document.getElementById('pol-site-accuracy').value = '';
    document.getElementById('pol-status').value = '待解决';
    document.getElementById('pol-forgetCount').value = '1';
    document.getElementById('pol-date').value = todayISO();
    document.getElementById('pol-analysis').value = '';
    politicsDraftOptions = [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' }
    ];
    politicsDraftCorrect = [];
    politicsDraftWrong = [];
    politicsDraftImage = { mode: 'keep', existingId: '', blob: null, previewUrl: '', mime: '', size: 0 };
    document.getElementById('pol-forget-history-wrap').classList.add('hidden');
  }

  renderPoliticsOptionRows();
  renderPoliticsDraftImageBox();
  polNoteRefreshPreview();
  politicsModalInitialSnap = JSON.stringify(getPoliticsModalSnapshot());

  // 检查是否存在上次未保存草稿
  const draft = loadEditorDraft(getPoliticsDraftKey(id));
  const banner = document.getElementById('pol-draft-banner');
  const timeEl = document.getElementById('pol-draft-time');
  if (banner) {
    if (draft && draft.payload && JSON.stringify(draft.payload) !== politicsModalInitialSnap) {
      if (timeEl) timeEl.textContent = formatDateTime(draft.savedAt);
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  document.getElementById('politicsModal').classList.add('open');
  setTimeout(() => {
    const focusEl = politicsDraftKind === 'choice'
      ? document.getElementById('pol-stem')
      : document.getElementById('pol-topic');
    if (focusEl) focusEl.focus();
  }, 100);
}

async function closePoliticsModal(force = false) {
  const modal = document.getElementById('politicsModal');
  if (!modal || !modal.classList.contains('open')) return;
  const curSnap = getPoliticsModalSnapshot();
  if (!force && JSON.stringify(curSnap) !== politicsModalInitialSnap) {
    const ok = await confirmDiscardEdits('政治卡片编辑');
    if (!ok) return;
    clearEditorDraft(getPoliticsDraftKey(curSnap.id));
  }
  clearTimeout(politicsDraftTimer);
  if (typeof toggleModalEditorFullscreen === 'function') {
    toggleModalEditorFullscreen('politicsModalPanel', 'pol-note-fullscreen-btn', false);
  }
  modal.classList.remove('open');
}

async function savePoliticsModal() {
  const id = document.getElementById('pol-id').value;
  const isChoice = politicsDraftKind === 'choice';
  const stem = document.getElementById('pol-stem').value.trim();
  let topic = document.getElementById('pol-topic').value.trim();
  const analysis = document.getElementById('pol-analysis').value.trim();

  if (isChoice) {
    if (!stem && !topic && politicsDraftImage.mode !== 'new' && !politicsDraftImage.existingId) {
      showToast('请至少填写题干、核心考点或粘贴原题截图', 'warning');
      return;
    }
    if (!topic) {
      topic = (stem || '政治选择题错题').replace(/^\d+[\.、．\s]+/, '').split(/[。？！\n]/)[0].trim().slice(0, 32) || '政治选择题错题';
    }
  } else {
    if (!topic) {
      showToast('请填写知识点标题', 'warning');
      return;
    }
  }

  // 处理原题截图持久化（写入 IndexedDB `assets` 与目录 `assets/`，不塞入 JSON）
  let finalImageId = politicsDraftImage.existingId || '';
  if (politicsDraftImage.mode === 'new' && politicsDraftImage.blob) {
    const ext = (politicsDraftImage.mime || '').includes('webp') ? 'webp' : 'jpg';
    const newImgId = `pol-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await idbPutAsset({
      id: newImgId,
      blob: politicsDraftImage.blob,
      mime: politicsDraftImage.mime || 'image/webp',
      size: politicsDraftImage.blob.size,
      createdAt: Date.now()
    });
    if (dirHandle && typeof writeAssetToBoundDir === 'function') {
      await writeAssetToBoundDir(newImgId, politicsDraftImage.blob);
    }
    politicsImageUrlCache[newImgId] = URL.createObjectURL(politicsDraftImage.blob);
    finalImageId = newImgId;
  } else if (politicsDraftImage.mode === 'clear') {
    finalImageId = '';
  }

  const dateSlash = isoToSlash(document.getElementById('pol-date').value || todayISO());
  const forgetCount = Math.max(1, parseInt(document.getElementById('pol-forgetCount').value, 10) || 1);
  let qType = document.getElementById('pol-qtype').value || 'single';
  const cleanCorrect = normalizeAnswerArray(politicsDraftCorrect);
  const cleanWrong = normalizeAnswerArray(politicsDraftWrong);
  if (isChoice && cleanCorrect.length > 1) qType = 'multi';

  const cleanOptions = isChoice
    ? politicsDraftOptions.map((o, idx) => ({
        key: String.fromCharCode(65 + idx),
        text: String(o.text || '').trim()
      }))
    : [];

  const payload = {
    cardKind: politicsDraftKind,
    subject: document.getElementById('pol-subject').value,
    questionType: qType,
    topic,
    stem: isChoice ? stem : '',
    options: cleanOptions,
    wrongAnswer: isChoice ? cleanWrong : [],
    correctAnswer: isChoice ? cleanCorrect : [],
    siteAccuracy: isChoice ? document.getElementById('pol-site-accuracy').value.trim() : '',
    source: document.getElementById('pol-source').value.trim(),
    errorReason: document.getElementById('pol-error-reason').value,
    analysis,
    imageId: finalImageId,
    status: document.getElementById('pol-status').value,
    forgetCount,
    dateStr: dateSlash
  };

  if (id) {
    const rec = getPoliticsRecords().find(r => r.id === id);
    if (rec) {
      Object.assign(rec, payload);
      if (!Array.isArray(rec.forgetEvents)) rec.forgetEvents = [dateStrToTs(dateSlash)];
    }
  } else {
    appData.politics.records.unshift({
      id: genId('pol'),
      ...payload,
      forgetEvents: [dateStrToTs(dateSlash)],
      practiceCount: 0,
      practiceCorrectCount: 0,
      firstDateStr: dateSlash,
      createdAt: Date.now()
    });
  }

  clearEditorDraft(getPoliticsDraftKey(id));
  await closePoliticsModal(true);
  await persistModule('politics', true);
  renderPolitics();
  showToast(id ? '已更新政治记录（已增量保存至 politics.json）' : '已添加新的政治记录（已增量保存至 politics.json）', 'success');
}

// =========================================================================
// 8. FLIP 详情放大查看弹窗
// =========================================================================
function politicsCardClick(e, id) {
  if (e.target.closest('button, select, a, input, textarea, label, option, img, .pol-quiz-masked')) return;
  openPoliticsViewer(id, e.currentTarget);
}

function buildPoliticsViewerHtml(rec) {
  const fc = Number(rec.forgetCount) || 1;
  const isHigh = fc >= 3;
  const fcColor = fc >= 3 ? 'text-rose-600' : (fc === 2 ? 'text-amber-600' : 'text-blue-600');
  const statusIcon = { '待解决': '🔴', '复习中': '🟡', '已掌握': '🟢' }[rec.status] || '';
  const statusStyle = rec.status === '已掌握'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : (rec.status === '复习中' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200');
  const subBadge = POLITICS_SUBJECT_STYLES[rec.subject] || 'bg-rose-50 text-rose-700 border-rose-200';
  const kindLabel = rec.cardKind === 'knowledge' ? '📝 纯知识点' : (rec.questionType === 'multi' ? '☑️ 多选题' : '🔘 单选题');

  return `
    <div class="flex flex-wrap items-center gap-2">
      <span class="px-2.5 py-1 rounded-lg text-xs font-bold border ${subBadge}">${escapeHtml(rec.subject)}</span>
      <span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">${kindLabel}</span>
      ${rec.errorReason ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">${escapeHtml(rec.errorReason)}</span>` : ''}
      ${rec.source ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(rec.source)}</span>` : ''}
      <span class="ml-auto px-3 py-1 rounded-full text-xs font-semibold border ${statusStyle}">${statusIcon} ${escapeHtml(rec.status || '待解决')}</span>
    </div>

    <h2 class="text-xl font-bold text-slate-900 leading-snug tracking-tight break-words">${escapeHtml(rec.topic)}</h2>

    ${rec.cardKind === 'choice' ? `
      <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-3">
        <div class="text-[15px] font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(rec.stem || rec.topic)}</div>
        ${buildChoiceOptionsHtml(rec, true)}
      </div>
    ` : ''}

    ${rec.imageId ? `
      <div>
        <div class="text-xs font-semibold text-slate-500 mb-1.5">原题截图（点击放大全屏查看）</div>
        <img data-pol-img="${escapeHtml(rec.imageId)}" onclick="openPoliticsLightbox('${escapeHtml(rec.imageId)}')" alt="原题截图"
          class="max-h-80 rounded-xl border border-slate-200 shadow-xs cursor-zoom-in bg-slate-50" />
      </div>
    ` : ''}

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-slate-50 to-rose-50/40 border border-slate-200/70 rounded-xl px-4 py-3">
      <div class="flex items-baseline gap-2.5">
        <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">累计遗忘</span>
        <span class="text-2xl font-extrabold ${fcColor} tabular-nums">${fc}</span>
        <span class="text-xs text-slate-400">次</span>
        ${isHigh ? `<span class="ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">高频易忘</span>` : ''}
      </div>
      <div class="ml-auto text-xs text-slate-500">
        最近：<b class="text-slate-700 font-semibold">${escapeHtml(rec.dateStr || '-')}</b>
        <span class="text-slate-300 mx-1">|</span>首次：${escapeHtml(rec.firstDateStr || rec.dateStr || '-')}
      </div>
    </div>

    <div>
      <div class="text-xs font-semibold text-slate-500 mb-2.5">${rec.cardKind === 'choice' ? '答案解析 / 避坑反思（Markdown 渲染）' : '知识点笔记（Markdown 渲染）'}</div>
      <div class="md-body text-sm text-slate-700 bg-slate-50/75 border border-slate-200/75 rounded-2xl px-6 sm:px-8 py-5 sm:py-6 min-h-[12rem]">
        ${rec.analysis ? renderMarkdown(rec.analysis) : '<p class="md-p text-slate-400 italic">（暂无解析笔记，点击下方「编辑此记录」补充...）</p>'}
      </div>
    </div>

    ${forgetTrailHtml(rec)}
  `;
}

function openPoliticsViewer(id, cardEl) {
  if (politicsViewerCtx) return;
  const rec = getPoliticsRecords().find(r => r.id === id);
  if (!rec) return;

  const backdrop = document.getElementById('politicsViewerModal');
  const panel = document.getElementById('politicsViewerPanel');
  const body = document.getElementById('politicsViewerBody');
  body.innerHTML = buildPoliticsViewerHtml(rec);
  renderMathIn(body);
  hydratePoliticsImages(body);

  document.getElementById('politicsViewerEditBtn').onclick = () => {
    closePoliticsViewer(true);
    openPoliticsModal(id);
  };
  document.getElementById('politicsViewerForgetBtn').onclick = async () => {
    await incrementPoliticsForget(id);
    const updated = getPoliticsRecords().find(r => r.id === id);
    if (updated) {
      body.innerHTML = buildPoliticsViewerHtml(updated);
      renderMathIn(body);
      hydratePoliticsImages(body);
    }
  };

  const useFlip = Boolean(cardEl && cardEl.classList && cardEl.classList.contains('k-card'));
  politicsViewerCtx = { id, backdrop, panel, useFlip, closing: false };

  backdrop.style.transition = 'none';
  backdrop.style.opacity = '0';
  backdrop.classList.add('open');
  backdrop.getBoundingClientRect();
  backdrop.style.transition = '';

  const target = panel.getBoundingClientRect();
  if (useFlip) {
    panel.style.transformOrigin = 'top left';
    const cr = cardEl.getBoundingClientRect();
    const sx = Math.max(cr.width, 80) / Math.max(target.width, 1);
    panel.style.transform = `translate(${cr.left - target.left}px, ${cr.top - target.top}px) scale(${sx})`;
  } else {
    panel.style.transformOrigin = 'center center';
    panel.style.transform = 'scale(0.94)';
  }
  panel.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.style.opacity = '';
    panel.style.transition = 'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease';
    panel.style.transform = 'translate(0, 0) scale(1)';
    panel.style.opacity = '1';
  }));
}

function closePoliticsViewer(skipAnim = false) {
  if (!politicsViewerCtx || politicsViewerCtx.closing) return;
  const { id, backdrop, panel, useFlip } = politicsViewerCtx;
  politicsViewerCtx.closing = true;
  if (skipAnim) {
    backdrop.classList.remove('open');
    panel.style.cssText = '';
    politicsViewerCtx = null;
    return;
  }
  const cardEl = useFlip ? document.querySelector(`article.k-card[data-pol-id="${id}"]`) : null;
  const cr = cardEl ? cardEl.getBoundingClientRect() : null;
  if (cr && cr.width) {
    const target = panel.getBoundingClientRect();
    const sx = Math.max(cr.width, 80) / Math.max(target.width, 1);
    panel.style.transformOrigin = 'top left';
    panel.style.transition = 'transform 0.34s cubic-bezier(0.55, 0, 0.55, 0.2), opacity 0.28s ease';
    panel.style.transform = `translate(${cr.left - target.left}px, ${cr.top - target.top}px) scale(${sx})`;
  } else {
    panel.style.transformOrigin = 'center center';
    panel.style.transition = 'transform 0.24s ease, opacity 0.22s ease';
    panel.style.transform = 'scale(0.95)';
  }
  panel.style.opacity = '0';
  backdrop.style.opacity = '0';
  setTimeout(() => {
    backdrop.classList.remove('open');
    panel.style.cssText = '';
    backdrop.style.opacity = '';
    politicsViewerCtx = null;
  }, cr && cr.width ? 360 : 250);
}
