// 统计页（组别选择、分数图表）
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// 平均分统计图表：数学/408 × 真题/模拟卷，柱形展示各套分数与平均分
    // ============ 统计页：组别大卡选择 + 单组详情 ============
let statGroupKey = ''; // 当前选中组别的 key，形如 math|模拟卷|张八

// 组装所有组别：数学真题 / 数学各模拟系列 / 408 真题 / 408 模拟
function buildStatGroups() {
  const groups = [];
  const add = (mod, cat, series, label, icon) => groups.push({
    key: `${mod}|${cat}|${series || ''}`, mod, cat, series, label, icon
  });
  add('math', '真题', '', '数学真题', '📐');
  // 数学模拟卷按系列拆分（无系列的归入「其他模拟卷」）
  const seriesCount = {};
  appData.papers
    .filter(p => p.mod === 'math' && p.category === '模拟卷')
    .forEach(p => {
      const s = (p.series || '').trim();
      seriesCount[s] = (seriesCount[s] || 0) + 1;
    });
  Object.keys(seriesCount)
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : (seriesCount[b] - seriesCount[a]) || a.localeCompare(b)))
    .forEach(s => add('math', '模拟卷', s, s ? `数学·${s}` : '其他模拟卷', '📘'));
  add('408', '真题', '', '408 真题', '💻');
  add('408', '模拟卷', '', '408 模拟', '🧪');
  return groups;
}

// 取某个组别下「填了分数」的套卷（按日期升序）
function papersOfGroup(g) {
  return appData.papers
    .filter(p => p.mod === g.mod && p.category === g.cat
      && (p.series || '').trim() === (g.series || '')
      && (p.smallScore !== null || p.bigScore !== null))
    .sort((a, b) => slashToIso(a.dateStr).localeCompare(slashToIso(b.dateStr)));
}

// 上一次均分线位置 / 均分数字（用于切换组别时的平滑动画）
let statLastAvgPct = null;
let statLastAvgNum = null;
let statAnimTimer = null;

// 平滑滚动数字：从 from 滚到 to，保留 1 位小数
function statTweenNumber(el, from, to, dur = 550) {
  if (from === to || !isFinite(from) || !isFinite(to)) { el.textContent = to.toFixed(1); return; }
  const t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
    el.textContent = (from + (to - from) * eased).toFixed(1);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

// 点击组别大卡：高亮平滑过渡 + 详情区淡出后入场
function selectStatGroup(key) {
  if (key === statGroupKey) return;
  statGroupKey = key;
  // 大卡高亮：只切换 class，交给 CSS transition 平滑过渡
  document.querySelectorAll('#score-chart .stat-tile').forEach(t =>
    t.classList.toggle('active', t.dataset.groupKey === key));
  // 详情区：旧内容先淡出，再渲染新内容（带入场动画）
  const box = document.getElementById('stat-detail');
  if (!box) return;
  box.classList.remove('stat-out');
  void box.offsetWidth; // 强制重排，保证连续点击也能重放淡出动画
  box.classList.add('stat-out');
  clearTimeout(statAnimTimer);
  statAnimTimer = setTimeout(() => renderStatDetail(true), 180);
}

// 新增系列：打开套卷弹窗并预置「数学 + 模拟卷」，光标落在系列输入框
function openPaperModalForSeries() {
  openPaperModal();
  document.getElementById('paper-mod').value = 'math';
  document.getElementById('paper-category').value = '模拟卷';
  onPaperModChange();
  document.getElementById('paper-series').value = '';
  updatePaperSeriesVisibility();
  setTimeout(() => document.getElementById('paper-series').focus(), 120);
}

// 渲染统计页：顶部组别大卡 + 下方选中组别的详情
function renderScoreChart() {
  const el = document.getElementById('score-chart');
  if (!el) return;
  const MAX = 150;
  const groups = buildStatGroups();

  // 默认选中：优先有数据的组别
  if (!groups.some(g => g.key === statGroupKey)) {
    const withData = groups.find(g => papersOfGroup(g).length);
    statGroupKey = (withData || groups[0]).key;
  }

  // ---- 组别大卡（选中态由 .stat-tile 驱动，切换只动 class，CSS 平滑过渡） ----
  const tiles = groups.map(g => {
    const list = papersOfGroup(g);
    const avg = list.length ? list.reduce((a, p) => a + paperTotal(p), 0) / list.length : null;
    return `
      <button onclick="selectStatGroup('${g.key}')" data-group-key="${g.key}"
        class="stat-tile btn-tactile text-left rounded-2xl border border-slate-200/80 bg-white/95 px-3.5 py-3 ${g.key === statGroupKey ? 'active' : ''}">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-base">${g.icon}</span>
          <span class="st-label text-xs font-bold truncate text-slate-800">${escapeHtml(g.label)}</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="st-avg text-xl font-extrabold tabular-nums text-slate-900">${avg === null ? '—' : avg.toFixed(1)}</span>
          <span class="st-sub text-[11px] text-slate-400">均分</span>
          <span class="st-sub ml-auto text-[11px] text-slate-400">${list.length} 套</span>
        </div>
      </button>`;
  }).join('') + `
      <button onclick="openPaperModalForSeries()"
        class="btn-tactile rounded-2xl border border-dashed border-slate-300 px-3.5 py-3 text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40 transition-all flex flex-col items-center justify-center gap-1">
        <span class="text-lg">＋</span>
        <span class="text-[11px] font-semibold">新增系列</span>
      </button>`;

  el.innerHTML = `
    <div class="space-y-4">
      <!-- 组别选择 -->
      <div class="bg-white/60 backdrop-blur border border-slate-200/70 rounded-2xl p-3.5 sm:p-4 shadow-sm">
        <div class="flex items-center justify-between mb-2.5 px-0.5">
          <h3 class="text-sm font-bold text-slate-800">选择组别</h3>
          <span class="text-[11px] text-slate-400">共 ${appData.papers.length} 套记录 · 点击查看该组分数曲线</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">${tiles}</div>
      </div>

      <!-- 选中组别详情（独立容器：切换组别时只重渲这一块，动画更连贯） -->
      <div id="stat-detail"></div>
    </div>`;
  renderStatDetail(false);
}

// 渲染选中组别的详情区；animated=true 表示由「切换组别」触发，启用平滑动画
// 动画拆解：卡片上浮淡入 → 柱形从 0 逐根生长 → 明细行逐条错峰 → 均分线滑移 + 均分数字滚动
function renderStatDetail(animated) {
  const el = document.getElementById('stat-detail');
  if (!el) return;
  el.classList.remove('stat-out'); // 清除淡出态（forwards 会把容器定在透明，必须先清掉）
  const MAX = 150;
  const all = buildStatGroups();
  const g = all.find(x => x.key === statGroupKey) || all[0];
  const list = papersOfGroup(g);
  const scores = list.map(paperTotal);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const hi = scores.length ? Math.max(...scores) : 0;
  const lo = scores.length ? Math.min(...scores) : 0;
  const avgPct = Math.max(0, Math.min(100, avg / MAX * 100));
  const fromPct = statLastAvgPct; // 上一次均分线的位置（滑移动画起点）
  const fromNum = statLastAvgNum; // 上一次显示的均分（数字滚动起点）

  const bars = list.map((p, i) => `
    <div class="relative flex-1 h-full flex items-end justify-center group" title="${escapeHtml(p.name)}：${scores[i]} 分（${escapeHtml(p.dateStr)}）">
      <div class="stat-bar w-full max-w-[22px] rounded-t-md bg-blue-500 opacity-60 group-hover:opacity-100 transition-opacity" style="--i:${i};height:${Math.max(2, Math.min(100, scores[i] / MAX * 100))}%"></div>
    </div>`).join('');

  const rows = list.map((p, i) => `
    <div class="stat-row flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/70 bg-white/70 text-sm" style="--i:${i}">
      <span class="text-xs text-slate-400 tabular-nums w-20 shrink-0">${escapeHtml(p.dateStr)}</span>
      <span class="flex-1 font-medium text-slate-800 truncate">${escapeHtml(p.name)}</span>
      ${p.series ? `<span class="hidden sm:inline px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-700 text-[11px] font-semibold shrink-0">${escapeHtml(p.series)}</span>` : ''}
      <span class="text-xs text-slate-400 tabular-nums shrink-0">小题 ${p.smallScore ?? '—'} · 大题 ${p.bigScore ?? '—'}</span>
      <span class="w-14 text-right text-base font-extrabold text-emerald-600 tabular-nums shrink-0">${paperTotal(p)}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="stat-anim bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg">${g.icon}</span>
            <h3 class="text-base font-bold text-slate-900">${escapeHtml(g.label)}</h3>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700">${list.length} 套</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span id="statAvgNum" class="text-4xl font-extrabold text-blue-600 tabular-nums leading-none">${scores.length ? avg.toFixed(1) : '—'}</span>
            <span class="text-xs text-slate-400">平均分</span>
            ${scores.length ? `<span class="text-[11px] text-slate-400 ml-2">最高 ${hi} · 最低 ${lo} · 满分 ${MAX}</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span class="inline-block w-3 h-3 rounded bg-blue-500/60"></span>单套得分
          <span class="inline-block w-3 h-0.5 bg-blue-600 ml-2"></span>平均分线
        </div>
      </div>

      <div class="relative h-52 bg-slate-50/90 border border-slate-100 rounded-xl overflow-hidden px-3 pt-3">
        <div class="absolute inset-x-0 bottom-1/3 border-t border-dashed border-slate-200"></div>
        <div class="absolute inset-x-0 bottom-[66.6%] border-t border-dashed border-slate-200"></div>
        <div class="flex items-end gap-1.5 h-full">
          ${scores.length ? bars : '<div class="w-full self-center text-center text-xs text-slate-400 py-16">该组别还没有带分数的套卷，点右上角「＋ 新增系列」或到套卷页添加</div>'}
        </div>
        ${scores.length ? `<div id="statAvgLine" class="absolute inset-x-3 border-t-2 border-dashed border-blue-500 pointer-events-none" style="bottom:calc(12px + (100% - 12px) * ${avgPct / 100})"></div>` : ''}
      </div>

      <div class="mt-2 text-[10px] text-slate-400">按考试日期从左到右排列 →</div>

      ${list.length ? `<div class="mt-4 space-y-1.5">${rows}</div>` : ''}
    </div>`;

  // ---- 切换组别时的增量动画（首次渲染不需要） ----
  if (animated) {
    // 均分线：从上一组的位置平滑滑到当前位置
    const line = el.querySelector('#statAvgLine');
    if (line && fromPct !== null && Math.abs(fromPct - avgPct) > 0.01) {
      line.animate(
        [{ bottom: `calc(12px + (100% - 12px) * ${fromPct / 100})` },
         { bottom: `calc(12px + (100% - 12px) * ${avgPct / 100})` }],
        { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    // 均分数字：从上一组的数值滚动到当前数值
    const numEl = el.querySelector('#statAvgNum');
    if (numEl && scores.length && fromNum !== null) statTweenNumber(numEl, parseFloat(fromNum), avg);
  }
  statLastAvgPct = scores.length ? avgPct : null;
  statLastAvgNum = scores.length ? avg.toFixed(1) : null;
}
