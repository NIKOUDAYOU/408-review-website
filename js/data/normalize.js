// 数据规范化（分模块独立校验 + 旧版 v3/v4 单文件兼容迁移）
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 4. 分模块数据规范化
// =========================================================================
function normalizeAnswerArray(val) {
  if (Array.isArray(val)) {
    return [...new Set(val.map(x => String(x || '').trim().toUpperCase()).filter(x => /^[A-F]$/.test(x)))].sort();
  }
  if (typeof val === 'string') {
    const letters = val.toUpperCase().match(/[A-F]/g) || [];
    return [...new Set(letters)].sort();
  }
  return [];
}

// 规范化一条考研政治记录（支持选择题错题 choice 与纯知识点 knowledge 双形态）
function migratePoliticsRecord(r) {
  const rec = r && typeof r === 'object' ? { ...r } : {};
  const cardKind = rec.cardKind === 'knowledge' ? 'knowledge' : 'choice';
  const subject = POLITICS_SUBJECTS.includes(rec.subject) ? rec.subject : (rec.subject || POLITICS_SUBJECTS[0]);
  const correctAnswer = normalizeAnswerArray(rec.correctAnswer);
  const wrongAnswer = normalizeAnswerArray(rec.wrongAnswer);
  let questionType = rec.questionType === 'multi' ? 'multi' : 'single';
  if (cardKind === 'choice' && correctAnswer.length > 1) questionType = 'multi';

  // 选项规范化（选择题默认保留 A~D）
  let options = [];
  if (Array.isArray(rec.options) && rec.options.length) {
    options = rec.options
      .filter(o => o && (o.key || o.text !== undefined))
      .map((o, idx) => ({
        key: String(o.key || String.fromCharCode(65 + idx)).trim().toUpperCase().slice(0, 1),
        text: String(o.text ?? '').trim()
      }))
      .filter(o => /^[A-F]$/.test(o.key));
  }
  if (cardKind === 'choice' && !options.length) {
    options = [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' }
    ];
  }

  const dateStr = isoToSlash(slashToIso(rec.dateStr || todayISO()));
  const firstDateStr = isoToSlash(slashToIso(rec.firstDateStr || dateStr));
  const forgetCount = Math.max(1, parseInt(rec.forgetCount, 10) || 1);

  let forgetEvents;
  if (Array.isArray(rec.forgetEvents) && rec.forgetEvents.length) {
    forgetEvents = rec.forgetEvents.filter(n => Number.isFinite(Number(n))).map(Number);
  } else {
    const firstTs = dateStrToTs(firstDateStr);
    const lastTs = dateStrToTs(dateStr);
    forgetEvents = [firstTs];
    if (forgetCount > 1 && lastTs !== firstTs) forgetEvents.push(lastTs);
  }

  const stem = String(rec.stem || '').trim();
  let topic = String(rec.topic || '').trim();
  if (!topic && stem) {
    topic = stem.replace(/^\d+[\.、．\s]+/, '').slice(0, 32);
  }

  return {
    id: rec.id || genId('pol'),
    cardKind,
    subject,
    questionType,
    topic: topic || '未命名政治卡片',
    stem,
    options,
    wrongAnswer,
    correctAnswer,
    siteAccuracy: String(rec.siteAccuracy || '').trim(),
    source: String(rec.source || '').trim(),
    errorReason: String(rec.errorReason || (cardKind === 'choice' ? '概念混淆' : '知识盲区')).trim(),
    analysis: String(rec.analysis ?? rec.note ?? '').trim(),
    imageId: String(rec.imageId || '').trim(),
    status: ['待解决', '复习中', '已掌握'].includes(rec.status) ? rec.status : '待解决',
    forgetCount,
    forgetEvents,
    practiceCount: Math.max(0, parseInt(rec.practiceCount, 10) || 0),
    practiceCorrectCount: Math.max(0, parseInt(rec.practiceCorrectCount, 10) || 0),
    firstDateStr,
    dateStr,
    createdAt: Number(rec.createdAt) || Date.now()
  };
}

function normalizeMathModule(raw) {
  const def = DEFAULT_DATA.math;
  const src = raw && typeof raw === 'object' ? (raw.data && raw.module === 'math' ? raw.data : raw) : null;
  if (!src) return { subjects: [...def.subjects], records: [] };
  const subjects = Array.isArray(src.subjects) && src.subjects.length ? [...src.subjects] : [...def.subjects];
  const rawRecords = Array.isArray(src.records) ? src.records : (Array.isArray(src) ? src : []);
  return { subjects, records: rawRecords.map(migrateRecord) };
}

function normalize408Module(raw) {
  const def = DEFAULT_DATA['408'];
  const src = raw && typeof raw === 'object' ? (raw.data && raw.module === '408' ? raw.data : raw) : null;
  if (!src) return { subjects: [...def.subjects], records: [] };
  const subjects = Array.isArray(src.subjects) && src.subjects.length ? [...src.subjects] : [...def.subjects];
  const rawRecords = Array.isArray(src.records) ? src.records : (Array.isArray(src) ? src : []);
  return { subjects, records: rawRecords.map(migrateRecord) };
}

function normalizePoliticsModule(raw) {
  const src = raw && typeof raw === 'object' ? (raw.data && raw.module === 'politics' ? raw.data : raw) : null;
  if (!src) return { subjects: [...POLITICS_SUBJECTS], records: [] };
  const subjects = Array.isArray(src.subjects) && src.subjects.length
    ? [...new Set([...POLITICS_SUBJECTS, ...src.subjects])]
    : [...POLITICS_SUBJECTS];
  const rawRecords = Array.isArray(src.records) ? src.records : (Array.isArray(src) ? src : []);
  return { subjects, records: rawRecords.map(migratePoliticsRecord) };
}

function normalizeTodosModule(raw) {
  const unwrapped = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (Array.isArray(raw.data) ? raw.data : (Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.todos) ? raw.todos : [])))
    : (Array.isArray(raw) ? raw : []);
  return unwrapped.map(t => ({
    id: t.id || genId('todo'),
    dateStr: slashToIso(t.dateStr || todayISO()),
    title: t.title || '',
    category: t.category || '综合',
    priority: t.priority || '中',
    completed: Boolean(t.completed),
    note: t.note || '',
    createdAt: t.createdAt || Date.now()
  }));
}

function normalizePapersModule(raw) {
  const unwrapped = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (Array.isArray(raw.data) ? raw.data : (Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.papers) ? raw.papers : [])))
    : (Array.isArray(raw) ? raw : []);
  return unwrapped.map(migratePaper);
}

function normalizeReadingsModule(raw) {
  const unwrapped = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (Array.isArray(raw.data) ? raw.data : (Array.isArray(raw.readings) ? raw.readings : (Array.isArray(raw.items) ? raw.items : [])))
    : (Array.isArray(raw) ? raw : []);
  if (typeof migrateReading === 'function') {
    return unwrapped.map(migrateReading);
  }
  return unwrapped;
}

// 兼容旧版整库规范化（用于旧 v3/v4 单文件 JSON 导入与首次升级迁移）
function normalizeData(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_DATA));
  if (!raw || typeof raw !== 'object') return base;

  base.app = raw.app || base.app;
  base.version = STORAGE_SCHEMA_VERSION;
  // 缺失时间戳时留空，避免旧文件误判为最新覆盖本地数据
  base.updatedAt = typeof raw.updatedAt === 'string' && !isNaN(new Date(raw.updatedAt).getTime()) ? raw.updatedAt : '';

  if (raw.math) base.math = normalizeMathModule(raw.math);
  if (raw['408']) base['408'] = normalize408Module(raw['408']);
  if (raw.politics) {
    base.politics = normalizePoliticsModule(raw.politics);
  } else {
    base.politics = { subjects: [...POLITICS_SUBJECTS], records: JSON.parse(JSON.stringify(DEFAULT_POLITICS_RECORDS)) };
  }

  base.todos = normalizeTodosModule(raw.todos || []);
  base.papers = normalizePapersModule(raw.papers || []);

  base.readingIndex = Array.isArray(raw.readingIndex) ? raw.readingIndex.map(item => ({
    id: item.id || '',
    title: item.title || '未命名文章',
    source: item.source || '',
    dateStr: slashToIso(item.dateStr || todayISO()),
    wordCount: Number(item.wordCount) || 0,
    annCount: Number(item.annCount) || 0,
    hasSummary: Boolean(item.hasSummary),
    updatedAt: item.updatedAt || Date.now()
  })).filter(x => x.id) : [];

  if (Array.isArray(raw.readings) && raw.readings.length && typeof migrateReading === 'function') {
    base._migratedReadings = raw.readings.map(migrateReading);
  }

  // 修正早期数据：套卷加入遗忘点时误把套卷名称当来源标签
  base.papers.forEach(pp => {
    if (!pp.name || pp.name === pp.category) return;
    ['math', '408'].forEach(m => {
      base[m].records.forEach(r => {
        if (r.source === pp.name) r.source = pp.category || '';
      });
    });
  });

  return base;
}
