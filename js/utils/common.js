// 通用工具函数（日期、ID、转义）
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 3. 通用工具函数
// =========================================================================
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


// ISO 日期（YYYY-MM-DD）转斜杠格式（YYYY/MM/DD）
function isoToSlash(iso) {
  if (!iso) return todayISO().replace(/-/g, '/');
  return iso.replace(/-/g, '/');
}


// 任意斜杠/短横线日期统一规范化为 ISO 格式
function slashToIso(str) {
  if (!str) return todayISO();
  const parts = String(str).replace(/\//g, '-').split('-');
  if (parts.length !== 3) return todayISO();
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}


// 在 ISO 日期上加/减若干天，返回新的 ISO 日期
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}


// 取 ISO 日期对应的中文星期几
function getWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date(y, m - 1, d).getDay()];
}


// 时间戳格式化为可读的“月-日 时:分”文本
function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}


// 生成带前缀的唯一 ID（时间戳 + 随机串）
function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}


// HTML 转义：防止备注/标题等用户输入被当作标签执行（XSS 防护）
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
