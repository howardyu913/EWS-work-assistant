/* ========================
   工作助手 - 主逻辑
   ======================== */

// ---------- 数据存储 ----------
const DB = {
  get(key, def = []) { try { return JSON.parse(localStorage.getItem('wa_' + key)) || def; } catch { return def; } },
  set(key, val) { localStorage.setItem('wa_' + key, JSON.stringify(val)); },
};

// ---------- 状态 ----------
let currentPage = 'home';
let editingId = null;
let editingType = null;
let scheduleViewDate = new Date();
let pomodoroTimer = null;
let pomodoroSeconds = 25 * 60;
let pomodoroMode = 'work';
let pomodoroRunning = false;
const POMO_TIMES = { work: 25, shortBreak: 5, longBreak: 15 };

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
  initHome();
  initTodo();
  initSchedule();
  initNote();
  initPomodoro();
  registerSW();
});

// ---------- Service Worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ==================== 导航 ====================
function navigateTo(page) {
  currentPage = page;
  // 更新页面
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  // 更新导航
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  // 更新标题
  const titles = { home: '工作助手', todo: '待办事项', schedule: '日程安排', note: '我的笔记', pomodoro: '番茄钟', settings: '设置' };
  document.getElementById('page-title').textContent = titles[page] || '工作助手';
  // 刷新数据
  if (page === 'home') renderHome();
  if (page === 'todo') renderTodo();
  if (page === 'schedule') renderSchedule();
  if (page === 'note') renderNote();
  if (page === 'pomodoro') renderPomodoroHistory();
}

// ==================== 首页 ====================
function initHome() {
  renderHome();
}

function renderHome() {
  const now = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  document.getElementById('home-date').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekDays[now.getDay()]}`;
  const hour = now.getHours();
  let greet = '晚上好';
  if (hour < 12) greet = '早上好';
  else if (hour < 18) greet = '下午好';
  document.getElementById('home-greeting').textContent = `${greet}，今天也要加油！`;

  // 统计
  const todos = DB.get('todos');
  const schedules = DB.get('schedules');
  const notes = DB.get('notes');
  const pomo = DB.get('pomo_stats', { today: 0, totalMin: 0, history: [] });
  const todayStr = formatDate(now);
  document.getElementById('stat-todo').textContent = todos.filter(t => !t.completed && t.date === todayStr).length;
  document.getElementById('stat-schedule').textContent = schedules.filter(s => s.date === todayStr).length;
  document.getElementById('stat-note').textContent = notes.length;
  document.getElementById('stat-pomodoro').textContent = pomo.today || 0;

  // 今日待办
  const todayTodos = todos.filter(t => t.date === todayStr && !t.completed).slice(0, 5);
  const todoList = document.getElementById('home-todo-list');
  todoList.innerHTML = '';
  if (todayTodos.length === 0) {
    document.getElementById('home-todo-empty').style.display = 'block';
  } else {
    document.getElementById('home-todo-empty').style.display = 'none';
    todayTodos.forEach(t => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot ${t.priority}"></span><span>${escapeHtml(t.title)}</span>`;
      todoList.appendChild(li);
    });
  }

  // 今日日程
  const todaySchedules = schedules.filter(s => s.date === todayStr).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 5);
  const scheduleList = document.getElementById('home-schedule-list');
  scheduleList.innerHTML = '';
  if (todaySchedules.length === 0) {
    document.getElementById('home-schedule-empty').style.display = 'block';
  } else {
    document.getElementById('home-schedule-empty').style.display = 'none';
    todaySchedules.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot schedule"></span><span>${s.time} ${escapeHtml(s.title)}</span>`;
      scheduleList.appendChild(li);
    });
  }
}

// ==================== 待办 ====================
function initTodo() {
  document.getElementById('todo-input-date').value = formatDate(new Date());
}

function renderTodo() {
  const filter = document.getElementById('todo-filter').value;
  let todos = DB.get('todos');
  if (filter === 'active') todos = todos.filter(t => !t.completed);
  if (filter === 'completed') todos = todos.filter(t => t.completed);
  todos.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pri = { high: 0, medium: 1, low: 2 };
    if (pri[a.priority] !== pri[b.priority]) return pri[a.priority] - pri[b.priority];
    return (a.date || '').localeCompare(b.date || '');
  });

  const list = document.getElementById('todo-list');
  list.innerHTML = '';
  const empty = document.getElementById('todo-empty');
  if (todos.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  todos.forEach(t => {
    const li = document.createElement('li');
    li.className = 'list-item' + (t.completed ? ' completed' : '');
    li.innerHTML = `
      <div class="list-item-header">
        <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTodo('${t.id}')">
        <span class="list-item-title">${escapeHtml(t.title)}</span>
        <span class="priority-badge ${t.priority}">${priorityLabel(t.priority)}</span>
      </div>
      <div class="list-item-meta">
        <span>📅 ${t.date || '无日期'}</span>
      </div>
      <div class="list-item-actions">
        <button onclick="editTodo('${t.id}')">编辑</button>
        <button class="delete" onclick="deleteTodo('${t.id}')">删除</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function priorityLabel(p) { return { high: '高', medium: '中', low: '低' }[p] || p; }

function saveTodo() {
  const title = document.getElementById('todo-input-title').value.trim();
  if (!title) { alert('请输入待办内容'); return; }
  const todos = DB.get('todos');
  const data = {
    id: editingId || Date.now().toString(),
    title,
    priority: document.getElementById('todo-input-priority').value,
    date: document.getElementById('todo-input-date').value,
    completed: editingId ? (todos.find(t => t.id === editingId)?.completed || false) : false,
  };
  if (editingId) {
    const idx = todos.findIndex(t => t.id === editingId);
    if (idx >= 0) todos[idx] = data;
  } else {
    todos.push(data);
  }
  DB.set('todos', todos);
  hideModal();
  renderTodo();
  renderHome();
}

function toggleTodo(id) {
  const todos = DB.get('todos');
  const t = todos.find(x => x.id === id);
  if (t) { t.completed = !t.completed; DB.set('todos', todos); renderTodo(); renderHome(); }
}

function editTodo(id) {
  const t = DB.get('todos').find(x => x.id === id);
  if (!t) return;
  editingId = id;
  editingType = 'todo';
  document.getElementById('todo-input-title').value = t.title;
  document.getElementById('todo-input-priority').value = t.priority;
  document.getElementById('todo-input-date').value = t.date || '';
  document.getElementById('modal-todo-title').textContent = '编辑待办';
  showModal('todo');
}

function deleteTodo(id) {
  showConfirm('确定删除这条待办吗？', () => {
    DB.set('todos', DB.get('todos').filter(t => t.id !== id));
    renderTodo();
    renderHome();
  });
}

// ==================== 日程 ====================
function initSchedule() {
  renderSchedule();
}

function changeScheduleDate(delta) {
  scheduleViewDate.setDate(scheduleViewDate.getDate() + delta);
  renderSchedule();
}

function renderSchedule() {
  const label = document.getElementById('schedule-date-label');
  const today = new Date();
  const isToday = formatDate(scheduleViewDate) === formatDate(today);
  label.textContent = (isToday ? '今天 ' : '') + `${scheduleViewDate.getMonth() + 1}月${scheduleViewDate.getDate()}日`;

  const dateStr = formatDate(scheduleViewDate);
  let schedules = DB.get('schedules').filter(s => s.date === dateStr);
  schedules.sort((a, b) => a.time.localeCompare(b.time));

  const list = document.getElementById('schedule-list');
  list.innerHTML = '';
  const empty = document.getElementById('schedule-empty');
  if (schedules.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  schedules.forEach(s => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="schedule-time">${s.time}</div>
      <div class="list-item-title">${escapeHtml(s.title)}</div>
      ${s.note ? `<div class="schedule-note">${escapeHtml(s.note)}</div>` : ''}
      <div class="list-item-actions">
        <button onclick="editSchedule('${s.id}')">编辑</button>
        <button class="delete" onclick="deleteSchedule('${s.id}')">删除</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function saveSchedule() {
  const title = document.getElementById('schedule-input-title').value.trim();
  if (!title) { alert('请输入日程标题'); return; }
  const schedules = DB.get('schedules');
  const data = {
    id: editingId || Date.now().toString(),
    title,
    date: document.getElementById('schedule-input-date').value,
    time: document.getElementById('schedule-input-time').value || '00:00',
    note: document.getElementById('schedule-input-note').value.trim(),
  };
  if (editingId) {
    const idx = schedules.findIndex(s => s.id === editingId);
    if (idx >= 0) schedules[idx] = data;
  } else {
    schedules.push(data);
  }
  DB.set('schedules', schedules);
  hideModal();
  renderSchedule();
  renderHome();
}

function editSchedule(id) {
  const s = DB.get('schedules').find(x => x.id === id);
  if (!s) return;
  editingId = id;
  editingType = 'schedule';
  document.getElementById('schedule-input-title').value = s.title;
  document.getElementById('schedule-input-date').value = s.date;
  document.getElementById('schedule-input-time').value = s.time;
  document.getElementById('schedule-input-note').value = s.note || '';
  document.getElementById('modal-schedule-title').textContent = '编辑日程';
  showModal('schedule');
}

function deleteSchedule(id) {
  showConfirm('确定删除这条日程吗？', () => {
    DB.set('schedules', DB.get('schedules').filter(s => s.id !== id));
    renderSchedule();
    renderHome();
  });
}

// ==================== 笔记 ====================
function initNote() {
  renderNote();
}

function renderNote() {
  const search = document.getElementById('note-search').value.toLowerCase();
  let notes = DB.get('notes');
  if (search) notes = notes.filter(n => (n.title + n.content).toLowerCase().includes(search));
  notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const grid = document.getElementById('note-grid');
  grid.innerHTML = '';
  const empty = document.getElementById('note-empty');
  if (notes.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  notes.forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.onclick = () => editNote(n.id);
    const d = n.updatedAt ? new Date(n.updatedAt) : new Date();
    card.innerHTML = `
      <button class="note-delete" onclick="event.stopPropagation(); deleteNote('${n.id}')">×</button>
      <h4>${escapeHtml(n.title || '无标题')}</h4>
      <p>${escapeHtml(n.content || '')}</p>
      <div class="note-date">${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}</div>
    `;
    grid.appendChild(card);
  });
}

function saveNote() {
  const title = document.getElementById('note-input-title').value.trim();
  const content = document.getElementById('note-input-content').value.trim();
  if (!title && !content) { alert('请输入标题或内容'); return; }
  const notes = DB.get('notes');
  const data = {
    id: editingId || Date.now().toString(),
    title: title || '无标题',
    content,
    updatedAt: Date.now(),
  };
  if (editingId) {
    const idx = notes.findIndex(n => n.id === editingId);
    if (idx >= 0) notes[idx] = data;
  } else {
    notes.push(data);
  }
  DB.set('notes', notes);
  hideModal();
  renderNote();
  renderHome();
}

function editNote(id) {
  const n = DB.get('notes').find(x => x.id === id);
  if (!n) return;
  editingId = id;
  editingType = 'note';
  document.getElementById('note-input-title').value = n.title === '无标题' ? '' : n.title;
  document.getElementById('note-input-content').value = n.content;
  document.getElementById('modal-note-title').textContent = '编辑笔记';
  showModal('note');
}

function deleteNote(id) {
  showConfirm('确定删除这条笔记吗？', () => {
    DB.set('notes', DB.get('notes').filter(n => n.id !== id));
    renderNote();
    renderHome();
  });
}

// ==================== 番茄钟 ====================
function initPomodoro() {
  resetPomodoro();
  renderPomodoroHistory();
}

function setPomodoroMode(mode) {
  if (pomodoroRunning) return;
  pomodoroMode = mode;
  pomodoroSeconds = POMO_TIMES[mode] * 60;
  updatePomodoroDisplay();
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function updatePomodoroDisplay() {
  const m = Math.floor(pomodoroSeconds / 60);
  const s = pomodoroSeconds % 60;
  document.getElementById('pomodoro-time').textContent = `${pad(m)}:${pad(s)}`;
  document.title = pomodoroRunning ? `${pad(m)}:${pad(s)} - 番茄钟` : '工作助手';
}

function startPomodoro() {
  if (pomodoroRunning) return;
  pomodoroRunning = true;
  document.getElementById('pomo-start').style.display = 'none';
  document.getElementById('pomo-pause').style.display = 'inline-block';
  pomodoroTimer = setInterval(() => {
    pomodoroSeconds--;
    updatePomodoroDisplay();
    if (pomodoroSeconds <= 0) {
      completePomodoro();
    }
  }, 1000);
}

function pausePomodoro() {
  pomodoroRunning = false;
  clearInterval(pomodoroTimer);
  document.getElementById('pomo-start').style.display = 'inline-block';
  document.getElementById('pomo-pause').style.display = 'none';
  document.title = '工作助手';
}

function resetPomodoro() {
  pausePomodoro();
  pomodoroSeconds = POMO_TIMES[pomodoroMode] * 60;
  updatePomodoroDisplay();
}

function completePomodoro() {
  pausePomodoro();
  // 记录
  const stats = DB.get('pomo_stats', { today: 0, totalMin: 0, history: [] });
  const task = document.getElementById('pomodoro-task-input').value.trim() || '专注工作';
  stats.history.unshift({ task, mode: pomodoroMode, minutes: POMO_TIMES[pomodoroMode], time: Date.now() });
  // 只保留最近50条
  if (stats.history.length > 50) stats.history = stats.history.slice(0, 50);
  // 今日统计
  stats.today = stats.history.filter(h => isToday(h.time)).length;
  stats.totalMin = stats.history.filter(h => h.mode === 'work' && isToday(h.time)).reduce((s, h) => s + h.minutes, 0);
  DB.set('pomo_stats', stats);
  // 通知
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  alert('⏰ 时间到！休息一下吧');
  renderPomodoroHistory();
  renderHome();
  resetPomodoro();
}

function renderPomodoroHistory() {
  const stats = DB.get('pomo_stats', { today: 0, totalMin: 0, history: [] });
  document.getElementById('pomo-today-count').textContent = stats.today || 0;
  document.getElementById('pomo-total-min').textContent = stats.totalMin || 0;
  const list = document.getElementById('pomo-history-list');
  const todayHistory = stats.history.filter(h => isToday(h.time));
  list.innerHTML = '';
  if (todayHistory.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-secondary);">今日暂无记录</li>';
    return;
  }
  todayHistory.forEach(h => {
    const d = new Date(h.time);
    const li = document.createElement('li');
    const modeLabels = { work: '专注', shortBreak: '短休', longBreak: '长休' };
    li.innerHTML = `<span>${escapeHtml(h.task)} <small style="color:var(--text-secondary)">(${modeLabels[h.mode]})</small></span><span style="color:var(--text-secondary);">${pad(d.getHours())}:${pad(d.getMinutes())}</span>`;
    list.appendChild(li);
  });
}

// ==================== 模态框 ====================
function showModal(type) {
  editingId = editingType === type ? editingId : null;
  if (!editingId) {
    // 重置表单
    document.getElementById(type + '-input-title').value = '';
    if (type === 'todo') {
      document.getElementById('todo-input-priority').value = 'medium';
      document.getElementById('todo-input-date').value = formatDate(new Date());
      document.getElementById('modal-todo-title').textContent = '新建待办';
    }
    if (type === 'schedule') {
      document.getElementById('schedule-input-date').value = formatDate(scheduleViewDate);
      document.getElementById('schedule-input-time').value = '09:00';
      document.getElementById('schedule-input-note').value = '';
      document.getElementById('modal-schedule-title').textContent = '新建日程';
    }
    if (type === 'note') {
      document.getElementById('note-input-content').value = '';
      document.getElementById('modal-note-title').textContent = '新建笔记';
    }
  }
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById('modal-' + type).style.display = 'block';
  document.getElementById('modal-overlay').classList.add('active');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  editingId = null;
  editingType = null;
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) hideModal();
}

// ==================== 确认对话框 ====================
function showConfirm(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.onclick = () => { cancelConfirm(); onOk(); };
  document.getElementById('confirm-overlay').classList.add('active');
}

function cancelConfirm() {
  document.getElementById('confirm-overlay').classList.remove('active');
}

// ==================== 设置 - 数据管理 ====================
function exportData() {
  const data = {
    todos: DB.get('todos'),
    schedules: DB.get('schedules'),
    notes: DB.get('notes'),
    pomo_stats: DB.get('pomo_stats', { today: 0, totalMin: 0, history: [] }),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工作助手备份_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.todos) DB.set('todos', data.todos);
      if (data.schedules) DB.set('schedules', data.schedules);
      if (data.notes) DB.set('notes', data.notes);
      if (data.pomo_stats) DB.set('pomo_stats', data.pomo_stats);
      alert('✅ 数据导入成功！');
      renderHome(); renderTodo(); renderSchedule(); renderNote(); renderPomodoroHistory();
    } catch {
      alert('❌ 文件格式错误');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearAllData() {
  showConfirm('⚠️ 确定要清空所有数据吗？此操作不可恢复！', () => {
    ['todos', 'schedules', 'notes', 'pomo_stats'].forEach(k => localStorage.removeItem('wa_' + k));
    renderHome(); renderTodo(); renderSchedule(); renderNote(); renderPomodoroHistory();
    alert('所有数据已清空');
  });
}

// ==================== 工具函数 ====================
function formatDate(d) {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function isToday(ts) { return formatDate(new Date(ts)) === formatDate(new Date()); }
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
