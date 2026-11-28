// Toast 提示、确认弹窗、编辑防误关保护、草稿暂存与字体主题切换
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 1. 动画 Toast 提示
// =========================================================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
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

// =========================================================================
// 2. 自定义确认弹窗（替代浏览器原生 confirm，z-index 高于所有编辑弹窗）
// =========================================================================
function showConfirm({ title = '确认操作', message = '', okText = '确认', cancelText = '取消', danger = true }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (cancelBtn) cancelBtn.textContent = cancelText || '取消';
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = okText;
    okBtn.className = danger
      ? 'btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm'
      : 'btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm';
    document.getElementById('confirmIcon').textContent = danger ? '⚠️' : '🔄';
    document.getElementById('confirmModal').classList.add('open');
  });
}

function closeConfirmModal(result) {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('open');
  if (confirmResolver) {
    const fn = confirmResolver;
    confirmResolver = null;
    fn(result);
  }
}

// =========================================================================
// 3. 编辑弹窗防误关保护 + 自动草稿暂存
//    原则：编辑卡片时除了点击 ✕ / 取消 / 保存，点弹窗外部任何地方都不退出
// =========================================================================
let lastBackdropGuardToastAt = 0;

function guardEditorBackdrop(backdropEl) {
  const panel = backdropEl ? backdropEl.querySelector('.modal-panel') : null;
  if (panel) {
    panel.classList.remove('modal-nudge');
    void panel.offsetWidth; // 强制重排以重放轻晃提示
    panel.classList.add('modal-nudge');
  }
  const now = Date.now();
  if (now - lastBackdropGuardToastAt > 3200) {
    lastBackdropGuardToastAt = now;
    showToast('编辑中已锁定空白处防误关，请点「保存」「取消」或右上角 ✕', 'info');
  }
}

function confirmDiscardEdits(modalLabel = '当前内容') {
  return showConfirm({
    title: '有未保存的编辑内容',
    message: `${modalLabel}包含尚未保存的修改，确定放弃并关闭吗？`,
    okText: '放弃并关闭',
    cancelText: '继续编辑',
    danger: true
  });
}

const LS_EDITOR_DRAFT_PREFIX = 'kaoyan_editor_draft_';

function saveEditorDraft(draftKey, payload) {
  try {
    localStorage.setItem(LS_EDITOR_DRAFT_PREFIX + draftKey, JSON.stringify({
      savedAt: Date.now(),
      payload
    }));
  } catch {}
}

function loadEditorDraft(draftKey) {
  try {
    const raw = localStorage.getItem(LS_EDITOR_DRAFT_PREFIX + draftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.payload ? parsed : null;
  } catch {
    return null;
  }
}

function clearEditorDraft(draftKey) {
  try {
    localStorage.removeItem(LS_EDITOR_DRAFT_PREFIX + draftKey);
  } catch {}
}

// =========================================================================
// 4. 中文字体主题切换（默认 Claude 书卷楷体：霞鹜文楷 + 西文衬线）
// =========================================================================
const FONT_PRESETS = [
  { key: 'claude-kai',   short: '楷体', name: 'Claude 书卷楷体（霞鹜文楷）', bodyClass: 'font-claude-kai' },
  { key: 'claude-serif', short: '宋体', name: 'Claude 衬线宋体（思源宋体）', bodyClass: 'font-claude-serif' },
  { key: 'sans',         short: '黑体', name: '清爽无衬线（Inter / 雅黑）',  bodyClass: 'font-sans-clean' }
];

function applyFontPreset(presetKey) {
  const target = FONT_PRESETS.find(f => f.key === presetKey) || FONT_PRESETS[0];
  fontPreset = target.key;
  FONT_PRESETS.forEach(f => document.body.classList.remove(f.bodyClass));
  document.body.classList.add(target.bodyClass);

  const btn = document.getElementById('fontSwitchBtn');
  const txt = document.getElementById('fontSwitchText');
  if (txt) txt.textContent = target.short;
  if (btn) btn.title = `当前字体：${target.name}（点击切换：楷体 / 宋体 / 黑体）`;
}

function cycleFontPreset() {
  const idx = FONT_PRESETS.findIndex(f => f.key === fontPreset);
  const next = FONT_PRESETS[(idx + 1) % FONT_PRESETS.length];
  applyFontPreset(next.key);
  if (typeof savePrefs === 'function') savePrefs();
  showToast(`已切换字体：${next.name}`, 'info');
}
