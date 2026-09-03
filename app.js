/* ========================
   工作助手 v3.0.13 - 主逻辑
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

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
  initVoice();
  initFeishuUI();
  initNav();
  renderPage(currentPage);
  registerSW();
});

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- 底部导航事件绑定 ----------
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const page = btn.dataset.page;
    if (!page) return;
    btn.addEventListener('click', () => navigateTo(page));
  });
}

// ==================== 导航 ====================
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = { complaint: '客诉管理', spare: '修补件', todo: '待办事项', report: 'AI周报', reviews: '消费者评论', settings: '设置' };
  document.getElementById('page-title').textContent = titles[page] || '工作助手';
  document.getElementById('voice-bar').style.display = (page === 'todo') ? 'block' : 'none';
  renderPage(page);
}

function renderPage(page) {
  if (page === 'complaint') { initFeishuUI(); renderComplaint(); }
  if (page === 'spare') initSparePage();
  if (page === 'todo') { renderTodo(); document.getElementById('voice-tip').style.display = 'block'; }
  if (page === 'report') updateReportPreview();
  if (page === 'reviews') renderReviews();
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
  if (feishuTokenCache && now < feishuTokenExpiry - 60000) {
    return { success: true, token: feishuTokenCache };
  }
  const cfg = getFeishuConfig();
  // 彻底清理输入：去除首尾空白 + 零宽字符 + 方向控制字符
  const clean = (s) => (s || '').replace(/^[\s\u200B-\u200F\uFEFF]+|[\s\u200B-\u200F\uFEFF]+$/g, '');
  const appId = clean(cfg.appId);
  const appSecret = clean(cfg.appSecret);
  if (!appId || !appSecret) {
    return { success: false, error: '缺少 App ID 或 App Secret' };
  }
  try {
    // 使用 Promise.race 实现超时，兼容性优于 AbortController
    const fetchPromise = fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 8000)
    );
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (data.code === 0 && data.tenant_access_token) {
      feishuTokenCache = data.tenant_access_token;
      feishuTokenExpiry = now + (data.expire || 7200) * 1000;
      return { success: true, token: feishuTokenCache };
    }
    return { success: false, error: `飞书API错误 code=${data.code || '?'}` + (data.msg ? `: ${data.msg}` : ` 原始响应: ${text.slice(0,100)}`) };
  } catch (e) {
    if (e.message === 'TIMEOUT') {
      return { success: false, error: '请求超时（8秒）— 可能公司网络屏蔽了 open.feishu.cn，请切到4G再试' };
    }
    return { success: false, error: `网络异常: ${e.message || e}` };
  }
}

async function testFeishuConnection() {
  saveFeishuConfig();
  showToast('正在测试连接…（最多5秒）');
  const result = await getFeishuToken();
  if (result.success) {
    showToast('✅ 连接成功！');
  } else {
    showToast('❌ ' + result.error);
  }
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
    const result = await getFeishuToken();
    if (!result.success) { showToast(result.error); return; }
    const token = result.token;
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
  iframe.onload = () => {
    const el = document.getElementById('spare-fallback');
    if (el) el.style.display = 'none';
  };
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
  const allTodos = DB.get('todos', []);
  // 更新统计面板
  const total = allTodos.length;
  const active = allTodos.filter(t => !t.completed).length;
  const done = allTodos.filter(t => t.completed).length;
  const high = allTodos.filter(t => !t.completed && t.priority === 'high').length;
  const stTotal = document.getElementById('todo-stat-total');
  const stActive = document.getElementById('todo-stat-active');
  const stDone = document.getElementById('todo-stat-done');
  const stHigh = document.getElementById('todo-stat-high');
  if (stTotal) stTotal.textContent = total;
  if (stActive) stActive.textContent = active;
  if (stDone) stDone.textContent = done;
  if (stHigh) stHigh.textContent = high;

  let todos = allTodos.slice();
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
    const doneLabel = t.completedAt
      ? `✅ 完成于 ${formatDateShort(t.completedAt)}`
      : '';
    li.innerHTML = `
      <div class="list-item-header">
        <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTodo('${t.id}')">
        <span class="list-item-title">${escapeHtml(t.title)}</span>
        <span class="priority-badge ${t.priority}">${priorityLabel(t.priority)}</span>
      </div>
      <div class="list-item-meta">
        ${t.date ? `<span>📅 ${t.date}</span>` : ''}
        ${t.createdAt ? `<span>🕐 ${formatDateShort(t.createdAt)}</span>` : ''}
        ${doneLabel ? `<span style="color:var(--success);">${doneLabel}</span>` : ''}
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
  if (t) {
    t.completed = !t.completed;
    if (t.completed) t.completedAt = Date.now();
    else delete t.completedAt;
    DB.set('todos', todos);
    renderTodo();
  }
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

  for (const t of activeTodos) {
    if (text.includes(t.title) || t.title.includes(text.slice(0, 6))) {
      t.note = (t.note ? t.note + '\n' : '') + formatDateTime() + ': ' + text;
      DB.set('todos', todos);
      renderTodo();
      showToast(`已更新「${t.title}」进度`);
      return;
    }
  }

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
  const whisperEl = document.getElementById('whisper-key');
  if (whisperKey && whisperEl) whisperEl.value = '已配置（隐藏）';
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

// ==================== 消费者评论模块 ====================
let reviewBrandFilter = 'all';
let reviewSeverityFilter = 'all';

function getReviews() {
  return DB.get('consumer_reviews', []);
}

function renderReviews() {
  const all = getReviews();
  // 统计
  const total = all.length;
  const red = all.filter(r => r.severity === 'red').length;
  const blue = all.filter(r => r.severity === 'blue').length;
  const green = all.filter(r => r.severity === 'green').length;
  const stTotal = document.getElementById('rev-stat-total');
  const stRed = document.getElementById('rev-stat-red');
  const stBlue = document.getElementById('rev-stat-blue');
  const stGreen = document.getElementById('rev-stat-green');
  if (stTotal) stTotal.textContent = total;
  if (stRed) stRed.textContent = red;
  if (stBlue) stBlue.textContent = blue;
  if (stGreen) stGreen.textContent = green;

  let filtered = all.slice();
  if (reviewBrandFilter !== 'all') {
    filtered = filtered.filter(r => (r.brand || '').includes(reviewBrandFilter));
  }
  if (reviewSeverityFilter !== 'all') {
    filtered = filtered.filter(r => r.severity === reviewSeverityFilter);
  }
  // 按日期倒序
  filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const list = document.getElementById('reviews-list');
  const empty = document.getElementById('reviews-empty');
  if (!list) return;
  list.innerHTML = '';
  if (filtered.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const sevMap = {
    red: { label: '🔴 红色', bg: '#FFE5E5', color: '#FF3B30' },
    blue: { label: '🔵 蓝色', bg: '#E5F0FF', color: '#007AFF' },
    green: { label: '🟢 绿色', bg: '#E5F9EC', color: '#34C759' }
  };

  filtered.forEach(r => {
    const sev = sevMap[r.severity] || sevMap.green;
    const card = document.createElement('div');
    card.className = 'review-card';
    const reviewId = 'rev-detail-' + (r.id || Math.random().toString(36).slice(2, 8));
    card.innerHTML = `
      <div class="review-card-header">
        <span class="review-date">${escapeHtml(r.date || '')}</span>
        <span class="review-market">${escapeHtml(r.market || '')}</span>
        <span class="review-severity" style="background:${sev.bg};color:${sev.color}">${sev.label}</span>
        <span class="review-brand">${escapeHtml(r.brand || '')}</span>
      </div>
      <div class="review-summary">${escapeHtml(r.chineseSummary || '')}</div>
      ${r.impact ? `<div class="review-impact">💡 影响：${escapeHtml(r.impact)}</div>` : ''}
      <div class="review-toggle" onclick="toggleReviewDetail('${reviewId}')">👁️ 查看原文 ▼</div>
      <div class="review-detail" id="${reviewId}" style="display:none;">
        <div class="review-original">${escapeHtml(r.originalText || '')}</div>
        ${r.sourceUrl ? `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" class="review-source">🔗 ${escapeHtml(r.sourceName || '来源')}</a>` : ''}
      </div>
    `;
    list.appendChild(card);
  });
}

function toggleReviewDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  const btn = el.previousElementSibling;
  if (btn) btn.textContent = isHidden ? '👁️ 收起原文 ▲' : '👁️ 查看原文 ▼';
}

function setReviewFilter(brand) {
  reviewBrandFilter = brand;
  document.querySelectorAll('[data-rfilter]').forEach(b => b.classList.toggle('active', b.dataset.rfilter === brand));
  renderReviews();
}

function setReviewSeverity(sev) {
  reviewSeverityFilter = sev;
  document.querySelectorAll('[data-sfilter]').forEach(b => b.classList.toggle('active', b.dataset.sfilter === sev));
  renderReviews();
}

function importReviews(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      let imported = [];
      if (Array.isArray(data)) imported = data;
      else if (data.consumer_reviews) imported = data.consumer_reviews;
      else if (data.reviews) imported = data.reviews;
      if (imported.length === 0) { showToast('❌ 文件中未找到评论数据'); return; }
      DB.set('consumer_reviews', imported);
      renderReviews();
      showToast(`✅ 已导入 ${imported.length} 条评论`);
    } catch { showToast('❌ 文件格式错误'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function clearReviews() {
  DB.set('consumer_reviews', []);
  renderReviews();
  showToast('评论数据已清空');
}

async function loadSampleReviews() {
  showToast('正在下载示例数据…');
  try {
    const res = await fetch('sample-reviews.json');
    const data = await res.json();
    let imported = [];
    if (Array.isArray(data)) imported = data;
    else if (data.consumer_reviews) imported = data.consumer_reviews;
    else if (data.reviews) imported = data.reviews;
    if (imported.length === 0) { showToast('❌ 示例数据为空'); return; }
    DB.set('consumer_reviews', imported);
    renderReviews();
    showToast(`✅ 已加载 ${imported.length} 条示例评论`);
  } catch (e) {
    showToast('❌ 下载失败: ' + (e.message || e));
  }
}
