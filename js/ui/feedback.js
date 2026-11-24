// Toast 提示与确认弹窗
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// 动画 Toast 提示
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✅', warning: '⚠️', error: '❌', info: '✨' };
  const styles = {
    success: 'bg-emerald-900/95 text-emerald-50 border-emerald-700/60',
    warning: 'bg-amber-900/95 text-amber-50 border-amber-700/60',
    error: 'bg-rose-900/95 text-rose-50 border-rose-700/60',
    info: 'bg-slate-900/95 text-white border-slate-700/60'
  };
  const el = document.createElement('div');
  el.className = `toast-item pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium border shadow-xl backdrop-blur ${styles[type] || styles.info}`;
  el.innerHTML = `<span class="text-base">${icons[type] || icons.info}</span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 260);
  }, 2500);
}

// 自定义确认弹窗（替代浏览器原生 confirm）
function showConfirm({ title = '确认操作', message = '', okText = '确认', danger = true }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = okText;
    okBtn.className = danger
      ? 'btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm'
      : 'btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm';
    document.getElementById('confirmIcon').textContent = danger ? '🗑️' : '🔄';
    document.getElementById('confirmModal').classList.add('open');
  });
}


// 关闭自定义确认弹窗并兑现/取消对应的 Promise 结果
function closeConfirmModal(result) {
  document.getElementById('confirmModal').classList.remove('open');
  if (confirmResolver) {
    const fn = confirmResolver;
    confirmResolver = null;
    fn(result);
  }
}
