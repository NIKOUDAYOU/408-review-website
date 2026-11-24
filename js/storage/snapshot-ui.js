// 历史快照弹窗
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 5. 历史快照弹窗逻辑
// =========================================================================
async function openSnapshotModal() {
  const list = await idbGetAllSnapshots();
  const container = document.getElementById('snapshotListContainer');
  if (!list.length) {
    container.innerHTML = `<div class="text-center py-12 text-slate-400 text-sm">暂无历史快照，点击顶部“手动保存”即可创建第一个快照 ✨</div>`;
  } else {
    container.innerHTML = list.map((s, idx) => `
      <div class="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 hover:border-blue-300 transition-all shadow-xs">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-slate-800">${formatDateTime(s.timestamp)}</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${idx === 0 ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}">${escapeHtml(s.reason)}</span>
          </div>
          <div class="text-xs text-slate-500 mt-1.5 flex items-center gap-3">
            <span>📐 数学: <b>${s.mathCount}</b></span>
            <span>💻 408: <b>${s.cs408Count}</b></span>
            <span>📅 待办: <b>${s.todoCount}</b></span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="exportSnapshot('${s.id}')" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">📤 导出此快照</button>
          <button onclick="restoreSnapshot('${s.id}')" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-xs">🔄 一键恢复</button>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('snapshotModal').classList.add('open');
}


// 关闭历史快照弹窗
function closeSnapshotModal() {
  document.getElementById('snapshotModal').classList.remove('open');
}


// 将某条历史快照的数据恢复到当前库（覆盖前需确认）
async function restoreSnapshot(snapId) {
  const list = await idbGetAllSnapshots();
  const target = list.find(s => s.id === snapId);
  if (!target) return;

  const ok = await showConfirm({
    title: '恢复历史快照',
    message: `确定要恢复到 ${formatDateTime(target.timestamp)}（${target.reason}）的数据状态吗？当前状态也会自动备份为一个新快照。`,
    okText: '确认恢复',
    danger: false
  });
  if (!ok) return;

  await createSnapshot('恢复快照前自动备份');
  appData = normalizeData(target.data);
  await persistData(true);
  renderAll();
  closeSnapshotModal();
  showToast('已成功恢复至所选历史快照！', 'success');
}


// 将指定历史快照导出为单独的 JSON 文件
async function exportSnapshot(snapId) {
  const list = await idbGetAllSnapshots();
  const target = list.find(s => s.id === snapId);
  if (!target) return;
  const blob = new Blob([JSON.stringify(target.data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapshot_${new Date(target.timestamp).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出该历史快照 JSON', 'success');
}
