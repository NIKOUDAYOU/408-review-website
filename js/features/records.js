// 薄弱点模块
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 7. 薄弱点模块（大卡片视图 + 紧凑表格视图）
// =========================================================================
function populateSubjectFilter(mod) {
  const sel = document.getElementById(`filter-subject-${mod}`);
  const prev = sel.value;
  sel.innerHTML = '<option value="">全部科目</option>' +
    appData[mod].subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (appData[mod].subjects.includes(prev)) sel.value = prev;
}


// 渲染数学/408 页顶部四个统计卡片（总数/未掌握/遗忘次数/高频遗忘）
function renderStats(mod) {
  const list = appData[mod].records;
  const total = list.length;
  const pending = list.filter(r => r.status !== '已掌握').length;
  const totalForgets = list.reduce((acc, r) => acc + (Number(r.forgetCount) || 1), 0);
  const highFreq = list.filter(r => (Number(r.forgetCount) || 1) >= 3).length;

  const cards = [
    { label: '总记录数', value: total, color: 'text-blue-600', bg: 'bg-blue-50', icon: '📚' },
    { label: '未掌握（待解决/复习中）', value: pending, color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
    { label: '累计遗忘次数', value: totalForgets, color: 'text-slate-800', bg: 'bg-slate-100', icon: '🧠' },
    { label: '高频遗忘（≥3次）', value: highFreq, color: 'text-rose-600', bg: 'bg-rose-50', icon: '🔥' }
  ];

  document.getElementById(`stats-${mod}`).innerHTML = cards.map((c, i) => `
    <div class="stat-card bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm flex items-center justify-between" style="--stagger:${i}">
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">${c.label}</div>
        <div class="text-2xl sm:text-3xl font-extrabold ${c.color} tracking-tight">${c.value}</div>
      </div>
      <div class="w-11 h-11 rounded-2xl ${c.bg} flex items-center justify-center text-xl">${c.icon}</div>
    </div>
  `).join('');
}


// 按科目/状态/关键词筛选并排序记录，返回当前页数据源
function getFilteredRecords(mod) {
  const subjectVal = document.getElementById(`filter-subject-${mod}`).value;
  const statusVal = document.getElementById(`filter-status-${mod}`).value;
  const sortVal = document.getElementById(`sort-${mod}`).value;
  const kw = document.getElementById(`search-${mod}`).value.trim().toLowerCase();

  let list = [...appData[mod].records];
  if (subjectVal) list = list.filter(r => r.subject === subjectVal);
  if (statusVal) list = list.filter(r => r.status === statusVal);
  if (kw) {
    list = list.filter(r =>
      (r.topic || '').toLowerCase().includes(kw) ||
      (r.source || '').toLowerCase().includes(kw) ||
      (r.note || '').toLowerCase().includes(kw) ||
      (r.subject || '').toLowerCase().includes(kw)
    );
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
    return slashToIso(b.firstDateStr || b.dateStr).localeCompare(slashToIso(a.firstDateStr || a.dateStr));
  });
  return list;
}


// 渲染数学/408 记录区：统计卡 + 卡片或表格视图 + 分页
function renderRecords(mod, popRecordId = null) {
  renderStats(mod);
  updateViewModeButtons(mod);
  const list = getFilteredRecords(mod);
  const container = document.getElementById(`records-container-${mod}`);
  const pagEl = document.getElementById(`pagination-${mod}`);

  if (!list.length) {
    pagEl.innerHTML = '';
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/80 rounded-2xl p-14 text-center shadow-sm">
        <div class="text-4xl mb-3">📭</div>
        <div class="text-slate-600 font-semibold mb-1">暂无匹配的薄弱点记录</div>
        <div class="text-xs text-slate-400">可以点击右上角“新增薄弱点”记录今天卡壳的题目或概念</div>
      </div>`;
    return;
  }

  // 分页：仅渲染当前页，统计仍基于全量数据
  const ps = pageState[mod];
  const totalPages = Math.max(1, Math.ceil(list.length / ps.size));
  ps.page = Math.min(Math.max(1, ps.page), totalPages);
  const start = (ps.page - 1) * ps.size;
  const pageList = list.slice(start, start + ps.size);
  renderPaginationBar(mod, list.length, totalPages, pagEl);

  if (viewModes[mod] === 'card') {
    // ========== 大卡片视图 ==========
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

      const subjectBadge = mod === 'math'
        ? 'bg-blue-50 text-blue-700 border-blue-100'
        : 'bg-violet-50 text-violet-700 border-violet-100';

      const popClass = popRecordId === r.id ? 'animate-pop' : '';

      return `
        <article class="k-card ${accentClass} cursor-pointer flex flex-col gap-3.5" data-mod="${mod}" data-rid="${r.id}" onclick="cardClick(event,'${mod}','${r.id}')" style="--stagger:${idx}" title="点击卡片查看完整详情">
          <!-- Top Row: 科目 / 错误类型 / 来源 / 状态选择器 -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2.5 py-1 rounded-lg text-xs font-semibold border ${subjectBadge}">${escapeHtml(r.subject)}</span>
              <span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">${escapeHtml(r.type || '未分类')}</span>
              ${r.source ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(r.source)}</span>` : ''}
            </div>
            <select onchange="changeRecordStatus('${mod}','${r.id}',this.value)"
              class="px-3 py-1 rounded-full text-xs font-semibold border cursor-pointer outline-none transition-colors ${statusStyle}">
              <option value="待解决" ${r.status === '待解决' ? 'selected' : ''}>🔴 待解决</option>
              <option value="复习中" ${r.status === '复习中' ? 'selected' : ''}>🟡 复习中</option>
              <option value="已掌握" ${r.status === '已掌握' ? 'selected' : ''}>🟢 已掌握</option>
            </select>
          </div>

          <!-- Main Title（最多显示两行，点击卡片查看完整标题与详情） -->
          <h3 class="k-card-title text-[19px] font-bold text-slate-900 leading-[1.4] tracking-tight break-words">
            ${escapeHtml(r.topic)}
          </h3>

          <!-- Note / Reflection Box（固定默认高度预览，超出部分渐变收起，点击查看详情） -->
          <div class="k-card-note bg-slate-50/90 border border-slate-200/70 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
            ${r.note
              ? `<div class="md-body text-slate-700">${renderMarkdown(r.note)}</div><span class="k-card-more">🔍 点击查看详情</span>`
              : `<div class="text-slate-400 italic cursor-pointer hover:text-blue-600 transition-colors" onclick="event.stopPropagation();openRecordModal('${mod}','${r.id}')">暂无反思备注，点击编辑补充...</div>`
            }
          </div>

          <!-- Bottom Stack: 遗忘计数 + 遗忘轨迹 + 操作栏固定贴底 -->
          <div class="mt-auto flex flex-col gap-3">
            <!-- Prominent Forget Counter Section -->
            <div class="flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-blue-50/40 border border-slate-200/70 rounded-xl px-4 py-3">
              <div class="flex items-baseline gap-2.5">
                <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">累计遗忘</span>
                <span class="text-2xl font-extrabold ${fcColor} ${popClass} inline-block tabular-nums">${fc}</span>
                <span class="text-xs text-slate-400">次</span>
                ${isHigh ? `<span class="ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">高频易忘</span>` : ''}
              </div>
              <button onclick="incrementForget('${mod}','${r.id}')"
                class="btn-tactile inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-white text-rose-600 border border-rose-200 hover:bg-rose-600 hover:text-white hover:border-rose-600 shadow-xs">
                <span>⚡ +1 遗忘</span>
              </button>
            </div>

            ${forgetTrailHtml(r)}

            <!-- Bottom Footer: Dates + Action Buttons -->
            <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                <span>最近：<b class="text-slate-700 font-semibold">${escapeHtml(r.dateStr || '-')}</b></span>
                <span class="text-slate-300">|</span>
                <span>首次：${escapeHtml(r.firstDateStr || r.dateStr || '-')}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <button onclick="pushRecordToTodo('${mod}','${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100">📅 加入待办</button>
                <button onclick="openRecordModal('${mod}','${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">✏️ 编辑</button>
                <button onclick="deleteRecord('${mod}','${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg font-medium bg-rose-50 text-rose-600 hover:bg-rose-100">🗑️ 删除</button>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('')}</div>`;
  } else {
    // ========== 紧凑表格视图 ==========
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-slate-50/90 text-slate-500 text-xs font-semibold border-b border-slate-200">
                <th class="py-3.5 px-4 whitespace-nowrap">科目</th>
                <th class="py-3.5 px-4 whitespace-nowrap">知识点 / 题目</th>
                <th class="py-3.5 px-4 whitespace-nowrap">错误类型</th>
                <th class="py-3.5 px-4 whitespace-nowrap">来源</th>
                <th class="py-3.5 px-4 whitespace-nowrap">状态</th>
                <th class="py-3.5 px-4 whitespace-nowrap">遗忘次数</th>
                <th class="py-3.5 px-4 whitespace-nowrap">日期（最近 / 首次）</th>
                <th class="py-3.5 px-4 whitespace-nowrap">备注</th>
                <th class="py-3.5 px-4 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${pageList.map(r => {
                const fc = Number(r.forgetCount) || 1;
                const fcColor = fc >= 3 ? 'text-rose-600' : (fc === 2 ? 'text-amber-600' : 'text-blue-600');
                const statusStyle = r.status === '已掌握'
                  ? 'bg-emerald-50 text-emerald-700'
                  : (r.status === '复习中' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700');
                const popClass = popRecordId === r.id ? 'animate-pop' : '';
                return `
                  <tr class="hover:bg-blue-50/30 transition-colors cursor-pointer" data-mod="${mod}" data-rid="${r.id}" onclick="cardClick(event,'${mod}','${r.id}')" title="点击行查看完整详情">
                    <td class="py-3 px-4 whitespace-nowrap"><span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">${escapeHtml(r.subject)}</span></td>
                    <td class="py-3 px-4 font-semibold text-slate-800 max-w-[260px]"><div class="tbl-topic break-words">${escapeHtml(r.topic)}</div></td>
                    <td class="py-3 px-4 whitespace-nowrap"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">${escapeHtml(r.type || '未分类')}</span></td>
                    <td class="py-3 px-4 text-slate-600 whitespace-nowrap">${escapeHtml(r.source || '-')}</td>
                    <td class="py-3 px-4 whitespace-nowrap">
                      <select onchange="changeRecordStatus('${mod}','${r.id}',this.value)" class="px-2.5 py-1 rounded-full text-xs font-semibold border-0 cursor-pointer ${statusStyle}">
                        <option value="待解决" ${r.status === '待解决' ? 'selected' : ''}>待解决</option>
                        <option value="复习中" ${r.status === '复习中' ? 'selected' : ''}>复习中</option>
                        <option value="已掌握" ${r.status === '已掌握' ? 'selected' : ''}>已掌握</option>
                      </select>
                    </td>
                    <td class="py-3 px-4 whitespace-nowrap">
                      <div class="flex items-center gap-2">
                        <span class="font-extrabold text-base ${fcColor} ${popClass} inline-block min-w-[20px] text-center">${fc}</span>
                        <button onclick="incrementForget('${mod}','${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white">+1 遗忘</button>
                      </div>
                    </td>
                    <td class="py-3 px-4 whitespace-nowrap text-xs">
                      <div class="font-medium text-slate-700">${escapeHtml(r.dateStr || '-')}</div>
                      <div class="text-slate-400">首次: ${escapeHtml(r.firstDateStr || r.dateStr || '-')}</div>
                    </td>
                    <td class="py-3 px-4 text-xs text-slate-500 max-w-[260px] break-words">${r.note ? `<div class="tbl-note-preview"><div class="md-body md-compact">${renderMarkdown(r.note)}</div><span class="tbl-note-more">详情 ›</span></div>` : '-'}</td>
                    <td class="py-3 px-4 whitespace-nowrap">
                      <div class="flex items-center gap-1.5">
                        <button onclick="pushRecordToTodo('${mod}','${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-blue-50 text-blue-700 hover:bg-blue-100">📅 待办</button>
                        <button onclick="openRecordModal('${mod}','${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-slate-100 text-slate-700 hover:bg-slate-200">编辑</button>
                        <button onclick="deleteRecord('${mod}','${r.id}')" class="btn-tactile px-2 py-1 rounded-lg text-xs bg-rose-50 text-rose-600 hover:bg-rose-100">删除</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  // 渲染卡片/表格内的数学公式并标记超长预览
  renderMathIn(container);
  markNoteOverflows(container);
}


// 遗忘次数 +1，记录本次遗忘时间到 forgetEvents 并重渲染
async function incrementForget(mod, id) {
  const rec = appData[mod].records.find(r => r.id === id);
  if (!rec) return;
  rec.forgetCount = (Number(rec.forgetCount) || 1) + 1;
  rec.dateStr = isoToSlash(todayISO());
  if (!Array.isArray(rec.forgetEvents)) rec.forgetEvents = [];
  rec.forgetEvents.push(Date.now());
  if (rec.status === '已掌握') rec.status = '复习中';
  await persistModule(mod, true);
  renderRecords(mod, id);
  showToast(`「${rec.topic}」遗忘次数 +1（当前 ${rec.forgetCount} 次）`, 'info');
}


// 修改记录状态（待解决/复习中/已掌握）
async function changeRecordStatus(mod, id, newStatus) {
  const rec = appData[mod].records.find(r => r.id === id);
  if (!rec) return;
  rec.status = newStatus;
  await persistModule(mod, true);
  renderRecords(mod);
}


// 删除一条薄弱点记录（删除前自动建快照，可找回）
async function deleteRecord(mod, id) {
  const rec = appData[mod].records.find(r => r.id === id);
  if (!rec) return;
  const ok = await showConfirm({
    title: '删除薄弱点记录',
    message: `确定要删除「${rec.topic}」吗？删除前系统会自动在历史快照中留存备份。`,
    okText: '确认删除',
    danger: true
  });
  if (!ok) return;

  await createSnapshot(`删除薄弱点前备份`);
  appData[mod].records = appData[mod].records.filter(r => r.id !== id);
  await persistModule(mod, true);
  renderRecords(mod);
  showToast('已删除记录（可通过历史快照恢复）', 'info');
}


// 把一条薄弱点记录推送到每日待办
async function pushRecordToTodo(mod, id) {
  const rec = appData[mod].records.find(r => r.id === id);
  if (!rec) return;
  const cat = mod === 'math' ? '数学' : '408';
  appData.todos.push({
    id: genId('todo'),
    dateStr: todayISO(),
    title: `复习【${rec.subject}】${rec.topic}`,
    category: cat,
    priority: (rec.forgetCount || 1) >= 3 ? '高' : '中',
    completed: false,
    note: rec.note || `来源：${rec.source || '薄弱点追踪'}`,
    createdAt: Date.now()
  });
  await persistModule('todos', true);
  renderTodos();
  showToast(`已将「${rec.topic}」加入今日待办`, 'success');
}


let recordModalInitialSnap = '';
let recordDraftTimer = null;
let recordDraftListenerBound = false;

function getRecordModalSnapshot() {
  return {
    mod: document.getElementById('rec-module').value,
    id: document.getElementById('rec-id').value,
    subject: document.getElementById('rec-subject').value,
    type: document.getElementById('rec-type').value,
    topic: document.getElementById('rec-topic').value,
    source: document.getElementById('rec-source').value,
    status: document.getElementById('rec-status').value,
    forgetCount: document.getElementById('rec-forgetCount').value,
    date: document.getElementById('rec-date').value,
    note: document.getElementById('rec-note').value
  };
}

function getRecordDraftKey(mod, id) {
  return `rec_${mod || 'math'}_${id || 'new'}`;
}

function scheduleRecordDraftSave() {
  clearTimeout(recordDraftTimer);
  recordDraftTimer = setTimeout(() => {
    const modal = document.getElementById('recordModal');
    if (!modal || !modal.classList.contains('open')) return;
    const snap = getRecordModalSnapshot();
    const key = getRecordDraftKey(snap.mod, snap.id);
    if (JSON.stringify(snap) !== recordModalInitialSnap && (snap.topic.trim() || snap.note.trim())) {
      saveEditorDraft(key, snap);
    }
  }, 450);
}

function bindRecordDraftAutoSave() {
  if (recordDraftListenerBound) return;
  const modal = document.getElementById('recordModal');
  if (!modal) return;
  recordDraftListenerBound = true;
  modal.addEventListener('input', scheduleRecordDraftSave);
  modal.addEventListener('change', scheduleRecordDraftSave);
}

function restoreRecordDraft() {
  const mod = document.getElementById('rec-module').value;
  const id = document.getElementById('rec-id').value;
  const draft = loadEditorDraft(getRecordDraftKey(mod, id));
  if (!draft || !draft.payload) return;
  const p = draft.payload;
  const subSel = document.getElementById('rec-subject');
  if (p.subject && [...subSel.options].some(o => o.value === p.subject)) subSel.value = p.subject;
  if (p.type) document.getElementById('rec-type').value = p.type;
  document.getElementById('rec-topic').value = p.topic || '';
  document.getElementById('rec-source').value = p.source || '';
  if (p.status) document.getElementById('rec-status').value = p.status;
  if (p.forgetCount) document.getElementById('rec-forgetCount').value = p.forgetCount;
  if (p.date) document.getElementById('rec-date').value = p.date;
  document.getElementById('rec-note').value = p.note || '';
  if (typeof recNoteRefreshPreview === 'function') recNoteRefreshPreview();
  const banner = document.getElementById('rec-draft-banner');
  if (banner) banner.classList.add('hidden');
  showToast('已恢复上次未保存的草稿', 'success');
}

function dismissRecordDraft() {
  const mod = document.getElementById('rec-module').value;
  const id = document.getElementById('rec-id').value;
  clearEditorDraft(getRecordDraftKey(mod, id));
  const banner = document.getElementById('rec-draft-banner');
  if (banner) banner.classList.add('hidden');
}

// 打开“新增/编辑薄弱点”弹窗并回填字段
function openRecordModal(mod, id = '') {
  bindRecordDraftAutoSave();
  document.getElementById('rec-module').value = mod;
  document.getElementById('rec-id').value = id;
  if (typeof toggleModalEditorFullscreen === 'function') {
    toggleModalEditorFullscreen('recordModalPanel', 'rec-note-fullscreen-btn', false);
  }
  recNoteSwitchTab('split'); // 每次打开备注编辑器都回到「分屏实时渲染」

  const subSel = document.getElementById('rec-subject');
  subSel.innerHTML = appData[mod].subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  if (id) {
    const rec = appData[mod].records.find(r => r.id === id);
    document.getElementById('recordModalTitle').textContent = '✏️ 编辑薄弱点';
    subSel.value = rec.subject;
    document.getElementById('rec-type').value = rec.type || '知识缺失';
    document.getElementById('rec-topic').value = rec.topic || '';
    document.getElementById('rec-source').value = rec.source || '';
    document.getElementById('rec-status').value = rec.status || '待解决';
    document.getElementById('rec-forgetCount').value = rec.forgetCount || 1;
    document.getElementById('rec-date').value = slashToIso(rec.dateStr);
    document.getElementById('rec-note').value = rec.note || '';
    document.getElementById('rec-forget-history').innerHTML = forgetHistoryHtml(rec);
    document.getElementById('rec-forget-history-wrap').classList.remove('hidden');
  } else {
    document.getElementById('recordModalTitle').textContent = mod === 'math' ? '📐 新增考研数学薄弱点' : '💻 新增408薄弱点';
    document.getElementById('rec-type').value = '知识缺失';
    document.getElementById('rec-topic').value = '';
    document.getElementById('rec-source').value = '';
    document.getElementById('rec-status').value = '待解决';
    document.getElementById('rec-forgetCount').value = '1';
    document.getElementById('rec-date').value = todayISO();
    document.getElementById('rec-note').value = '';
    document.getElementById('rec-forget-history-wrap').classList.add('hidden');
  }
  recordModalInitialSnap = JSON.stringify(getRecordModalSnapshot());

  // 检查是否存在上次未保存草稿
  const draft = loadEditorDraft(getRecordDraftKey(mod, id));
  const banner = document.getElementById('rec-draft-banner');
  const timeEl = document.getElementById('rec-draft-time');
  if (banner) {
    if (draft && draft.payload && JSON.stringify(draft.payload) !== recordModalInitialSnap) {
      if (timeEl) timeEl.textContent = formatDateTime(draft.savedAt);
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  document.getElementById('recordModal').classList.add('open');
  setTimeout(() => document.getElementById('rec-topic').focus(), 100);
}


// 关闭薄弱点编辑弹窗（有未保存改动时二次确认，防误丢）
async function closeRecordModal(force = false) {
  const modal = document.getElementById('recordModal');
  if (!modal || !modal.classList.contains('open')) return;
  const curSnap = getRecordModalSnapshot();
  if (!force && JSON.stringify(curSnap) !== recordModalInitialSnap) {
    const ok = await confirmDiscardEdits('薄弱点编辑');
    if (!ok) return;
    clearEditorDraft(getRecordDraftKey(curSnap.mod, curSnap.id));
  }
  clearTimeout(recordDraftTimer);
  if (typeof toggleModalEditorFullscreen === 'function') {
    toggleModalEditorFullscreen('recordModalPanel', 'rec-note-fullscreen-btn', false);
  }
  modal.classList.remove('open');
}


// 保存薄弱点编辑弹窗的表单数据（新增或更新）
async function saveRecordModal() {
  const mod = document.getElementById('rec-module').value;
  const id = document.getElementById('rec-id').value;
  const topic = document.getElementById('rec-topic').value.trim();
  if (!topic) {
    showToast('请填写知识点或题目名称', 'warning');
    return;
  }

  const dateSlash = isoToSlash(document.getElementById('rec-date').value || todayISO());
  const forgetCount = Math.max(1, parseInt(document.getElementById('rec-forgetCount').value, 10) || 1);

  if (id) {
    const rec = appData[mod].records.find(r => r.id === id);
    if (rec) {
      rec.subject = document.getElementById('rec-subject').value;
      rec.type = document.getElementById('rec-type').value;
      rec.topic = topic;
      rec.source = document.getElementById('rec-source').value.trim();
      rec.status = document.getElementById('rec-status').value;
      rec.forgetCount = forgetCount;
      rec.dateStr = dateSlash;
      rec.note = document.getElementById('rec-note').value.trim();
      if (!Array.isArray(rec.forgetEvents)) rec.forgetEvents = [];
    }
  } else {
    appData[mod].records.unshift({
      id: genId(mod),
      subject: document.getElementById('rec-subject').value,
      topic,
      type: document.getElementById('rec-type').value,
      source: document.getElementById('rec-source').value.trim(),
      status: document.getElementById('rec-status').value,
      note: document.getElementById('rec-note').value.trim(),
      forgetCount,
      forgetEvents: [dateStrToTs(dateSlash)],
      firstDateStr: dateSlash,
      dateStr: dateSlash,
      createdAt: Date.now()
    });
  }

  clearEditorDraft(getRecordDraftKey(mod, id));
  await closeRecordModal(true);
  await persistModule(mod, true);
  renderRecords(mod);
  showToast(id ? '已更新薄弱点记录' : '已添加新的薄弱点', 'success');
}
