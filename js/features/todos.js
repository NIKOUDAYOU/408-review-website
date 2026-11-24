// 每日待办与热力图
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// =========================================================================
// 8. 每日待办模块（按日期分组、进度条、顺延）
// =========================================================================
function toggleTodoDateSort() {
  todoDateSortOrder = todoDateSortOrder === 'desc' ? 'asc' : 'desc';
  document.getElementById('todo-sort-btn').textContent = todoDateSortOrder === 'desc'
    ? '📅 按日期降序（最新在前）↓'
    : '📅 按日期升序（最早在前）↑';
  renderTodos();
}


// 清空待办页的所有筛选条件
function clearTodoFilters() {
  document.getElementById('filter-todo-status').value = 'all';
  document.getElementById('filter-todo-cat').value = '';
  document.getElementById('filter-todo-date').value = '';
  document.getElementById('search-todo').value = '';
  renderTodos();
}


// 快速添加一条待办（来自顶部输入栏）
async function quickAddTodo() {
  const titleEl = document.getElementById('quick-todo-title');
  const title = titleEl.value.trim();
  if (!title) {
    showToast('请输入待办事项内容', 'warning');
    titleEl.focus();
    return;
  }

  appData.todos.push({
    id: genId('todo'),
    dateStr: document.getElementById('quick-todo-date').value || todayISO(),
    title,
    category: document.getElementById('quick-todo-cat').value,
    priority: document.getElementById('quick-todo-priority').value,
    completed: false,
    note: document.getElementById('quick-todo-note').value.trim(),
    createdAt: Date.now()
  });

  titleEl.value = '';
  document.getElementById('quick-todo-note').value = '';
  await persistData(true);
  renderTodos();
  showToast('已添加待办事项', 'success');
}


// 切换某条待办的完成状态
async function toggleTodoComplete(id) {
  const todo = appData.todos.find(t => t.id === id);
  if (!todo) return;
  todo.completed = !todo.completed;
  await persistData(true);
  renderTodos(id);
}


// 顺延待办：在自身日期上加一天
async function postponeTodoToTomorrow(id) {
  const todo = appData.todos.find(t => t.id === id);
  if (!todo) return;
  // 直接在待办自身日期上加一天：22 号没完成顺延到 23 号，而不是今天(23)的明天
  todo.dateStr = addDaysISO(todo.dateStr, 1);
  await persistData(true);
  renderTodos();
  showToast(`已顺延至 ${isoToSlash(todo.dateStr)}`, 'info');
}


// 删除一条待办
async function deleteTodo(id) {
  await createSnapshot('删除待办前备份');
  appData.todos = appData.todos.filter(t => t.id !== id);
  await persistData(true);
  renderTodos();
  showToast('已删除待办（可在历史快照中找回）', 'info');
}


// 打开待办编辑弹窗并回填字段
function openTodoModal(id) {
  const todo = appData.todos.find(t => t.id === id);
  if (!todo) return;
  document.getElementById('edit-todo-id').value = todo.id;
  document.getElementById('edit-todo-date').value = slashToIso(todo.dateStr);
  document.getElementById('edit-todo-cat').value = todo.category || '综合';
  document.getElementById('edit-todo-title').value = todo.title || '';
  document.getElementById('edit-todo-priority').value = todo.priority || '中';
  document.getElementById('edit-todo-completed').value = String(Boolean(todo.completed));
  document.getElementById('edit-todo-note').value = todo.note || '';
  document.getElementById('todoModal').classList.add('open');
}


// 关闭待办编辑弹窗
function closeTodoModal() {
  document.getElementById('todoModal').classList.remove('open');
}


// 保存待办编辑弹窗的修改
async function saveTodoModal() {
  const id = document.getElementById('edit-todo-id').value;
  const title = document.getElementById('edit-todo-title').value.trim();
  if (!title) {
    showToast('待办内容不能为空', 'warning');
    return;
  }
  const todo = appData.todos.find(t => t.id === id);
  if (todo) {
    todo.dateStr = document.getElementById('edit-todo-date').value || todayISO();
    todo.category = document.getElementById('edit-todo-cat').value;
    todo.title = title;
    todo.priority = document.getElementById('edit-todo-priority').value;
    todo.completed = document.getElementById('edit-todo-completed').value === 'true';
    todo.note = document.getElementById('edit-todo-note').value.trim();
  }
  closeTodoModal();
  await persistData(true);
  renderTodos();
  showToast('已保存待办修改', 'success');
}


// 渲染待办页顶部四个统计卡片
function renderTodoStats() {
  const today = todayISO();
  const all = appData.todos;
  const todayList = all.filter(t => t.dateStr === today);
  const todayDone = todayList.filter(t => t.completed).length;
  const pendingAll = all.filter(t => !t.completed).length;
  const overdue = all.filter(t => !t.completed && t.dateStr < today).length;
  const doneAll = all.filter(t => t.completed).length;

  const cards = [
    { label: '今日待办进度', value: `${todayDone} / ${todayList.length}`, color: 'text-blue-600', bg: 'bg-blue-50', icon: '🎯' },
    { label: '全部未完成', value: pendingAll, color: 'text-amber-600', bg: 'bg-amber-50', icon: '📝' },
    { label: '已逾期未完成', value: overdue, color: 'text-rose-600', bg: 'bg-rose-50', icon: '⏰' },
    { label: '累计已完成', value: doneAll, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: '🏆' }
  ];

  document.getElementById('stats-todo').innerHTML = cards.map((c, i) => `
    <div class="stat-card bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between" style="--stagger:${i}">
      <div>
        <div class="text-[11px] font-medium text-slate-500 mb-0.5">${c.label}</div>
        <div class="text-2xl font-extrabold ${c.color} tracking-tight">${c.value}</div>
      </div>
      <div class="w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center text-lg">${c.icon}</div>
    </div>
  `).join('');
}

// 月度待办热力图：每格 = 一天，颜色深浅表示当天待办数量
function shiftHeatmapMonth(delta) {
  const base = heatmapYM || todayISO().slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  heatmapYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderTodoHeatmap();
}


// 渲染月度待办热力图：按日期统计待办数量，颜色深浅表示忙闲
function renderTodoHeatmap() {
  const el = document.getElementById('todo-heatmap');
  if (!el) return;
  const ym = heatmapYM || todayISO().slice(0, 7);
  const [year, month] = ym.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = (firstDay.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const weekNames = ['一', '二', '三', '四', '五', '六', '日'];
  const today = todayISO();

  // 按日期统计待办数量（含已完成/未完成）
  const counts = {};
  appData.todos.forEach(t => {
    const iso = slashToIso(t.dateStr || today);
    counts[iso] = (counts[iso] || 0) + 1;
  });

  // 颜色分档：0 浅灰 → 1~2 → 3~4 → 5~6 → 7+ 深蓝
  const levelOf = n => n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  const cellColors = [
    'bg-slate-100/80 border-slate-200/70 text-slate-400',
    'bg-blue-100 border-blue-200 text-blue-700',
    'bg-blue-200 border-blue-300 text-blue-800',
    'bg-blue-400 border-blue-500 text-white',
    'bg-blue-600 border-blue-700 text-white'
  ];

  // 先汇总整月统计，再生成格子（避免 tooltip 里的“最多一天”标记错位）
  let monthTotal = 0, activeDays = 0, maxCount = 0, maxDay = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const n = counts[`${ym}-${String(d).padStart(2, '0')}`] || 0;
    monthTotal += n;
    if (n > 0) activeDays++;
    if (n > maxCount) { maxCount = n; maxDay = d; }
  }

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push('<div></div>'); // 月初占位
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const n = counts[iso] || 0;
    const lv = levelOf(n);
    const isToday = iso === today;
    const dow = (startWeekday + d - 1) % 7;
    cells.push(`
      <div class="relative aspect-square rounded-lg border flex flex-col items-center justify-center cursor-default transition-transform hover:scale-110 hover:z-10 shadow-xs ${cellColors[lv]} ${dow >= 5 ? 'opacity-90' : ''} ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}"
        title="${month}月${d}日：${n} 条待办${n > 0 && d === maxDay ? ' · 本月最多' : ''}">
        <span class="text-xs sm:text-sm font-semibold leading-none">${d}</span>
      </div>`);
  }

  const isCurrentMonth = ym === today.slice(0, 7);
  el.innerHTML = `
    <div class="bg-white/95 backdrop-blur border border-slate-200/80 rounded-2xl p-4 shadow-sm max-w-md mx-auto">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 class="text-sm sm:text-base font-bold text-slate-800">🗓️ 待办热力图 <span class="text-xs font-normal text-slate-400">· 格子颜色越深，当天待办越多</span></h3>
          <p class="text-[11px] text-slate-500 mt-0.5">本月共 <b class="text-blue-600">${monthTotal}</b> 条 · 有安排 <b class="text-emerald-600">${activeDays}</b> 天${maxCount ? ` · 最多 ${month}月${maxDay}日（${maxCount} 条）` : ''}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <button onclick="shiftHeatmapMonth(-1)" class="btn-tactile w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200" title="上个月">‹</button>
          <span class="min-w-[92px] text-center text-sm font-bold text-slate-700 tabular-nums">${year}年${month}月</span>
          <button onclick="shiftHeatmapMonth(1)" class="btn-tactile w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200 ${isCurrentMonth ? 'opacity-40' : ''}" title="下个月">›</button>
          ${!isCurrentMonth ? `<button onclick="heatmapYM='';renderTodoHeatmap()" class="btn-tactile px-2.5 h-8 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100">回到本月</button>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-1.5 sm:gap-2">
        ${weekNames.map(w => `<div class="text-center text-[11px] font-semibold text-slate-400 pb-1">${w}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="flex items-center justify-end gap-1.5 mt-3 text-[11px] text-slate-400">
        <span>少</span>
        ${cellColors.map(c => `<span class="w-3.5 h-3.5 rounded border ${c}"></span>`).join('')}
        <span>多</span>
      </div>
    </div>`;
}


// 渲染待办页：统计卡 + 热力图 + 按日期分组的待办列表
function renderTodos(popTodoId = null) {
  renderTodoStats();
  renderTodoHeatmap();
  const statusFilter = document.getElementById('filter-todo-status').value;
  const catFilter = document.getElementById('filter-todo-cat').value;
  const dateFilter = document.getElementById('filter-todo-date').value;
  const kw = document.getElementById('search-todo').value.trim().toLowerCase();

  let list = [...appData.todos];
  if (statusFilter === 'pending') list = list.filter(t => !t.completed);
  if (statusFilter === 'done') list = list.filter(t => t.completed);
  if (catFilter) list = list.filter(t => t.category === catFilter);
  if (dateFilter) list = list.filter(t => t.dateStr === dateFilter);
  if (kw) {
    list = list.filter(t =>
      (t.title || '').toLowerCase().includes(kw) ||
      (t.note || '').toLowerCase().includes(kw) ||
      (t.category || '').toLowerCase().includes(kw)
    );
  }

  const container = document.getElementById('todo-groups-container');
  if (!list.length) {
    container.innerHTML = `
      <div class="bg-white/95 border border-slate-200/80 rounded-2xl p-14 text-center shadow-sm">
        <div class="text-4xl mb-3">🗓️</div>
        <div class="text-slate-600 font-semibold mb-1">暂无待办事项</div>
        <div class="text-xs text-slate-400">在上方快速添加今天的考研复习计划，或从数学/408薄弱点一键加入待办 ✨</div>
      </div>`;
    return;
  }

  const groupsMap = {};
  list.forEach(t => {
    const d = slashToIso(t.dateStr);
    if (!groupsMap[d]) groupsMap[d] = [];
    groupsMap[d].push(t);
  });

  const sortedDates = Object.keys(groupsMap).sort((a, b) =>
    todoDateSortOrder === 'desc' ? b.localeCompare(a) : a.localeCompare(b)
  );

  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const priorityRank = { '高': 1, '中': 2, '低': 3 };

  const catStyles = {
    '数学': 'bg-blue-50 text-blue-700',
    '408': 'bg-violet-50 text-violet-700',
    '英语': 'bg-cyan-50 text-cyan-700',
    '政治': 'bg-rose-50 text-rose-700',
    '综合': 'bg-slate-100 text-slate-600'
  };

  const prioStyles = {
    '高': 'bg-rose-50 text-rose-600 border border-rose-200/70',
    '中': 'bg-amber-50 text-amber-700 border border-amber-200/70',
    '低': 'bg-slate-100 text-slate-500 border border-slate-200/70'
  };

  container.innerHTML = sortedDates.map((dateIso, gIdx) => {
    const items = groupsMap[dateIso].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const pDiff = (priorityRank[a.priority] || 2) - (priorityRank[b.priority] || 2);
      if (pDiff !== 0) return pDiff;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    const doneCount = items.filter(i => i.completed).length;
    const pct = Math.round((doneCount / items.length) * 100);
    const hasPending = doneCount < items.length;

    let tagHtml = '';
    if (dateIso === today) {
      tagHtml = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">今天</span>`;
    } else if (dateIso === tomorrow) {
      tagHtml = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700">明天</span>`;
    } else if (dateIso < today && hasPending) {
      tagHtml = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">有未完成</span>`;
    } else if (dateIso < today) {
      tagHtml = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">已归档</span>`;
    } else {
      tagHtml = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-700">计划中</span>`;
    }

    const itemsHtml = items.map(t => {
      const popClass = popTodoId === t.id ? 'animate-pop' : '';
      return `
        <li class="flex flex-wrap sm:flex-nowrap items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 last:border-b-0 transition-all ${t.completed ? 'bg-slate-50/60 opacity-75' : 'hover:bg-blue-50/25'}">
          <div class="flex items-start gap-3.5 flex-1 min-w-0">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTodoComplete('${t.id}')"
              class="mt-1 w-5 h-5 rounded-md accent-blue-600 cursor-pointer flex-shrink-0 ${popClass}" />
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-lg text-xs font-semibold ${catStyles[t.category] || catStyles['综合']}">${escapeHtml(t.category || '综合')}</span>
                <span class="px-2 py-0.5 rounded-lg text-[11px] font-semibold ${prioStyles[t.priority] || prioStyles['中']}">${escapeHtml(t.priority || '中')}优</span>
                <span class="text-[15px] font-semibold break-words ${t.completed ? 'line-through text-slate-400' : 'text-slate-800'}">${escapeHtml(t.title)}</span>
              </div>
              ${t.note ? `<div class="text-xs text-slate-500 mt-1.5 break-words">${escapeHtml(t.note)}</div>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0 ml-8 sm:ml-0">
            ${!t.completed ? `<button onclick="postponeTodoToTomorrow('${t.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100" title="顺延到下一天">顺延</button>` : ''}
            <button onclick="openTodoModal('${t.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">编辑</button>
            <button onclick="deleteTodo('${t.id}')" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100">删除</button>
          </div>
        </li>
      `;
    }).join('');

    return `
      <div class="todo-date-group bg-white/95 backdrop-blur border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden" style="--stagger:${gIdx}">
        <div class="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="text-base font-bold text-slate-800">📅 ${isoToSlash(dateIso)}</span>
            <span class="text-sm font-medium text-slate-500">${getWeekday(dateIso)}</span>
            ${tagHtml}
          </div>
          <div class="flex items-center gap-3 text-xs font-medium text-slate-500">
            <span>已完成 <b class="text-slate-800">${doneCount}</b> / ${items.length}</span>
            <div class="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-300" style="width:${pct}%"></div>
            </div>
          </div>
        </div>
        <ul>${itemsHtml}</ul>
      </div>
    `;
  }).join('');
}
