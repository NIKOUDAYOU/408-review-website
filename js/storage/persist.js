// 偏好、三层存储同步、写盘队列、绑定/导入/导出
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享


// 从 localStorage 读取界面偏好（视图模式/自动写盘/每页条数）
function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.viewModes) viewModes = { ...viewModes, ...p.viewModes };
      if (typeof p.autoSyncEnabled === 'boolean') autoSyncEnabled = p.autoSyncEnabled;
      if (p.pageSizes) {
        if (p.pageSizes.math) pageState.math.size = p.pageSizes.math;
        if (p.pageSizes['408']) pageState['408'].size = p.pageSizes['408'];
      }
    }
  } catch {}
  document.getElementById('autoSyncToggle').checked = autoSyncEnabled;
}


// 把当前界面偏好持久化到 localStorage
function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS_KEY, JSON.stringify({ viewModes, autoSyncEnabled, pageSizes: { math: pageState.math.size, '408': pageState['408'].size } }));
  } catch {}
}


// 切换“有未保存修改”状态，控制顶部黄点与按钮文字
function setDirtyState(dirty) {
  isDirty = dirty;
  const dot = document.getElementById('dirtyDot');
  const saveText = document.getElementById('manualSaveText');
  if (dirty) {
    dot.classList.remove('hidden');
    saveText.textContent = '保存修改';
  } else {
    dot.classList.add('hidden');
    saveText.textContent = '手动保存';
  }
}


// 根据是否已绑定本地 JSON 文件，更新顶部同步状态徽章与相关按钮显隐
function updateSyncUI() {
  const badge = document.getElementById('syncBadge');
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const autoSyncWrap = document.getElementById('autoSyncWrap');

  if (fileHandle) {
    badge.className = 'hdr-ctrl bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[120px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0';
    text.textContent = `已绑定：${fileHandle.name}`;
    reconnectBtn.classList.add('hidden');
    autoSyncWrap.classList.remove('hidden');
  } else if (pendingSavedHandle) {
    badge.className = 'hdr-ctrl bg-amber-50 text-amber-700 border border-amber-200 max-w-[120px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0';
    text.textContent = `待恢复：${pendingSavedHandle.name}`;
    reconnectBtn.classList.remove('hidden');
    autoSyncWrap.classList.add('hidden');
  } else {
    badge.className = 'hdr-ctrl bg-slate-100 text-slate-600 border border-slate-200/80 max-w-[120px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0';
    text.textContent = dbInstance ? 'IndexedDB 本地库' : '浏览器缓存';
    reconnectBtn.classList.add('hidden');
    autoSyncWrap.classList.add('hidden');
  }
  badge.title = text.textContent; // 文件名被截断时，悬停可看完整名称
}


// 把当前数据写入用户绑定的本地 JSON 文件
// 所有写盘都串行排队，避免多个 createWritable() 并发互相覆盖；内容在真正执行时才序列化，保证写入的是最新数据
let fileWriteChain = Promise.resolve();
function writeToBoundFile() {
  const run = fileWriteChain.then(async () => {
    if (!fileHandle) return false;
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(appData, null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.error('写入本地 JSON 失败', err);
      return false;
    }
  });
  fileWriteChain = run.catch(() => false);
  return run;
}

// 自动写盘防抖：短时间内的多次修改只写最后一次；同一窗口内的调用共享同一个结果
const AUTO_WRITE_DELAY = 400;
let autoWriteTimer = null;
let autoWritePending = null; // { promise, resolve }
function scheduleFileWrite() {
  if (!autoWritePending) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    autoWritePending = { promise, resolve };
  }
  const pending = autoWritePending;
  clearTimeout(autoWriteTimer);
  autoWriteTimer = setTimeout(async () => {
    autoWritePending = null;
    autoWriteTimer = null;
    pending.resolve(await writeToBoundFile());
  }, AUTO_WRITE_DELAY);
  return pending.promise;
}

// 立即执行尚在防抖中的写盘（手动保存时调用），返回写盘结果
async function flushScheduledWrite() {
  if (!autoWritePending) return null;
  clearTimeout(autoWriteTimer);
  autoWriteTimer = null;
  const pending = autoWritePending;
  autoWritePending = null;
  const ok = await writeToBoundFile();
  pending.resolve(ok);
  return ok;
}

// localStorage 镜像：写入失败（通常是超出约 5MB 配额）时提醒一次，而不是静默吞掉
let lsQuotaWarned = false;
function saveLocalMirror() {
  try {
    localStorage.setItem(LS_KEY_V4, JSON.stringify(appData));
    lsQuotaWarned = false;
    return true;
  } catch (err) {
    console.warn('localStorage 镜像写入失败', err);
    if (!lsQuotaWarned) {
      lsQuotaWarned = true;
      const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
      showToast(isQuota
        ? '浏览器缓存空间已满，localStorage 备份已停止（IndexedDB 与本地 JSON 不受影响），建议导出 JSON 备份'
        : 'localStorage 备份写入失败，建议导出 JSON 备份', 'warning');
    }
    return false;
  }
}

// 常规修改后的持久化（写入 IndexedDB + localStorage，若开启自动写盘则同步本地文件）
async function persistData(silent = false) {
  appData.updatedAt = new Date().toISOString();
  appData.version = 4;

  // Tier 1: IndexedDB + localStorage 镜像兜底
  const idbOk = await idbPut('state', appData, 'current');
  if (dbInstance && !idbOk) showToast('写入 IndexedDB 失败，请尽快手动保存或导出 JSON', 'error');
  saveLocalMirror();

  updateTabCounts();

  // Tier 2: 若已绑定本地 JSON 且开启自动写盘（防抖排队，不阻塞界面）
  if (fileHandle && autoSyncEnabled) {
    setDirtyState(true); // 写盘完成前视为未保存，期间关闭页面会收到提醒
    scheduleFileWrite().then(ok => {
      if (autoWritePending) return; // 之后又有新修改排队，等最后一次写完再更新状态
      if (ok) {
        setDirtyState(false);
        if (!silent) showToast('已自动同步至本地 JSON 与 IndexedDB', 'success');
      } else {
        setDirtyState(true);
        showToast('写入本地文件失败，已暂存至 IndexedDB，请点击手动保存重试', 'warning');
      }
    });
  } else {
    // 未绑定文件或关闭了自动写盘 -> 标记“有未保存修改”，提醒用户可点手动保存留存快照/写盘
    setDirtyState(true);
  }
}

// Tier 3: 手动保存按钮 & Ctrl+S / Cmd+S
async function manualSave() {
  appData.updatedAt = new Date().toISOString();
  appData.version = 4;

  // 1. 写入 IndexedDB 主库 + localStorage
  await idbPut('state', appData, 'current');
  saveLocalMirror();

  // 2. 创建时间戳历史快照
  await createSnapshot('手动保存');

  // 3. 若已绑定本地 JSON，强制写盘（先取消排队中的防抖写入，统一走队列）
  let fileSynced = false;
  if (fileHandle) {
    await flushScheduledWrite();
    fileSynced = await writeToBoundFile();
  }

  setDirtyState(false);

  // 按钮庆祝动效
  const btn = document.getElementById('manualSaveBtn');
  const icon = document.getElementById('manualSaveIcon');
  const text = document.getElementById('manualSaveText');
  icon.textContent = '✅';
  text.textContent = '已保存';
  btn.classList.add('animate-pop');
  setTimeout(() => {
    icon.textContent = '💾';
    text.textContent = isDirty ? '保存修改' : '手动保存';
    btn.classList.remove('animate-pop');
  }, 1200);

  if (fileHandle && fileSynced) {
    showToast(`保存成功！已写入 ${fileHandle.name} 并生成历史快照`, 'success');
  } else if (fileHandle && !fileSynced) {
    showToast('已保存至 IndexedDB 并生成快照，但本地文件写入权限失效，请重新绑定', 'warning');
  } else {
    showToast('已保存至 IndexedDB 并生成历史快照（绑定本地 JSON 可同步到硬盘）', 'success');
  }
}


// 开启/关闭“自动写盘”（每次修改同步写入本地 JSON）
function toggleAutoSync(checked) {
  autoSyncEnabled = checked;
  savePrefs();
  showToast(checked ? '已开启自动写盘：每次修改自动写入本地 JSON' : '已关闭自动写盘：请通过“手动保存”或 Ctrl+S 写盘', 'info');
}

// 绑定本地 JSON 文件（并记忆句柄到 IndexedDB）
async function bindLocalJson() {
  if (!window.showOpenFilePicker) {
    showToast('当前浏览器不支持直接绑定，请使用“导入 / 导出JSON”', 'warning');
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON 数据文件', accept: { 'application/json': ['.json'] } }]
    });
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = normalizeData(JSON.parse(text));

    await createSnapshot(`绑定文件前备份 (${file.name})`);
    appData = parsed;
    fileHandle = handle;
    pendingSavedHandle = null;

    await idbPut('handles', handle, 'jsonFile');
    await idbPut('state', appData, 'current');
    saveLocalMirror();

    setDirtyState(false);
    updateSyncUI();
    renderAll();
    showToast(`成功绑定并加载 ${file.name}`, 'success');
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      showToast('打开文件失败：请检查是否为合法的 JSON 文件', 'error');
    }
  }
}

// 刷新后一键恢复之前绑定的文件句柄权限
async function reconnectLocalJson() {
  if (!pendingSavedHandle) return;
  try {
    const perm = await pendingSavedHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      fileHandle = pendingSavedHandle;
      pendingSavedHandle = null;
      updateSyncUI();

      // 读取本地文件并与当前数据同步（默认以最新时间戳或提示）
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text.trim()) {
        const diskData = normalizeData(JSON.parse(text));
        const diskTime = new Date(diskData.updatedAt || 0).getTime();
        const localTime = new Date(appData.updatedAt || 0).getTime();
        if (diskTime > localTime) {
          await createSnapshot('恢复同步前备份');
          appData = diskData;
          await idbPut('state', appData, 'current');
          saveLocalMirror();
          renderAll();
          showToast(`已恢复同步并加载硬盘中较新的 ${fileHandle.name}`, 'success');
        } else {
          await writeToBoundFile();
          showToast(`已恢复同步，并将最新数据写回 ${fileHandle.name}`, 'success');
        }
      }
      setDirtyState(false);
    } else {
      showToast('未获得文件读写权限，已继续使用 IndexedDB', 'warning');
    }
  } catch (err) {
    showToast('恢复文件同步失败，请重新点击“绑定本地JSON”', 'error');
  }
}


// 处理用户选择的 JSON 文件导入：解析、规范化数据并替换当前数据
function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = normalizeData(JSON.parse(e.target.result));
      await createSnapshot(`导入 ${file.name} 前备份`);
      appData = parsed;
      await persistData(true);
      renderAll();
      showToast(`成功导入 ${file.name}（已自动为旧数据创建快照）`, 'success');
    } catch {
      showToast('JSON 解析失败，请检查文件内容', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}


// 导出当前全量数据为 JSON 文件下载
function exportJson() {
  appData.updatedAt = new Date().toISOString();
  appData.version = 4;
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileHandle ? fileHandle.name : `kaoyan_tracker_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出 JSON 备份文件', 'success');
}
