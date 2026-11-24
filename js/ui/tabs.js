// 标签页与视图模式切换
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 6. 标签页切换与视图模式切换
// =========================================================================
    // 切换四大标签页（数学/408/待办/套卷），同步按钮高亮与视图显示
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    const countEl = btn.querySelector('.tab-count'); // 「统计」页没有数量徽章
    btn.classList.toggle('active', active);
    if (active) {
      btn.classList.add('bg-blue-600', 'text-white', 'shadow-sm', 'shadow-blue-500/25');
      btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      if (countEl) countEl.className = 'tab-count px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white';
    } else {
      btn.classList.remove('bg-blue-600', 'text-white', 'shadow-sm', 'shadow-blue-500/25');
      btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      if (countEl) countEl.className = 'tab-count px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600';
    }
  });

  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${tab}`);
  });

  // 进入统计页时重绘图表（数据可能刚变过）
  if (tab === 'stat') renderScoreChart();
  // 切换到数学/408 页时，容器刚从 display:none 变为可见，重新计算备注溢出遮罩
  if ((tab === 'math' || tab === '408') && typeof markNoteOverflows === 'function') {
    const sec = document.getElementById(`view-${tab}`);
    if (sec) markNoteOverflows(sec);
  }
}


// 切换记录视图模式（大卡片/紧凑表格）并持久化偏好
function setViewMode(mod, mode) {
  viewModes[mod] = mode;
  savePrefs();
  updateViewModeButtons(mod);
  renderRecords(mod);
}


// 同步“卡片/表格”视图切换按钮的选中态样式
function updateViewModeButtons(mod) {
  const cardBtn = document.getElementById(`viewBtn-${mod}-card`);
  const tableBtn = document.getElementById(`viewBtn-${mod}-table`);
  if (!cardBtn || !tableBtn) return;
  const isCard = viewModes[mod] === 'card';
  cardBtn.className = `btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isCard ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`;
  tableBtn.className = `btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isCard ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`;
}


// 刷新四个标签页上的记录数量徽章
function updateTabCounts() {
  document.getElementById('tabCount-math').textContent = appData.math.records.length;
  document.getElementById('tabCount-408').textContent = appData['408'].records.length;
  document.getElementById('tabCount-todo').textContent = appData.todos.filter(t => !t.completed).length;
  document.getElementById('tabCount-paper').textContent = appData.papers.length;
}
