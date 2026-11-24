// 常量配置、默认数据与全局运行状态
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 1. 常量配置与默认数据（100% 兼容 v3 JSON 数据结构）
// =========================================================================
const DB_NAME = 'KaoyanTrackerDB';
const DB_VERSION = 1;
const LS_KEY_V4 = 'kaoyan_tracker_data_v4';
const LS_KEY_V3 = 'kaoyan_tracker_data_v3';
const LS_PREFS_KEY = 'kaoyan_tracker_prefs_v4';
const MAX_SNAPSHOTS = 15;

const DEFAULT_DATA = {
  "app": "考研数学与408薄弱点遗忘追踪表",
  "version": 4,
  "updatedAt": "2026-11-21T05:46:52.417Z",
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
  "todos": [],
  "papers": []
};

// 全局运行状态
let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
let dbInstance = null;
let fileHandle = null;
let pendingSavedHandle = null; // 刷新后从 IndexedDB 恢复的句柄（等待用户点击授权）
let isDirty = false; // 是否有尚未手动保存/写盘的修改
let todoDateSortOrder = 'desc';
let heatmapYM = ''; // 热力图当前查看的月份（YYYY-MM），空 = 当月
let viewModes = { math: 'card', '408': 'card' }; // 默认大卡片视图
let pageState = { math: { page: 1, size: 20 }, '408': { page: 1, size: 20 } }; // 分页状态
let paperDraftErrors = []; // 套卷弹窗中正在编辑的错误题草稿
let autoSyncEnabled = true;
let confirmResolver = null;
