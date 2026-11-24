// 备注编辑器与卡片放大查看
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// ---------- 备注编辑器辅助（工具栏 / Tab / 快捷键 / 实时预览） ----------
    // 备注编辑器三态切换：编辑/分屏/预览；分屏时平滑加宽弹窗并实时渲染
function recNoteSwitchTab(mode) {
  const ta = document.getElementById('rec-note');
  const pv = document.getElementById('rec-note-preview');
  const toolbar = document.getElementById('rec-note-toolbar');
  const flex = document.getElementById('rec-note-flex');
  const panel = document.getElementById('recordModalPanel');
  const m = ['edit', 'split', 'preview'].includes(mode) ? mode : 'edit';
  const showTa = m !== 'preview';
  const showPv = m !== 'edit';
  ta.classList.toggle('hidden', !showTa);
  toolbar.classList.toggle('hidden', m === 'preview');
  pv.classList.toggle('hidden', !showPv);
  flex.classList.toggle('md-split', m === 'split');
  panel.classList.toggle('md-wide', m === 'split'); // 分屏时平滑加宽弹窗
  ['edit', 'split', 'preview'].forEach(k =>
    document.getElementById('rec-note-tab-' + k).classList.toggle('md-tab-active', k === m));
  if (showPv) recNoteRefreshPreview();
}

// 输入防抖后实时刷新预览
let recPreviewTimer = null;
    // 输入框 oninput 防抖（90ms）触发预览刷新，避免逐字渲染卡顿
function recNoteLivePreview() {
  clearTimeout(recPreviewTimer);
  recPreviewTimer = setTimeout(recNoteRefreshPreview, 90);
}


// 把当前备注文本实时渲染进预览窗格（含公式）
function recNoteRefreshPreview() {
  const pv = document.getElementById('rec-note-preview');
  if (pv.classList.contains('hidden')) return;
  pv.innerHTML = renderMarkdown(document.getElementById('rec-note').value) ||
    '<p class="md-p text-slate-400 italic">（暂无内容，切回「编辑」写下你的思考…）</p>';
  renderMathIn(pv);
}

// ---------- 卡片放大查看（FLIP：从卡片位置平滑放大到弹窗） ----------
let viewerCtx = null; // { mod, id, backdrop, panel, closing }

// 卡片点击：跳过内部的按钮 / 下拉 / 链接等交互元素
    // 卡片点击入口：点击卡片空白放大查看，自动跳过按钮/下拉等交互元素
function cardClick(e, mod, id) {
  if (e.target.closest('button, select, a, input, textarea, label, option')) return;
  openRecordViewer(mod, id, e.currentTarget);
}


// 构建放大查看弹窗的内容 HTML（徽章/标题/统计/Markdown 备注/遗忘轨迹）
function buildViewerHtml(mod, rec) {
  const fc = Number(rec.forgetCount) || 1;
  const isHigh = fc >= 3;
  const fcColor = fc >= 3 ? 'text-rose-600' : (fc === 2 ? 'text-amber-600' : 'text-blue-600');
  const statusIcon = { '待解决': '🔴', '复习中': '🟡', '已掌握': '🟢' }[rec.status] || '';
  const statusStyle = rec.status === '已掌握'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : (rec.status === '复习中' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200');
  const subjectBadge = mod === 'math'
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-violet-50 text-violet-700 border-violet-100';
  return `
    <div class="flex flex-wrap items-center gap-2">
      <span class="px-2.5 py-1 rounded-lg text-xs font-semibold border ${subjectBadge}">${escapeHtml(rec.subject)}</span>
      <span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">${escapeHtml(rec.type || '未分类')}</span>
      ${rec.source ? `<span class="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50/70 text-indigo-600">📌 ${escapeHtml(rec.source)}</span>` : ''}
      <span class="ml-auto px-3 py-1 rounded-full text-xs font-semibold border ${statusStyle}">${statusIcon} ${escapeHtml(rec.status || '待解决')}</span>
    </div>
    <h2 class="text-2xl font-bold text-slate-900 leading-snug tracking-tight break-words">${escapeHtml(rec.topic)}</h2>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-slate-50 to-blue-50/40 border border-slate-200/70 rounded-xl px-4 py-3">
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
      <div class="text-xs font-semibold text-slate-500 mb-2">备注 / 反思（Markdown 渲染）</div>
      <div class="md-body text-sm text-slate-700 bg-slate-50/90 border border-slate-200/70 rounded-xl px-4 py-3.5 min-h-[6rem]">
        ${rec.note ? renderMarkdown(rec.note) : '<p class="md-p text-slate-400 italic">（暂无备注，点击下方「编辑此记录」补充...）</p>'}
      </div>
    </div>
    ${forgetTrailHtml(rec)}
  `;
}


// 检测卡片/紧凑表格备注是否超出默认预览高度，控制渐变遮罩与「点击查看详情」提示
function markNoteOverflows(root = document) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.k-card-note, .tbl-note-preview').forEach(el => {
    if (!el.clientHeight) return;
    el.classList.toggle('is-overflow', el.scrollHeight > el.clientHeight + 1);
  });
}

let noteOverflowResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(noteOverflowResizeTimer);
  noteOverflowResizeTimer = setTimeout(() => markNoteOverflows(document), 120);
});

// 打开放大查看弹窗，大卡片使用 FLIP 从卡片位置平滑放大，表格行使用居中缩放淡入
function openRecordViewer(mod, id, cardEl) {
  if (viewerCtx) return;
  const rec = appData[mod].records.find(r => r.id === id);
  if (!rec) return;
  const backdrop = document.getElementById('viewerModal');
  const panel = document.getElementById('viewerPanel');
  document.getElementById('viewerBody').innerHTML = buildViewerHtml(mod, rec);
  renderMathIn(document.getElementById('viewerBody'));
  document.getElementById('viewerEditBtn').onclick = () => {
    closeRecordViewer(true);
    openRecordModal(mod, id);
  };
  const useFlip = Boolean(cardEl && cardEl.classList && cardEl.classList.contains('k-card'));
  viewerCtx = { mod, id, backdrop, panel, useFlip, closing: false };

  // 背景淡入（display:none → flex 需手动触发过渡）
  backdrop.style.transition = 'none';
  backdrop.style.opacity = '0';
  backdrop.classList.add('open');
  backdrop.getBoundingClientRect(); // 强制回流
  backdrop.style.transition = '';

  // FLIP：大卡片先摆到卡片位置再过渡回中央；表格行居中微缩淡入
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


// 关闭放大查看弹窗，带反向缩回卡片（或居中淡出）的动画；skipAnim 用于立即切换
function closeRecordViewer(skipAnim = false) {
  if (!viewerCtx || viewerCtx.closing) return;
  const { id, backdrop, panel, useFlip } = viewerCtx;
  viewerCtx.closing = true;
  if (skipAnim) {
    backdrop.classList.remove('open');
    panel.style.cssText = '';
    viewerCtx = null;
    return;
  }
  const cardEl = useFlip ? document.querySelector(`article.k-card[data-rid="${id}"]`) : null;
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
    viewerCtx = null;
  }, cr && cr.width ? 360 : 250);
}

// ESC 关闭放大查看
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && viewerCtx && !viewerCtx.closing) closeRecordViewer();
});

// 用 before/after 包裹选区（无选区时插入 placeholder）
function recNoteWrapSel(before, after, placeholder) {
  const ta = document.getElementById('rec-note');
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || placeholder || '';
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
}

// 在光标处插入文本
function recNoteInsert(text) {
  const ta = document.getElementById('rec-note');
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + text.length;
}

// 给选区内每行加前缀（标题 / 列表 / 引用）；autoNum=true 时生成 1. 2. 3.
function recNotePrefixLines(prefix, autoNum) {
  const ta = document.getElementById('rec-note');
  const s = ta.selectionStart, e = ta.selectionEnd;
  const v = ta.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e);
  if (le === -1) le = v.length;
  const lines = v.slice(ls, le).split('\n');
  const patched = lines.map((ln, idx) => {
    const p = autoNum ? `${idx + 1}. ` : prefix;
    const stripped = autoNum ? ln.replace(/^\s*\d+[.)]\s+/, '') : ln;
    return stripped.startsWith(p) ? stripped : p + stripped;
  });
  const block = patched.join('\n');
  ta.value = v.slice(0, ls) + block + v.slice(le);
  ta.focus();
  ta.selectionStart = ls;
  ta.selectionEnd = ls + block.length;
}

// 备注编辑区快捷键：Ctrl+B 加粗 / Ctrl+I 斜体 / Tab 缩进
function recNoteKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    recNoteWrapSel('**', '**', '加粗文字');
  } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault();
    recNoteWrapSel('*', '*', '斜体文字');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    recNoteInsert('  ');
  }
}
