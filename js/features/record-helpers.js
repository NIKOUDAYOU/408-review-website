// 分页辅助、遗忘事件时间戳与记录/套卷迁移
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 3.5 分页辅助 & 遗忘事件时间戳
// =========================================================================
function onRecordFilterChange(mod) {
  pageState[mod].page = 1;
  renderRecords(mod);
}


// 跳转到指定页并重渲染当前科目记录
function gotoPage(mod, p) {
  pageState[mod].page = Math.max(1, p);
  renderRecords(mod);
}


// 切换每页条数，重置到第一页后重渲染
function changePageSize(mod, size) {
  pageState[mod].size = parseInt(size, 10) || 20;
  pageState[mod].page = 1;
  savePrefs();
  renderRecords(mod);
}


// 渲染分页控件（上一页/页码/下一页 + 总数信息）
function renderPaginationBar(mod, total, totalPages, el) {
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const ps = pageState[mod];
  const sizeOpts = [20, 50, 100].map(s => `<option value="${s}" ${ps.size === s ? 'selected' : ''}>${s}</option>`).join('');
  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 bg-white/95 backdrop-blur border border-slate-200/90 rounded-2xl shadow-sm px-4 py-3">
      <div class="flex items-center gap-2 text-sm text-slate-600">
        <span>每页</span>
        <select onchange="changePageSize('${mod}', this.value)" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 text-sm focus:border-blue-500 outline-none">${sizeOpts}</select>
        <span>条 · 共 <b class="text-slate-800">${total}</b> 条</span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="gotoPage('${mod}', ${ps.page - 1})" ${ps.page <= 1 ? 'disabled' : ''} class="btn-tactile px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">← 上一页</button>
        <span class="text-sm font-semibold text-slate-700 tabular-nums">第 ${ps.page} / ${totalPages} 页</span>
        <button onclick="gotoPage('${mod}', ${ps.page + 1})" ${ps.page >= totalPages ? 'disabled' : ''} class="btn-tactile px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页 →</button>
      </div>
    </div>`;
}

// "2026/11/21" -> 当天正午的毫秒时间戳（避免时区/夏令时边界问题）
function dateStrToTs(str) {
  const [y, m, d] = slashToIso(str).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

// 兼容旧数据：为缺少 forgetEvents 的记录补种首/末两次已知日期（不伪造中间时间）
function migrateRecord(r) {
  const rec = { ...r };
  if (!Array.isArray(rec.forgetEvents)) {
    const events = [];
    const firstTs = dateStrToTs(rec.firstDateStr || rec.dateStr);
    events.push(firstTs);
    const lastTs = dateStrToTs(rec.dateStr || rec.firstDateStr);
    if ((Number(rec.forgetCount) || 1) > 1 && lastTs !== firstTs) events.push(lastTs);
    rec.forgetEvents = events;
  }
  return rec;
}

// 套卷数据规范化：兼容缺字段 / 旧数据，分数空值统一为 null
function migratePaper(p) {
  const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  const paper = { ...p };
  paper.id = paper.id || genId('paper');
  paper.mod = paper.mod === 'math' ? 'math' : '408';
  paper.name = paper.name || '';
  const rawCat = (paper.category || '').trim();
  paper.category = rawCat.includes('真题') ? '真题' : (rawCat ? '模拟卷' : '');
  // 系列（张八/李六…）：只有数学模拟卷才有意义，旧数据补空字符串
  paper.series = typeof paper.series === 'string' ? paper.series.trim() : '';
  if (paper.mod !== 'math' || paper.category !== '模拟卷') paper.series = '';
  paper.smallScore = numOrNull(paper.smallScore);
  paper.bigScore = numOrNull(paper.bigScore);
  paper.timeUsed = numOrNull(paper.timeUsed);
  paper.dateStr = isoToSlash(slashToIso(paper.dateStr || todayISO()));
  paper.note = paper.note || '';
  paper.errors = (Array.isArray(paper.errors) ? paper.errors : []).map(e => ({
    id: e.id || genId('err'),
    qno: e.qno || '',
    point: e.point || '',
    sub: e.sub || '',
    addedToTracker: Boolean(e.addedToTracker)
  }));
  paper.createdAt = paper.createdAt || Date.now();
  return paper;
}

// 卡片上的紧凑遗忘轨迹（最近至多 5 次 + 间隔天数）
function forgetTrailHtml(rec) {
  const ev = Array.isArray(rec.forgetEvents) ? rec.forgetEvents.slice().sort((a, b) => a - b) : [];
  if (!ev.length) return '';
  const count = Number(rec.forgetCount) || 1;
  const fmt = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const shown = ev.length > 5 ? ev.slice(-5) : ev;
  const prefix = ev.length > 5 ? `<span class="text-slate-400 mr-1">…前${ev.length - 5}次</span>` : '';
  const parts = [];
  shown.forEach((ts, i) => {
    if (i > 0) {
      const gap = Math.round((ts - shown[i - 1]) / 86400000);
      parts.push(`<span class="text-slate-300 mx-1">→</span><span class="text-[10px] text-slate-400">${gap}天</span><span class="text-slate-300 mx-1">→</span>`);
    }
    parts.push(`<span class="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">${fmt(ts)}</span>`);
  });
  const untracked = count - ev.length;
  const note = untracked > 0 ? `<span class="text-[10px] text-slate-400 ml-1.5">另${untracked}次早期未记时</span>` : '';
  return `<div class="k-trail flex flex-wrap items-center gap-y-1 text-[11px] mt-2.5"><span class="text-slate-400 font-semibold mr-1.5 shrink-0">遗忘轨迹</span>${prefix}${parts.join('')}${note}</div>`;
}

// 编辑弹窗里的完整遗忘历史
function forgetHistoryHtml(rec) {
  const ev = Array.isArray(rec.forgetEvents) ? rec.forgetEvents.slice().sort((a, b) => a - b) : [];
  const count = Number(rec.forgetCount) || 1;
  if (!ev.length) return '<div class="text-slate-400 italic">暂无精确时间记录</div>';
  const p = n => String(n).padStart(2, '0');
  const fmt = ts => { const d = new Date(ts); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  let html = ev.map((ts, i) => {
    const gap = i > 0 ? ` <span class="text-slate-400">（距上次 ${Math.round((ts - ev[i - 1]) / 86400000)} 天）</span>` : ' <span class="text-slate-400">（首次）</span>';
    return `<div>第 ${i + 1} 次 · ${fmt(ts)}${gap}</div>`;
  }).join('');
  if (count > ev.length) html += `<div class="text-slate-400 italic mt-1">另有 ${count - ev.length} 次早期遗忘未记录精确时间</div>`;
  return html;
}
