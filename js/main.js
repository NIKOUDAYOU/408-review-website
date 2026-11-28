// 全量渲染、快捷键、倒计时与启动入口
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享


// 全量重渲染：所有标签页的记录/统计/图表一次刷新
function renderAll() {
  populateSubjectFilter('math');
  populateSubjectFilter('408');
  if (typeof populatePoliticsSubjectFilter === 'function') populatePoliticsSubjectFilter();
  renderRecords('math');
  renderRecords('408');
  if (typeof renderPolitics === 'function') renderPolitics();
  renderTodos();
  renderPapers();
  renderScoreChart(); // 统计页图表
  renderReadings();   // 英语阅读总结
  updateTabCounts();
}

// =========================================================================
// 9. 快捷键 (Ctrl+S / Cmd+S) 与离开提醒
// =========================================================================
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    manualSave();
  }
  // 在英语阅读标签页（且焦点不在输入框/文本域、且未打开弹窗）支持 Ctrl+Z / Ctrl+Y 撤回与重做分段
  if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target && e.target.tagName) || '') && !document.querySelector('.modal-backdrop.open')) {
    const readingSec = document.getElementById('view-reading');
    if (readingSec && readingSec.classList.contains('active')) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey && typeof undoReadingText === 'function') {
        e.preventDefault();
        undoReadingText();
      } else if ((e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && typeof redoReadingText === 'function') {
        e.preventDefault();
        redoReadingText();
      }
    }
  }
  if (e.key === 'Escape') {
    // 1. 优先关闭确认弹窗与图片全屏灯箱
    const cm = document.getElementById('confirmModal');
    if (cm && cm.classList.contains('open')) {
      closeConfirmModal(false);
      return;
    }
    const lb = document.getElementById('politicsLightbox');
    if (lb && lb.classList.contains('open')) {
      closePoliticsLightbox();
      return;
    }
    const ms = document.getElementById('mathStudioModal');
    if (ms && ms.classList.contains('open')) {
      if (typeof closeMathStudio === 'function') closeMathStudio();
      return;
    }
    // 2. 编辑类弹窗打开时，禁止按 Esc 直接退出，避免写了一大段误触丢失
    const editorModalIds = [
      'recordModal',
      'politicsModal',
      'todoModal',
      'paperModal',
      'readingModal',
      'readingNoteModal',
      'pdfImportModal'
    ];
    if (editorModalIds.some(id => document.getElementById(id)?.classList.contains('open'))) {
      return;
    }
    // 3. 仅关闭无未保存内容的只读查看弹窗与工具栏
    if (typeof closePoliticsViewer === 'function') closePoliticsViewer();
    if (typeof closePaperDetail === 'function') closePaperDetail();
    if (typeof closeStorageModal === 'function') closeStorageModal();
    closeSnapshotModal();
    hideReadingToolbar();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// =========================================================================
// 10. 启动初始化流程
// =========================================================================
// ============ 考试倒计时（目标 2026-12-19 06:00，每秒刷新） ============
const EXAM_TARGET = new Date('2026-12-19T06:00:00');
let countdownTimer = null;
function updateCountdown() {
  let diff = Math.floor((EXAM_TARGET - Date.now()) / 1000); // 剩余总秒数
  const el = document.getElementById('examCountdown');
  if (!el) return;
  if (diff <= 0) {
    el.innerHTML = '<span class="text-sm">🎓</span><span class="text-xs sm:text-sm font-bold text-emerald-700">考试已开始，加油！</span>';
    if (countdownTimer) clearInterval(countdownTimer);
    return;
  }
  const d = Math.floor(diff / 86400); diff -= d * 86400;
  const h = Math.floor(diff / 3600);  diff -= h * 3600;
  const m = Math.floor(diff / 60);
  const s = diff - m * 60;
  document.getElementById('cdDays').textContent = d;
  document.getElementById('cdHours').textContent = String(h).padStart(2, '0');
  document.getElementById('cdMins').textContent = String(m).padStart(2, '0');
  document.getElementById('cdSecs').textContent = String(s).padStart(2, '0');
}
updateCountdown();
countdownTimer = setInterval(updateCountdown, 1000);

// 应用启动入口：建库 → 分模块加载/迁移 → 恢复目录句柄 → 首次全量渲染
async function initApp() {
  loadPrefs();
  document.getElementById('quick-todo-date').value = todayISO();

  // 1. 打开 IndexedDB v2
  dbInstance = await openDatabase();

  // 2. 启动 v5 分模块存储（若检测到旧版单文件数据则自动无损拆分迁移）
  await initModularStorage();

  // 2.5 初始化英语阅读模块辅助状态
  if (typeof initReadingStore === 'function') {
    await initReadingStore();
  }

  // 3. 初始化界面与渲染
  switchTab('math');
  updateSyncUI();
  await refreshSnapshotCount();
  renderAll();
}

initApp();
