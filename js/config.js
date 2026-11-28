// 常量配置、默认数据与全局运行状态
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 1. 常量配置与默认数据（v5 分模块存储，100% 兼容 v3/v4 旧数据自动迁移）
// =========================================================================
const DB_NAME = 'KaoyanTrackerDB';
const DB_VERSION = 2;
const STORAGE_SCHEMA_VERSION = 5;

// 旧版单文件存储键（仅用于首次升级无损迁移与兼容兜底）
const LS_KEY_V4 = 'kaoyan_tracker_data_v4';
const LS_KEY_V3 = 'kaoyan_tracker_data_v3';
const LS_READING_STORE_KEY = 'kaoyan_tracker_readings_v1';
const LS_PREFS_KEY = 'kaoyan_tracker_prefs_v4';

// 新版分模块 localStorage 前缀：每个模块独立键，互不挤压配额
const LS_MOD_PREFIX = 'kaoyan_v5_mod_';
const MAX_SNAPSHOTS = 15;

// 六大独立存储模块注册表（本地数据目录内各自对应独立 JSON 文件）
const STORAGE_MODULES = [
  { key: 'math',     file: 'math.json',     label: '考研数学',   icon: '📐', desc: '高等数学 / 线代 / 概率论薄弱点' },
  { key: '408',      file: 'cs408.json',    label: '408 专业课', icon: '💻', desc: '数据结构 / 计组 / 操作系统 / 网络薄弱点' },
  { key: 'politics', file: 'politics.json', label: '考研政治',   icon: '📕', desc: '政治选择题错题与知识点卡片' },
  { key: 'todos',    file: 'todos.json',    label: '每日待办',   icon: '📅', desc: '每日复习计划与打卡热力图' },
  { key: 'papers',   file: 'papers.json',   label: '套卷记录',   icon: '📝', desc: '数学与 408 真题/模拟卷及错题' },
  { key: 'readings', file: 'readings.json', label: '英语阅读',   icon: '📖', desc: '英文原文、段落笔记与高亮批注' }
];

// 考研政治科目与错因预设
const POLITICS_SUBJECTS = ['马原', '毛中特', '习思', '史纲', '思修法基', '时政'];
const POLITICS_ERROR_REASONS = [
  '概念混淆',
  '帽子题张冠李戴',
  '漏选',
  '误选干扰项',
  '知识盲区',
  '审题失误',
  '时政遗忘',
  '其他'
];

// 考研政治初始示例（首次启用政治模块时展示，可直接体验复盘与自测重做）
const DEFAULT_POLITICS_RECORDS = [
  {
    id: 'pol-demo-001',
    cardKind: 'choice',
    subject: '毛中特',
    questionType: 'single',
    topic: '马克思主义中国化时代化理论成果的共同点',
    stem: '5. 马克思主义中国化时代化的理论成果是一脉相承又与时俱进的关系。它们都是 ①关于中国革命、建设、改革的正确的理论原则和经验总结 ②马克思列宁主义在中国的运用和发展 ③全国各族人民团结奋斗的共同思想基础 ④党和国家必须长期坚持的指导思想',
    options: [
      { key: 'A', text: '①②③' },
      { key: 'B', text: '①②④' },
      { key: 'C', text: '①③④' },
      { key: 'D', text: '②③④' }
    ],
    wrongAnswer: ['B'],
    correctAnswer: ['D'],
    siteAccuracy: '53%',
    source: '刷题错题',
    errorReason: '概念混淆',
    analysis: '**排除 ① 的关键原因：**\n- **毛泽东思想**是关于**中国革命和建设**的正确的理论原则和经验总结；\n- **中国特色社会主义理论体系**（邓/三/科/习）聚焦**建设、改革和发展**，并不涵盖「中国革命」；\n- 题干问的是「**它们都是**」，① 并非全部理论成果的共同概括，故排除 ①。\n\n**共同点（②③④）：**\n1. 都是马克思列宁主义在中国的运用和发展；\n2. 都是全国各族人民团结奋斗的共同思想基础；\n3. 都是党和国家必须长期坚持的指导思想。',
    imageId: '',
    status: '待解决',
    forgetCount: 1,
    forgetEvents: [1795651200000],
    practiceCount: 0,
    practiceCorrectCount: 0,
    firstDateStr: '2026/11/26',
    dateStr: '2026/11/26',
    createdAt: 1795651200000
  }
];

const DEFAULT_DATA = {
  "app": "考研复盘工作台（数学 · 408 · 政治 · 英语）",
  "version": STORAGE_SCHEMA_VERSION,
  "updatedAt": "2026-11-26T00:00:00.000Z",
  "math": {
    "subjects": ["高等数学", "线性代数", "概率论与数理统计"],
    "records": [
      {
        "id": "math-1795240012408-t4hv",
        "subject": "高等数学",
        "topic": "27|李六|物理应用",
        "type": "知识缺失",
        "source": "模拟卷",
        "status": "待解决",
        "note": "忘记要用单位密度去求质量，然后算力，需要对物理应用进行弥补",
        "forgetCount": 1,
        "firstDateStr": "2026/11/21",
        "dateStr": "2026/11/21",
        "createdAt": 1795233600000
      }
    ]
  },
  "408": {
    "subjects": ["数据结构", "计组", "操作系统", "网络"],
    "records": [
      {
        "id": "408-1795239427422-l79u",
        "subject": "数据结构",
        "topic": "Cache 的写回策略",
        "type": "理解错误",
        "source": "模拟题",
        "status": "待解决",
        "note": "",
        "forgetCount": 1,
        "firstDateStr": "2026/11/21",
        "dateStr": "2026/11/21",
        "createdAt": 1795233600000
      }
    ]
  },
  "politics": {
    "subjects": [...POLITICS_SUBJECTS],
    "records": JSON.parse(JSON.stringify(DEFAULT_POLITICS_RECORDS))
  },
  "todos": [],
  "papers": [],
  "readingIndex": []
};

// 英语阅读内存数组（在 IndexedDB / 本地目录中独立存储于 readings.json）
let readingStore = []; // [{ id, title, source, dateStr, text, summary, createdAt, updatedAt, annotations }]

// 本地目录与兼容单文件句柄
let dirHandle = null;          // v5 绑定的本地数据文件夹句柄（FileSystemDirectoryHandle）
let pendingDirHandle = null;   // 刷新后从 IndexedDB 恢复的目录句柄（等待一键授权）
let fileHandle = null;         // 兼容旧版：单文件主 JSON 句柄
let pendingSavedHandle = null; // 兼容旧版：待恢复的单文件主 JSON 句柄
let readingFileHandle = null;  // 兼容旧版：独立阅读库单文件句柄
let pendingReadingHandle = null;

// 分模块元数据与脏模块集合（用于增量落盘：改哪个模块只写哪个文件）
let moduleMeta = {}; // { [modKey]: { updatedAt: ISOString, count: number } }
let dirtyModules = new Set();

// 全局运行状态
let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
let dbInstance = null;
let isDirty = false; // 是否有尚未同步到硬盘 / 手动保存的修改
let todoDateSortOrder = 'desc';
let heatmapYM = ''; // 热力图当前查看的月份（YYYY-MM），空 = 当月
const MAX_CARD_PAGE_SIZE = 10;
const CARD_PAGE_SIZE_OPTIONS = [5, 10];
function normalizeCardPageSize(val) {
  const n = parseInt(val, 10);
  if (!n || isNaN(n)) return MAX_CARD_PAGE_SIZE;
  const clamped = Math.min(MAX_CARD_PAGE_SIZE, Math.max(1, n));
  return CARD_PAGE_SIZE_OPTIONS.includes(clamped) ? clamped : MAX_CARD_PAGE_SIZE;
}

let viewModes = { math: 'card', '408': 'card', politics: 'card' }; // 默认大卡片视图
let pageState = {
  math: { page: 1, size: MAX_CARD_PAGE_SIZE },
  '408': { page: 1, size: MAX_CARD_PAGE_SIZE },
  politics: { page: 1, size: MAX_CARD_PAGE_SIZE },
  papers: { page: 1, size: MAX_CARD_PAGE_SIZE }
};
let paperDraftErrors = []; // 套卷弹窗中正在编辑的错误题草稿
let autoSyncEnabled = true;
let fontPreset = 'claude-kai'; // 默认 Claude 风格书卷楷体：claude-kai | claude-serif | sans
let confirmResolver = null;
