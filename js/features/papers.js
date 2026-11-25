// 套卷模块
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 8.5 套卷模块（408 / 数学：小题大题分数 + 错误题一键加入遗忘点）
// =========================================================================
// 卡片上最多直接显示的错误题条数，其余在详情弹窗中查看
const PAPER_CARD_MAX_ERRORS = 2;

function paperTotal(p) {
  return (p.smallScore || 0) + (p.bigScore || 0);
}


// 根据现有套卷的分类动态填充“系列”筛选下拉框
function populatePaperCatFilter() {
  const sel = document.getElementById('filter-paper-cat');
  const prev = sel.value;
  const cats = [...new Set(appData.papers.map(p => p.category).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">全部系列</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cats.includes(prev)) sel.value = prev;
}


// 渲染套卷页顶部四个统计卡片
function renderPaperStats() {
  const list = appData.papers;
  const mathCount = list.filter(p => p.mod === 'math').length;
  const csCount = list.filter(p => p.mod === '408').length;
  const errTotal = list.reduce((a, p) => a + (p.errors ? p.errors.length : 0), 0);
  const cards = [
    { label: '总套卷数', value: list.length, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: '📝' },
    { label: '数学套卷', value: mathCount, color: 'text-blue-600', bg: 'bg-blue-50', icon: '📐' },
    { label: '408 套卷', value: csCount, color: 'text-violet-600', bg: 'bg-violet-50', icon: '💻' },
    { label: '错误题总数', value: errTotal, color: 'text-rose-600', bg: 'bg-rose-50', icon: '❌' }
  ];
  document.getElementById('stats-paper').innerHTML = cards.map((c, i) => `
    <div class="stat-card bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm flex items-center justify-between" style="--stagger:${i}">
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">${c.label}</div>
        <div class="text-2xl sm:text-3xl font-extrabold ${c.color} tracking-tight">${c.value}</div>
      </div>
      <div class="w-11 h-11 rounded-2xl ${c.bg} flex items-center justify-center text-xl">${c.icon}</div>
    </div>
  `).join('');
}



// 按科目/分类/关键词筛选并排序套卷
function getFilteredPapers() {
  const modVal = document.getElementById('filter-paper-mod').value;
  const catVal = document.getElementById('filter-paper-cat').value;
  const sortVal = document.getElementById('sort-paper').value;
  const kw = document.getElementById('search-paper').value.trim().toLowerCase();

  let list = [...appData.papers];
  if (modVal) list = list.filter(p => p.mod === modVal);
  if (catVal) list = list.filter(p => p.category === catVal);
  if (kw) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(kw) ||
      (p.category || '').toLowerCase().includes(kw) ||
      (p.series || '').toLowerCase().includes(kw) ||
      (p.note || '').toLowerCase().includes(kw) ||
      (p.errors || []).some(e => (e.point || '').toLowerCase().includes(kw) || (e.qno || '').toLowerCase().includes(kw))
    );
  }
  list.sort((a, b) => {
    if (sortVal === 'scoreDesc') return paperTotal(b) - paperTotal(a) || slashToIso(b.dateStr).localeCompare(slashToIso(a.dateStr));
    if (sortVal === 'scoreAsc') return paperTotal(a) - paperTotal(b) || slashToIso(b.dateStr).localeCompare(slashToIso(a.dateStr));
    return slashToIso(b.dateStr).localeCompare(slashToIso(a.dateStr)) || (b.createdAt || 0) - (a.createdAt || 0);
  });
  return list;
}


// 生成单张套卷卡片的 HTML（分数/用时/错误题列表）
function paperCardHtml(p, idx) {
  const modBadge = p.mod === 'math'
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-violet-50 text-violet-700 border-violet-100';
  const modLabel = p.mod === 'math' ? '📐 数学' : '💻 408';
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const hasScore = p.smallScore !== null || p.bigScore !== null;
  const total = hasScore ? paperTotal(p) : '—';
  const time = p.timeUsed === null ? '—' : `${p.timeUsed}′`;
  const errors = p.errors || [];

  const scoreCell = (label, val, cls) => `
    <div class="bg-slate-50/80 border border-slate-200/70 rounded-xl px-2 py-2.5 text-center">
      <div class="text-[11px] text-slate-500 mb-0.5">${label}</div>
      <div class="text-lg font-extrabold ${cls} tabular-nums leading-none">${val}</div>
    </div>`;

  const shown = errors.slice(0, PAPER_CARD_MAX_ERRORS);
  const hidden = errors.length - shown.length;
  const errorsHtml = errors.length
    ? `<div class="space-y-1.5 min-h-0 overflow-hidden">${shown.map(e => paperErrorRowHtml(p, e, true)).join('')}</div>`
    : `<div class="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 text-center">
         <div class="text-2xl leading-none mb-1">🎉</div>
         <div class="text-sm font-semibold text-emerald-700">全对，没有错误题</div>
         <div class="text-[11px] text-slate-400 mt-0.5">有遗漏可点 ✏️ 补充</div>
       </div>`;

  // 统一固定高度：备注 1 行、错误题最多 PAPER_CARD_MAX_ERRORS 条，完整内容点击卡片查看详情
  return `
    <article onclick="openPaperDetail('${p.id}')" title="点击查看详情"
      class="group cursor-pointer select-none h-[410px] overflow-hidden bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md hover:border-blue-200 transition p-5 flex flex-col gap-3" style="--stagger:${idx}">
      ${paperHeaderHtml(p, modBadge, modLabel)}

      <h3 class="text-[19px] font-bold text-slate-900 leading-[1.4] tracking-tight truncate shrink-0" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>

      <div class="grid grid-cols-4 gap-2 shrink-0">
        ${scoreCell('小题', fmt(p.smallScore), 'text-slate-800')}
        ${scoreCell('大题', fmt(p.bigScore), 'text-slate-800')}
        ${scoreCell('总分', total, 'text-emerald-600')}
        ${scoreCell('用时', time, 'text-blue-600')}
      </div>

      ${p.note ? `<div class="shrink-0 bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-2.5 text-sm text-slate-700 truncate">💬 ${escapeHtml(p.note.replace(/\s*\n\s*/g, ' '))}</div>` : ''}

      <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div class="text-xs font-semibold text-slate-500 mb-1.5 shrink-0">错误题（${errors.length}）</div>
        ${errorsHtml}
      </div>

      <div class="shrink-0 flex items-center justify-between text-xs pt-2 border-t border-slate-100">
        <span class="text-slate-400">${hidden > 0 ? `还有 ${hidden} 道错误题未显示` : ''}</span>
        <span class="font-semibold text-blue-600 group-hover:translate-x-0.5 transition">查看详情 →</span>
      </div>
    </article>`;
}


// 卡片 / 详情中单行错误题（compact = 卡片内单行省略）
function paperErrorRowHtml(p, e, compact) {
  return `
    <div class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/70 bg-slate-50/60">
      <span class="shrink-0 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-xs font-bold text-slate-700">${e.qno ? '题 ' + escapeHtml(e.qno) : '—'}</span>
      ${e.sub ? `<span class="shrink-0 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[11px] font-medium">${escapeHtml(e.sub)}</span>` : ''}
      <span class="flex-1 min-w-0 text-sm text-slate-700 ${compact ? 'truncate' : 'break-words'}">${e.point ? escapeHtml(e.point) : '<span class="text-slate-400 italic">未填写错误点</span>'}</span>
      ${e.addedToTracker
        ? '<span class="shrink-0 text-xs font-semibold text-emerald-600">✓ 已加入</span>'
        : `<button onclick="event.stopPropagation(); pushErrorToTracker('${p.id}','${e.id}')" class="shrink-0 btn-tactile px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-xs">＋ 遗忘点</button>`}
    </div>`;
}


// 卡片顶部：科目/分类/系列/日期 + 编辑删除按钮
function paperHeaderHtml(p, modBadge, modLabel) {
  return `
      <div class="flex items-start justify-between gap-2 shrink-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="px-2.5 py-1 rounded-lg text-xs font-semibold border ${modBadge}">${modLabel}</span>
          ${p.category ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(p.category)}</span>` : ''}
          ${p.series ? `<span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-100">📚 ${escapeHtml(p.series)}</span>` : ''}
          <span class="text-xs text-slate-400">📅 ${escapeHtml(p.dateStr)}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="event.stopPropagation(); openPaperModal('${p.id}')" title="编辑" class="btn-tactile w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-blue-600">✏️</button>
          <button onclick="event.stopPropagation(); deletePaper('${p.id}')" title="删除" class="btn-tactile w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600">🗑️</button>
        </div>
      </div>`;
}


// 套卷详情弹窗：展示完整备注与全部错误题
let currentPaperDetailId = '';
function openPaperDetail(id) {
  const p = appData.papers.find(x => x.id === id);
  if (!p) return;
  currentPaperDetailId = id;
  const modBadge = p.mod === 'math'
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-violet-50 text-violet-700 border-violet-100';
  const modLabel = p.mod === 'math' ? '📐 数学' : '💻 408';
  const fmt = v => (v === null || v === undefined) ? '—' : v;
  const hasScore = p.smallScore !== null || p.bigScore !== null;
  const total = hasScore ? paperTotal(p) : '—';
  const time = p.timeUsed === null ? '—' : `${p.timeUsed}′`;
  const errors = p.errors || [];
  const cell = (label, val, cls) => `
    <div class="bg-slate-50/80 border border-slate-200/70 rounded-xl px-2 py-3 text-center">
      <div class="text-xs text-slate-500 mb-1">${label}</div>
      <div class="text-xl font-extrabold ${cls} tabular-nums leading-none">${val}</div>
    </div>`;

  document.getElementById('paperDetailTitle').textContent = p.name || '套卷详情';
  document.getElementById('paperDetailBody').innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <span class="px-2.5 py-1 rounded-lg text-xs font-semibold border ${modBadge}">${modLabel}</span>
      ${p.category ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(p.category)}</span>` : ''}
      ${p.series ? `<span class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-100">📚 ${escapeHtml(p.series)}</span>` : ''}
      <span class="text-xs text-slate-400">📅 ${escapeHtml(p.dateStr)}</span>
    </div>
    <div class="grid grid-cols-4 gap-2">
      ${cell('小题', fmt(p.smallScore), 'text-slate-800')}
      ${cell('大题', fmt(p.bigScore), 'text-slate-800')}
      ${cell('总分', total, 'text-emerald-600')}
      ${cell('用时', time, 'text-blue-600')}
    </div>
    <div>
      <div class="text-xs font-semibold text-slate-500 mb-1.5">总结 / 反思</div>
      ${p.note
        ? `<div class="bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(p.note)}</div>`
        : '<div class="text-xs text-slate-400 italic px-1">暂无总结</div>'}
    </div>
    <div>
      <div class="text-xs font-semibold text-slate-500 mb-1.5">错误题（${errors.length}）</div>
      <div class="space-y-1.5">${errors.length
        ? errors.map(e => paperErrorRowHtml(p, e, false)).join('')
        : '<div class="text-xs text-slate-400 italic px-1">暂无错误题</div>'}</div>
    </div>`;
  document.getElementById('paperDetailModal').classList.add('open');
}


function closePaperDetail() {
  currentPaperDetailId = '';
  document.getElementById('paperDetailModal').classList.remove('open');
}


// 详情弹窗中点击“编辑”
function editPaperFromDetail() {
  const id = currentPaperDetailId;
  closePaperDetail();
  if (id) openPaperModal(id);
}


// 渲染套卷页：统计卡 + 筛选后的套卷列表（平均分图表已移到「统计」页）
function renderPapers() {
  populatePaperCatFilter();
  renderPaperStats();
  const list = getFilteredPapers();
  const container = document.getElementById('papers-container');
  if (!list.length) {
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/80 rounded-2xl p-14 text-center shadow-sm">
        <div class="text-4xl mb-3">📭</div>
        <div class="text-slate-600 font-semibold mb-1">暂无套卷记录</div>
        <div class="text-xs text-slate-400">点击右上角“新增套卷”，记录小题/大题分数与错误题</div>
      </div>`;
    return;
  }
  container.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">${list.map((p, idx) => paperCardHtml(p, idx)).join('')}</div>`;
}


// 打开“新增/编辑套卷”弹窗
function openPaperModal(id = '') {
  document.getElementById('paper-id').value = id;
  populateSeriesPresets(); // 系列候选：预设 + 已用过的
  const modSel = document.getElementById('paper-mod');
  if (id) {
    const p = appData.papers.find(x => x.id === id);
    if (!p) return;
    document.getElementById('paperModalTitle').textContent = '✏️ 编辑套卷';
    modSel.value = p.mod;
    document.getElementById('paper-name').value = p.name || '';
    document.getElementById('paper-category').value = p.category || '';
    document.getElementById('paper-small').value = p.smallScore === null ? '' : p.smallScore;
    document.getElementById('paper-big').value = p.bigScore === null ? '' : p.bigScore;
    document.getElementById('paper-time').value = p.timeUsed === null ? '' : p.timeUsed;
    document.getElementById('paper-date').value = slashToIso(p.dateStr);
    document.getElementById('paper-note').value = p.note || '';
    document.getElementById('paper-series').value = p.series || '';
    paperDraftErrors = (p.errors || []).map(e => ({ ...e }));
  } else {
    document.getElementById('paperModalTitle').textContent = '📝 新增套卷';
    modSel.value = '408';
    document.getElementById('paper-name').value = '';
    document.getElementById('paper-category').value = '';
    document.getElementById('paper-small').value = '';
    document.getElementById('paper-big').value = '';
    document.getElementById('paper-time').value = '';
    document.getElementById('paper-date').value = todayISO();
    document.getElementById('paper-note').value = '';
    document.getElementById('paper-series').value = '';
    paperDraftErrors = [];
  }
  renderPaperErrorRows();
  updatePaperSeriesVisibility(); // 按科目+分类决定是否显示系列输入
  document.getElementById('paperModal').classList.add('open');
  setTimeout(() => document.getElementById('paper-name').focus(), 100);
}


// 关闭套卷编辑弹窗
function closePaperModal() {
  document.getElementById('paperModal').classList.remove('open');
}


// 套卷科目切换时的联动处理
function onPaperModChange() {
  renderPaperErrorRows();
  updatePaperSeriesVisibility();
}


// 「系列/组别」输入框显隐：只有「数学 + 模拟卷」才显示（408 只分真题/模拟；真题无系列）
function updatePaperSeriesVisibility() {
  const mod = document.getElementById('paper-mod').value;
  const cat = document.getElementById('paper-category').value;
  const show = mod === 'math' && cat === '模拟卷';
  const wrap = document.getElementById('paper-series-wrap');
  wrap.classList.toggle('hidden', !show);
  if (!show) document.getElementById('paper-series').value = '';
}


// 填充系列候选：常用预设 + 已记录过的系列（手输的新系列保存后会自动出现在这里）
function populateSeriesPresets() {
  const defaults = ['张八', '张四', '李六', '李四', '永乐', '超越', '共创'];
  const used = appData.papers
    .filter(p => p.mod === 'math' && p.category === '模拟卷')
    .map(p => (p.series || '').trim())
    .filter(Boolean);
  const all = [...new Set([...defaults, ...used])];
  document.getElementById('paper-series-presets').innerHTML =
    all.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
}


// 渲染套卷弹窗内的错误题编辑行
function renderPaperErrorRows() {
  const mod = document.getElementById('paper-mod').value;
  const subjects = appData[mod].subjects;
  const container = document.getElementById('paper-errors-container');
  if (!paperDraftErrors.length) {
    container.innerHTML = '<div class="text-xs text-slate-400 italic px-1 py-2">暂无错误题，点击右上角“添加错误题”记录题号与错误点</div>';
    return;
  }
  container.innerHTML = paperDraftErrors.map(e => {
    const opts = '<option value="">未分科目</option>' +
      subjects.map(s => `<option value="${escapeHtml(s)}" ${e.sub === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
    return `
      <div class="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60">
        <input type="text" value="${escapeHtml(e.qno)}" oninput="updatePaperDraft('${e.id}','qno',this.value)" placeholder="题号"
          class="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:border-blue-500 outline-none" />
        <select onchange="updatePaperDraft('${e.id}','sub',this.value)" class="px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:border-blue-500 outline-none">${opts}</select>
        <input type="text" value="${escapeHtml(e.point)}" oninput="updatePaperDraft('${e.id}','point',this.value)" placeholder="错误点 / 知识点"
          class="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:border-blue-500 outline-none" />
        ${e.addedToTracker ? '<span class="text-xs font-semibold text-emerald-600 shrink-0">✓ 已加入</span>' : ''}
        <button onclick="removePaperErrorRow('${e.id}')" class="btn-tactile shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600">✕</button>
      </div>`;
  }).join('');
}


// 在套卷弹窗中新增一行错误题输入
function addPaperErrorRow() {
  paperDraftErrors.push({ id: genId('err'), qno: '', point: '', sub: '', addedToTracker: false });
  renderPaperErrorRows();
}


// 删除套卷弹窗中的一行错误题
function removePaperErrorRow(id) {
  paperDraftErrors = paperDraftErrors.filter(e => e.id !== id);
  renderPaperErrorRows();
}


// 更新套卷弹窗草稿中某个字段的值
function updatePaperDraft(id, field, val) {
  const e = paperDraftErrors.find(x => x.id === id);
  if (e) e[field] = val;
}


// 保存套卷弹窗的表单（含错误题）到数据
async function savePaperModal() {
  const id = document.getElementById('paper-id').value;
  const name = document.getElementById('paper-name').value.trim();
  if (!name) {
    showToast('请填写套卷名称', 'warning');
    return;
  }
  const numOrNull = v => {
    const t = String(v).trim();
    if (t === '') return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };
  const data = {
    mod: document.getElementById('paper-mod').value,
    name,
    category: document.getElementById('paper-category').value.trim(),
    // 系列只在「数学 + 模拟卷」下有效，其余清空（408 只分真题/模拟）
    series: (document.getElementById('paper-mod').value === 'math'
      && document.getElementById('paper-category').value.trim() === '模拟卷')
      ? document.getElementById('paper-series').value.trim() : '',
    smallScore: numOrNull(document.getElementById('paper-small').value),
    bigScore: numOrNull(document.getElementById('paper-big').value),
    timeUsed: numOrNull(document.getElementById('paper-time').value),
    dateStr: isoToSlash(document.getElementById('paper-date').value || todayISO()),
    note: document.getElementById('paper-note').value.trim(),
    errors: paperDraftErrors
      .filter(e => (e.qno || '').trim() || (e.point || '').trim())
      .map(e => ({ id: e.id, qno: (e.qno || '').trim(), point: (e.point || '').trim(), sub: e.sub || '', addedToTracker: Boolean(e.addedToTracker) }))
  };
  if (id) {
    const p = appData.papers.find(x => x.id === id);
    if (p) Object.assign(p, data);
  } else {
    appData.papers.unshift({ id: genId('paper'), ...data, createdAt: Date.now() });
  }
  closePaperModal();
  await persistData(true);
  renderPapers();
  updateTabCounts();
  showToast(id ? '已更新套卷' : '已添加套卷', 'success');
}


// 删除一套卷记录
async function deletePaper(id) {
  const p = appData.papers.find(x => x.id === id);
  if (!p) return;
  const ok = await showConfirm({
    title: '删除套卷',
    message: `确定要删除「${p.name}」吗？其错误题记录会一并删除（已加入遗忘点的记录不受影响）。删除前会自动留存历史快照。`,
    okText: '确认删除',
    danger: true
  });
  if (!ok) return;
  await createSnapshot('删除套卷前备份');
  appData.papers = appData.papers.filter(x => x.id !== id);
  await persistData(true);
  renderPapers();
  updateTabCounts();
  showToast('已删除套卷（可通过历史快照恢复）', 'info');
}


// 将套卷中的某道错误题一键加入薄弱点遗忘追踪
async function pushErrorToTracker(paperId, errId) {
  const paper = appData.papers.find(p => p.id === paperId);
  if (!paper) return;
  const err = (paper.errors || []).find(e => e.id === errId);
  if (!err || err.addedToTracker) return;
  const mod = paper.mod;
  const dateSlash = isoToSlash(todayISO());
  const subject = err.sub || appData[mod].subjects[0];
  const topic = err.point || `第 ${err.qno || '?'} 题`;
  appData[mod].records.unshift({
    id: genId(mod),
    subject,
    topic,
    type: '知识缺失',
    source: paper.category || '',
    status: '待解决',
    note: `来自套卷「${paper.name}」${err.qno ? '第 ' + err.qno + ' 题' : ''}`.trim(),
    forgetCount: 1,
    forgetEvents: [dateStrToTs(dateSlash)],
    firstDateStr: dateSlash,
    dateStr: dateSlash,
    createdAt: Date.now()
  });
  err.addedToTracker = true;
  await persistData(true);
  renderRecords(mod);
  renderPapers();
  if (currentPaperDetailId === paperId) openPaperDetail(paperId);
  updateTabCounts();
  showToast(`已将「${topic}」加入${mod === 'math' ? '数学' : '408'}遗忘点`, 'success');
}
