// 英语阅读总结：独立存储库、与主 JSON 关联索引、按段落粘贴与管理、段落级段意笔记、
// 全文 Markdown 分屏总结、高亮批注、自测遮挡复习与分段撤回/重做
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享
//
// 存储架构：
// 1. 独立阅读库 readingStore[] 存在 IndexedDB ('state' -> 'readings') + localStorage (LS_READING_STORE_KEY)
//    并可独立绑定/导出/导入本地阅读库文件（如 english_readings.json），绝不把长篇原文写入主 JSON。
// 2. 与主 JSON 的关联：每次阅读库更新时，自动向 appData.readingIndex 同步轻量级索引
//    { id, title, source, dateStr, wordCount, annCount, hasSummary, updatedAt }，保持与主 JSON 的双向联系。

const READING_COLORS = ['yellow', 'green', 'blue', 'pink'];
const READING_COLOR_NAMES = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉' };
const READING_KIND_NAMES = { word: '单词', phrase: '短语', sentence: '句子' };
const READING_PARA_ROLES = [
  { value: '', label: '未标作用', cls: 'bg-slate-100 text-slate-500' },
  { value: '引入', label: '引入背景', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: '观点', label: '核心观点', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: '论据', label: '举例论据', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: '转折', label: '转折反驳', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: '对比', label: '对比分析', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  { value: '批判', label: '批评质疑', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: '结论', label: '总结展望', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
];
const LS_READING_KEY = 'kaoyan_reading_prefs_v1';

let readingCurrentId = '';
let readingFilter = 'all';         // 批注侧栏类型筛选：all / word / phrase / sentence / noted
let readingColorFilter = '';       // 批注侧栏颜色筛选：'' / yellow / green / blue / pink
let readingAnnSearch = '';         // 批注侧栏关键词搜索
let readingSearch = '';            // 左侧文章搜索
let readingListSourceFilter = '';  // 左侧来源筛选
let readingListStatusFilter = 'all'; // 左侧状态筛选：all / summarized / unsummarized / hasGist
let readingFontSize = 18;
let readingSummaryMode = 'edit';   // edit / split / preview
let readingPendingSel = null;      // 当前选区 { start, end } 或 { annId }
let readingSummaryTimer = null;
let readingParaNoteTimer = null;
let readingLeftCollapsed = false;  // 左侧文章栏是否收起
let readingRightCollapsed = false; // 右侧批注栏是否收起
let readingShowParaGists = false;  // 是否全局展开每段「段意笔记」栏
let readingExpandedGistKeys = new Set(); // 单独展开段意编辑的段落 key
let readingShowInlineAppend = false; // 阅读器底部「按段追加」抽屉是否展开
let readingQuizMode = false;       // 右侧批注栏自测遮挡模式

// 撤回 / 重做栈：
// 1) 阅读器内按文章 id 保存的原文分段历史 { [id]: { undo: [{text, annotations, label}], redo: [...] } }
const readingHistoryMap = {};
// 2) 文章编辑弹窗内的状态
let modalTextUndoStack = [];
let modalReadingMode = 'paras'; // paras | full
let modalReadingParas = [];

// ---------- 偏好 ----------
function loadReadingPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_READING_KEY) || '{}');
    if (p.currentId) readingCurrentId = p.currentId;
    if (p.fontSize) readingFontSize = Math.min(26, Math.max(14, p.fontSize));
    if (typeof p.leftCollapsed === 'boolean') readingLeftCollapsed = p.leftCollapsed;
    if (typeof p.rightCollapsed === 'boolean') readingRightCollapsed = p.rightCollapsed;
    if (typeof p.showParaGists === 'boolean') readingShowParaGists = p.showParaGists;
    if (typeof p.quizMode === 'boolean') readingQuizMode = p.quizMode;
    if (['edit', 'split', 'preview'].includes(p.summaryMode)) readingSummaryMode = p.summaryMode;
  } catch {}
}

function saveReadingPrefs() {
  try {
    localStorage.setItem(LS_READING_KEY, JSON.stringify({
      currentId: readingCurrentId,
      fontSize: readingFontSize,
      leftCollapsed: readingLeftCollapsed,
      rightCollapsed: readingRightCollapsed,
      showParaGists: readingShowParaGists,
      quizMode: readingQuizMode,
      summaryMode: readingSummaryMode
    }));
  } catch {}
}

function toggleReadingLeftPane() {
  readingLeftCollapsed = !readingLeftCollapsed;
  saveReadingPrefs();
  applyReadingPaneStates();
  renderReadingReader();
}

function toggleReadingRightPane() {
  readingRightCollapsed = !readingRightCollapsed;
  saveReadingPrefs();
  applyReadingPaneStates();
  renderReadingReader();
}

function applyReadingPaneStates() {
  const left = document.getElementById('reading-left-pane');
  if (left) left.classList.toggle('lg:hidden', readingLeftCollapsed);
  const right = document.getElementById('reading-right-pane');
  if (right) right.classList.toggle('lg:hidden', readingRightCollapsed);
  const qBtn = document.getElementById('rd-quiz-toggle-btn');
  if (qBtn) {
    qBtn.className = readingQuizMode
      ? 'btn-tactile px-2 py-1 rounded-lg text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300'
      : 'btn-tactile px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200';
    qBtn.textContent = readingQuizMode ? '👁️ 退出自测' : '🙈 自测';
  }
}

// =========================================================================
// 浏览器离线英语朗读（Web Speech API，无需网络/外接接口）
// =========================================================================
function speakReadingText(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (!window.speechSynthesis) {
    showToast('当前浏览器不支持语音朗读', 'warning');
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'en-US';
    utter.rate = clean.split(/\s+/).length <= 3 ? 0.9 : 0.96;
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const enVoice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (enVoice) utter.voice = enVoice;
    window.speechSynthesis.speak(utter);
  } catch {
    showToast('语音朗读启动失败', 'warning');
  }
}

function speakReadingQuoteInModal() {
  const q = document.getElementById('rdn-quote');
  if (q) speakReadingText(q.textContent);
}

// =========================================================================
// 段落指纹与偏移切分（保证所有批注 start/end 偏移 100% 精确不漂移）
// =========================================================================
function readingParaKey(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'p_' + (h >>> 0).toString(36) + '_' + s.length;
}

function getReadingParagraphs(text) {
  const src = String(text || '');
  if (!src.trim()) return [];
  const paras = [];
  const re = /\n[ \t]*\n+/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      const seg = src.slice(last, m.index);
      if (seg.trim()) {
        paras.push({
          index: paras.length,
          start: last,
          end: m.index,
          text: seg,
          key: readingParaKey(seg),
          wordCount: seg.trim().split(/\s+/).length
        });
      }
    }
    last = re.lastIndex;
  }
  if (last < src.length) {
    const seg = src.slice(last);
    if (seg.trim()) {
      paras.push({
        index: paras.length,
        start: last,
        end: src.length,
        text: seg,
        key: readingParaKey(seg),
        wordCount: seg.trim().split(/\s+/).length
      });
    }
  }
  return paras;
}

function getParaRoleMeta(roleVal) {
  return READING_PARA_ROLES.find(x => x.value === roleVal) || READING_PARA_ROLES[0];
}

function countFilledParaGists(r) {
  if (!r || !r.paraNotes) return 0;
  const paras = getReadingParagraphs(r.text);
  return paras.filter(p => {
    const note = r.paraNotes[p.key];
    return note && ((note.gist && note.gist.trim()) || (note.role && note.role.trim()));
  }).length;
}

// =========================================================================
// 独立存储与主 JSON 关联同步
// =========================================================================
function buildReadingIndexItem(r) {
  const kws = r.text && r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
  return {
    id: r.id,
    title: r.title || '未命名文章',
    source: r.source || '',
    dateStr: r.dateStr || todayISO(),
    wordCount: kws,
    annCount: Array.isArray(r.annotations) ? r.annotations.length : 0,
    hasSummary: Boolean(r.summary && r.summary.trim()),
    updatedAt: r.updatedAt || Date.now()
  };
}

function syncReadingIndexToAppData() {
  if (!appData) return false;
  const nextIndex = (readingStore || []).map(buildReadingIndexItem);
  const prevJson = JSON.stringify(appData.readingIndex || []);
  const nextJson = JSON.stringify(nextIndex);
  if ('readings' in appData) delete appData.readings;
  if ('_migratedReadings' in appData) delete appData._migratedReadings;
  if (prevJson !== nextJson) {
    appData.readingIndex = nextIndex;
    return true;
  }
  return false;
}

async function absorbMigratedReadingsFromAppData() {
  if (!appData || !Array.isArray(appData._migratedReadings) || !appData._migratedReadings.length) {
    if (appData && 'readings' in appData) delete appData.readings;
    return;
  }
  const incoming = appData._migratedReadings;
  delete appData._migratedReadings;
  if ('readings' in appData) delete appData.readings;

  const map = new Map((readingStore || []).map(r => [r.id, r]));
  incoming.forEach(r => {
    const clean = migrateReading(r);
    const exist = map.get(clean.id);
    if (!exist || (clean.updatedAt || 0) >= (exist.updatedAt || 0)) {
      map.set(clean.id, clean);
    }
  });
  readingStore = [...map.values()];
  await persistReadingStore(true);
}

async function initReadingStore() {
  // v5 分模块引擎（initModularStorage）已从 IndexedDB `modules -> readings` 完成加载与旧数据迁移
  if (!Array.isArray(readingStore)) readingStore = [];

  // 若尚未绑定统一本地数据目录，兼容检查旧版单独绑定的阅读库文件句柄
  if (!dirHandle && !pendingDirHandle) {
    const savedHandle = await idbGet('handles', 'readingJsonFile');
    if (savedHandle && typeof savedHandle.queryPermission === 'function') {
      try {
        const perm = await savedHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          readingFileHandle = savedHandle;
        } else {
          pendingReadingHandle = savedHandle;
        }
      } catch {
        pendingReadingHandle = savedHandle;
      }
    }
  }
  updateReadingStoreUI();
}

function saveReadingLocalMirror() {
  if (typeof saveModuleLocalMirror === 'function') {
    saveModuleLocalMirror('readings');
  }
}

let readingWriteChain = Promise.resolve();
function writeToReadingBoundFile() {
  const run = readingWriteChain.then(async () => {
    if (!readingFileHandle) return false;
    try {
      const payload = typeof buildModuleEnvelope === 'function'
        ? buildModuleEnvelope('readings')
        : {
            app: '英语阅读独立存储库',
            schemaVersion: STORAGE_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            readings: readingStore
          };
      const writable = await readingFileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.error('写入独立阅读 JSON 失败', err);
      return false;
    }
  });
  readingWriteChain = run.catch(() => false);
  return run;
}

async function persistReadingStore(silent = false) {
  syncReadingIndexToAppData();
  if (typeof persistModule === 'function') {
    await persistModule('readings', true);
  }
  if (!dirHandle && readingFileHandle) {
    writeToReadingBoundFile();
  }
  updateReadingStoreUI();
  if (!silent) showToast('阅读数据已保存至 readings.json 独立模块库', 'success');
}

function updateReadingStoreUI() {
  const dot = document.getElementById('readingStoreDot');
  const text = document.getElementById('readingStoreText');
  const badge = document.getElementById('readingStoreBadge');
  const recBtn = document.getElementById('readingReconnectBtn');
  if (!dot || !text || !badge || !recBtn) return;

  if (dirHandle) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0';
    text.textContent = `目录同步：readings.json`;
    recBtn.classList.add('hidden');
  } else if (pendingDirHandle) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0';
    text.textContent = `待恢复目录：${pendingDirHandle.name}`;
    recBtn.textContent = '恢复目录';
    recBtn.onclick = () => reconnectDataDirectory();
    recBtn.classList.remove('hidden');
  } else if (readingFileHandle) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0';
    text.textContent = `旧独立文件：${readingFileHandle.name}`;
    recBtn.classList.add('hidden');
  } else if (pendingReadingHandle) {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0';
    text.textContent = `待恢复：${pendingReadingHandle.name}`;
    recBtn.textContent = '恢复文件';
    recBtn.onclick = () => reconnectReadingJson();
    recBtn.classList.remove('hidden');
  } else {
    dot.className = 'w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0';
    text.textContent = `独立模块 readings.json (${readingStore.length}篇)`;
    recBtn.classList.add('hidden');
  }
  badge.title = `${text.textContent}（英语阅读数据在 IndexedDB 与数据目录中独立存放于 readings.json）`;
}

async function bindReadingJson() {
  if (!window.showOpenFilePicker) {
    showToast('当前浏览器不支持直接绑定，请使用阅读库的“导入 / 导出”', 'warning');
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: '英语阅读独立库 JSON', accept: { 'application/json': ['.json'] } }]
    });
    const file = await handle.getFile();
    const text = await file.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.readings) ? parsed.readings : null));
      if (!arr) {
        showToast('该文件不是有效的阅读库 JSON（如需绑定主数据请用顶栏的绑定JSON）', 'error');
        return;
      }
      await createSnapshot(`绑定阅读库前备份 (${file.name})`);
      readingStore = arr.map(migrateReading);
    }
    readingFileHandle = handle;
    pendingReadingHandle = null;
    await idbPut('handles', handle, 'readingJsonFile');
    await persistReadingStore(true);
    await writeToReadingBoundFile();
    renderReadings();
    showToast(`已绑定独立阅读库文件：${file.name}`, 'success');
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      showToast('绑定阅读库文件失败，请检查 JSON 格式', 'error');
    }
  }
}

async function reconnectReadingJson() {
  if (!pendingReadingHandle) return;
  try {
    const perm = await pendingReadingHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      readingFileHandle = pendingReadingHandle;
      pendingReadingHandle = null;
      const file = await readingFileHandle.getFile();
      const text = await file.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.readings) ? parsed.readings : null);
        if (arr) {
          readingStore = arr.map(migrateReading);
          await persistReadingStore(true);
          renderReadings();
        }
      } else {
        await writeToReadingBoundFile();
      }
      updateReadingStoreUI();
      showToast(`已恢复独立阅读库同步：${readingFileHandle.name}`, 'success');
    }
  } catch {
    showToast('恢复独立阅读库失败，请重新点击「📂 绑定库」', 'error');
  }
}

function exportReadingJson() {
  if (typeof exportModuleJson === 'function') {
    exportModuleJson('readings');
    return;
  }
  const payload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    module: 'readings',
    label: '英语阅读',
    updatedAt: new Date().toISOString(),
    data: readingStore
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `readings.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出英语阅读模块 readings.json', 'success');
}

function handleImportReadingFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const arr = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.data) ? parsed.data : (Array.isArray(parsed.readings) ? parsed.readings : null));
      if (!arr) {
        showToast('未识别到阅读文章列表，请检查 JSON 文件', 'error');
        return;
      }
      await createSnapshot(`导入阅读库 ${file.name} 前备份`);
      readingStore = arr.map(migrateReading);
      await persistReadingStore(true);
      renderReadings();
      showToast(`已导入 ${readingStore.length} 篇阅读文章到独立模块 readings.json`, 'success');
    } catch {
      showToast('阅读库 JSON 解析失败', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
  event.target.value = '';
}

// =========================================================================
// 数据规范化与撤回/重做历史管理
// =========================================================================
function parseOptInt(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : '';
}

function migrateReading(r) {
  const text = String(r.text || '').replace(/\r\n?/g, '\n');
  const paraNotes = {};
  if (r.paraNotes && typeof r.paraNotes === 'object') {
    for (const [k, v] of Object.entries(r.paraNotes)) {
      if (v && typeof v === 'object') {
        paraNotes[k] = {
          role: String(v.role || ''),
          gist: String(v.gist || '')
        };
      }
    }
  }
  return {
    id: r.id || genId('read'),
    title: r.title || '未命名文章',
    source: r.source || '',
    topic: String(r.topic || ''),
    dateStr: slashToIso(r.dateStr || todayISO()),
    correctCount: parseOptInt(r.correctCount),
    totalCount: parseOptInt(r.totalCount),
    durationMin: parseOptInt(r.durationMin),
    text,
    summary: r.summary || '',
    paraNotes,
    createdAt: r.createdAt || Date.now(),
    updatedAt: r.updatedAt || r.createdAt || Date.now(),
    annotations: (Array.isArray(r.annotations) ? r.annotations : [])
      .filter(a => a && Number.isFinite(a.start) && Number.isFinite(a.end) && a.end > a.start)
      .map(a => ({
        id: a.id || genId('ann'),
        start: a.start,
        end: a.end,
        quote: a.quote || text.slice(a.start, a.end),
        color: READING_COLORS.includes(a.color) ? a.color : 'yellow',
        kind: READING_KIND_NAMES[a.kind] ? a.kind : detectReadingKind(a.quote || ''),
        meaning: a.meaning || '',
        comment: a.comment || '',
        createdAt: a.createdAt || Date.now()
      }))
  };
}

function getCurrentReading() {
  return (readingStore || []).find(r => r.id === readingCurrentId) || null;
}

function pushReadingHistory(r, label = '分段修改') {
  if (!r) return;
  if (!readingHistoryMap[r.id]) readingHistoryMap[r.id] = { undo: [], redo: [] };
  const h = readingHistoryMap[r.id];
  h.undo.push({
    text: r.text,
    annotations: JSON.parse(JSON.stringify(r.annotations || [])),
    label
  });
  if (h.undo.length > 25) h.undo.shift();
  h.redo.length = 0;
}

function getReadingHistory(id) {
  return readingHistoryMap[id] || { undo: [], redo: [] };
}

async function undoReadingText() {
  const r = getCurrentReading();
  if (!r) return;
  const h = getReadingHistory(r.id);
  if (!h.undo.length) {
    showToast('没有可撤回的分段操作', 'info');
    return;
  }
  const prev = h.undo.pop();
  h.redo.push({
    text: r.text,
    annotations: JSON.parse(JSON.stringify(r.annotations || [])),
    label: prev.label
  });
  r.text = prev.text;
  r.annotations = prev.annotations;
  r.updatedAt = Date.now();
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  showToast(`已撤回：${prev.label}`, 'info');
}

async function redoReadingText() {
  const r = getCurrentReading();
  if (!r) return;
  const h = getReadingHistory(r.id);
  if (!h.redo.length) return;
  const next = h.redo.pop();
  h.undo.push({
    text: r.text,
    annotations: JSON.parse(JSON.stringify(r.annotations || [])),
    label: next.label
  });
  r.text = next.text;
  r.annotations = next.annotations;
  r.updatedAt = Date.now();
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  showToast(`已重做：${next.label}`, 'info');
}

function detectReadingKind(q) {
  const t = String(q || '').trim();
  if (!/\s/.test(t)) return 'word';
  if (/[.!?。！？;；]["'”’)\]]*$/.test(t) || t.split(/\s+/).length >= 10) return 'sentence';
  return 'phrase';
}

function reanchorAnnotations(text, anns) {
  let dropped = 0;
  const list = anns.map(a => {
    if (text.slice(a.start, a.end) === a.quote) return a;
    let best = -1, bestD = Infinity;
    let idx = a.quote ? text.indexOf(a.quote) : -1;
    while (idx !== -1) {
      const d = Math.abs(idx - a.start);
      if (d < bestD) { best = idx; bestD = d; }
      idx = text.indexOf(a.quote, idx + 1);
    }
    if (best < 0) { dropped++; return null; }
    return { ...a, start: best, end: best + a.quote.length };
  }).filter(Boolean);
  return { list, dropped };
}

function formatAccuracyBadge(r) {
  if (r.correctCount === '' || r.totalCount === '' || !r.totalCount) return '';
  const ratio = r.correctCount / r.totalCount;
  const cls = ratio >= 0.8
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ratio >= 0.6
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-rose-50 text-rose-700 border-rose-200';
  return `<span class="px-1.5 py-0.5 rounded-md border text-[11px] font-semibold ${cls}" title="做题正确率">🎯 ${r.correctCount}/${r.totalCount}</span>`;
}

// =========================================================================
// 渲染总入口
// =========================================================================
function renderReadings() {
  if (!document.getElementById('view-reading')) return;
  if (!getCurrentReading()) {
    const sorted = sortedReadings();
    readingCurrentId = sorted.length ? sorted[0].id : '';
  }
  applyReadingPaneStates();
  updateReadingStoreUI();
  populateReadingSourceFilter();
  renderReadingList();
  renderReadingReader();
  renderReadingSide();
}

function sortedReadings() {
  return [...(readingStore || [])].sort((a, b) =>
    (b.dateStr || '').localeCompare(a.dateStr || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
}

function populateReadingSourceFilter() {
  const sel = document.getElementById('reading-list-source-filter');
  if (!sel) return;
  const sources = [...new Set((readingStore || []).map(r => (r.source || '').trim()).filter(Boolean))];
  const curVal = readingListSourceFilter;
  sel.innerHTML = `<option value="">全部来源 (${(readingStore || []).length})</option>` +
    sources.map(s => `<option value="${escapeHtml(s)}" ${s === curVal ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  if (curVal && !sources.includes(curVal)) {
    readingListSourceFilter = '';
    sel.value = '';
  }
}

function onReadingListFilterChange() {
  const srcSel = document.getElementById('reading-list-source-filter');
  const stSel = document.getElementById('reading-list-status-filter');
  readingListSourceFilter = srcSel ? srcSel.value : '';
  readingListStatusFilter = stSel ? stSel.value : 'all';
  renderReadingList();
}

// ---------- 左侧：文章列表 ----------
function renderReadingList() {
  const box = document.getElementById('reading-list');
  if (!box) return;
  const kw = readingSearch.trim().toLowerCase();
  const list = sortedReadings().filter(r => {
    if (readingListSourceFilter && (r.source || '').trim() !== readingListSourceFilter) return false;
    if (readingListStatusFilter === 'summarized' && !r.summary.trim()) return false;
    if (readingListStatusFilter === 'unsummarized' && r.summary.trim()) return false;
    if (readingListStatusFilter === 'hasGist' && countFilledParaGists(r) === 0) return false;
    if (!kw) return true;
    const gistsText = Object.values(r.paraNotes || {}).map(x => `${x.role || ''} ${x.gist || ''}`).join(' ');
    return [r.title, r.source, r.topic, r.summary, r.text, gistsText].some(s => String(s || '').toLowerCase().includes(kw)) ||
      r.annotations.some(a => (a.quote + a.meaning + a.comment).toLowerCase().includes(kw));
  });

  const storeIds = new Set((readingStore || []).map(r => r.id));
  const missingLinked = ((appData && appData.readingIndex) || []).filter(x => x.id && !storeIds.has(x.id));
  const missingBanner = missingLinked.length ? `
    <div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 space-y-1">
      <div class="font-bold">🔗 主 JSON 关联了 ${missingLinked.length} 篇文章尚未载入</div>
      <div class="text-amber-700">请点击上方「📂 绑定库」或「📥 导入」加载你的独立阅读库 JSON。</div>
    </div>` : '';

  if (!list.length) {
    box.innerHTML = missingBanner + `<div class="text-center text-xs text-slate-400 py-10 leading-relaxed">${(kw || readingListSourceFilter || readingListStatusFilter !== 'all') ? '没有符合筛选条件的文章' : '还没有文章<br>点上方「📄 PDF」拆真题<br>或点「＋ 新增」按段粘贴'}</div>`;
    return;
  }
  box.innerHTML = missingBanner + list.map(r => {
    const active = r.id === readingCurrentId;
    const words = r.annotations.filter(a => a.kind === 'word').length;
    const sents = r.annotations.filter(a => a.kind !== 'word').length;
    const paraTotal = getReadingParagraphs(r.text).length;
    const gistFilled = countFilledParaGists(r);
    const acc = (r.correctCount !== '' && r.totalCount) ? `${r.correctCount}/${r.totalCount}` : '';
    return `
      <button onclick="selectReading('${r.id}')" class="w-full text-left px-3 py-2.5 rounded-xl border transition-all ${active ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-slate-200/80 hover:border-blue-200 hover:bg-slate-50'}">
        <div class="text-sm font-semibold ${active ? 'text-blue-800' : 'text-slate-800'} line-clamp-2 break-words">${escapeHtml(r.title)}</div>
        <div class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <span>${escapeHtml(r.dateStr)}</span>
          ${r.source ? `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${escapeHtml(r.source)}</span>` : ''}
          ${r.topic ? `<span class="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">${escapeHtml(r.topic)}</span>` : ''}
          ${acc ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">🎯${acc}</span>` : ''}
        </div>
        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span title="单词批注">🔤 ${words}</span>
          <span title="句子/短语批注">✍️ ${sents}</span>
          ${gistFilled > 0 ? `<span title="已写段落大意" class="text-blue-600">🧭 ${gistFilled}/${paraTotal}</span>` : ''}
          ${r.summary.trim() ? '<span title="已写全文总结" class="text-emerald-600">📝 已总结</span>' : ''}
        </div>
      </button>`;
  }).join('');
}

function selectReading(id) {
  flushReadingSummary();
  flushParaNotes();
  readingCurrentId = id;
  readingFilter = 'all';
  readingColorFilter = '';
  readingAnnSearch = '';
  const annSearchEl = document.getElementById('reading-ann-search');
  if (annSearchEl) annSearchEl.value = '';
  readingExpandedGistKeys.clear();
  readingShowInlineAppend = false;
  saveReadingPrefs();
  hideReadingToolbar();
  renderReadings();
}

function onReadingSearch(v) {
  readingSearch = v || '';
  renderReadingList();
}

// ---------- 中间：段落卡片阅读器 + 段意笔记 + 全文总结 ----------
function renderReadingReader() {
  const box = document.getElementById('reading-reader');
  if (!box) return;
  const r = getCurrentReading();
  if (!r) {
    box.innerHTML = `
      <div class="flex flex-col items-center justify-center text-center py-24 px-6">
        <div class="text-5xl mb-3">📖</div>
        <div class="text-base font-bold text-slate-800">开始你的英语阅读精读与笔记</div>
        <p class="text-sm text-slate-500 mt-1.5 max-w-md leading-relaxed">
          支持 <b>上传考研真题/外刊 PDF 一键拆出文章</b>，或 <b>按段落连续粘贴</b>。<br>
          原文按段编号展示，支持逐段记录段意与结构作用、划词高亮、Markdown 精读总结与自测复习。
        </p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button onclick="openPdfImportModal()" class="btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm">📄 从 PDF 拆出文章</button>
          <button onclick="openReadingModal()" class="btn-tactile px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm">🧩 按段落粘贴新增</button>
        </div>
      </div>`;
    return;
  }

  const paras = getReadingParagraphs(r.text);
  const kws = r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
  const gistCount = countFilledParaGists(r);
  const hist = getReadingHistory(r.id);
  const canUndo = hist.undo.length > 0;
  const canRedo = hist.redo.length > 0;
  const lastUndoLabel = canUndo ? hist.undo[hist.undo.length - 1].label : '';

  box.innerHTML = `
    <div class="px-5 sm:px-7 py-4 border-b border-slate-100 space-y-2.5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex items-start gap-2.5 flex-1">
          ${readingLeftCollapsed ? `<button onclick="toggleReadingLeftPane()" class="hidden lg:inline-flex btn-tactile mt-0.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 shrink-0" title="展开左侧文章列表">📚 列表 »</button>` : ''}
          <div class="min-w-0">
            <h2 class="text-lg font-bold text-slate-900 break-words">${escapeHtml(r.title)}</h2>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>📅 ${escapeHtml(r.dateStr)}</span>
              ${r.source ? `<span class="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">${escapeHtml(r.source)}</span>` : ''}
              ${r.topic ? `<span class="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">🏷️ ${escapeHtml(r.topic)}</span>` : ''}
              ${formatAccuracyBadge(r)}
              ${r.durationMin ? `<span class="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">⏱️ ${r.durationMin} 分钟</span>` : ''}
              <span>${paras.length} 段 · 约 ${kws} 词 · ${r.annotations.length} 批注</span>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 shrink-0">
          ${readingRightCollapsed ? `<button onclick="toggleReadingRightPane()" class="hidden lg:inline-flex btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200" title="展开右侧高亮与评论栏">« 🖍️ 批注 (${r.annotations.length})</button>` : ''}
          <div class="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200/80">
            <button onclick="changeReadingFont(-1)" class="btn-tactile px-2 py-1 rounded-md text-xs font-semibold text-slate-600 hover:bg-white" title="缩小字号">A-</button>
            <button onclick="changeReadingFont(1)" class="btn-tactile px-2 py-1 rounded-md text-xs font-semibold text-slate-600 hover:bg-white" title="放大字号">A+</button>
          </div>
          <button onclick="toggleAllReadingParaGists()" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${readingShowParaGists ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}" title="展开/收起每段的「段落作用 + 一句话段意」笔记栏">🧭 段意${gistCount ? ` ${gistCount}/${paras.length}` : ''}</button>
          <button onclick="undoReadingText()" ${canUndo ? '' : 'disabled'} class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${canUndo ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 cursor-pointer' : 'bg-slate-50 text-slate-300 border-slate-200/70 cursor-not-allowed'}" title="${canUndo ? `撤回：${escapeHtml(lastUndoLabel)} (Ctrl+Z)` : '暂无可撤回的分段操作 (Ctrl+Z)'}">↩️${canUndo ? ` (${hist.undo.length})` : ''}</button>
          ${canRedo ? `<button onclick="redoReadingText()" class="btn-tactile px-2 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200" title="重做 (Ctrl+Y)">↪️</button>` : ''}
          <button onclick="quickAutoSplitCurrentReading()" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold ${paras.length <= 1 && kws > 80 ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}" title="按考研阅读常见段落长度（3~4句）智能分段；不满意可随时撤回">✂️ 智能分段</button>
          <button onclick="copyReadingMarkdown()" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200" title="导出整篇精读笔记（含段意脉络、全文总结、生词与长难句）为 Markdown 并复制">📋 复制笔记</button>
          <button onclick="openReadingModal('${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">✏️ 编辑</button>
          <button onclick="deleteReading('${r.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100" title="删除文章">🗑️</button>
        </div>
      </div>
      <div class="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
        <span>🖱️ 拖选句子 / 双击单词 → 高亮或写批注</span>
        <span>📏「整句」一键扩选全句</span>
        <span>🧭 点每段「段意」梳理脉络，再一键汇总到下方总结</span>
        <span>↩️ 分段改动均支持 Ctrl+Z 撤回</span>
      </div>
    </div>

    <!-- 正文：按段落卡片渲染（每段独立 .rd-para-text 严格对应 r.text 偏移） -->
    <div id="reading-text" class="reading-text-wrap px-5 sm:px-7 py-5 space-y-4">
      ${buildReadingParagraphsHtml(r, paras)}
    </div>

    <!-- 阅读器底部：文末快速按段粘贴追加抽屉 -->
    <div class="px-5 sm:px-7 pb-4">
      ${readingShowInlineAppend ? `
        <div class="rd-append-box p-3.5 rounded-xl bg-blue-50/55 border border-blue-200/80 space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span class="font-bold text-blue-800">🧩 在文末追加第 ${paras.length + 1} 段（支持连续按段粘贴）</span>
            <div class="flex items-center gap-2.5">
              <label class="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer select-none">
                <input type="checkbox" id="rd-inline-clean" checked class="accent-blue-600" />
                <span>自动清断行</span>
              </label>
              <button onclick="toggleInlineAppendPara()" class="text-xs text-slate-400 hover:text-slate-700">收起 ✕</button>
            </div>
          </div>
          <textarea id="rd-inline-append-ta" rows="3"
            onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();submitInlineAppendPara();}"
            placeholder="把下一段英文粘贴到这里，按 Ctrl+Enter 或点击下方按钮直接追加到文末（支持一次粘多段，自动按空行拆段）…"
            class="w-full px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm font-serif leading-relaxed focus:border-blue-500 outline-none resize-y"></textarea>
          <div class="flex flex-wrap items-center gap-2">
            <button onclick="submitInlineAppendPara()" class="btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-xs">＋ 追加段落 (Ctrl+Enter)</button>
            <button onclick="submitInlineClipboardPara()" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-blue-200 text-blue-700 hover:bg-blue-50">📋 直接粘贴剪贴板追加</button>
          </div>
        </div>`
      : `
        <button onclick="toggleInlineAppendPara()" class="btn-tactile w-full py-2 rounded-xl border border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 text-xs font-semibold text-slate-500 hover:text-blue-700 transition-all">
          ＋ 在文末按段粘贴追加新段落
        </button>`}
    </div>

    <!-- 全文总结笔记区（升级：Markdown 工具栏 + 编辑/分屏/预览 + 段意汇总 + 精读模板） -->
    <div class="px-5 sm:px-7 py-4 border-t border-slate-100 bg-slate-50/55 rounded-b-2xl">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-sm font-bold text-slate-800">📝 全文总结笔记</span>
          <span class="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">Markdown</span>
          <span id="reading-summary-state" class="text-[11px] font-normal text-slate-400"></span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" onclick="insertParaGistsToSummary()" class="btn-tactile px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100" title="把上面各段已填写的段意与段落作用自动汇总到总结笔记中">🧩 汇总各段段意</button>
          <button type="button" onclick="insertReadingSummaryTemplate()" class="btn-tactile px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="插入考研英语精读复盘 Markdown 模板">📋 精读模板</button>
          <div class="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <button onclick="setReadingSummaryMode('edit')" class="md-tab-btn ${readingSummaryMode === 'edit' ? 'md-tab-active' : ''}">✍️ 编辑</button>
            <button onclick="setReadingSummaryMode('split')" class="md-tab-btn ${readingSummaryMode === 'split' ? 'md-tab-active' : ''}" title="左边写，右边实时渲染">⇔ 分屏</button>
            <button onclick="setReadingSummaryMode('preview')" class="md-tab-btn ${readingSummaryMode === 'preview' ? 'md-tab-active' : ''}">👁️ 预览</button>
          </div>
        </div>
      </div>

      ${readingSummaryMode !== 'preview' ? `
        <div class="flex flex-wrap items-center gap-1 mb-2">
          <button type="button" onclick="rdSumWrap('**','**','重点内容')" title="加粗 (Ctrl+B)" class="md-tool font-bold">B</button>
          <button type="button" onclick="rdSumWrap('*','*','斜体')" title="斜体 (Ctrl+I)" class="md-tool italic font-serif">I</button>
          <button type="button" onclick="rdSumPrefix('## ')" title="二级标题" class="md-tool font-bold">H2</button>
          <button type="button" onclick="rdSumPrefix('- ')" title="无序列表" class="md-tool">• 列表</button>
          <button type="button" onclick="rdSumPrefix('> ')" title="引用原文/错题分析" class="md-tool">❝ 引用</button>
        </div>` : ''}

      <div class="rd-summary-grid ${readingSummaryMode === 'split' ? 'md-split' : ''}">
        ${readingSummaryMode !== 'preview' ? `
          <textarea id="reading-summary" rows="9"
            onkeydown="onReadingSummaryKeydown(event)"
            oninput="onReadingSummaryInput()"
            onblur="flushReadingSummary()"
            placeholder="文章主旨、段落脉络、错题原因与干扰项特征、长难句结构、写作可借鉴表达…&#10;&#10;支持 Markdown：## 标题、- 列表、**加粗**、> 引用；也可点上方「🧩 汇总各段段意」或「📋 精读模板」"
            class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm leading-relaxed focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 outline-none resize-y">${escapeHtml(r.summary)}</textarea>` : ''}
        ${readingSummaryMode !== 'edit' ? `
          <div id="reading-summary-preview" class="md-body px-3.5 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 min-h-[11rem] ${readingSummaryMode === 'split' ? 'max-h-[26rem] overflow-y-auto' : ''}">${r.summary.trim() ? renderMarkdown(r.summary) : '<span class="text-slate-400">还没有总结，切换到「编辑」或点击「📋 精读模板」开始写吧</span>'}</div>` : ''}
      </div>
    </div>`;

  const pv = document.getElementById('reading-summary-preview');
  if (pv) renderMathIn(pv);
}

// 渲染所有段落卡片
function buildReadingParagraphsHtml(r, paras) {
  if (!paras.length) {
    return '<div class="text-slate-400 text-sm py-8 text-center">（原文为空，点击右上角「✏️ 编辑」粘贴原文）</div>';
  }
  return paras.map(p => {
    const note = (r.paraNotes && r.paraNotes[p.key]) ? r.paraNotes[p.key] : { role: '', gist: '' };
    const roleMeta = getParaRoleMeta(note.role);
    const hasGist = Boolean((note.gist && note.gist.trim()) || note.role);
    const showGistBox = readingShowParaGists || readingExpandedGistKeys.has(p.key);
    const annInPara = r.annotations.filter(a => a.end > p.start && a.start < p.end).length;

    return `
      <div class="rd-para-block group rounded-2xl border border-slate-200/75 hover:border-blue-200/90 bg-white transition-all" data-pkey="${p.key}" data-pidx="${p.index}">
        <div class="rd-para-head px-4 py-2 border-b border-slate-100/90 bg-slate-50/55 rounded-t-2xl flex flex-wrap items-center justify-between gap-2 select-none">
          <div class="flex flex-wrap items-center gap-1.5 min-w-0">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-100">P${p.index + 1}</span>
            <span class="text-[11px] text-slate-400">${p.wordCount} 词</span>
            ${annInPara ? `<span class="text-[11px] text-amber-600 font-medium">· ${annInPara} 批注</span>` : ''}
            ${note.role ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${roleMeta.cls}">${escapeHtml(roleMeta.label)}</span>` : ''}
            ${!showGistBox && note.gist && note.gist.trim() ? `<span class="text-xs text-slate-600 truncate max-w-[320px] sm:max-w-[460px]" title="${escapeHtml(note.gist)}">— ${escapeHtml(note.gist)}</span>` : ''}
          </div>
          <div class="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
            <button type="button" onclick="toggleSingleParaGist('${p.key}')" class="btn-tactile px-2 py-0.5 rounded-md text-[11px] font-semibold ${hasGist || showGistBox ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}" title="记录本段段意与段落作用">📝 ${hasGist ? '段意' : '写段意'}</button>
            <button type="button" onclick="speakReadingPara(${p.index})" class="btn-tactile px-1.5 py-0.5 rounded-md text-[11px] bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="离线朗读本段">🔊</button>
            ${p.index > 0 ? `<button type="button" onclick="mergeReadingParaByIndex(${p.index})" class="btn-tactile px-1.5 py-0.5 rounded-md text-[11px] bg-white border border-slate-200 text-slate-500 hover:bg-slate-100" title="与上一段合并（可撤回）">⤴ 合并上段</button>` : ''}
          </div>
        </div>
        <div class="rd-para-text reading-text px-4 sm:px-5 py-3.5" data-pstart="${p.start}" data-pend="${p.end}" style="font-size:${readingFontSize}px">${buildReadingSliceHtml(r, p.start, p.end)}</div>
        ${showGistBox ? `
          <div class="rd-para-gist px-4 py-2.5 border-t border-slate-100 bg-blue-50/35 rounded-b-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 select-none">
            <select onchange="onParaRoleChange('${p.key}', this.value)" class="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:border-blue-500 outline-none shrink-0">
              ${READING_PARA_ROLES.map(opt => `<option value="${opt.value}" ${note.role === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
            <input type="text" id="rd-gist-inp-${p.key}" value="${escapeHtml(note.gist || '')}"
              oninput="onParaGistInput('${p.key}', this.value)"
              onblur="flushParaNotes()"
              placeholder="一句话总结 P${p.index + 1} 段意、作者态度或出题信号…"
              class="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 outline-none" />
          </div>` : ''}
      </div>`;
  }).join('');
}

// 渲染单个段落切片 [pStart, pEnd) 内的带 <mark> 高亮 HTML（绝对不引入额外文本字符）
function buildReadingSliceHtml(r, pStart, pEnd) {
  const text = r.text;
  const anns = r.annotations.filter(a => a.end > pStart && a.start < pEnd);
  const pts = new Set([pStart, pEnd]);
  anns.forEach(a => {
    pts.add(Math.max(pStart, a.start));
    pts.add(Math.min(pEnd, a.end));
  });
  const cuts = [...pts].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    if (e <= s) continue;
    const chunk = escapeHtml(text.slice(s, e));
    const cover = anns.filter(a => a.start <= s && a.end >= e);
    if (!cover.length) { html += chunk; continue; }
    const top = [...cover].sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const noted = cover.some(a => a.comment.trim() || a.meaning.trim());
    const tip = cover.filter(a => a.meaning || a.comment)
      .map(a => `${a.quote.length > 30 ? a.quote.slice(0, 30) + '…' : a.quote}：${(a.meaning || '') + (a.meaning && a.comment ? ' / ' : '') + (a.comment || '')}`)
      .join('\n');
    html += `<mark class="rd-hl rd-c-${top.color}${noted ? ' rd-noted' : ''}" data-ids="${cover.map(a => a.id).join(',')}" data-top="${top.id}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${chunk}</mark>`;
  }
  return html;
}

function changeReadingFont(delta) {
  readingFontSize = Math.min(26, Math.max(14, readingFontSize + delta));
  saveReadingPrefs();
  document.querySelectorAll('#reading-text .rd-para-text').forEach(el => {
    el.style.fontSize = readingFontSize + 'px';
  });
}

function speakReadingPara(paraIdx) {
  const r = getCurrentReading();
  if (!r) return;
  const paras = getReadingParagraphs(r.text);
  if (paras[paraIdx]) speakReadingText(paras[paraIdx].text);
}

// ---------- 段落大意与结构作用笔记 ----------
function toggleAllReadingParaGists() {
  readingShowParaGists = !readingShowParaGists;
  if (!readingShowParaGists) readingExpandedGistKeys.clear();
  saveReadingPrefs();
  renderReadingReader();
}

function toggleSingleParaGist(pKey) {
  if (readingShowParaGists) {
    const inp = document.getElementById(`rd-gist-inp-${pKey}`);
    if (inp) { inp.focus(); return; }
  }
  if (readingExpandedGistKeys.has(pKey)) {
    readingExpandedGistKeys.delete(pKey);
  } else {
    readingExpandedGistKeys.add(pKey);
  }
  renderReadingReader();
  if (readingExpandedGistKeys.has(pKey)) {
    setTimeout(() => {
      const inp = document.getElementById(`rd-gist-inp-${pKey}`);
      if (inp) inp.focus();
    }, 30);
  }
}

function onParaRoleChange(pKey, role) {
  const r = getCurrentReading();
  if (!r) return;
  if (!r.paraNotes) r.paraNotes = {};
  if (!r.paraNotes[pKey]) r.paraNotes[pKey] = { role: '', gist: '' };
  r.paraNotes[pKey].role = role;
  r.updatedAt = Date.now();
  persistReadingStore(true);
  renderReadingReader();
  renderReadingList();
}

function onParaGistInput(pKey, val) {
  const r = getCurrentReading();
  if (!r) return;
  if (!r.paraNotes) r.paraNotes = {};
  if (!r.paraNotes[pKey]) r.paraNotes[pKey] = { role: '', gist: '' };
  r.paraNotes[pKey].gist = val;
  clearTimeout(readingParaNoteTimer);
  readingParaNoteTimer = setTimeout(flushParaNotes, 700);
}

function flushParaNotes() {
  clearTimeout(readingParaNoteTimer);
  readingParaNoteTimer = null;
  const r = getCurrentReading();
  if (!r) return;
  r.updatedAt = Date.now();
  persistReadingStore(true);
  renderReadingList();
}

// ---------- 阅读器底部：文末快速追加段落 ----------
function toggleInlineAppendPara() {
  readingShowInlineAppend = !readingShowInlineAppend;
  renderReadingReader();
  if (readingShowInlineAppend) {
    setTimeout(() => {
      const ta = document.getElementById('rd-inline-append-ta');
      if (ta) ta.focus();
    }, 30);
  }
}

async function appendParagraphsToCurrentReading(rawText, cleanBreaks) {
  const r = getCurrentReading();
  if (!r) return;
  const blocks = splitRawIntoCleanParagraphs(rawText, cleanBreaks);
  if (!blocks.length) {
    showToast('粘贴内容为空', 'warning');
    return;
  }
  pushReadingHistory(r, `追加 ${blocks.length} 段`);
  const base = r.text.replace(/\s+$/, '');
  r.text = base ? (base + '\n\n' + blocks.join('\n\n')) : blocks.join('\n\n');
  r.updatedAt = Date.now();
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingList();
  showToast(`已追加 ${blocks.length} 段到文末（可 Ctrl+Z 撤回）`, 'success');
  const ta = document.getElementById('rd-inline-append-ta');
  if (ta) { ta.value = ''; ta.focus(); }
}

function submitInlineAppendPara() {
  const ta = document.getElementById('rd-inline-append-ta');
  const cleanChk = document.getElementById('rd-inline-clean');
  if (!ta) return;
  appendParagraphsToCurrentReading(ta.value, !cleanChk || cleanChk.checked);
}

async function submitInlineClipboardPara() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showToast('当前环境不允许直接读取剪贴板，请在输入框内按 Ctrl+V', 'info');
    return;
  }
  try {
    const txt = await navigator.clipboard.readText();
    const cleanChk = document.getElementById('rd-inline-clean');
    await appendParagraphsToCurrentReading(txt, !cleanChk || cleanChk.checked);
  } catch {
    showToast('未获得剪贴板权限，请直接在文本框内按 Ctrl+V 粘贴', 'warning');
  }
}

// ---------- 总结笔记（支持分屏实时预览 + Markdown 快捷键 + 段意汇总 + 精读模板） ----------
function setReadingSummaryMode(mode) {
  flushReadingSummary();
  readingSummaryMode = mode;
  saveReadingPrefs();
  renderReadingReader();
}

function onReadingSummaryInput() {
  const st = document.getElementById('reading-summary-state');
  if (st) st.textContent = '编辑中…';
  // 分屏模式下实时刷新右侧 Markdown 预览
  const ta = document.getElementById('reading-summary');
  const pv = document.getElementById('reading-summary-preview');
  if (ta && pv) {
    pv.innerHTML = ta.value.trim() ? renderMarkdown(ta.value) : '<span class="text-slate-400">实时预览区…</span>';
    renderMathIn(pv);
  }
  clearTimeout(readingSummaryTimer);
  readingSummaryTimer = setTimeout(flushReadingSummary, 800);
}

function flushReadingSummary() {
  clearTimeout(readingSummaryTimer);
  readingSummaryTimer = null;
  const ta = document.getElementById('reading-summary');
  const r = getCurrentReading();
  if (!ta || !r || ta.value === r.summary) return;
  r.summary = ta.value;
  r.updatedAt = Date.now();
  persistReadingStore(true);
  renderReadingList();
  const st = document.getElementById('reading-summary-state');
  if (st) st.textContent = '已自动保存';
}

function onReadingSummaryKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault(); rdSumWrap('**', '**', '加粗文字');
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
    e.preventDefault(); rdSumWrap('*', '*', '斜体文字');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const s = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = s + 2;
    onReadingSummaryInput();
  }
}

function rdSumWrap(before, after, fallback) {
  const ta = document.getElementById('reading-summary');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || fallback;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  onReadingSummaryInput();
}

function rdSumPrefix(prefix) {
  const ta = document.getElementById('reading-summary');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  const block = ta.value.slice(lineStart, e);
  const replaced = block.split('\n').map(l => prefix + l).join('\n');
  ta.value = ta.value.slice(0, lineStart) + replaced + ta.value.slice(e);
  ta.focus();
  onReadingSummaryInput();
}

function insertParaGistsToSummary() {
  const r = getCurrentReading();
  if (!r) return;
  const paras = getReadingParagraphs(r.text);
  const lines = [];
  paras.forEach(p => {
    const note = r.paraNotes && r.paraNotes[p.key];
    if (note && ((note.gist && note.gist.trim()) || note.role)) {
      const roleTag = note.role ? `【${getParaRoleMeta(note.role).label}】` : '';
      lines.push(`- **P${p.index + 1}** ${roleTag}${note.gist ? note.gist.trim() : ''}`);
    }
  });
  if (!lines.length) {
    readingShowParaGists = true;
    saveReadingPrefs();
    renderReadingReader();
    showToast('还没有填写任何段落段意，已为你展开每段的段意输入栏', 'info');
    return;
  }
  const section = `## 🧭 段落脉络\n\n${lines.join('\n')}`;
  if (readingSummaryMode === 'preview') {
    readingSummaryMode = 'edit';
    saveReadingPrefs();
  }
  const cur = (document.getElementById('reading-summary') ? document.getElementById('reading-summary').value : r.summary) || '';
  r.summary = cur.trim() ? (cur.trimEnd() + '\n\n' + section + '\n') : (section + '\n');
  r.updatedAt = Date.now();
  persistReadingStore(true);
  renderReadingReader();
  renderReadingList();
  showToast(`已将 ${lines.length} 段段意汇总到总结笔记`, 'success');
}

function insertReadingSummaryTemplate() {
  const r = getCurrentReading();
  if (!r) return;
  const tpl = [
    '## 🎯 文章主旨与作者态度',
    '- 核心话题：',
    '- 作者态度：（正面支持 / 客观中立 / 批评质疑 / 谨慎担忧）',
    '',
    '## 🧭 段落脉络',
    '- **P1**：',
    '',
    '## ❌ 错题与干扰项复盘',
    '- 题号 / 错选原因：（偷换概念 / 过度推断 / 定位偏差 / 反向干扰）',
    '',
    '## 🧱 长难句与写作借鉴',
    '- 亮点句式 / 替换表达：'
  ].join('\n');
  if (readingSummaryMode === 'preview') {
    readingSummaryMode = 'edit';
    saveReadingPrefs();
  }
  const cur = (document.getElementById('reading-summary') ? document.getElementById('reading-summary').value : r.summary) || '';
  r.summary = cur.trim() ? (cur.trimEnd() + '\n\n' + tpl + '\n') : (tpl + '\n');
  r.updatedAt = Date.now();
  persistReadingStore(true);
  renderReadingReader();
  renderReadingList();
  showToast('已插入考研英语精读复盘模板', 'success');
}

// ---------- 右侧：批注复习与自测栏 ----------
function toggleReadingQuizMode() {
  readingQuizMode = !readingQuizMode;
  saveReadingPrefs();
  applyReadingPaneStates();
  renderReadingSide();
  showToast(readingQuizMode ? '已开启自测遮挡模式：点击或悬停卡片可揭晓释义与笔记' : '已退出自测遮挡模式', 'info');
}

function setReadingFilter(key) {
  readingFilter = key;
  renderReadingSide();
}

function setReadingColorFilter(color) {
  readingColorFilter = readingColorFilter === color ? '' : color;
  renderReadingSide();
}

function onReadingAnnSearch(val) {
  readingAnnSearch = val || '';
  renderReadingSide();
}

function renderReadingSide() {
  const box = document.getElementById('reading-side');
  if (!box) return;
  const r = getCurrentReading();
  if (!r) {
    box.innerHTML = '<div class="text-center text-xs text-slate-400 py-10">选择一篇文章后，这里会列出所有高亮与评论</div>';
    return;
  }
  const all = [...r.annotations].sort((a, b) => a.start - b.start || a.end - b.end);
  const counts = {
    all: all.length,
    word: all.filter(a => a.kind === 'word').length,
    phrase: all.filter(a => a.kind === 'phrase').length,
    sentence: all.filter(a => a.kind === 'sentence').length,
    noted: all.filter(a => a.comment.trim() || a.meaning.trim()).length
  };
  const kw = readingAnnSearch.trim().toLowerCase();
  const list = all.filter(a => {
    if (readingFilter === 'noted' && !(a.comment.trim() || a.meaning.trim())) return false;
    if (readingFilter !== 'all' && readingFilter !== 'noted' && a.kind !== readingFilter) return false;
    if (readingColorFilter && a.color !== readingColorFilter) return false;
    if (kw && !`${a.quote} ${a.meaning} ${a.comment}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  const pill = (key, label) => `<button onclick="setReadingFilter('${key}')" class="btn-tactile px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${readingFilter === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${label} ${counts[key]}</button>`;

  // 计算每条批注所在段落编号（P1 / P2…），方便复习时快速对应位置
  const paras = getReadingParagraphs(r.text);
  const paraIdxOf = (pos) => {
    for (const p of paras) {
      if (pos >= p.start && pos <= p.end) return p.index + 1;
    }
    return 0;
  };

  box.innerHTML = `
    <div class="space-y-2 mb-3">
      <div class="flex flex-wrap gap-1">
        ${pill('all', '全部')}${pill('word', '单词')}${pill('phrase', '短语')}${pill('sentence', '句子')}${pill('noted', '有评论')}
      </div>
      <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>按颜色筛选：</span>
        <div class="flex items-center gap-1.5 shrink-0" title="按高亮颜色筛选">
          ${readingColorFilter ? `<button onclick="setReadingColorFilter('')" class="text-[10px] text-blue-600 hover:underline mr-0.5">全部</button>` : ''}
          ${READING_COLORS.map(c => `
            <button onclick="setReadingColorFilter('${c}')" class="w-4 h-4 rounded-full rd-c-${c} border ${readingColorFilter === c ? 'ring-2 ring-blue-600 scale-110 border-white' : 'border-slate-300/80 opacity-80 hover:opacity-100'} transition-all" title="筛选${READING_COLOR_NAMES[c]}色高亮"></button>`).join('')}
        </div>
      </div>
    </div>

    ${readingQuizMode ? '<div class="mb-2.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">🙈 自测中：悬停或点击模糊区域揭晓释义与笔记</div>' : ''}

    <div class="space-y-2.5 ${readingQuizMode ? 'rd-quiz-mode' : ''}">
      ${list.length ? list.map(a => {
        const pNo = paraIdxOf(a.start);
        return `
        <div id="rd-ann-${a.id}" class="rd-ann-item group rounded-xl border border-slate-200 bg-white p-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all" onclick="focusReadingAnn('${a.id}')">
          <div class="flex items-center gap-1.5 mb-1.5">
            <span class="rd-dot rd-c-${a.color}"></span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${a.kind === 'word' ? 'bg-violet-50 text-violet-600' : a.kind === 'sentence' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-600'}">${READING_KIND_NAMES[a.kind]}</span>
            ${pNo ? `<span class="text-[10px] font-semibold text-slate-400">P${pNo}</span>` : ''}
            <span class="ml-auto flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
              <button onclick="event.stopPropagation(); speakReadingAnn('${a.id}')" class="w-6 h-6 rounded-md text-xs hover:bg-slate-100" title="朗读">🔊</button>
              <button onclick="event.stopPropagation(); openReadingNoteModal('${a.id}')" class="w-6 h-6 rounded-md text-xs hover:bg-slate-100" title="编辑评论">✏️</button>
              <button onclick="event.stopPropagation(); deleteReadingAnn('${a.id}')" class="w-6 h-6 rounded-md text-xs hover:bg-rose-50" title="删除">🗑️</button>
            </span>
          </div>
          <div class="rd-quote ${a.kind === 'word' ? 'text-base font-bold text-slate-900' : 'text-[13px] text-slate-700 line-clamp-4'}">${escapeHtml(a.quote)}</div>
          ${a.meaning.trim() || a.comment.trim() ? `
            <div class="rd-quiz-mask mt-1.5 space-y-1" onclick="if(readingQuizMode){ event.stopPropagation(); this.classList.toggle('rd-quiz-revealed'); }">
              ${a.meaning.trim() ? `<div class="text-xs font-semibold text-emerald-700">💡 ${escapeHtml(a.meaning)}</div>` : ''}
              ${a.comment.trim() ? `<div class="md-body text-xs text-slate-600 border-l-2 border-blue-200 pl-2">${renderMarkdown(a.comment)}</div>` : ''}
            </div>` : `<button onclick="event.stopPropagation(); openReadingNoteModal('${a.id}')" class="mt-1.5 text-[11px] text-blue-500 hover:text-blue-700">＋ 添加评论</button>`}
        </div>`;
      }).join('')
      : `<div class="text-center text-xs text-slate-400 py-8">${all.length ? '当前筛选条件下暂无批注' : '还没有批注<br>在原文中拖选文字试试'}</div>`}
    </div>`;
  box.querySelectorAll('.md-body').forEach(el => renderMathIn(el));
}

function speakReadingAnn(id) {
  const a = findReadingAnn(id);
  if (a) speakReadingText(a.quote);
}

// 点击侧栏批注：滚动到原文位置并闪烁
function focusReadingAnn(id) {
  const marks = [...document.querySelectorAll('#reading-text mark.rd-hl')]
    .filter(m => m.dataset.ids.split(',').includes(id));
  if (!marks.length) return;
  marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  marks.forEach(m => {
    m.classList.remove('rd-flash');
    void m.offsetWidth;
    m.classList.add('rd-flash');
  });
}

// =========================================================================
// 选区处理（精确映射到 .rd-para-text[data-pstart][data-pend]）与浮动工具栏
// =========================================================================
function findEnclosingParaText(node) {
  if (!node) return null;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el && el.closest ? el.closest('.rd-para-text') : null;
}

function readingOffsetOf(container, node, offset) {
  const paraEl = findEnclosingParaText(node);
  if (!paraEl || !container.contains(paraEl)) return -1;
  const pStart = Number(paraEl.dataset.pstart) || 0;
  const range = document.createRange();
  range.selectNodeContents(paraEl);
  range.setEnd(node, offset);
  return pStart + range.toString().length;
}

function readingNodeAt(container, target) {
  const paraEls = [...container.querySelectorAll('.rd-para-text')];
  if (!paraEls.length) return { node: container, offset: 0 };

  let targetPara = paraEls[paraEls.length - 1];
  let localTarget = 0;

  for (const el of paraEls) {
    const ps = Number(el.dataset.pstart) || 0;
    const pe = Number(el.dataset.pend) || 0;
    if (target >= ps && target <= pe) {
      targetPara = el;
      localTarget = target - ps;
      break;
    }
    if (target < ps) {
      targetPara = el;
      localTarget = 0;
      break;
    }
    localTarget = pe - ps;
  }

  const walker = document.createTreeWalker(targetPara, NodeFilter.SHOW_TEXT);
  let pos = 0, node, last = null;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (localTarget <= pos + len) return { node, offset: localTarget - pos };
    pos += len;
    last = node;
  }
  return last ? { node: last, offset: last.nodeValue.length } : { node: targetPara, offset: 0 };
}

function readingSelectRange(start, end) {
  const container = document.getElementById('reading-text');
  if (!container) return null;
  const a = readingNodeAt(container, start);
  const b = readingNodeAt(container, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function onReadingMouseUp(e) {
  const container = document.getElementById('reading-text');
  if (!container) return;
  if (e.target && e.target.closest && e.target.closest('.rd-para-head, .rd-para-gist, input, textarea, select, button')) {
    hideReadingToolbar();
    return;
  }
  setTimeout(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const startPara = findEnclosingParaText(range.startContainer);
      let endPara = findEnclosingParaText(range.endContainer);
      if (!startPara || !container.contains(startPara)) return;
      const r = getCurrentReading();
      if (!r) return;
      let start = readingOffsetOf(container, range.startContainer, range.startOffset);
      let end;
      if (endPara && container.contains(endPara)) {
        end = readingOffsetOf(container, range.endContainer, range.endOffset);
      } else {
        // 兼容三击整段时浏览器把 endContainer 落到段落外层容器的情况
        end = Number(startPara.dataset.pend) || start;
      }
      if (start < 0 || end < 0) { hideReadingToolbar(); return; }
      if (start > end) [start, end] = [end, start];
      while (start < end && /\s/.test(r.text[start])) start++;
      while (end > start && /\s/.test(r.text[end - 1])) end--;
      if (end <= start) { hideReadingToolbar(); return; }
      readingPendingSel = { start, end };
      showReadingToolbar('new', range.getBoundingClientRect());
      return;
    }
    const mark = e.target.closest && e.target.closest('mark.rd-hl');
    if (mark && container.contains(mark)) {
      readingPendingSel = { annId: mark.dataset.top };
      showReadingToolbar('edit', mark.getBoundingClientRect());
      return;
    }
    hideReadingToolbar();
  }, 0);
}

function showReadingToolbar(mode, rect) {
  const tb = document.getElementById('readingToolbar');
  const colorBtns = READING_COLORS.map(c =>
    `<button onclick="readingToolbarColor('${c}')" class="rd-tb-color rd-c-${c}" title="${READING_COLOR_NAMES[c]}色高亮"></button>`).join('');
  if (mode === 'new') {
    const r = getCurrentReading();
    const q = r.text.slice(readingPendingSel.start, readingPendingSel.end);
    const isAtParaStart = readingPendingSel.start > 0 && /\n\s*\n\s*$/.test(r.text.slice(0, readingPendingSel.start));
    const canSplit = readingPendingSel.start > 0 && !isAtParaStart;
    tb.innerHTML = `
      ${colorBtns}
      <span class="rd-tb-sep"></span>
      <button onclick="readingToolbarComment()" class="rd-tb-btn">💬 评论</button>
      <button onclick="readingExpandSentence()" class="rd-tb-btn" title="把选区扩展为完整句子">📏 整句</button>
      <button onclick="readingToolbarSpeak()" class="rd-tb-btn" title="离线朗读选中内容">🔊</button>
      ${canSplit ? `<button onclick="readingSplitParagraphAtSelection()" class="rd-tb-btn" title="在当前选区开头插入分段">↵ 分段</button>` : ''}
      ${isAtParaStart ? `<button onclick="readingMergeWithPrevParagraph()" class="rd-tb-btn" title="取消此处分段，合并回上一段">⤴ 合并上段</button>` : ''}
      <span class="rd-tb-sep"></span>
      <span class="text-[10px] text-slate-400 px-1 whitespace-nowrap">${READING_KIND_NAMES[detectReadingKind(q)]}</span>`;
  } else {
    const a = findReadingAnn(readingPendingSel.annId);
    if (!a) return;
    tb.innerHTML = `
      ${colorBtns}
      <span class="rd-tb-sep"></span>
      <button onclick="readingToolbarComment()" class="rd-tb-btn">💬 ${a.comment || a.meaning ? '编辑评论' : '评论'}</button>
      <button onclick="readingToolbarSpeak()" class="rd-tb-btn" title="离线朗读">🔊</button>
      <button onclick="readingToolbarDelete()" class="rd-tb-btn text-rose-600">🗑️ 删除</button>`;
  }
  tb.classList.remove('hidden');
  const tw = tb.offsetWidth, th = tb.offsetHeight;
  let top = rect.top - th - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  tb.style.top = top + 'px';
  tb.style.left = left + 'px';
}

function hideReadingToolbar() {
  const tb = document.getElementById('readingToolbar');
  if (tb) tb.classList.add('hidden');
}

function findReadingAnn(id) {
  const r = getCurrentReading();
  return r ? r.annotations.find(a => a.id === id) : null;
}

function readingToolbarSpeak() {
  if (!readingPendingSel) return;
  const r = getCurrentReading();
  if (!r) return;
  if (readingPendingSel.annId) {
    const a = findReadingAnn(readingPendingSel.annId);
    if (a) speakReadingText(a.quote);
  } else {
    speakReadingText(r.text.slice(readingPendingSel.start, readingPendingSel.end));
  }
}

function readingExpandSentence() {
  const r = getCurrentReading();
  if (!r || !readingPendingSel || readingPendingSel.annId) return;
  const t = r.text;
  let { start, end } = readingPendingSel;
  const isEnd = i => /[.!?。！？]/.test(t[i]) && !(t[i] === '.' && /[A-Za-z0-9]/.test(t[i + 1] || ''))
    && !(t[i] === '.' && /\b(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e|U\.S)$/.test(t.slice(Math.max(0, i - 4), i)));
  while (start > 0 && t[start - 1] !== '\n' && !isEnd(start - 1)) start--;
  while (start < end && /[\s"'”’)\]]/.test(t[start])) start++;
  while (end < t.length && t[end] !== '\n' && !isEnd(end - 1)) end++;
  while (end < t.length && /["'”’)\]]/.test(t[end])) end++;
  while (end > start && /\s/.test(t[end - 1])) end--;
  readingPendingSel = { start, end };
  const range = readingSelectRange(start, end);
  if (range) showReadingToolbar('new', range.getBoundingClientRect());
}

function createReadingAnn(color) {
  const r = getCurrentReading();
  const { start, end } = readingPendingSel;
  let a = r.annotations.find(x => x.start === start && x.end === end);
  if (!a) {
    const quote = r.text.slice(start, end);
    a = { id: genId('ann'), start, end, quote, color, kind: detectReadingKind(quote), meaning: '', comment: '', createdAt: Date.now() };
    r.annotations.push(a);
  } else {
    a.color = color;
  }
  r.updatedAt = Date.now();
  return a;
}

function readingToolbarColor(color) {
  if (!readingPendingSel) return;
  if (readingPendingSel.annId) {
    const a = findReadingAnn(readingPendingSel.annId);
    if (a) a.color = color;
  } else {
    createReadingAnn(color);
  }
  afterReadingAnnChange();
}

function readingToolbarComment() {
  if (!readingPendingSel) return;
  const id = readingPendingSel.annId || createReadingAnn('yellow').id;
  if (!readingPendingSel.annId) afterReadingAnnChange();
  hideReadingToolbar();
  openReadingNoteModal(id);
}

function readingToolbarDelete() {
  if (!readingPendingSel || !readingPendingSel.annId) return;
  deleteReadingAnn(readingPendingSel.annId);
}

function afterReadingAnnChange() {
  window.getSelection().removeAllRanges();
  hideReadingToolbar();
  readingPendingSel = null;
  persistReadingStore(true);
  refreshReadingTextAndSide();
}

function refreshReadingTextAndSide() {
  const r = getCurrentReading();
  const el = document.getElementById('reading-text');
  if (el && r) {
    el.innerHTML = buildReadingParagraphsHtml(r, getReadingParagraphs(r.text));
  }
  renderReadingSide();
  renderReadingList();
}

function deleteReadingAnn(id) {
  const r = getCurrentReading();
  if (!r) return;
  r.annotations = r.annotations.filter(a => a.id !== id);
  r.updatedAt = Date.now();
  afterReadingAnnChange();
  showToast('已删除批注', 'info');
}

// =========================================================================
// 弹窗：批注评论编辑
// =========================================================================
let readingNoteModalInitialSnap = '';

function getReadingNoteModalSnapshot() {
  const active = document.querySelector('#rdn-colors button.active');
  return JSON.stringify({
    id: document.getElementById('rdn-id').value,
    kind: document.getElementById('rdn-kind').value,
    meaning: document.getElementById('rdn-meaning').value,
    comment: document.getElementById('rdn-comment').value,
    color: active ? active.dataset.color : ''
  });
}

function openReadingNoteModal(id) {
  const a = findReadingAnn(id);
  if (!a) return;
  document.getElementById('rdn-id').value = id;
  document.getElementById('rdn-quote').textContent = a.quote;
  document.getElementById('rdn-kind').value = a.kind;
  document.getElementById('rdn-meaning').value = a.meaning;
  document.getElementById('rdn-comment').value = a.comment;
  document.querySelectorAll('#rdn-colors button').forEach(b => b.classList.toggle('active', b.dataset.color === a.color));
  updateReadingNoteHints();
  readingNoteModalInitialSnap = getReadingNoteModalSnapshot();
  document.getElementById('readingNoteModal').classList.add('open');
  setTimeout(() => document.getElementById(a.kind === 'word' ? 'rdn-meaning' : 'rdn-comment').focus(), 60);
}

function updateReadingNoteHints() {
  const kind = document.getElementById('rdn-kind').value;
  document.getElementById('rdn-meaning').placeholder = kind === 'word'
    ? '词性 + 释义，如：v. 削弱，破坏' : kind === 'phrase' ? '短语释义，如：在很大程度上' : '核心句意 / 主干要点（可选）';
  document.getElementById('rdn-comment').placeholder = kind === 'sentence'
    ? '长难句结构分析、主干、从句、出题点、干扰项特征…（支持 Markdown）'
    : '词根词缀、熟词僻义、真题同义替换、固定搭配…（支持 Markdown）';
}

function pickReadingNoteColor(color) {
  document.querySelectorAll('#rdn-colors button').forEach(b => b.classList.toggle('active', b.dataset.color === color));
}

async function closeReadingNoteModal(force = false) {
  const modal = document.getElementById('readingNoteModal');
  if (!modal || !modal.classList.contains('open')) return;
  if (!force && getReadingNoteModalSnapshot() !== readingNoteModalInitialSnap) {
    const ok = await confirmDiscardEdits('批注评论编辑');
    if (!ok) return;
  }
  modal.classList.remove('open');
}

function saveReadingNoteModal() {
  const a = findReadingAnn(document.getElementById('rdn-id').value);
  if (!a) { closeReadingNoteModal(true); return; }
  a.kind = document.getElementById('rdn-kind').value;
  a.meaning = document.getElementById('rdn-meaning').value.trim();
  a.comment = document.getElementById('rdn-comment').value;
  const active = document.querySelector('#rdn-colors button.active');
  if (active) a.color = active.dataset.color;
  const r = getCurrentReading();
  if (r) r.updatedAt = Date.now();
  closeReadingNoteModal(true);
  persistReadingStore(true);
  refreshReadingTextAndSide();
  showToast('批注已保存', 'success');
}

function deleteReadingNoteFromModal() {
  const id = document.getElementById('rdn-id').value;
  closeReadingNoteModal(true);
  deleteReadingAnn(id);
}

// =========================================================================
// 弹窗：文章新增 / 编辑（支持 🧩 按段落粘贴 与 📄 全文粘贴 双向同步）
// =========================================================================
function cleanSingleParagraphBreaks(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function splitRawIntoCleanParagraphs(raw, cleanBreaks = true) {
  const normalized = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const rawBlocks = normalized.split(/\n[ \t]*\n+/);
  return rawBlocks
    .map(b => cleanBreaks ? cleanSingleParagraphBreaks(b) : b.trim())
    .filter(Boolean);
}

let readingModalInitialSnap = '';

function getReadingModalSnapshot() {
  const textVal = modalReadingMode === 'paras'
    ? modalReadingParas.join('\n\n')
    : (document.getElementById('rd-text')?.value || '');
  return JSON.stringify({
    id: document.getElementById('rd-id').value,
    title: document.getElementById('rd-title').value,
    source: document.getElementById('rd-source').value,
    topic: document.getElementById('rd-topic').value,
    date: document.getElementById('rd-date').value,
    correct: document.getElementById('rd-correct').value,
    total: document.getElementById('rd-total').value,
    duration: document.getElementById('rd-duration').value,
    text: textVal,
    quickInput: document.getElementById('rd-para-quick-input')?.value || ''
  });
}

function openReadingModal(id) {
  const r = id ? (readingStore || []).find(x => x.id === id) : null;
  modalTextUndoStack = [];
  updateModalUndoBtn();
  document.getElementById('readingModalTitle').textContent = r ? '✏️ 编辑文章' : '📖 新增阅读文章';
  document.getElementById('rd-id').value = r ? r.id : '';
  document.getElementById('rd-title').value = r ? r.title : '';
  document.getElementById('rd-source').value = r ? r.source : '';
  document.getElementById('rd-topic').value = r ? (r.topic || '') : '';
  document.getElementById('rd-date').value = r ? r.dateStr : todayISO();
  document.getElementById('rd-correct').value = (r && r.correctCount !== '') ? r.correctCount : '';
  document.getElementById('rd-total').value = (r && r.totalCount !== '') ? r.totalCount : '';
  document.getElementById('rd-duration').value = (r && r.durationMin !== '') ? r.durationMin : '';
  document.getElementById('rd-text').value = r ? r.text : '';
  const qInp = document.getElementById('rd-para-quick-input');
  if (qInp) qInp.value = '';

  modalReadingParas = r && r.text.trim()
    ? r.text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean)
    : [];

  // 默认进入「按段落粘贴」模式，方便直接逐段粘贴或逐段微调
  modalReadingMode = 'paras';
  applyReadingModalModeUI();
  renderModalParasList();
  updateReadingModalStats();

  document.getElementById('rd-text-warn').classList.toggle('hidden', !(r && r.annotations.length));
  readingModalInitialSnap = getReadingModalSnapshot();
  document.getElementById('readingModal').classList.add('open');
  setTimeout(() => document.getElementById(r ? 'rd-para-quick-input' : 'rd-title').focus(), 60);
}

async function closeReadingModal(force = false) {
  const modal = document.getElementById('readingModal');
  if (!modal || !modal.classList.contains('open')) return;
  if (!force && getReadingModalSnapshot() !== readingModalInitialSnap) {
    const ok = await confirmDiscardEdits('阅读文章编辑');
    if (!ok) return;
  }
  modal.classList.remove('open');
}

function switchReadingModalMode(mode) {
  if (mode === modalReadingMode) return;
  if (mode === 'full') {
    // 段落模式 → 全文模式同步
    const qInp = document.getElementById('rd-para-quick-input');
    const extra = qInp && qInp.value.trim() ? splitRawIntoCleanParagraphs(qInp.value, true) : [];
    const all = [...modalReadingParas.map(s => s.trim()).filter(Boolean), ...extra];
    if (extra.length && qInp) qInp.value = '';
    modalReadingParas = all;
    document.getElementById('rd-text').value = all.join('\n\n');
  } else {
    // 全文模式 → 段落模式同步
    const raw = document.getElementById('rd-text').value.replace(/\r\n?/g, '\n').trim();
    modalReadingParas = raw ? raw.split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean) : [];
  }
  modalReadingMode = mode;
  applyReadingModalModeUI();
  if (mode === 'paras') renderModalParasList();
  updateReadingModalStats();
}

function applyReadingModalModeUI() {
  const isParas = modalReadingMode === 'paras';
  const tabP = document.getElementById('rd-mode-tab-paras');
  const tabF = document.getElementById('rd-mode-tab-full');
  const paneP = document.getElementById('rd-pane-paras');
  const paneF = document.getElementById('rd-pane-full');
  const toolsF = document.getElementById('rd-full-tools');
  if (tabP) tabP.classList.toggle('md-tab-active', isParas);
  if (tabF) tabF.classList.toggle('md-tab-active', !isParas);
  if (paneP) paneP.classList.toggle('hidden', !isParas);
  if (paneF) paneF.classList.toggle('hidden', isParas);
  if (toolsF) toolsF.classList.toggle('hidden', isParas);
}

function updateReadingModalStats() {
  const el = document.getElementById('rd-modal-stats');
  if (!el) return;
  let paras = [];
  if (modalReadingMode === 'paras') {
    paras = modalReadingParas.map(s => s.trim()).filter(Boolean);
  } else {
    const raw = (document.getElementById('rd-text') ? document.getElementById('rd-text').value : '').trim();
    paras = raw ? raw.split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean) : [];
  }
  const wc = paras.join(' ').trim() ? paras.join(' ').trim().split(/\s+/).length : 0;
  el.textContent = `${paras.length} 段 · 约 ${wc} 词`;
}

function onReadingParaQuickPaste(event) {
  const autoAppend = document.getElementById('rd-opt-auto-append');
  const cleanOpt = document.getElementById('rd-opt-clean-paste');
  const clip = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
  if (!clip || !clip.trim()) return;

  const shouldClean = !cleanOpt || cleanOpt.checked;
  if (autoAppend && autoAppend.checked) {
    event.preventDefault();
    const pieces = splitRawIntoCleanParagraphs(clip, shouldClean);
    if (!pieces.length) return;
    modalReadingParas.push(...pieces);
    renderModalParasList();
    updateReadingModalStats();
    const ta = document.getElementById('rd-para-quick-input');
    if (ta) ta.value = '';
    showToast(
      pieces.length === 1
        ? `已追加第 ${modalReadingParas.length} 段（可直接继续 Ctrl+V 粘贴下一段）`
        : `检测到空行，已自动拆分为 ${pieces.length} 段追加（共 ${modalReadingParas.length} 段）`,
      'success'
    );
    const listBox = document.getElementById('rd-paras-list');
    if (listBox && listBox.lastElementChild) {
      listBox.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else if (shouldClean) {
    event.preventDefault();
    const ta = event.target;
    const cleaned = splitRawIntoCleanParagraphs(clip, true).join('\n\n');
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + cleaned + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + cleaned.length;
  }
}

function appendQuickParaInput() {
  const ta = document.getElementById('rd-para-quick-input');
  const cleanOpt = document.getElementById('rd-opt-clean-paste');
  if (!ta) return;
  const pieces = splitRawIntoCleanParagraphs(ta.value, !cleanOpt || cleanOpt.checked);
  if (!pieces.length) {
    showToast('请先在上方输入框粘贴或输入段落内容', 'warning');
    return;
  }
  modalReadingParas.push(...pieces);
  ta.value = '';
  renderModalParasList();
  updateReadingModalStats();
  ta.focus();
  showToast(`已追加 ${pieces.length} 段（当前共 ${modalReadingParas.length} 段）`, 'success');
}

async function pasteClipboardAsPara() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showToast('当前浏览器不支持按钮直读剪贴板，请在上方粘贴框内按 Ctrl+V', 'info');
    return;
  }
  try {
    const txt = await navigator.clipboard.readText();
    const cleanOpt = document.getElementById('rd-opt-clean-paste');
    const pieces = splitRawIntoCleanParagraphs(txt, !cleanOpt || cleanOpt.checked);
    if (!pieces.length) { showToast('剪贴板中没有文本内容', 'warning'); return; }
    modalReadingParas.push(...pieces);
    renderModalParasList();
    updateReadingModalStats();
    showToast(`已从剪贴板追加 ${pieces.length} 段（共 ${modalReadingParas.length} 段）`, 'success');
  } catch {
    showToast('未获得剪贴板权限，请点击上方框后按 Ctrl+V 粘贴', 'warning');
  }
}

function addEmptyModalPara() {
  modalReadingParas.push('');
  renderModalParasList();
  updateReadingModalStats();
  setTimeout(() => {
    const el = document.getElementById(`rd-mpara-ta-${modalReadingParas.length - 1}`);
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }, 30);
}

function cleanAllModalParas() {
  if (!modalReadingParas.length) return;
  modalReadingParas = modalReadingParas.map(cleanSingleParagraphBreaks).filter(Boolean);
  renderModalParasList();
  updateReadingModalStats();
  showToast('已清理全部段落的断行与连字符', 'info');
}

function onModalParaEdit(idx, val) {
  modalReadingParas[idx] = val;
  updateReadingModalStats();
  const wcEl = document.getElementById(`rd-mpara-wc-${idx}`);
  if (wcEl) {
    const wc = val.trim() ? val.trim().split(/\s+/).length : 0;
    wcEl.textContent = `${wc} 词`;
  }
}

function cleanModalPara(idx) {
  modalReadingParas[idx] = cleanSingleParagraphBreaks(modalReadingParas[idx]);
  renderModalParasList();
  updateReadingModalStats();
}

function moveModalPara(idx, delta) {
  const next = idx + delta;
  if (next < 0 || next >= modalReadingParas.length) return;
  const tmp = modalReadingParas[idx];
  modalReadingParas[idx] = modalReadingParas[next];
  modalReadingParas[next] = tmp;
  renderModalParasList();
}

function mergeModalParaWithPrev(idx) {
  if (idx <= 0 || idx >= modalReadingParas.length) return;
  modalReadingParas[idx - 1] = (modalReadingParas[idx - 1].trim() + ' ' + modalReadingParas[idx].trim()).trim();
  modalReadingParas.splice(idx, 1);
  renderModalParasList();
  updateReadingModalStats();
}

function splitModalParaAtCursor(idx) {
  const ta = document.getElementById(`rd-mpara-ta-${idx}`);
  if (!ta) return;
  const pos = ta.selectionStart;
  const val = ta.value;
  if (!pos || pos <= 0 || pos >= val.length) {
    showToast('请先把光标放到本段要拆开的位置，再点击「✂️ 光标拆分」', 'info');
    return;
  }
  const p1 = val.slice(0, pos).trim();
  const p2 = val.slice(pos).trim();
  if (!p1 || !p2) return;
  modalReadingParas.splice(idx, 1, p1, p2);
  renderModalParasList();
  updateReadingModalStats();
}

function deleteModalPara(idx) {
  modalReadingParas.splice(idx, 1);
  renderModalParasList();
  updateReadingModalStats();
}

function renderModalParasList() {
  const box = document.getElementById('rd-paras-list');
  if (!box) return;
  if (!modalReadingParas.length) {
    box.innerHTML = `<div class="text-center text-xs text-slate-400 py-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">还没有段落，在上方粘贴框按 <kbd class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-semibold">Ctrl+V</kbd> 逐段粘贴即可自动生成 P1、P2、P3…</div>`;
    return;
  }
  box.innerHTML = modalReadingParas.map((p, idx) => {
    const wc = p.trim() ? p.trim().split(/\s+/).length : 0;
    const rows = Math.min(7, Math.max(2, Math.ceil((p.length || 60) / 86)));
    return `
      <div class="rd-para-card p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 hover:border-blue-200 transition-all">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-[11px]">
          <div class="flex items-center gap-1.5">
            <span class="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-bold">P${idx + 1}</span>
            <span id="rd-mpara-wc-${idx}" class="text-slate-400">${wc} 词</span>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <button type="button" onclick="cleanModalPara(${idx})" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="清理本段断行">🧹</button>
            ${idx > 0 ? `<button type="button" onclick="moveModalPara(${idx}, -1)" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="上移">↑</button>` : ''}
            ${idx < modalReadingParas.length - 1 ? `<button type="button" onclick="moveModalPara(${idx}, 1)" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="下移">↓</button>` : ''}
            ${idx > 0 ? `<button type="button" onclick="mergeModalParaWithPrev(${idx})" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="与上一段合并">⤴ 合并上段</button>` : ''}
            <button type="button" onclick="splitModalParaAtCursor(${idx})" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="在文本框光标处拆成两段">✂️ 光标拆分</button>
            <button type="button" onclick="deleteModalPara(${idx})" class="px-1.5 py-0.5 rounded bg-white border border-rose-200 text-rose-500 hover:bg-rose-50" title="删除此段">✕</button>
          </div>
        </div>
        <textarea id="rd-mpara-ta-${idx}" rows="${rows}" oninput="onModalParaEdit(${idx}, this.value)"
          placeholder="输入或粘贴第 ${idx + 1} 段原文…"
          class="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-[13.5px] font-serif leading-relaxed text-slate-800 focus:border-blue-500 outline-none resize-y">${escapeHtml(p)}</textarea>
      </div>`;
  }).join('');
}

function pushModalTextUndo() {
  const ta = document.getElementById('rd-text');
  if (!ta) return;
  modalTextUndoStack.push(ta.value);
  if (modalTextUndoStack.length > 20) modalTextUndoStack.shift();
  updateModalUndoBtn();
}

function updateModalUndoBtn() {
  const btn = document.getElementById('rd-modal-undo-btn');
  if (!btn) return;
  if (modalTextUndoStack.length > 0) {
    btn.classList.remove('hidden');
    btn.textContent = `↩️ 撤回 (${modalTextUndoStack.length})`;
  } else {
    btn.classList.add('hidden');
  }
}

function undoModalReadingText() {
  if (!modalTextUndoStack.length) return;
  const ta = document.getElementById('rd-text');
  if (ta) ta.value = modalTextUndoStack.pop();
  updateModalUndoBtn();
  updateReadingModalStats();
  showToast('已撤回到上一步原文状态', 'info');
}

function mergeReadingLineBreaks() {
  const ta = document.getElementById('rd-text');
  const raw = ta.value.replace(/\r\n?/g, '\n').trim();
  if (!raw) return;

  pushModalTextUndo();

  const rawLines = raw.split('\n');
  if (rawLines.length <= 1) {
    const split = splitIntoBalancedParagraphs(raw);
    ta.value = split;
    updateReadingModalStats();
    const count = split.split(/\n\s*\n/).length;
    showToast(`已按句子边界智能分为 ${count} 段（不满意可点「↩️ 撤回」）`, 'info');
    return;
  }

  const nonEmptyLens = rawLines.map(l => l.trim().length).filter(len => len > 25).sort((a, b) => b - a);
  const fullLineLen = nonEmptyLens.length ? nonEmptyLens[Math.min(nonEmptyLens.length - 1, Math.floor(nonEmptyLens.length * 0.25))] : 75;

  const paragraphs = [];
  let cur = [];

  const flush = () => {
    if (!cur.length) return;
    const joined = cur.join('\n')
      .replace(/-\n(?=[a-z])/g, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (joined) paragraphs.push(joined);
    cur = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (cur.length > 0) {
      const prevRaw = cur[cur.length - 1];
      const prevTrim = prevRaw.trim();
      const prevEndsSentence = /[.!?。！？]["'”’)\]]*$/.test(prevTrim);
      const nextHasIndent = /^(\t| {2,}|\u3000+)/.test(rawLine);
      const nextStartsCap = /^[A-Z"“‘'(\[\d]/.test(trimmed);
      const prevIsShortLine = prevTrim.length < fullLineLen * 0.78;
      if (nextHasIndent || (prevEndsSentence && prevIsShortLine && nextStartsCap)) {
        flush();
      }
    }
    cur.push(trimmed);
  }
  flush();

  if (paragraphs.length === 1 && raw.split(/\s+/).length > 100) {
    ta.value = splitIntoBalancedParagraphs(paragraphs[0]);
    updateReadingModalStats();
    showToast('已合并断行并智能分段（不满意可点「↩️ 撤回」）', 'info');
    return;
  }

  ta.value = paragraphs.join('\n\n');
  updateReadingModalStats();
  showToast(`已智能合并断行，共分为 ${paragraphs.length} 段（可点「↩️ 撤回」）`, 'info');
}

function splitIntoBalancedParagraphs(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (/[.!?]/.test(clean[i])) {
      let end = i + 1;
      while (end < clean.length && /["'”’)\]]/.test(clean[end])) end++;
      if (end < clean.length && !/\s/.test(clean[end])) continue;
      const prevWord = clean.slice(Math.max(0, start), i + 1);
      if (/\b(Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$/.test(prevWord)) continue;
      const nextChar = clean.slice(end).trimStart()[0] || '';
      if (nextChar && !/[A-Z"“‘'(\[\d]/.test(nextChar)) continue;
      sentences.push(clean.slice(start, end).trim());
      i = end;
      while (i < clean.length && /\s/.test(clean[i])) i++;
      start = i;
    }
  }
  if (start < clean.length) {
    const rest = clean.slice(start).trim();
    if (rest) sentences.push(rest);
  }
  if (sentences.length <= 3) return clean;

  const totalWords = clean.split(/\s+/).length;
  const targetParas = Math.max(3, Math.min(6, Math.round(totalWords / 75)));
  const targetWordsPerPara = totalWords / targetParas;

  const paras = [];
  let buf = [];
  let bufWords = 0;
  sentences.forEach((s, idx) => {
    const w = s.split(/\s+/).length;
    buf.push(s);
    bufWords += w;
    const remainSentences = sentences.length - idx - 1;
    const remainParas = targetParas - paras.length - 1;
    if (remainParas > 0 && remainSentences >= remainParas && (bufWords >= targetWordsPerPara * 0.85 || buf.length >= 4)) {
      paras.push(buf.join(' '));
      buf = [];
      bufWords = 0;
    }
  });
  if (buf.length) paras.push(buf.join(' '));
  return paras.join('\n\n');
}

function autoSplitReadingParagraphs() {
  const ta = document.getElementById('rd-text');
  const raw = ta.value.replace(/\r\n?/g, '\n').trim();
  if (!raw) return;
  pushModalTextUndo();
  const split = splitIntoBalancedParagraphs(raw);
  const count = split.split(/\n\s*\n/).length;
  ta.value = split;
  updateReadingModalStats();
  showToast(`已按句子边界智能分为 ${count} 段（可点「↩️ 撤回」）`, 'info');
}

// 阅读器内一键智能分段
async function quickAutoSplitCurrentReading() {
  const r = getCurrentReading();
  if (!r) return;
  const newText = splitIntoBalancedParagraphs(r.text);
  if (newText === r.text) {
    showToast('当前已经是智能分段状态，可选中任意句首词点「↵ 分段」手动微调', 'info');
    return;
  }
  pushReadingHistory(r, '智能分段');
  if (r.annotations.length) {
    r.annotations = reanchorAnnotations(newText, r.annotations).list;
  }
  r.text = newText;
  r.updatedAt = Date.now();
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  const count = newText.split(/\n\s*\n/).length;
  showToast(`已智能分为 ${count} 段（不满意可点右上角「↩️」或按 Ctrl+Z）`, 'success');
}

async function readingSplitParagraphAtSelection() {
  const r = getCurrentReading();
  if (!r || !readingPendingSel || readingPendingSel.annId) return;
  let pos = readingPendingSel.start;
  while (pos > 0 && /[ \t]/.test(r.text[pos - 1])) pos--;
  if (pos <= 0) return;
  pushReadingHistory(r, '手动分段');
  const before = r.text.slice(0, pos).replace(/[ \t\n]+$/, '');
  const after = r.text.slice(readingPendingSel.start).replace(/^[ \t\n]+/, '');
  const newText = before + '\n\n' + after;
  if (r.annotations.length) {
    r.annotations = reanchorAnnotations(newText, r.annotations).list;
  }
  r.text = newText;
  r.updatedAt = Date.now();
  window.getSelection().removeAllRanges();
  hideReadingToolbar();
  readingPendingSel = null;
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  showToast('已在此处分段（可点「↩️」或 Ctrl+Z 取消）', 'success');
}

async function readingMergeWithPrevParagraph() {
  const r = getCurrentReading();
  if (!r || !readingPendingSel || readingPendingSel.annId) return;
  const pos = readingPendingSel.start;
  if (pos <= 0) return;
  pushReadingHistory(r, '合并段落');
  const before = r.text.slice(0, pos).replace(/\s+$/, '');
  const after = r.text.slice(pos).replace(/^\s+/, '');
  const newText = before + ' ' + after;
  if (r.annotations.length) {
    r.annotations = reanchorAnnotations(newText, r.annotations).list;
  }
  r.text = newText;
  r.updatedAt = Date.now();
  window.getSelection().removeAllRanges();
  hideReadingToolbar();
  readingPendingSel = null;
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  showToast('已合并回上一段（可点「↩️」恢复）', 'success');
}

// 段落卡片头上的「⤴ 合并上段」快捷按钮
async function mergeReadingParaByIndex(paraIdx) {
  const r = getCurrentReading();
  if (!r || paraIdx <= 0) return;
  const paras = getReadingParagraphs(r.text);
  if (paraIdx >= paras.length) return;
  pushReadingHistory(r, `合并 P${paraIdx + 1} 到 P${paraIdx}`);
  const merged = paras.map(p => p.text.trim());
  merged[paraIdx - 1] = (merged[paraIdx - 1] + ' ' + merged[paraIdx]).trim();
  merged.splice(paraIdx, 1);
  const newText = merged.join('\n\n');
  if (r.annotations.length) {
    r.annotations = reanchorAnnotations(newText, r.annotations).list;
  }
  r.text = newText;
  r.updatedAt = Date.now();
  await persistReadingStore(true);
  renderReadingReader();
  renderReadingSide();
  showToast(`已将 P${paraIdx + 1} 合并回 P${paraIdx}（可 Ctrl+Z 撤回）`, 'success');
}

async function saveReadingModal() {
  const id = document.getElementById('rd-id').value;
  const title = document.getElementById('rd-title').value.trim();

  let text = '';
  if (modalReadingMode === 'paras') {
    const qInp = document.getElementById('rd-para-quick-input');
    const cleanOpt = document.getElementById('rd-opt-clean-paste');
    const extra = (qInp && qInp.value.trim())
      ? splitRawIntoCleanParagraphs(qInp.value, !cleanOpt || cleanOpt.checked)
      : [];
    const finalParas = [...modalReadingParas.map(s => s.replace(/\r\n?/g, '\n').trim()).filter(Boolean), ...extra];
    text = finalParas.join('\n\n');
  } else {
    text = document.getElementById('rd-text').value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  }

  if (!title) { showToast('请填写文章标题', 'warning'); return; }
  if (!text.trim()) { showToast('请粘贴阅读原文（至少一段）', 'warning'); return; }

  const source = document.getElementById('rd-source').value.trim();
  const topic = document.getElementById('rd-topic').value.trim();
  const dateStr = document.getElementById('rd-date').value || todayISO();
  const correctCount = parseOptInt(document.getElementById('rd-correct').value);
  const totalCount = parseOptInt(document.getElementById('rd-total').value);
  const durationMin = parseOptInt(document.getElementById('rd-duration').value);

  if (id) {
    const r = readingStore.find(x => x.id === id);
    if (!r) return;
    if (r.text !== text) {
      pushReadingHistory(r, '编辑原文');
      if (r.annotations.length) {
        const { list, dropped } = reanchorAnnotations(text, r.annotations);
        r.annotations = list;
        if (dropped) showToast(`原文改动后有 ${dropped} 条批注找不到对应文字，已移除`, 'warning');
      }
    }
    Object.assign(r, { title, source, topic, dateStr, correctCount, totalCount, durationMin, text, updatedAt: Date.now() });
  } else {
    const r = migrateReading({ title, source, topic, dateStr, correctCount, totalCount, durationMin, text });
    readingStore.push(r);
    readingCurrentId = r.id;
    saveReadingPrefs();
  }
  await closeReadingModal(true);
  await persistReadingStore();
  renderReadings();
  updateTabCounts();
}

async function deleteReading(id) {
  const r = (readingStore || []).find(x => x.id === id);
  if (!r) return;
  const ok = await showConfirm({
    title: '删除这篇文章？',
    message: `「${r.title}」及其 ${r.annotations.length} 条批注、段落与总结笔记将从独立阅读库中删除（删除前会自动生成快照，可回滚）。`,
    okText: '删除'
  });
  if (!ok) return;
  await createSnapshot('删除阅读文章前备份');
  readingStore = readingStore.filter(x => x.id !== id);
  delete readingHistoryMap[id];
  if (readingCurrentId === id) readingCurrentId = '';
  await persistReadingStore(true);
  renderReadings();
  updateTabCounts();
  showToast('已删除文章并更新主 JSON 关联索引', 'success');
}

// =========================================================================
// 导出：复制为完整 Markdown 精读笔记（含元信息 + 段落脉络 + 总结 + 单词 + 句子）
// =========================================================================
function copyReadingMarkdown() {
  flushReadingSummary();
  flushParaNotes();
  const r = getCurrentReading();
  if (!r) return;
  const anns = [...r.annotations].sort((a, b) => a.start - b.start);
  const words = anns.filter(a => a.kind === 'word');
  const others = anns.filter(a => a.kind !== 'word');
  const paras = getReadingParagraphs(r.text);

  const metaParts = [
    r.source,
    r.topic ? `题材：${r.topic}` : '',
    r.dateStr,
    (r.correctCount !== '' && r.totalCount) ? `正确率：${r.correctCount}/${r.totalCount}` : '',
    r.durationMin ? `用时：${r.durationMin} 分钟` : ''
  ].filter(Boolean);

  const lines = [`# ${r.title}`, '', `> ${metaParts.join(' · ')}`, ''];

  const gistLines = [];
  paras.forEach(p => {
    const note = r.paraNotes && r.paraNotes[p.key];
    if (note && ((note.gist && note.gist.trim()) || note.role)) {
      const roleTag = note.role ? `【${getParaRoleMeta(note.role).label}】` : '';
      gistLines.push(`- **P${p.index + 1}** ${roleTag}${note.gist ? note.gist.trim() : ''}`);
    }
  });
  if (gistLines.length) {
    lines.push('## 🧭 段落脉络', '', ...gistLines, '');
  }

  if (r.summary.trim()) lines.push('## 📝 总结笔记', '', r.summary.trim(), '');
  if (words.length) {
    lines.push('## 🔤 单词', '');
    words.forEach(a => {
      lines.push(`- **${a.quote}**${a.meaning ? ` — ${a.meaning}` : ''}`);
      if (a.comment.trim()) lines.push(...a.comment.trim().split('\n').map(l => '  ' + l));
    });
    lines.push('');
  }
  if (others.length) {
    lines.push('## ✍️ 句子 / 短语', '');
    others.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.kind === 'phrase' ? `**${a.quote}**` : `*${a.quote}*`}`);
      if (a.meaning) lines.push(`   - 要点：${a.meaning}`);
      if (a.comment.trim()) lines.push(...a.comment.trim().split('\n').map(l => '   ' + l));
    });
    lines.push('');
  }
  const md = lines.join('\n');
  const done = () => showToast('已复制完整 Markdown 精读笔记到剪贴板', 'success');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(md).then(done).catch(() => fallbackCopy(md, done));
  } else {
    fallbackCopy(md, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { showToast('复制失败，请手动复制', 'error'); }
  ta.remove();
}

// =========================================================================
// 全局事件绑定
// =========================================================================
document.addEventListener('mouseup', (e) => {
  if (e.target.closest && e.target.closest('#readingToolbar')) return;
  if (e.target.closest && e.target.closest('#reading-text')) onReadingMouseUp(e);
  else if (!e.target.closest || !e.target.closest('.modal-backdrop')) hideReadingToolbar();
});
document.addEventListener('scroll', (e) => {
  if (e.target && e.target.closest && e.target.closest('#reading-side')) return;
  hideReadingToolbar();
}, true);
window.addEventListener('resize', hideReadingToolbar);

loadReadingPrefs();
