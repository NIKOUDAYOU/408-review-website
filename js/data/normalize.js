// 数据规范化
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 4. 数据规范化、三层存储同步与手动保存
// =========================================================================
function normalizeData(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_DATA));
  if (!raw || typeof raw !== 'object') return base;

  base.app = raw.app || base.app;
  base.version = 4;
  // 缺失时间戳时不能填“现在”，否则旧文件会被误判为最新而覆盖本地数据；留空即视为最旧
  base.updatedAt = typeof raw.updatedAt === 'string' && !isNaN(new Date(raw.updatedAt).getTime()) ? raw.updatedAt : '';

  if (raw.math) {
    base.math.subjects = Array.isArray(raw.math.subjects) && raw.math.subjects.length
      ? raw.math.subjects : base.math.subjects;
    base.math.records = (Array.isArray(raw.math.records) ? raw.math.records : []).map(migrateRecord);
  }
  if (raw['408']) {
    base['408'].subjects = Array.isArray(raw['408'].subjects) && raw['408'].subjects.length
      ? raw['408'].subjects : base['408'].subjects;
    base['408'].records = (Array.isArray(raw['408'].records) ? raw['408'].records : []).map(migrateRecord);
  }
  base.todos = Array.isArray(raw.todos) ? raw.todos.map(t => ({
    id: t.id || genId('todo'),
    dateStr: slashToIso(t.dateStr || todayISO()),
    title: t.title || '',
    category: t.category || '综合',
    priority: t.priority || '中',
    completed: Boolean(t.completed),
    note: t.note || '',
    createdAt: t.createdAt || Date.now()
  })) : [];

  base.papers = Array.isArray(raw.papers) ? raw.papers.map(migratePaper) : [];

  // 修正旧数据：从套卷加入遗忘点时误把套卷名称（如“2015”）当来源标签，改回套卷分类（真题/模拟卷）
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
