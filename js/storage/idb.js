// IndexedDB v2 封装（分模块对象仓库 + 图片资产仓库 + 句柄记忆 + 滚动历史快照）
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 2. IndexedDB v2 封装
//    - modules   : 按模块独立键存储（math / 408 / politics / todos / papers / readings / meta）
//    - assets    : 二进制图片资源（keyPath: 'id'，存放政治错题截图，不膨胀 JSON）
//    - handles   : 本地数据目录 / 兼容文件句柄记忆
//    - snapshots : 最近 MAX_SNAPSHOTS 条历史滚动快照
//    - state     : 保留旧版 v1 仓库，用于首次升级无损迁移
// =========================================================================
function openDatabase() {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state');
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('modules')) {
          db.createObjectStore('modules');
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      console.warn('IndexedDB 不可用，将降级使用 localStorage', err);
      resolve(null);
    }
  });
}


// 从 IndexedDB 指定存储读取一个键值，失败返回 null
function idbGet(storeName, key) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve(null);
    try {
      const tx = dbInstance.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}


// 向 IndexedDB 指定存储写入一个值，可指定键；等待事务 oncomplete 确保真正落盘
function idbPut(storeName, value, key = undefined) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve(false);
    try {
      const tx = dbInstance.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (key !== undefined) store.put(value, key); else store.put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}


// 从 IndexedDB 指定存储删除一个键
function idbDelete(storeName, key) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve(false);
    try {
      const tx = dbInstance.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}


// 读取 IndexedDB 指定存储中的全部记录
function idbGetAll(storeName) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve([]);
    try {
      const tx = dbInstance.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}


// 读取 IndexedDB 指定存储中的全部 Key
function idbGetAllKeys(storeName) {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains(storeName)) return resolve([]);
    try {
      const tx = dbInstance.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAllKeys();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}


// 图片资产专用封装（存于 assets 仓库，每条：{ id, blob, mime, size, createdAt }）
function idbPutAsset(asset) {
  if (!asset || !asset.id) return Promise.resolve(false);
  return idbPut('assets', asset);
}

function idbGetAsset(id) {
  if (!id) return Promise.resolve(null);
  return idbGet('assets', id);
}

function idbDeleteAsset(id) {
  if (!id) return Promise.resolve(false);
  return idbDelete('assets', id);
}

function idbGetAllAssets() {
  return idbGetAll('assets');
}


// 读取全部历史快照并按时间倒序返回
function idbGetAllSnapshots() {
  return new Promise((resolve) => {
    if (!dbInstance || !dbInstance.objectStoreNames.contains('snapshots')) return resolve([]);
    try {
      const tx = dbInstance.transaction('snapshots', 'readonly');
      const req = tx.objectStore('snapshots').getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? req.result : [];
        list.sort((a, b) => b.timestamp - a.timestamp);
        resolve(list);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}


// 生成一条历史快照（按 6 大模块独立保存深拷贝），并滚动保留最近 MAX_SNAPSHOTS 条
async function createSnapshot(reason = '手动保存') {
  if (!dbInstance) return;
  const rList = typeof readingStore !== 'undefined' && Array.isArray(readingStore) ? readingStore : [];
  const polList = appData.politics && Array.isArray(appData.politics.records) ? appData.politics.records : [];
  const snap = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    timestamp: Date.now(),
    reason,
    mathCount: appData.math.records.length,
    cs408Count: appData['408'].records.length,
    politicsCount: polList.length,
    todoCount: appData.todos.length,
    paperCount: (appData.papers || []).length,
    readingCount: rList.length,
    modules: {
      math: JSON.parse(JSON.stringify(appData.math)),
      '408': JSON.parse(JSON.stringify(appData['408'])),
      politics: JSON.parse(JSON.stringify(appData.politics || { subjects: [...POLITICS_SUBJECTS], records: [] })),
      todos: JSON.parse(JSON.stringify(appData.todos || [])),
      papers: JSON.parse(JSON.stringify(appData.papers || [])),
      readings: JSON.parse(JSON.stringify(rList))
    }
  };
  await idbPut('snapshots', snap);

  // 保持最多 MAX_SNAPSHOTS 条滚动快照
  const all = await idbGetAllSnapshots();
  if (all.length > MAX_SNAPSHOTS) {
    const toDelete = all.slice(MAX_SNAPSHOTS);
    await new Promise((resolve) => {
      try {
        const tx = dbInstance.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        toDelete.forEach(s => store.delete(s.id));
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => { console.warn('清理旧快照失败', tx.error); resolve(); };
      } catch (err) {
        console.warn('清理旧快照失败', err);
        resolve();
      }
    });
  }
  await refreshSnapshotCount();
}


// 刷新顶部“历史快照”按钮上的数量徽章
async function refreshSnapshotCount() {
  const all = await idbGetAllSnapshots();
  const badge = document.getElementById('snapshotCountBadge');
  if (badge) badge.textContent = all.length;
}
