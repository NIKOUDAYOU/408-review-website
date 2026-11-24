// 全量渲染、快捷键、倒计时与启动入口
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享


// 全量重渲染：四个标签页的记录/统计/图表一次刷新
function renderAll() {
  populateSubjectFilter('math');
  populateSubjectFilter('408');
  renderRecords('math');
  renderRecords('408');
  renderTodos();
  renderPapers();
  renderScoreChart(); // 统计页图表
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
  if (e.key === 'Escape') {
    closeRecordModal();
    closeTodoModal();
    closePaperModal();
    closeSnapshotModal();
    closeConfirmModal(false);
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
  if (diff <= 0) {
    // 已到达/已过考试时间：显示提示并停止刷新
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

// 应用启动入口：建库 → 加载数据 → 恢复文件句柄 → 首次全量渲染
async function initApp() {
  loadPrefs();
  document.getElementById('quick-todo-date').value = todayISO();

  // 1. 打开 IndexedDB
  dbInstance = await openDatabase();

  // 2. 加载数据：优先 IndexedDB -> 其次 v4 localStorage -> 其次 v3 localStorage 迁移 -> 默认数据
  let loaded = await idbGet('state', 'current');
  if (!loaded) {
    try {
      const rawV4 = localStorage.getItem(LS_KEY_V4);
      const rawV3 = localStorage.getItem(LS_KEY_V3);
      if (rawV4) loaded = JSON.parse(rawV4);
      else if (rawV3) loaded = JSON.parse(rawV3);
    } catch {}
  }
  appData = normalizeData(loaded || DEFAULT_DATA);

  // 3. 检查是否记忆了本地 JSON 文件句柄
  const savedHandle = await idbGet('handles', 'jsonFile');
  if (savedHandle && typeof savedHandle.queryPermission === 'function') {
    try {
      const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        fileHandle = savedHandle;
      } else {
        pendingSavedHandle = savedHandle;
      }
    } catch {
      pendingSavedHandle = savedHandle;
    }
  }

  // 4. 初始化样式与渲染
  switchTab('math');
  updateSyncUI();
  await refreshSnapshotCount();
  renderAll();
}

initApp();
