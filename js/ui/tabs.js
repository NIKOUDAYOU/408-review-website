// 标签页与视图模式切换
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 6. 标签页切换与视图模式切换
// =========================================================================
// 切换七大标签页（数学/408/政治/待办/套卷/英语阅读/统计），同步按钮高亮与视图显示
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    const countEl = btn.querySelector('.tab-count'); // 「统计」页没有数量徽章
    btn.classList.toggle('active', active);
    if (active) {
      const activeBg = tab === 'politics'
        ? ['bg-rose-600', 'text-white', 'shadow-sm', 'shadow-rose-500/25']
        : ['bg-blue-600', 'text-white', 'shadow-sm', 'shadow-blue-500/25'];
      btn.classList.remove('bg-blue-600', 'shadow-blue-500/25', 'bg-rose-600', 'shadow-rose-500/25', 'text-slate-600', 'hover:bg-slate-100');
      btn.classList.add(...activeBg);
      if (countEl) countEl.className = 'tab-count px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white';
    } else {
      btn.classList.remove('bg-blue-600', 'bg-rose-600', 'text-white', 'shadow-sm', 'shadow-blue-500/25', 'shadow-rose-500/25');
      btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      if (countEl) countEl.className = 'tab-count px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600';
    }
  });

  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${tab}`);
  });

  // 英语阅读三栏布局需要更宽的主容器，让中间阅读器区域更大
  const mainEl = document.querySelector('main');
  if (mainEl) {
    mainEl.classList.toggle('max-w-[1680px]', tab === 'reading');
    mainEl.classList.toggle('max-w-[1380px]', tab !== 'reading');
  }

  // 进入统计页时重绘图表（数据可能刚变过）
  if (tab === 'stat') renderScoreChart();
  if (tab !== 'reading' && typeof hideReadingToolbar === 'function') hideReadingToolbar();
  // 切换到数学/408/政治页时，容器刚从 display:none 变为可见，重新计算备注溢出遮罩
  if ((tab === 'math' || tab === '408' || tab === 'politics') && typeof markNoteOverflows === 'function') {
    const sec = document.getElementById(`view-${tab}`);
    if (sec) markNoteOverflows(sec);
  }
}


// 切换记录视图模式（大卡片/紧凑表格）并持久化偏好
function setViewMode(mod, mode) {
  viewModes[mod] = mode;
  savePrefs();
  updateViewModeButtons(mod);
  if (mod === 'politics') {
    if (typeof renderPolitics === 'function') renderPolitics();
  } else {
    renderRecords(mod);
  }
}


// 同步“卡片/表格”视图切换按钮的选中态样式
function updateViewModeButtons(mod) {
  const cardBtn = document.getElementById(`viewBtn-${mod}-card`);
  const tableBtn = document.getElementById(`viewBtn-${mod}-table`);
  if (!cardBtn || !tableBtn) return;
  const isCard = viewModes[mod] === 'card';
  const activeColor = mod === 'politics' ? 'text-rose-600' : 'text-blue-600';
  cardBtn.className = `btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isCard ? `bg-white ${activeColor} shadow-xs` : 'text-slate-500 hover:text-slate-800'}`;
  tableBtn.className = `btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isCard ? `bg-white ${activeColor} shadow-xs` : 'text-slate-500 hover:text-slate-800'}`;
}


// 刷新各标签页上的记录数量徽章
function updateTabCounts() {
  const elMath = document.getElementById('tabCount-math');
  const el408 = document.getElementById('tabCount-408');
  const elPol = document.getElementById('tabCount-politics');
  const elTodo = document.getElementById('tabCount-todo');
  const elPaper = document.getElementById('tabCount-paper');
  const elRead = document.getElementById('tabCount-reading');

  if (elMath) elMath.textContent = appData.math.records.length;
  if (el408) el408.textContent = appData['408'].records.length;
  if (elPol) elPol.textContent = (appData.politics && Array.isArray(appData.politics.records)) ? appData.politics.records.length : 0;
  if (elTodo) elTodo.textContent = appData.todos.filter(t => !t.completed).length;
  if (elPaper) elPaper.textContent = appData.papers.length;
  if (elRead) elRead.textContent = (typeof readingStore !== 'undefined' && Array.isArray(readingStore)) ? readingStore.length : 0;
}
