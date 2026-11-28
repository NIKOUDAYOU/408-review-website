// 分模块持久化引擎（v5）
// - Tier 1: IndexedDB v2 `modules` 分键存储 + `assets` 二进制截图存储 + localStorage 分模块镜像
// - Tier 2: 本地数据文件夹（File System Access API: showDirectoryPicker）按模块增量写盘
//           目录结构：manifest.json / math.json / cs408.json / politics.json / todos.json / papers.json / readings.json / assets/
// - Tier 3: 历史快照 + 统一「存储中心」单模块/全量/旧版兼容导入导出
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

const MOD_KEYS = STORAGE_MODULES.map(m => m.key);
let storageImportTargetMod = ''; // 当前导入文件对应的模块（空 = 全局智能导入）

// =========================================================================
// 1. 界面偏好（视图模式 / 自动写盘 / 分页条数）
// =========================================================================
function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.viewModes) viewModes = { ...viewModes, ...p.viewModes };
      if (typeof p.autoSyncEnabled === 'boolean') autoSyncEnabled = p.autoSyncEnabled;
      if (p.pageSizes && typeof p.pageSizes === 'object') {
        Object.keys(pageState).forEach(mod => {
          if (p.pageSizes[mod] !== undefined) {
            pageState[mod].size = normalizeCardPageSize(p.pageSizes[mod]);
          }
        });
      }
      if (typeof p.fontPreset === 'string' && p.fontPreset) {
        fontPreset = p.fontPreset;
      }
    }
  } catch {}
  const toggle = document.getElementById('autoSyncToggle');
  if (toggle) toggle.checked = autoSyncEnabled;
  if (typeof applyFontPreset === 'function') applyFontPreset(fontPreset);
}

function savePrefs() {
  try {
    const pageSizes = {};
    Object.keys(pageState).forEach(mod => {
      pageSizes[mod] = normalizeCardPageSize(pageState[mod].size);
    });
    localStorage.setItem(LS_PREFS_KEY, JSON.stringify({
      viewModes,
      autoSyncEnabled,
      fontPreset,
      pageSizes
    }));
  } catch {}
}

// =========================================================================
// 2. 模块读写抽象（内存 <-> 标准化封包）
// =========================================================================
function getModuleMetaDef(key) {
  return STORAGE_MODULES.find(m => m.key === key) || null;
}

function getModuleData(key) {
  switch (key) {
    case 'math': return appData.math;
    case '408': return appData['408'];
    case 'politics': return appData.politics;
    case 'todos': return appData.todos;
    case 'papers': return appData.papers;
    case 'readings': return readingStore;
    default: return null;
  }
}

function setModuleData(key, raw) {
  switch (key) {
    case 'math':
      appData.math = normalizeMathModule(raw);
      break;
    case '408':
      appData['408'] = normalize408Module(raw);
      break;
    case 'politics':
      appData.politics = normalizePoliticsModule(raw);
      break;
    case 'todos':
      appData.todos = normalizeTodosModule(raw);
      break;
    case 'papers':
      appData.papers = normalizePapersModule(raw);
      break;
    case 'readings':
      readingStore = normalizeReadingsModule(raw);
      if (typeof syncReadingIndexToAppData === 'function') syncReadingIndexToAppData();
      break;
  }
}

function getModuleCount(key) {
  const data = getModuleData(key);
  if (!data) return 0;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data.records)) return data.records.length;
  return 0;
}

function ensureModuleMetaDefaults() {
  const fallbackIso = appData.updatedAt || new Date().toISOString();
  STORAGE_MODULES.forEach(m => {
    if (!moduleMeta[m.key] || typeof moduleMeta[m.key] !== 'object') {
      moduleMeta[m.key] = { updatedAt: fallbackIso, count: getModuleCount(m.key) };
    } else {
      moduleMeta[m.key].count = getModuleCount(m.key);
      if (!moduleMeta[m.key].updatedAt) moduleMeta[m.key].updatedAt = fallbackIso;
    }
  });
}

function buildModuleEnvelope(key) {
  const def = getModuleMetaDef(key);
  ensureModuleMetaDefaults();
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    module: key,
    label: def ? def.label : key,
    updatedAt: moduleMeta[key].updatedAt,
    count: getModuleCount(key),
    data: getModuleData(key)
  };
}

function buildManifestPayload() {
  ensureModuleMetaDefaults();
  const modulesSummary = {};
  STORAGE_MODULES.forEach(m => {
    modulesSummary[m.key] = {
      file: m.file,
      label: m.label,
      updatedAt: moduleMeta[m.key].updatedAt,
      count: getModuleCount(m.key)
    };
  });
  return {
    app: '考研复盘工作台（数学 · 408 · 政治 · 英语）',
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    modules: modulesSummary
  };
}

// =========================================================================
// 3. 分模块 localStorage 镜像（每模块独立 Key，单模块超限不拖累其他模块）
// =========================================================================
const lsQuotaWarnedMap = {};
function saveModuleLocalMirror(key) {
  try {
    const payload = key === 'meta' ? buildManifestPayload() : buildModuleEnvelope(key);
    localStorage.setItem(LS_MOD_PREFIX + key, JSON.stringify(payload));
    lsQuotaWarnedMap[key] = false;
    return true;
  } catch (err) {
    console.warn(`localStorage 模块镜像 [${key}] 写入失败`, err);
    if (!lsQuotaWarnedMap[key]) {
      lsQuotaWarnedMap[key] = true;
      const def = getModuleMetaDef(key);
      const label = def ? def.label : key;
      showToast(`「${label}」的浏览器缓存镜像已达上限（IndexedDB 与本地目录不受影响）`, 'warning');
    }
    return false;
  }
}

function loadModuleFromLocalMirror(key) {
  try {
    const raw = localStorage.getItem(LS_MOD_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// =========================================================================
// 4. 启动加载与旧版单文件数据自动无损拆分迁移
// =========================================================================
async function initModularStorage() {
  let metaRecord = await idbGet('modules', 'meta');
  if (!metaRecord) metaRecord = loadModuleFromLocalMirror('meta');

  if (metaRecord && metaRecord.schemaVersion >= STORAGE_SCHEMA_VERSION && metaRecord.modules) {
    // 已是 v5 分模块存储：逐模块独立加载
    moduleMeta = {};
    for (const m of STORAGE_MODULES) {
      let env = await idbGet('modules', m.key);
      if (!env) env = loadModuleFromLocalMirror(m.key);
      if (env) {
        setModuleData(m.key, env);
        moduleMeta[m.key] = {
          updatedAt: env.updatedAt || (metaRecord.modules[m.key] && metaRecord.modules[m.key].updatedAt) || new Date().toISOString(),
          count: getModuleCount(m.key)
        };
      } else if (m.key === 'politics') {
        appData.politics = {
          subjects: [...POLITICS_SUBJECTS],
          records: JSON.parse(JSON.stringify(DEFAULT_POLITICS_RECORDS))
        };
        moduleMeta.politics = { updatedAt: new Date().toISOString(), count: getModuleCount('politics') };
        await idbPut('modules', buildModuleEnvelope('politics'), 'politics');
        saveModuleLocalMirror('politics');
      } else {
        setModuleData(m.key, m.key === 'math' || m.key === '408' ? DEFAULT_DATA[m.key] : []);
        moduleMeta[m.key] = { updatedAt: new Date().toISOString(), count: getModuleCount(m.key) };
      }
    }
    if (typeof syncReadingIndexToAppData === 'function') syncReadingIndexToAppData();
    appData.version = STORAGE_SCHEMA_VERSION;
    appData.updatedAt = metaRecord.updatedAt || new Date().toISOString();
  } else {
    // 首次升级迁移：从旧版 IndexedDB state('current'/'readings') 或 localStorage 无损拆分
    let legacyMain = await idbGet('state', 'current');
    if (!legacyMain) {
      try {
        const rawV4 = localStorage.getItem(LS_KEY_V4);
        const rawV3 = localStorage.getItem(LS_KEY_V3);
        if (rawV4) legacyMain = JSON.parse(rawV4);
        else if (rawV3) legacyMain = JSON.parse(rawV3);
      } catch {}
    }
    appData = normalizeData(legacyMain || DEFAULT_DATA);

    let legacyReadings = await idbGet('state', 'readings');
    if (!Array.isArray(legacyReadings)) {
      try {
        const rawR = localStorage.getItem(LS_READING_STORE_KEY);
        if (rawR) {
          const parsedR = JSON.parse(rawR);
          legacyReadings = Array.isArray(parsedR) ? parsedR : (Array.isArray(parsedR.readings) ? parsedR.readings : null);
        }
      } catch {}
    }
    readingStore = normalizeReadingsModule(legacyReadings || []);
    if (Array.isArray(appData._migratedReadings) && appData._migratedReadings.length) {
      const map = new Map(readingStore.map(r => [r.id, r]));
      appData._migratedReadings.forEach(r => {
        const clean = normalizeReadingsModule([r])[0];
        if (clean) map.set(clean.id, clean);
      });
      readingStore = [...map.values()];
      delete appData._migratedReadings;
    }
    if (typeof syncReadingIndexToAppData === 'function') syncReadingIndexToAppData();

    const migratedAt = appData.updatedAt || new Date().toISOString();
    moduleMeta = {};
    for (const m of STORAGE_MODULES) {
      moduleMeta[m.key] = { updatedAt: migratedAt, count: getModuleCount(m.key) };
      await idbPut('modules', buildModuleEnvelope(m.key), m.key);
      saveModuleLocalMirror(m.key);
    }
    await idbPut('modules', buildManifestPayload(), 'meta');
    saveModuleLocalMirror('meta');
  }

  // 检查已记忆的本地数据目录句柄
  const savedDir = await idbGet('handles', 'dataDir');
  if (savedDir && typeof savedDir.queryPermission === 'function') {
    try {
      const perm = await savedDir.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        dirHandle = savedDir;
      } else {
        pendingDirHandle = savedDir;
      }
    } catch {
      pendingDirHandle = savedDir;
    }
  }

  // 若尚未绑定目录，检查是否记忆了旧版单文件句柄（平滑兼容）
  if (!dirHandle && !pendingDirHandle) {
    const savedHandle = await idbGet('handles', 'jsonFile');
    if (savedHandle && typeof savedHandle.queryPermission === 'function') {
      try {
        const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') fileHandle = savedHandle;
        else pendingSavedHandle = savedHandle;
      } catch {
        pendingSavedHandle = savedHandle;
      }
    }
  }
}

// =========================================================================
// 5. 状态栏与脏标记更新
// =========================================================================
function setDirtyState(dirty) {
  isDirty = dirty;
  const dot = document.getElementById('dirtyDot');
  const saveText = document.getElementById('manualSaveText');
  if (!dot || !saveText) return;
  if (dirty) {
    dot.classList.remove('hidden');
    saveText.textContent = '保存修改';
  } else {
    dot.classList.add('hidden');
    saveText.textContent = '手动保存';
  }
}

function updateSyncUI() {
  const badge = document.getElementById('syncBadge');
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const autoSyncWrap = document.getElementById('autoSyncWrap');
  if (!badge || !dot || !text || !reconnectBtn || !autoSyncWrap) return;

  if (dirHandle) {
    badge.className = 'hdr-ctrl bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[160px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0';
    text.textContent = `目录：${dirHandle.name}`;
    reconnectBtn.classList.add('hidden');
    autoSyncWrap.classList.remove('hidden');
  } else if (pendingDirHandle) {
    badge.className = 'hdr-ctrl bg-amber-50 text-amber-700 border border-amber-200 max-w-[160px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0';
    text.textContent = `待恢复：${pendingDirHandle.name}`;
    reconnectBtn.textContent = '🔄 恢复目录';
    reconnectBtn.classList.remove('hidden');
    autoSyncWrap.classList.add('hidden');
  } else if (fileHandle) {
    badge.className = 'hdr-ctrl bg-sky-50 text-sky-700 border border-sky-200 max-w-[160px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0';
    text.textContent = `旧文件：${fileHandle.name}`;
    reconnectBtn.classList.add('hidden');
    autoSyncWrap.classList.remove('hidden');
  } else if (pendingSavedHandle) {
    badge.className = 'hdr-ctrl bg-amber-50 text-amber-700 border border-amber-200 max-w-[160px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0';
    text.textContent = `旧待恢复：${pendingSavedHandle.name}`;
    reconnectBtn.textContent = '🔄 恢复同步';
    reconnectBtn.classList.remove('hidden');
    autoSyncWrap.classList.add('hidden');
  } else {
    badge.className = 'hdr-ctrl bg-slate-100 text-slate-600 border border-slate-200/80 max-w-[160px]';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0';
    text.textContent = dbInstance ? 'IndexedDB 分模块库' : '浏览器分模块缓存';
    reconnectBtn.classList.add('hidden');
    autoSyncWrap.classList.add('hidden');
  }
  badge.title = `${text.textContent}（6 大模块分散独立存储）`;

  if (typeof updateReadingStoreUI === 'function') updateReadingStoreUI();
}

// =========================================================================
// 6. 本地目录按模块增量写盘队列 & 图片资产目录同步
// =========================================================================
let dirWriteChain = Promise.resolve();
const AUTO_WRITE_DELAY = 380;
let autoWriteTimer = null;
let autoWritePending = null;

async function writeTextFileInDir(directoryHandle, filename, content) {
  const fh = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFileInDir(directoryHandle, filename) {
  try {
    const fh = await directoryHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// 将指定模块列表（默认仅脏模块）写入已绑定的本地数据目录
function writeModulesToBoundDir(keysToWrite = null) {
  const run = dirWriteChain.then(async () => {
    if (!dirHandle) return false;
    const targets = Array.isArray(keysToWrite) && keysToWrite.length
      ? keysToWrite.filter(k => MOD_KEYS.includes(k))
      : [...dirtyModules].filter(k => MOD_KEYS.includes(k));
    if (!targets.length) return true;
    try {
      for (const key of targets) {
        const def = getModuleMetaDef(key);
        if (!def) continue;
        const env = buildModuleEnvelope(key);
        await writeTextFileInDir(dirHandle, def.file, JSON.stringify(env, null, 2));
        dirtyModules.delete(key);
      }
      await writeTextFileInDir(dirHandle, 'manifest.json', JSON.stringify(buildManifestPayload(), null, 2));
      return true;
    } catch (err) {
      console.error('按模块写入本地目录失败', err);
      return false;
    }
  });
  dirWriteChain = run.catch(() => false);
  return run;
}

// 兼容旧版单文件写盘队列
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
      console.error('写入兼容单文件 JSON 失败', err);
      return false;
    }
  });
  fileWriteChain = run.catch(() => false);
  return run;
}

function scheduleAutoDiskWrite() {
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
    let ok = false;
    if (dirHandle) ok = await writeModulesToBoundDir();
    else if (fileHandle) ok = await writeToBoundFile();
    pending.resolve(ok);
  }, AUTO_WRITE_DELAY);
  return pending.promise;
}

async function flushScheduledWrite() {
  if (!autoWritePending) return null;
  clearTimeout(autoWriteTimer);
  autoWriteTimer = null;
  const pending = autoWritePending;
  autoWritePending = null;
  let ok = false;
  if (dirHandle) ok = await writeModulesToBoundDir();
  else if (fileHandle) ok = await writeToBoundFile();
  pending.resolve(ok);
  return ok;
}

// 图片二进制资源与目录 assets/ 双向同步
async function writeAssetToBoundDir(id, blob) {
  if (!dirHandle || !id || !blob) return false;
  try {
    const assetsDir = await dirHandle.getDirectoryHandle('assets', { create: true });
    const fh = await assetsDir.getFileHandle(id, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (err) {
    console.warn('写入目录图片资产失败', id, err);
    return false;
  }
}

async function readAssetFromBoundDir(id) {
  if (!dirHandle || !id) return null;
  try {
    const assetsDir = await dirHandle.getDirectoryHandle('assets');
    const fh = await assetsDir.getFileHandle(id);
    const file = await fh.getFile();
    return {
      id,
      blob: file,
      mime: file.type || 'image/webp',
      size: file.size || 0,
      createdAt: file.lastModified || Date.now()
    };
  } catch {
    return null;
  }
}

async function deleteAssetFromBoundDir(id) {
  if (!dirHandle || !id) return false;
  try {
    const assetsDir = await dirHandle.getDirectoryHandle('assets');
    await assetsDir.removeEntry(id);
    return true;
  } catch {
    return false;
  }
}

async function syncAllAssetsToBoundDir() {
  if (!dirHandle) return;
  const all = await idbGetAllAssets();
  for (const asset of all) {
    if (asset && asset.id && asset.blob) {
      await writeAssetToBoundDir(asset.id, asset.blob);
    }
  }
}

async function pullMissingAssetsFromBoundDir() {
  if (!dirHandle) return;
  const neededIds = new Set();
  if (appData.politics && Array.isArray(appData.politics.records)) {
    appData.politics.records.forEach(r => { if (r.imageId) neededIds.add(r.imageId); });
  }
  for (const id of neededIds) {
    const existing = await idbGetAsset(id);
    if (!existing) {
      const fromDisk = await readAssetFromBoundDir(id);
      if (fromDisk) await idbPutAsset(fromDisk);
    }
  }
}

// =========================================================================
// 7. 增量持久化主入口：persistModule / persistModules / persistData(兼容)
// =========================================================================
async function persistModules(keys, silent = false) {
  const validKeys = [...new Set((Array.isArray(keys) ? keys : [keys]).filter(k => MOD_KEYS.includes(k)))];
  if (!validKeys.length) return;

  const nowIso = new Date().toISOString();
  appData.updatedAt = nowIso;
  appData.version = STORAGE_SCHEMA_VERSION;
  if (validKeys.includes('readings') && typeof syncReadingIndexToAppData === 'function') {
    syncReadingIndexToAppData();
  }

  // Tier 1: 仅将变动模块写入 IndexedDB `modules` 仓库 + 对应 localStorage 独立 Key
  let allIdbOk = true;
  for (const key of validKeys) {
    moduleMeta[key] = { updatedAt: nowIso, count: getModuleCount(key) };
    const ok = await idbPut('modules', buildModuleEnvelope(key), key);
    if (dbInstance && !ok) allIdbOk = false;
    saveModuleLocalMirror(key);
    dirtyModules.add(key);
  }
  await idbPut('modules', buildManifestPayload(), 'meta');
  saveModuleLocalMirror('meta');

  if (dbInstance && !allIdbOk) {
    showToast('写入 IndexedDB 分模块库失败，请尽快手动保存或导出备份', 'error');
  }

  updateTabCounts();

  // Tier 2: 自动增量写盘
  if ((dirHandle || fileHandle) && autoSyncEnabled) {
    setDirtyState(true);
    scheduleAutoDiskWrite().then(ok => {
      if (autoWritePending) return;
      if (ok) {
        if (!dirHandle || dirtyModules.size === 0) setDirtyState(false);
        if (!silent) {
          const names = validKeys.map(k => (getModuleMetaDef(k) || {}).file || k).join('、');
          showToast(dirHandle ? `已增量写入目录：${names}` : '已自动同步至本地文件', 'success');
        }
      } else {
        setDirtyState(true);
        showToast('写入本地目录失败，已暂存至 IndexedDB，请点手动保存重试', 'warning');
      }
    });
  } else {
    setDirtyState(true);
  }
}

function persistModule(key, silent = false) {
  return persistModules([key], silent);
}

// 兼容旧调用点：未指定具体模块时持久化除阅读外的业务模块（或全部）
function persistData(silent = false, keys = null) {
  const targetKeys = Array.isArray(keys) && keys.length
    ? keys
    : ['math', '408', 'politics', 'todos', 'papers'];
  return persistModules(targetKeys, silent);
}

// Tier 3: 手动保存按钮 & Ctrl+S / Cmd+S
async function manualSave() {
  const nowIso = new Date().toISOString();
  appData.updatedAt = nowIso;
  appData.version = STORAGE_SCHEMA_VERSION;
  if (typeof syncReadingIndexToAppData === 'function') syncReadingIndexToAppData();

  const keysToPersist = dirtyModules.size > 0 ? [...dirtyModules] : [...MOD_KEYS];
  for (const key of keysToPersist) {
    moduleMeta[key] = { updatedAt: nowIso, count: getModuleCount(key) };
    await idbPut('modules', buildModuleEnvelope(key), key);
    saveModuleLocalMirror(key);
    dirtyModules.add(key);
  }
  await idbPut('modules', buildManifestPayload(), 'meta');
  saveModuleLocalMirror('meta');

  // 创建时间戳历史快照
  await createSnapshot('手动保存');

  // 强制写盘
  let diskSynced = false;
  if (dirHandle) {
    await flushScheduledWrite();
    diskSynced = await writeModulesToBoundDir([...MOD_KEYS]);
    await syncAllAssetsToBoundDir();
  } else if (fileHandle) {
    await flushScheduledWrite();
    diskSynced = await writeToBoundFile();
  }
  if (typeof readingFileHandle !== 'undefined' && readingFileHandle && typeof writeToReadingBoundFile === 'function') {
    await writeToReadingBoundFile();
  }

  dirtyModules.clear();
  setDirtyState(false);

  // 按钮动效
  const btn = document.getElementById('manualSaveBtn');
  const icon = document.getElementById('manualSaveIcon');
  const text = document.getElementById('manualSaveText');
  if (btn && icon && text) {
    icon.textContent = '✅';
    text.textContent = '已保存';
    btn.classList.add('animate-pop');
    setTimeout(() => {
      icon.textContent = '💾';
      text.textContent = isDirty ? '保存修改' : '手动保存';
      btn.classList.remove('animate-pop');
    }, 1200);
  }

  if (dirHandle && diskSynced) {
    showToast(`保存成功！已按模块写入目录「${dirHandle.name}」并留存快照`, 'success');
  } else if (dirHandle && !diskSynced) {
    showToast('已保存至 IndexedDB 并生成快照，但本地目录写入权限失效，请重新绑定', 'warning');
  } else if (fileHandle && diskSynced) {
    showToast(`保存成功！已写入 ${fileHandle.name} 并生成历史快照`, 'success');
  } else {
    showToast('已保存至 IndexedDB 分模块库并生成历史快照（可绑定本地目录分散落盘）', 'success');
  }
}

function toggleAutoSync(checked) {
  autoSyncEnabled = checked;
  savePrefs();
  showToast(checked ? '已开启自动写盘：改哪个模块自动落盘对应文件' : '已关闭自动写盘：请通过“手动保存”或 Ctrl+S 写盘', 'info');
}

// =========================================================================
// 8. 本地数据文件夹绑定与刷新后一键恢复（showDirectoryPicker）
// =========================================================================
async function bindDataDirectory() {
  if (!window.showDirectoryPicker) {
    showToast('当前浏览器不支持绑定本地目录，请在“存储中心”使用分模块导入/导出', 'warning');
    openStorageModal();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });

    // 检测目录里是否已存在分模块文件
    const manifestText = await readTextFileInDir(handle, 'manifest.json');
    const existingModFiles = [];
    for (const m of STORAGE_MODULES) {
      const txt = await readTextFileInDir(handle, m.file);
      if (txt && txt.trim()) existingModFiles.push({ mod: m, text: txt });
    }

    if (existingModFiles.length > 0) {
      const okLoad = await showConfirm({
        title: `目录「${handle.name}」已有分模块数据`,
        message: `检测到该目录中已有 ${existingModFiles.length} 个模块文件（${existingModFiles.map(x => x.mod.file).join('、')}）。点击「从目录加载」将用目录文件加载到本地（加载前自动创建历史快照）；点击「取消」则终止本次绑定。`,
        okText: '从目录加载并绑定',
        danger: false
      });
      if (!okLoad) return;

      await createSnapshot(`绑定目录前备份 (${handle.name})`);
      const loadedKeys = new Set();
      let manifestObj = null;
      try { if (manifestText) manifestObj = JSON.parse(manifestText); } catch {}

      for (const item of existingModFiles) {
        try {
          const parsed = JSON.parse(item.text);
          setModuleData(item.mod.key, parsed);
          moduleMeta[item.mod.key] = {
            updatedAt: parsed.updatedAt || (manifestObj && manifestObj.modules && manifestObj.modules[item.mod.key] && manifestObj.modules[item.mod.key].updatedAt) || new Date().toISOString(),
            count: getModuleCount(item.mod.key)
          };
          loadedKeys.add(item.mod.key);
        } catch (err) {
          console.warn(`解析目录文件 ${item.mod.file} 失败，保留本地数据`, err);
        }
      }

      dirHandle = handle;
      pendingDirHandle = null;
      fileHandle = null;
      pendingSavedHandle = null;
      await idbPut('handles', handle, 'dataDir');

      // 落盘至 IDB + LS；目录中尚未生成的模块（如新增的 politics.json）补写回目录
      const missingInDir = MOD_KEYS.filter(k => !loadedKeys.has(k));
      for (const key of MOD_KEYS) {
        await idbPut('modules', buildModuleEnvelope(key), key);
        saveModuleLocalMirror(key);
      }
      await idbPut('modules', buildManifestPayload(), 'meta');
      saveModuleLocalMirror('meta');

      await pullMissingAssetsFromBoundDir();
      if (missingInDir.length) {
        await writeModulesToBoundDir(missingInDir);
      } else {
        await writeTextFileInDir(dirHandle, 'manifest.json', JSON.stringify(buildManifestPayload(), null, 2));
      }
      await syncAllAssetsToBoundDir();

      dirtyModules.clear();
      setDirtyState(false);
      updateSyncUI();
      renderAll();
      if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
      showToast(`已绑定目录「${handle.name}」并加载 ${loadedKeys.size} 个模块文件`, 'success');
    } else {
      // 空目录：直接把当前全部分散模块写入初始化
      dirHandle = handle;
      pendingDirHandle = null;
      fileHandle = null;
      pendingSavedHandle = null;
      await idbPut('handles', handle, 'dataDir');

      const ok = await writeModulesToBoundDir([...MOD_KEYS]);
      await syncAllAssetsToBoundDir();
      dirtyModules.clear();
      setDirtyState(!ok);
      updateSyncUI();
      if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
      showToast(ok
        ? `已绑定目录「${handle.name}」，6 个模块 JSON 已分散写入！`
        : `已绑定目录「${handle.name}」，但初始写入失败，请点手动保存重试`, ok ? 'success' : 'warning');
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error('绑定目录失败', err);
      showToast('绑定本地数据目录失败，请确认已授予读写权限', 'error');
    }
  }
}

// 刷新后一键恢复目录（或兼容旧单文件）权限并按模块比对时间戳同步
async function reconnectLocalJson() {
  if (pendingDirHandle) {
    return reconnectDataDirectory();
  }
  if (!pendingSavedHandle) return;
  try {
    const perm = await pendingSavedHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      fileHandle = pendingSavedHandle;
      pendingSavedHandle = null;
      updateSyncUI();
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (text.trim()) {
        const diskData = normalizeData(JSON.parse(text));
        const diskTime = new Date(diskData.updatedAt || 0).getTime();
        const localTime = new Date(appData.updatedAt || 0).getTime();
        if (diskTime > localTime) {
          await createSnapshot('恢复同步前备份');
          await applyLegacyFullData(diskData);
          renderAll();
          showToast(`已恢复旧文件同步并加载较新的 ${fileHandle.name}（建议升级为「绑定目录」）`, 'success');
        } else {
          await writeToBoundFile();
          showToast(`已恢复旧文件同步，并将最新数据写回 ${fileHandle.name}`, 'success');
        }
      }
      setDirtyState(false);
    } else {
      showToast('未获得文件读写权限，已继续使用 IndexedDB 分模块库', 'warning');
    }
  } catch {
    showToast('恢复同步失败，建议直接点击「📁 绑定目录」升级为分模块目录同步', 'error');
  }
}

async function reconnectDataDirectory() {
  if (!pendingDirHandle) return;
  try {
    const perm = await pendingDirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      showToast('未获得目录读写权限，已继续使用 IndexedDB 分模块库', 'warning');
      return;
    }
    dirHandle = pendingDirHandle;
    pendingDirHandle = null;
    updateSyncUI();

    let manifestObj = null;
    const manifestText = await readTextFileInDir(dirHandle, 'manifest.json');
    try { if (manifestText) manifestObj = JSON.parse(manifestText); } catch {}

    let pulledCount = 0;
    let pushedKeys = [];
    let snapCreated = false;

    for (const m of STORAGE_MODULES) {
      const localTs = new Date((moduleMeta[m.key] && moduleMeta[m.key].updatedAt) || 0).getTime();
      const txt = await readTextFileInDir(dirHandle, m.file);
      if (txt && txt.trim()) {
        try {
          const diskParsed = JSON.parse(txt);
          const diskIso = diskParsed.updatedAt || (manifestObj && manifestObj.modules && manifestObj.modules[m.key] && manifestObj.modules[m.key].updatedAt) || '';
          const diskTs = new Date(diskIso || 0).getTime();
          if (diskTs > localTs && !dirtyModules.has(m.key)) {
            if (!snapCreated) {
              await createSnapshot('恢复目录同步前备份');
              snapCreated = true;
            }
            setModuleData(m.key, diskParsed);
            moduleMeta[m.key] = { updatedAt: diskIso || new Date().toISOString(), count: getModuleCount(m.key) };
            await idbPut('modules', buildModuleEnvelope(m.key), m.key);
            saveModuleLocalMirror(m.key);
            pulledCount++;
          } else if (localTs > diskTs || dirtyModules.has(m.key)) {
            pushedKeys.push(m.key);
          }
        } catch {
          pushedKeys.push(m.key);
        }
      } else {
        pushedKeys.push(m.key);
      }
    }

    await pullMissingAssetsFromBoundDir();
    if (pushedKeys.length) {
      await writeModulesToBoundDir(pushedKeys);
    }
    await syncAllAssetsToBoundDir();
    await idbPut('modules', buildManifestPayload(), 'meta');
    saveModuleLocalMirror('meta');

    dirtyModules.clear();
    setDirtyState(false);
    updateSyncUI();
    if (pulledCount > 0) renderAll();
    if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();

    if (pulledCount > 0 && pushedKeys.length > 0) {
      showToast(`已恢复目录「${dirHandle.name}」：拉取 ${pulledCount} 个模块，写回 ${pushedKeys.length} 个模块`, 'success');
    } else if (pulledCount > 0) {
      showToast(`已恢复目录「${dirHandle.name}」并同步硬盘中较新的 ${pulledCount} 个模块`, 'success');
    } else {
      showToast(`已恢复目录「${dirHandle.name}」同步${pushedKeys.length ? `（已写回 ${pushedKeys.length} 个模块）` : ''}`, 'success');
    }
  } catch (err) {
    console.error('恢复目录同步失败', err);
    showToast('恢复目录同步失败，请重新点击「📁 绑定目录」', 'error');
  }
}

// 兼容别名
function bindLocalJson() {
  return bindDataDirectory();
}

// =========================================================================
// 9. 图片资产导入/导出辅助（仅便携单文件下载时附带 _assets，目录内保持纯文本 JSON + assets/）
// =========================================================================
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  if (parts.length < 2) return null;
  const match = parts[0].match(/:(.*?);/);
  const mime = match ? match[1] : 'image/webp';
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function collectReferencedAssetsAsDataUrls() {
  const map = {};
  const records = (appData.politics && appData.politics.records) || [];
  const ids = [...new Set(records.map(r => r.imageId).filter(Boolean))];
  for (const id of ids) {
    let asset = await idbGetAsset(id);
    if (!asset && dirHandle) asset = await readAssetFromBoundDir(id);
    if (asset && asset.blob) {
      try { map[id] = await blobToDataURL(asset.blob); } catch {}
    }
  }
  return map;
}

async function restoreEmbeddedAssets(assetsMap) {
  if (!assetsMap || typeof assetsMap !== 'object') return 0;
  let restored = 0;
  for (const [id, dataUrl] of Object.entries(assetsMap)) {
    if (!id || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
    try {
      const blob = dataURLToBlob(dataUrl);
      if (!blob) continue;
      await idbPutAsset({ id, blob, mime: blob.type, size: blob.size, createdAt: Date.now() });
      if (dirHandle) await writeAssetToBoundDir(id, blob);
      restored++;
    } catch {}
  }
  return restored;
}

// =========================================================================
// 10. 智能导入（兼容旧版 v3/v4 单文件、v5 全量包、单模块 JSON）与单模块/全量导出
// =========================================================================
function triggerModuleImport(modKey = '') {
  storageImportTargetMod = modKey;
  const input = document.getElementById('importFileInput');
  if (input) input.click();
}

async function applyLegacyFullData(parsedNormalized) {
  const changed = ['math', '408', 'todos', 'papers'];
  appData.math = parsedNormalized.math;
  appData['408'] = parsedNormalized['408'];
  appData.todos = parsedNormalized.todos;
  appData.papers = parsedNormalized.papers;
  if (parsedNormalized.politics && Array.isArray(parsedNormalized.politics.records) && parsedNormalized.politics.records.length) {
    // 仅当旧文件明确带 politics 时覆盖；若旧 v4 文件没有 politics，保留现有政治数据不误清空
    if (parsedNormalized._hasPoliticsInSource) {
      appData.politics = parsedNormalized.politics;
      changed.push('politics');
    }
  }
  if (Array.isArray(parsedNormalized._migratedReadings) && parsedNormalized._migratedReadings.length) {
    const map = new Map(readingStore.map(r => [r.id, r]));
    parsedNormalized._migratedReadings.forEach(r => map.set(r.id, r));
    readingStore = [...map.values()];
    delete parsedNormalized._migratedReadings;
    changed.push('readings');
  }
  await persistModules(changed, true);
}

function handleImportFile(event) {
  const file = event.target.files[0];
  const targetMod = storageImportTargetMod;
  storageImportTargetMod = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      await createSnapshot(`导入 ${file.name} 前备份`);

      // 1) 指定了目标模块的单模块导入
      if (targetMod && MOD_KEYS.includes(targetMod)) {
        const def = getModuleMetaDef(targetMod);
        setModuleData(targetMod, parsed);
        if (parsed._assets) await restoreEmbeddedAssets(parsed._assets);
        await persistModule(targetMod, true);
        renderAll();
        if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
        showToast(`已成功导入「${def.label}」模块（${getModuleCount(targetMod)} 条）`, 'success');
        return;
      }

      // 2) 自动识别 v5 全量打包备份（含 modules 对象）
      if (parsed && typeof parsed === 'object' && parsed.modules && typeof parsed.modules === 'object') {
        const importedKeys = [];
        for (const m of STORAGE_MODULES) {
          if (parsed.modules[m.key] !== undefined) {
            setModuleData(m.key, parsed.modules[m.key]);
            importedKeys.push(m.key);
          }
        }
        if (parsed._assets) await restoreEmbeddedAssets(parsed._assets);
        if (!importedKeys.length) {
          showToast('未在文件中识别到任何模块数据', 'error');
          return;
        }
        await persistModules(importedKeys, true);
        renderAll();
        if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
        showToast(`已导入全量备份（拆分为 ${importedKeys.length} 个独立模块）`, 'success');
        return;
      }

      // 3) 自动识别 v5 单模块文件（含 module 字段）
      if (parsed && typeof parsed === 'object' && MOD_KEYS.includes(parsed.module)) {
        const def = getModuleMetaDef(parsed.module);
        setModuleData(parsed.module, parsed);
        if (parsed._assets) await restoreEmbeddedAssets(parsed._assets);
        await persistModule(parsed.module, true);
        renderAll();
        if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
        showToast(`已识别并导入单模块「${def.label}」（${getModuleCount(parsed.module)} 条）`, 'success');
        return;
      }

      // 4) 自动识别旧版独立英语阅读库 JSON
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.readings) && !parsed.math && !parsed['408']) {
        setModuleData('readings', parsed.readings);
        await persistModule('readings', true);
        renderAll();
        if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
        showToast(`已识别并导入英语阅读库（${readingStore.length} 篇）`, 'success');
        return;
      }

      // 5) 自动识别旧版 v3/v4 单文件全量 JSON（自动拆分归位到各模块，保留现有政治数据）
      if (parsed && typeof parsed === 'object' && (parsed.math || parsed['408'] || parsed.todos || parsed.papers || parsed.politics)) {
        const norm = normalizeData(parsed);
        norm._hasPoliticsInSource = Boolean(parsed.politics);
        await applyLegacyFullData(norm);
        renderAll();
        if (document.getElementById('storageModal')?.classList.contains('open')) renderStorageModalBody();
        showToast(`已将旧版文件 ${file.name} 自动拆分归位到各独立模块！`, 'success');
        return;
      }

      showToast('未识别该 JSON 格式，请检查文件内容', 'error');
    } catch (err) {
      console.error('导入 JSON 失败', err);
      showToast('JSON 解析失败，请检查文件内容', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}

function downloadJsonFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportModuleJson(modKey) {
  const def = getModuleMetaDef(modKey);
  if (!def) return;
  const payload = buildModuleEnvelope(modKey);
  if (modKey === 'politics') {
    const assets = await collectReferencedAssetsAsDataUrls();
    if (Object.keys(assets).length) payload._assets = assets;
  }
  downloadJsonFile(payload, def.file);
  showToast(`已导出「${def.label}」独立文件：${def.file}`, 'success');
}

async function exportFullBundleJson() {
  const modulesObj = {};
  STORAGE_MODULES.forEach(m => { modulesObj[m.key] = buildModuleEnvelope(m.key); });
  const assets = await collectReferencedAssetsAsDataUrls();
  const payload = {
    app: '考研复盘工作台（数学 · 408 · 政治 · 英语）',
    schemaVersion: STORAGE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    modules: modulesObj
  };
  if (Object.keys(assets).length) payload._assets = assets;
  downloadJsonFile(payload, `kaoyan_bundle_v5_${todayISO()}.json`);
  showToast('已导出全量分模块备份包（含全部 6 个模块）', 'success');
}

// 兼容顶栏旧调用
function exportJson() {
  return exportFullBundleJson();
}

// =========================================================================
// 11. 🗄️ 分模块存储中心弹窗
// =========================================================================
function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function estimateJsonBytes(obj) {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}

async function openStorageModal() {
  await renderStorageModalBody();
  document.getElementById('storageModal').classList.add('open');
}

function closeStorageModal() {
  const m = document.getElementById('storageModal');
  if (m) m.classList.remove('open');
}

async function forceSyncAllToDir() {
  if (!dirHandle) {
    showToast('请先绑定一个本地数据目录', 'warning');
    return;
  }
  const ok = await writeModulesToBoundDir([...MOD_KEYS]);
  await syncAllAssetsToBoundDir();
  if (ok) {
    dirtyModules.clear();
    setDirtyState(false);
    await renderStorageModalBody();
    showToast(`已将全部 6 个模块与图片资产完整写入目录「${dirHandle.name}」`, 'success');
  } else {
    showToast('同步写入目录失败，请重新授权目录权限', 'error');
  }
}

async function cleanupOrphanAssets() {
  const allAssets = await idbGetAllAssets();
  const usedIds = new Set(
    ((appData.politics && appData.politics.records) || []).map(r => r.imageId).filter(Boolean)
  );
  const orphans = allAssets.filter(a => a && a.id && !usedIds.has(a.id));
  if (!orphans.length) {
    showToast('没有未引用的孤立截图，存储很干净 ✨', 'info');
    return;
  }
  const ok = await showConfirm({
    title: '清理未引用截图',
    message: `检测到 ${orphans.length} 张未被任何政治错题引用的截图（共 ${formatBytes(orphans.reduce((s, a) => s + (a.size || 0), 0))}），确认清理吗？`,
    okText: '确认清理',
    danger: true
  });
  if (!ok) return;
  for (const a of orphans) {
    await idbDeleteAsset(a.id);
    if (dirHandle) await deleteAssetFromBoundDir(a.id);
  }
  await renderStorageModalBody();
  showToast(`已清理 ${orphans.length} 张未引用截图`, 'success');
}

async function renderStorageModalBody() {
  const container = document.getElementById('storageModalBody');
  if (!container) return;

  ensureModuleMetaDefaults();
  const allAssets = await idbGetAllAssets();
  const assetBytes = allAssets.reduce((sum, a) => sum + (a.size || (a.blob ? a.blob.size : 0)), 0);
  const usedAssetIds = new Set(
    ((appData.politics && appData.politics.records) || []).map(r => r.imageId).filter(Boolean)
  );
  const orphanCount = allAssets.filter(a => a && a.id && !usedAssetIds.has(a.id)).length;

  let dirStatusHtml = '';
  if (dirHandle) {
    dirStatusHtml = `
      <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg shrink-0">📁</div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-emerald-900 truncate">已绑定本地数据目录：${escapeHtml(dirHandle.name)}</div>
            <div class="text-xs text-emerald-700 mt-0.5">改动任一模块时仅增量写入对应 JSON 文件与 manifest.json，互不干扰</div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button onclick="forceSyncAllToDir()" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs">🔄 全量写盘</button>
          <button onclick="bindDataDirectory()" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-100">切换目录</button>
        </div>
      </div>`;
  } else if (pendingDirHandle) {
    dirStatusHtml = `
      <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-amber-50/90 border border-amber-200">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg shrink-0">⏳</div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-amber-900 truncate">上次绑定目录待恢复授权：${escapeHtml(pendingDirHandle.name)}</div>
            <div class="text-xs text-amber-700 mt-0.5">浏览器刷新后需要点一次授权，即可自动比对并恢复 6 个模块同步</div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="reconnectDataDirectory()" class="btn-tactile px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 shadow-xs">🔄 一键恢复目录同步</button>
          <button onclick="bindDataDirectory()" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-white text-amber-800 border border-amber-300 hover:bg-amber-100">换个目录</button>
        </div>
      </div>`;
  } else {
    dirStatusHtml = `
      <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-indigo-50/75 border border-indigo-200/80">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg shrink-0">🗄️</div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-slate-900">当前运行于 IndexedDB v2 分模块本地库</div>
            <div class="text-xs text-slate-600 mt-0.5">推荐绑定一个本地文件夹（如 <code class="px-1 py-0.5 rounded bg-white border border-indigo-200 text-indigo-700">kaoyan-data/</code>），自动把 6 大模块拆成独立 JSON 落盘</div>
          </div>
        </div>
        <button onclick="bindDataDirectory()" class="btn-tactile px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs shrink-0">📁 绑定本地数据目录</button>
      </div>`;
  }

  let totalBytes = 0;
  const modCardsHtml = STORAGE_MODULES.map(m => {
    const env = buildModuleEnvelope(m.key);
    const bytes = estimateJsonBytes(env);
    totalBytes += bytes;
    const isModDirty = dirtyModules.has(m.key);
    const meta = moduleMeta[m.key] || {};
    const updatedText = meta.updatedAt ? formatDateTime(new Date(meta.updatedAt).getTime()) : '—';
    return `
      <div class="bg-white border border-slate-200/90 rounded-2xl p-3.5 flex flex-col justify-between gap-3 hover:border-blue-200 transition-colors">
        <div>
          <div class="flex items-center justify-between gap-2 mb-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg">${m.icon}</span>
              <span class="text-sm font-bold text-slate-800 truncate">${escapeHtml(m.label)}</span>
            </div>
            <span class="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 text-slate-600 border border-slate-200/70 shrink-0">${m.file}</span>
          </div>
          <p class="text-[11px] text-slate-400 mb-2.5">${escapeHtml(m.desc)}</p>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>条数：<b class="text-slate-900 tabular-nums">${env.count}</b></span>
            <span>体积：<b class="text-slate-900 tabular-nums">${formatBytes(bytes)}</b></span>
            ${isModDirty
              ? `<span class="text-amber-600 font-semibold">● 待写盘</span>`
              : `<span class="text-emerald-600 font-semibold">● 已同步</span>`}
          </div>
          <div class="text-[11px] text-slate-400 mt-1">更新：${updatedText}</div>
        </div>
        <div class="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100">
          <button onclick="triggerModuleImport('${m.key}')" class="btn-tactile py-1.5 rounded-xl text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200">📥 单独导入</button>
          <button onclick="exportModuleJson('${m.key}')" class="btn-tactile py-1.5 rounded-xl text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200">📤 单独导出</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    ${dirStatusHtml}

    <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div class="text-xs font-bold text-slate-600">六大独立存储模块（文本总计 ${formatBytes(totalBytes)}）</div>
      <div class="flex flex-wrap items-center gap-2">
        <button onclick="triggerModuleImport('')" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">📥 智能导入（旧单文件 / 全量包 / 单模块）</button>
        <button onclick="exportFullBundleJson()" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-white hover:bg-slate-900">📤 导出全量打包备份</button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      ${modCardsHtml}
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
      <div class="flex items-center gap-2.5 text-slate-600">
        <span class="text-base">🖼️</span>
        <div>
          <span class="font-bold text-slate-800">原题截图资产库</span>
          <span class="ml-1.5 font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500">assets/</span>
          <span class="ml-2">已存 <b>${allAssets.length}</b> 张 · 占用 <b>${formatBytes(assetBytes)}</b>${orphanCount ? ` · <span class="text-amber-600 font-semibold">${orphanCount} 张未引用</span>` : ''}</span>
        </div>
      </div>
      <button onclick="cleanupOrphanAssets()" class="btn-tactile px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200">🧹 清理未引用截图</button>
    </div>
  `;
}
