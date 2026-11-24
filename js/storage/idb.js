// IndexedDB 封装与历史快照存取
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 2. IndexedDB 封装（Tier 1: 主存储 + 文件句柄记忆 + 滚动历史快照）
// =========================================================================
    // 打开 IndexedDB 主库：建 state/handles/snapshots 三个存储；不可用时降级返回 null
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
    if (!dbInstance) return resolve(null);
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


// 向 IndexedDB 指定存储写入一个值，可指定键；返回是否成功
// 注意：必须等事务 oncomplete 才算真正落盘，req.onsuccess 时事务尚未提交
function idbPut(storeName, value, key = undefined) {
  return new Promise((resolve) => {
    if (!dbInstance) return resolve(false);
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


// 读取全部历史快照并按时间倒序返回
function idbGetAllSnapshots() {
  return new Promise((resolve) => {
    if (!dbInstance) return resolve([]);
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


// 生成一条历史快照（含全量数据深拷贝），并滚动保留最近 MAX_SNAPSHOTS 条
async function createSnapshot(reason = '手动保存') {
  if (!dbInstance) return;
  const snap = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: Date.now(),
    reason,
    mathCount: appData.math.records.length,
    cs408Count: appData['408'].records.length,
    todoCount: appData.todos.length,
    data: JSON.parse(JSON.stringify(appData))
  };
  await idbPut('snapshots', snap);

  // 保持最多 15 条滚动快照
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
