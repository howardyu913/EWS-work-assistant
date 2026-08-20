/* ========================
   工作助手 v3.0 - 主逻辑
   ======================== */

// ---------- 数据存储 ----------
const DB = {
  get(key, def) { try { return JSON.parse(localStorage.getItem('wa_' + key)) ?? def; } catch { return def; } },
  set(key, val) { localStorage.setItem('wa_' + key, JSON.stringify(val)); },
};

// ---------- 状态 ----------
let currentPage = 'complaint';
let editingId = null;
let todoFilter = 'active';
let feishuTokenCache = null;
let feishuTokenExpiry = 0;
let recognition = null;
let isRecording = false;
let audioChunks = [];
let mediaRecorder = null;

// ---------- 行业动态数据 ----------
const NEWS_DATA = [
  { id: 'n1', tag: 'export', tagText: '出口', title: '2026年Q1电动两轮车出口约720万辆，同比增长68.2%', desc: '海关总署数据显示，2026年第一季度中国电动两轮车出口保持高速增长，民营企业出口电动摩托车及脚踏车同比增长30%。', date: '2026-08-16', source: 'STARGO市场洞察' },
  { id: 'n2', tag: 'market', tagText: '市场', title: '无锡锡山区电动两轮车出口额达2.87亿美元，同比增长33.7%', desc: '今年前四月，锡山区电动两轮车行业出口额达2.87亿美元，同比增长33.7%，出口已连续9年保持稳定增长。', date: '2026-06-08', source: '中国一带一路网' },
  { id: 'n3', tag: 'policy', tagText: '政策', title: '工信部加强电动自行车锂电池回收利用体系建设', desc: '工信部、供销合作总社联合发布通知，进一步加强电动自行车锂离子电池回收利用体系建设，推动标准制定和宣贯培训。', date: '2026-04-06', source: 'Mysteel' },
  { id: 'n4', tag: 'export', tagText: '出口', title: '浙江"新三样"产品出口额759.4亿元，同比增长51.7%', desc: '1-5月浙江省新能源汽车、储能锂电池、光伏等"新三样"产品出口额达759.4亿元，锂电池出口增长4成左右。', date: '2026-06-25', source: '海关总署' },
  { id: 'n5', tag: 'market', tagText: '市场', title: '电动自行车位列MIC国际站重工行业订单量第一', desc: '在中国制造网"超级出海季"数据中，电动自行车位列重工行业订单量排行榜第一，在美、巴、俄、阿、墨五大市场高频出现。', date: '2026-05-16', source: '上海经信委' },
  { id: 'n6', tag: 'policy', tagText: '政策', title: '欧盟LMT电池护照2027年2月18日起适用', desc: '欧盟委员会Regulation (EU) 2023/1542规定，电动自行车电池护照制度将于2027年2月18日正式实施，需提前准备合规。', date: '2026-08-16', source: 'STARGO' },
  { id: 'n7', tag: 'market', tagText: '市场', title: '印尼镍铁出口政策反复，镍价持续上涨', desc: '印尼镍铁出口政策一度引发供应担忧，当前镍铁供应紧张，价格持续上涨。碳酸锂市场预计短期价格震荡于18-20万元/吨。', date: '2026-05-22', source: 'Mysteel' },
  { id: 'n8', tag: 'export', tagText: '出口', title: '2026年1-2月锂电池出口142亿美元，增长46%', desc: '乘联分会数据显示，2026年1-2月锂电池出口额达142亿美元，同比增长46%，在出口退税减少前保持高位增速。', date: '2026-04-09', source: '乘联分会' },
];

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
  initVoice();
  initFeishuUI();
  renderPage(currentPage);
  registerSW();
});

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ==================== 导航 ====================
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = { complaint: '客诉管理', spare: '修补件', todo: '待办事项', news: '行业动态', report: 'AI周报', settings: '设置' };
  document.getElementById('page-title').textContent = titles[page] || '工作助手';

  // 语音按钮只在待办页面显示
  document.getElementById('voice-bar').style.display = (page === 'todo') ? 'block' : 'none';

  renderPage(page);
}

function renderPage(page) {
  if (page === 'complaint') renderComplaint();
  if (page === 'spare') initSparePage();
  if (page === 'todo') { renderTodo(); document.getElementById('voice-tip').style.display = 'block'; }
  if (page === 'news') renderNews();
  if (page === 'report') updateReportPreview();
  if (page === 'settings') loadSettings();
}

// ==================== 客诉模块（飞书）====================
function initFeishuUI() {
  const cfg = getFeishuConfig();
  const statusEl = document.getElementById('feishu-status');
  if (cfg.appId && cfg.appSecret && cfg.appToken && cfg.tableId) {
    statusEl.innerHTML = '<span>🟢 飞书已配置</span>';
    statusEl.classList.add('connected');
    document.getElementById('complaint-toolbar').style.display = 'flex';
    document.getElementById('complaint-summary').style.display = 'grid';
  } else {
    statusEl.innerHTML = '<span>🔴 未配置飞书</span><button onclick="navigateTo(\'settings\')">去配置</button>';
    statusEl.classList.remove('connected');
    document.getElementById('complaint-toolbar').style.display = 'none';
    document.getElementById('complaint-summary').style.display = 'none';
  }
}

function getFeishuConfig() {
  return DB.get('feishu_config', {});
}

async function getFeishuToken() {
  const now = Date.now();
  if (feishuTokenCache && now < feishuTokenExpiry - 60000) return feishuTokenCache;
  const cfg = getFeishuConfig();
  if (!cfg.appId || !cfg.appSecret) return null;
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret })
    });
    const data = await res.json();
    if (data.code === 0 && data.tenant_access_token) {
      feishuTokenCache = data.tenant_access_token;
      feishuTokenExpiry = now + (data.expire || 7200) * 1000;
      return feishuTokenCache;
    }
  } catch (e) { console.error('Feishu token error:', e); }
  return null;
}

async function refreshFeishuData() {
  const cfg = getFeishuConfig();
  if (!cfg.appId || !cfg.appSecret || !cfg.appToken || !cfg.tableId) {
    showToast('请先配置飞书'); return;
  }
  const loading = document.getElementById('complaint-loading');
  const list = document.getElementById('complaint-list');
  const empty = document.getElementById('complaint-empty');
  loading.style.display = 'block'; list.style.display = 'none'; empty.style.display = 'none';
  try {
    const token = await getFeishuToken();
    if (!token) { showToast('飞书认证失败'); return; }
    let allRecords = [];
    let hasMore = true;
    let pageToken = '';
    while (hasMore && allRecords.length < 500) {
      let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${cfg.tableId}/records?page_size=500`;
      if (pageToken) url += `&page_token=${pageToken}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (data.code !== 0) { showToast('获取数据失败: ' + (data.msg || '未知错误')); break; }
      if (data.data?.items) allRecords = allRecords.concat(data.data.items);
      hasMore = data.data?.has_more;
      pageToken = data.data?.page_token;
    }
    DB.set('feishu_records', allRecords);
    DB.set('feishu_sync_time', Date.now());
    renderComplaint();
    showToast(`已同步 ${allRecords.length} 条客诉`);
  } catch (e) {
    console.error(e);
    showToast('同步失败，请检查网络和配置');
    renderComplaint();
  } finally {
    loading.style.display = 'none';
  }
}

function renderComplaint() {
  const filter = document.getElementById('complaint-filter').value;
  const records = DB.get('feishu_records', []);
  const cfg = getFeishuConfig();
  const statusField = cfg.statusField || '状态';
  const doneValue = cfg.doneValue || '已完成';

  let total = 0, pending = 0, urgent = 0;
  records.forEach(r => {
    const fields = r.fields || {};
    const status = String(fields[statusField] || '');
    if (status !== doneValue) {
      total++;
      if (status.includes('待') || status.includes('Pending') || status === '') pending++;
      if (status.includes('急') || status.includes('Urgent') || status.includes('紧急')) urgent++;
    }
  });
  document.getElementById('summary-total').textContent = total;
  document.getElementById('summary-pending').textContent = pending;
  document.getElementById('summary-urgent').textContent = urgent;

  let filtered = records.filter(r => {
    const fields = r.fields || {};
    const status = String(fields[statusField] || '');
    const isDone = status === doneValue || status.includes('完成') || status.includes('Closed');
    if (filter === 'pending') return !isDone && (status.includes('待') || status === '');
    if (filter === 'processing') return !isDone && (status.includes('处理') || status.includes('进行'));
    if (filter === 'urgent') return status.includes('急') || status.includes('Urgent');
    return !isDone;
  });

  const list = document.getElementById('complaint-list');
  const empty = document.getElementById('complaint-empty');
  list.innerHTML = '';
  if (filtered.length === 0) {
    empty.style.display = 'block'; list.style.display = 'none';
    const cfgOk = getFeishuConfig().appId;
    empty.querySelector('.empty-sub').textContent = cfgOk ? '当前筛选条件下无数据' : '请在设置中配置飞书多维表格';
    return;
  }
  empty.style.display = 'none'; list.style.display = 'block';

  filtered.forEach(r => {
    const fields = r.fields || {};
    const status = String(fields[statusField] || '待处理');
    let statusClass = 'pending';
    if (status.includes('急') || status.includes('Urgent')) statusClass = 'urgent';
    else if (status.includes('处理') || status.includes('进行')) statusClass = 'processing';
    else if (status.includes('完成') || status.includes('Closed')) statusClass = 'done';

    const title = fields['客诉编号'] || fields['编号'] || fields['标题'] || fields['Title'] || '客诉 ' + (r.record_id?.slice(-6) || '');
    const customer = fields['客户'] || fields['客户名称'] || fields['Customer'] || '';
    const market = fields['市场'] || fields['区域'] || fields['Market'] || '';
    const date = fields['创建日期'] || fields['日期'] || fields['Date'] || '';

    const item = document.createElement('div');
    item.className = 'complaint-item';
    item.innerHTML = `
      <div class="complaint-item-header">
        <div class="complaint-item-title">${escapeHtml(String(title))}</div>
        <span class="complaint-status ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <div class="complaint-meta">
        ${customer ? `<span>👤 ${escapeHtml(String(customer))}</span>` : ''}
        ${market ? `<span>🌍 ${escapeHtml(String(market))}</span>` : ''}
        ${date ? `<span>📅 ${escapeHtml(String(date))}</span>` : ''}
      </div>
    `;
    item.onclick = () => showComplaintDetail(r);
    list.appendChild(item);
  });
}

function showComplaintDetail(record) {
  const fields = record.fields || {};
  let html = '';
  Object.entries(fields).forEach(([key, val]) => {
    let displayVal = val;
    if (Array.isArray(val)) displayVal = val.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(', ');
    else if (typeof val === 'object') displayVal = JSON.stringify(val);
    html += `<div class="detail-row"><div class="detail-label">${escapeHtml(key)}</div><div class="detail-value">${escapeHtml(String(displayVal))}</div></div>`;
  });
  document.getElementById('complaint-detail-content').innerHTML = html;
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById('modal-complaint').style.display = 'block';
  document.getElementById('modal-overlay').classList.add('active');
}

// ==================== 修补件模块 ====================
function initSparePage() {
  const iframe = document.getElementById('spare-iframe');
  iframe.onload = () => { document.getElementById('spare-fallback')?.style.display = 'none'; };
}

function switchSpareTab(tab) {
  document.querySelectorAll('.spare-tab').forEach(t => t.classList.toggle('active', t.textContent.includes(tab === 'dashboard' ? '看板' : 'SKU')));
  document.getElementById('spare-dashboard').classList.toggle('active', tab === 'dashboard');
  document.getElementById('spare-search').classList.toggle('active', tab === 'search');
}

function searchSKU() {
  const sku = document.getElementById('sku-input').value.trim();
  const resultDiv = document.getElementById('sku-result');
  if (!sku) { showToast('请输入SKU编号'); return; }
  const searchUrl = `https://ewssp.pythonanywhere.com/dashboard?search=${encodeURIComponent(sku)}`;
  resultDiv.innerHTML = `
    <div class="empty-state">
      <p>将在浏览器中搜索 SKU: <strong>${escapeHtml(sku)}</strong></p>
      <a href="${searchUrl}" target="_blank" class="btn-primary" style="display:inline-block;margin-top:12px;text-decoration:none;">打开搜索</a>
    </div>
  `;
}

// ==================== 待办模块 ====================
function renderTodo() {
  let todos = DB.get('todos', []);
  if (todoFilter === 'active') todos = todos.filter(t => !t.completed);
  if (todoFilter === 'completed') todos = todos.filter(t => t.completed);
  todos.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pri = { high: 0, medium: 1, low: 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });

  const list = document.getElementById('todo-list');
  const empty = document.getElementById('todo-empty');
  list.innerHTML = '';
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
        ${t.date ? `<span>📅 ${t.date}</span>` : ''}
        ${t.createdAt ? `<span>🕐 ${formatDateShort(t.createdAt)}</span>` : ''}
      </div>
      ${t.note ? `<div class="list-item-note">📝 ${escapeHtml(t.note)}</div>` : ''}
      <div class="list-item-actions">
        <button onclick="editTodo('${t.id}')">编辑</button>
        <button onclick="addTodoNote('${t.id}')">备注</button>
        <button class="delete" onclick="deleteTodo('${t.id}')">删除</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function setTodoFilter(filter) {
  todoFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  renderTodo();
}

function saveTodo() {
  const title = document.getElementById('todo-input-title').value.trim();
  if (!title) { showToast('请输入待办内容'); return; }
  const todos = DB.get('todos', []);
  const data = {
    id: editingId || Date.now().toString(),
    title,
    priority: document.getElementById('todo-input-priority').value,
    date: document.getElementById('todo-input-date').value,
    note: document.getElementById('todo-input-note').value.trim(),
    completed: editingId ? (todos.find(t => t.id === editingId)?.completed || false) : false,
    createdAt: editingId ? (todos.find(t => t.id === editingId)?.createdAt || Date.now()) : Date.now(),
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
  showToast(editingId ? '待办已更新' : '待办已添加');
}

function toggleTodo(id) {
  const todos = DB.get('todos', []);
  const t = todos.find(x => x.id === id);
  if (t) { t.completed = !t.completed; DB.set('todos', todos); renderTodo(); }
}

function editTodo(id) {
  const t = DB.get('todos', []).find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('todo-input-title').value = t.title;
  document.getElementById('todo-input-priority').value = t.priority || 'medium';
  document.getElementById('todo-input-date').value = t.date || '';
  document.getElementById('todo-input-note').value = t.note || '';
  document.getElementById('modal-todo-title').textContent = '编辑待办';
  showModal('todo');
}

function addTodoNote(id) {
  const t = DB.get('todos', []).find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('todo-input-title').value = t.title;
  document.getElementById('todo-input-priority').value = t.priority || 'medium';
  document.getElementById('todo-input-date').value = t.date || '';
  document.getElementById('todo-input-note').value = t.note || '';
  document.getElementById('modal-todo-title').textContent = '更新进度';
  showModal('todo');
}

function deleteTodo(id) {
  showConfirm('确定删除这条待办吗？', () => {
    DB.set('todos', DB.get('todos', []).filter(t => t.id !== id));
    renderTodo();
    showToast('已删除');
  });
}

// ==================== 语音识别 ====================
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('voice-btn').innerHTML = '<span>⚠️ 设备不支持语音</span>';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    document.getElementById('voice-btn').classList.add('recording');
    document.getElementById('voice-hint').style.display = 'block';
  };
  recognition.onend = () => {
    isRecording = false;
    document.getElementById('voice-btn').classList.remove('recording');
    document.getElementById('voice-hint').style.display = 'none';
  };
  recognition.onresult = (event) => {
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
    }
    if (final) processVoiceText(final);
  };
  recognition.onerror = () => {
    isRecording = false;
    document.getElementById('voice-btn').classList.remove('recording');
    document.getElementById('voice-hint').style.display = 'none';
    showToast('语音识别失败，请重试');
  };
}

function startVoiceInput(e) {
  e.preventDefault();
  if (!recognition) { showToast('您的设备不支持语音识别'); return; }
  if (isRecording) return;
  try { recognition.start(); } catch { recognition.stop(); setTimeout(() => recognition.start(), 200); }
}

function stopVoiceInput(e) {
  e.preventDefault();
  if (!recognition || !isRecording) return;
  recognition.stop();
}

function processVoiceText(text) {
  text = text.trim();
  if (!text) return;
  showToast('识别到: ' + text);

  const todos = DB.get('todos', []);
  const activeTodos = todos.filter(t => !t.completed);

  // 尝试匹配现有待办
  for (const t of activeTodos) {
    if (text.includes(t.title) || t.title.includes(text.slice(0, 6))) {
      t.note = (t.note ? t.note + '\n' : '') + formatDateTime() + ': ' + text;
      DB.set('todos', todos);
      renderTodo();
      showToast(`已更新「${t.title}」进度`);
      return;
    }
  }

  // 创建新待办
  const newTodo = {
    id: Date.now().toString(),
    title: text,
    priority: text.includes('紧急') || text.includes('重要') ? 'high' : 'medium',
    date: '',
    note: '🎤 语音录入: ' + formatDateTime(),
    completed: false,
    createdAt: Date.now(),
  };
  todos.push(newTodo);
  DB.set('todos', todos);
  renderTodo();
  showToast('已添加待办: ' + text);
}

// ==================== 行业动态 ====================
function renderNews() {
  const filter = document.getElementById('news-filter').value;
  let news = NEWS_DATA;
  if (filter !== 'all') news = news.filter(n => n.tag === filter);

  const list = document.getElementById('news-list');
  const empty = document.getElementById('news-empty');
  list.innerHTML = '';
  if (news.length === 0) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  news.forEach(item => {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.innerHTML = `
      <div class="news-card-header">
        <span class="news-tag ${item.tag}">${item.tagText}</span>
        <span style="font-size:12px;color:var(--text-secondary);margin-left:auto;">${item.date}</span>
      </div>
      <div class="news-title">${escapeHtml(item.title)}</div>
      <div class="news-desc">${escapeHtml(item.desc)}</div>
      <div class="news-date">来源: ${escapeHtml(item.source)}</div>
    `;
    list.appendChild(card);
  });
}

// ==================== AI 周报 ====================
function updateReportPreview() {
  const range = document.getElementById('report-range').value;
  let startDate, endDate;
  const now = new Date();
  if (range === 'week') {
    const day = now.getDay() || 7;
    startDate = new Date(now); startDate.setDate(now.getDate() - day + 1);
    endDate = new Date(now);
  } else if (range === 'lastweek') {
    const day = now.getDay() || 7;
    endDate = new Date(now); endDate.setDate(now.getDate() - day);
    startDate = new Date(endDate); startDate.setDate(endDate.getDate() - 6);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = now;
  }

  const todos = DB.get('todos', []);
  const doneInRange = todos.filter(t => t.completed && t.createdAt >= startDate.getTime() && t.createdAt <= endDate.getTime() + 86400000);
  const totalInRange = todos.filter(t => t.createdAt >= startDate.getTime() && t.createdAt <= endDate.getTime() + 86400000);

  document.getElementById('r-todo-done').textContent = doneInRange.length;
  document.getElementById('r-todo-total').textContent = totalInRange.length;

  const records = DB.get('feishu_records', []);
  const cfg = getFeishuConfig();
  const doneValue = cfg.doneValue || '已完成';
  const statusField = cfg.statusField || '状态';
  const complaintsDone = records.filter(r => {
    const status = String(r.fields?.[statusField] || '');
    return status === doneValue;
  }).length;
  document.getElementById('r-complaint').textContent = complaintsDone;
}

function generateWeeklyReport() {
  const range = document.getElementById('report-range').value;
  let startDate, endDate, rangeLabel;
  const now = new Date();
  if (range === 'week') {
    const day = now.getDay() || 7;
    startDate = new Date(now); startDate.setDate(now.getDate() - day + 1);
    endDate = new Date(now);
    rangeLabel = '本周';
  } else if (range === 'lastweek') {
    const day = now.getDay() || 7;
    endDate = new Date(now); endDate.setDate(now.getDate() - day);
    startDate = new Date(endDate); startDate.setDate(endDate.getDate() - 6);
    rangeLabel = '上周';
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = now;
    rangeLabel = '本月';
  }

  const startStr = `${startDate.getMonth()+1}月${startDate.getDate()}日`;
  const endStr = `${endDate.getMonth()+1}月${endDate.getDate()}日`;

  const todos = DB.get('todos', []);
  const createdInRange = todos.filter(t => t.createdAt >= startDate.getTime() && t.createdAt <= endDate.getTime() + 86400000);
  const doneInRange = createdInRange.filter(t => t.completed);
  const pendingHigh = todos.filter(t => !t.completed && t.priority === 'high').length;

  const records = DB.get('feishu_records', []);
  const cfg = getFeishuConfig();
  const statusField = cfg.statusField || '状态';
  const doneValue = cfg.doneValue || '已完成';
  const totalComplaints = records.length;
  const activeComplaints = records.filter(r => {
    const s = String(r.fields?.[statusField] || '');
    return s !== doneValue && s !== '';
  }).length;

  let report = `📋 ${rangeLabel}工作总结 (${startStr} - ${endStr})\n`;
  report += `═══════════════════════════\n\n`;

  report += `✅ 一、待办事项\n`;
  report += `   新增待办: ${createdInRange.length} 项\n`;
  report += `   已完成: ${doneInRange.length} 项\n`;
  report += `   完成率: ${createdInRange.length > 0 ? Math.round(doneInRange.length / createdInRange.length * 100) : 0}%\n`;
  if (pendingHigh > 0) report += `   ⚠️ 高优先级待处理: ${pendingHigh} 项\n`;
  report += `\n`;

  report += `📋 二、客诉处理\n`;
  report += `   客诉总数: ${totalComplaints} 件\n`;
  report += `   待处理: ${activeComplaints} 件\n`;
  report += `   ${activeComplaints > 5 ? '⚠️ 客诉积压较多，需重点关注' : '✓ 客诉处理进度正常'}\n`;
  report += `\n`;

  if (doneInRange.length > 0) {
    report += `📝 三、完成事项清单\n`;
    doneInRange.forEach((t, i) => {
      report += `   ${i + 1}. ${t.title}\n`;
      if (t.note) report += `      备注: ${t.note.split('\n').pop() || t.note}\n`;
    });
    report += `\n`;
  }

  const pendingTodos = todos.filter(t => !t.completed);
  if (pendingTodos.length > 0) {
    report += `📌 四、下周/下阶段计划\n`;
    pendingTodos.slice(0, 8).forEach((t, i) => {
      const priMark = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      report += `   ${i + 1}. ${priMark} ${t.title}\n`;
    });
    if (pendingTodos.length > 8) report += `   ...还有 ${pendingTodos.length - 8} 项待办\n`;
    report += `\n`;
  }

  report += `═══════════════════════════\n`;
  report += `💡 总结: ${rangeLabel}共完成 ${doneInRange.length} 项工作，`;
  report += activeComplaints > 0 ? `有 ${activeComplaints} 件客诉待跟进。` : '客诉处理完毕。';
  report += `\n`;
  report += `📅 生成时间: ${formatDateTime()}`;

  document.getElementById('report-preview').innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;line-height:1.8;">${escapeHtml(report)}</pre>`;
  document.getElementById('btn-copy-report').style.display = 'block';
  DB.set('last_report', report);
  showToast('周报生成成功！');
}

function copyReport() {
  const report = DB.get('last_report', '');
  if (!report) return;
  navigator.clipboard.writeText(report).then(() => showToast('已复制到剪贴板'))
    .catch(() => showToast('复制失败'));
}

// ==================== 设置 ====================
function loadSettings() {
  const cfg = getFeishuConfig();
  document.getElementById('fs-app-id').value = cfg.appId || '';
  document.getElementById('fs-app-secret').value = cfg.appSecret || '';
  document.getElementById('fs-app-token').value = cfg.appToken || '';
  document.getElementById('fs-table-id').value = cfg.tableId || '';
  document.getElementById('fs-status-field').value = cfg.statusField || '状态';
  document.getElementById('fs-done-value').value = cfg.doneValue || '已完成';

  const whisperKey = DB.get('whisper_key', '');
  if (whisperKey) document.getElementById('whisper-key').value = '已配置（隐藏）';
}

function saveFeishuConfig() {
  const cfg = {
    appId: document.getElementById('fs-app-id').value.trim(),
    appSecret: document.getElementById('fs-app-secret').value.trim(),
    appToken: document.getElementById('fs-app-token').value.trim(),
    tableId: document.getElementById('fs-table-id').value.trim(),
    statusField: document.getElementById('fs-status-field').value.trim() || '状态',
    doneValue: document.getElementById('fs-done-value').value.trim() || '已完成',
  };
  DB.set('feishu_config', cfg);
  feishuTokenCache = null;
  initFeishuUI();
  showToast('飞书配置已保存');
}

function saveWhisperKey() {
  const key = document.getElementById('whisper-key').value.trim();
  if (!key) { showToast('请输入 API Key'); return; }
  DB.set('whisper_key', key);
  showToast('Whisper API Key 已保存');
}

async function testFeishuConnection() {
  saveFeishuConfig();
  showToast('正在测试连接...');
  const token = await getFeishuToken();
  if (token) {
    showToast('✅ 连接成功！');
  } else {
    showToast('❌ 连接失败，请检查凭证');
  }
}

// ==================== 数据管理 ====================
function exportData() {
  const data = {
    todos: DB.get('todos', []),
    feishu_records: DB.get('feishu_records', []),
    feishu_config: DB.get('feishu_config', {}),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工作助手备份_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.todos) DB.set('todos', data.todos);
      if (data.feishu_records) DB.set('feishu_records', data.feishu_records);
      if (data.feishu_config) DB.set('feishu_config', data.feishu_config);
      showToast('✅ 数据导入成功');
      initFeishuUI();
      renderPage(currentPage);
    } catch { showToast('❌ 文件格式错误'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearAllData() {
  showConfirm('⚠️ 确定清空所有数据？不可恢复！', () => {
    ['todos', 'feishu_records', 'feishu_config', 'feishu_sync_time', 'last_report', 'whisper_key'].forEach(k => localStorage.removeItem('wa_' + k));
    feishuTokenCache = null;
    renderPage(currentPage);
    initFeishuUI();
    showToast('数据已清空');
  });
}

// ==================== 模态框 ====================
function showModal(type) {
  editingId = null;
  if (type === 'todo') {
    document.getElementById('todo-input-title').value = '';
    document.getElementById('todo-input-priority').value = 'medium';
    document.getElementById('todo-input-date').value = '';
    document.getElementById('todo-input-note').value = '';
    document.getElementById('modal-todo-title').textContent = '新建待办';
  }
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById('modal-' + type).style.display = 'block';
  document.getElementById('modal-overlay').classList.add('active');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  editingId = null;
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) hideModal();
}

// ==================== 确认对话框 ====================
function showConfirm(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-ok').onclick = () => { cancelConfirm(); onOk(); };
  document.getElementById('confirm-overlay').classList.add('active');
}

function cancelConfirm() {
  document.getElementById('confirm-overlay').classList.remove('active');
}

// ==================== Toast ====================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==================== 工具函数 ====================
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatDateTime() {
  const d = new Date();
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDateShort(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
}
function priorityLabel(p) { return { high: '高', medium: '中', low: '低' }[p] || p; }
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
