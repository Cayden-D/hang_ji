import dd from 'dingtalk-jsapi';
import './style.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const currentMonth = () => today().slice(0, 7);
const money = (value) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const roleNames = { sales: '业务员', purchase: '采购', logistics: '物流', admin: '管理员' };
const statusMeta = {
  pending_purchase: { label: '待采购', className: 'pending_purchase' },
  purchasing: { label: '采购中', className: 'purchasing' },
  purchased: { label: '待发货', className: 'purchased' },
  shipped: { label: '已发货', className: 'shipped' },
  cancelled: { label: '已取消', className: 'cancelled' }
};

const state = {
  token: localStorage.getItem('hangji_pc_session') || '',
  user: null,
  orders: [],
  orderFilter: 'all',
  search: '',
  currentView: 'dashboard',
  currentDetail: null,
  members: [],
  rates: null,
  performance: null,
  leaderboardReport: null,
  performanceMonth: currentMonth(),
  productDrafts: [],
  paymentAttachments: [],
  shipmentAttachments: [],
  shipmentOrderId: '',
  shipmentMode: 'create',
  adminEditProducts: [],
  busy: false
};

const previewMode = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get('preview') === '1';

const emptyProduct = () => ({
  sku: '', name: '', variant: '', unitsPerCarton: 0, cartons: 0, weight: 0, volume: 0,
  quantity: 1, unitPrice: 0, purchaseCost: 0, images: []
});

const toast = (message) => {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
};

const setError = (message = '') => {
  const banner = $('#error-banner');
  banner.textContent = message;
  banner.classList.toggle('is-hidden', !message);
};

const setBusy = (busy, label) => {
  state.busy = busy;
  ['#create-button', '#save-order', '#save-shipment', '#refresh-button', '#import-pi'].forEach((selector) => {
    const button = $(selector);
    if (button) button.disabled = busy;
  });
  if (label) toast(label);
};

const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/dingtalk') logout(false);
    throw new Error(body?.error?.message || `请求失败（${response.status}）`);
  }
  return body;
};

const uploadImage = async (file, category) => {
  const form = new FormData();
  form.append('file', file);
  form.append('category', category);
  const result = await api('/api/uploads/image', { method: 'POST', body: form });
  return result.attachment;
};

const dingTalkAuthCode = async (corpId) => {
  if (!corpId) throw new Error('服务端未配置 DING_CORP_ID');
  if (!dd) throw new Error('钉钉客户端 SDK 加载失败');
  console.info('钉钉 PC 免登环境', {
    platform: dd.env?.platform || 'unknown',
    hasRuntimeAuth: typeof dd.runtime?.permission?.requestAuthCode === 'function',
    hasGetAuthCode: typeof dd.getAuthCode === 'function',
    userAgentHasDingTalk: /DingTalk/i.test(navigator.userAgent)
  });
  if (dd.env?.platform === 'notInDingTalk' && !/DingTalk/i.test(navigator.userAgent)) {
    throw new Error('当前工作台使用系统浏览器打开，无法调用钉钉 H5 免登；请改为钉钉内置窗口，或接入网页登录/扫码登录');
  }

  // 不单独使用 dd.env.platform 判断：钉钉 UA 存在时即使平台字段误报，仍尝试 JSBridge；
  // 只有平台和浏览器 UA 都确认是外部环境时才停止调用。
  await Promise.race([
    new Promise((resolve, reject) => {
      let ready = false;
      const onReady = () => { if (!ready) { ready = true; resolve(); } };
      const result = dd.ready(onReady);
      if (result && typeof result.then === 'function') result.then(onReady, reject);
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('钉钉 JSAPI 初始化超时')), 8000))
  ]);

  const invokeAuthApi = (method, owner) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('获取免登授权码超时'));
    }, 10000);
    const onSuccess = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result?.authCode || result?.code);
    };
    const onFail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(error?.errorMessage || error?.message || '获取免登授权码失败'));
    };
    const request = method.call(owner, {
      corpId,
      success: onSuccess,
      fail: onFail
    });
    if (request && typeof request.then === 'function') request.then(onSuccess, onFail);
  });

  const attempts = [];
  const legacyMethod = dd.runtime?.permission?.requestAuthCode;
  if (typeof legacyMethod === 'function') {
    try {
      return await invokeAuthApi(legacyMethod, dd.runtime.permission);
    } catch (error) {
      attempts.push(error.message);
    }
  }
  if (typeof dd.getAuthCode === 'function') {
    try {
      return await invokeAuthApi(dd.getAuthCode, dd);
    } catch (error) {
      attempts.push(error.message);
    }
  }
  const platform = dd.env?.platform || 'unknown';
  throw new Error(`无法调用钉钉网页免登（platform=${platform}）：${attempts.join('；') || '客户端未提供免登接口'}`);
};

async function authenticate() {
  const message = $('#auth-message');
  message.textContent = '正在验证当前会话…';
  if (state.token) {
    try {
      const result = await api('/api/auth/me');
      state.user = result.user;
      return enterApp();
    } catch (_error) {
      state.token = '';
      localStorage.removeItem('hangji_pc_session');
    }
  }
  try {
    message.textContent = '正在连接钉钉身份…';
    const config = await api('/api/public-config');
    const code = await dingTalkAuthCode(config.corpId);
    if (!code) throw new Error('钉钉未返回免登授权码');
    const result = await api('/api/auth/dingtalk', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem('hangji_pc_session', state.token);
    enterApp();
  } catch (error) {
    console.error('PC 端免登失败', error);
    message.textContent = error.message;
    $('#auth-retry').classList.remove('is-hidden');
  }
}

function enterApp() {
  $('#auth-screen').classList.add('is-hidden');
  $('#app').classList.remove('is-hidden');
  renderAccount();
  $('#performance-month').value = state.performanceMonth;
  if (previewMode) {
    renderAll();
    renderLeaderboard();
  }
  else {
    loadOrders();
    loadExchangeRates();
    loadLeaderboard();
  }
}

function logout(reload = true) {
  state.token = '';
  state.user = null;
  localStorage.removeItem('hangji_pc_session');
  if (reload) window.location.reload();
}

function renderAccount() {
  const user = state.user;
  $('#account-name').textContent = user.name || '钉钉用户';
  $('#account-role').textContent = `${roleNames[user.role] || user.role}${user.title ? ` · ${user.title}` : ''}`;
  $('#account-avatar').innerHTML = user.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" />`
    : escapeHtml((user.name || '航').slice(0, 1));
  $$('.admin-only').forEach((element) => element.classList.toggle('is-hidden', user.role !== 'admin'));
  $$('.sales-only').forEach((element) => element.classList.toggle('is-hidden', !['sales', 'admin'].includes(user.role)));
}

async function loadOrders() {
  setError('');
  try {
    const result = await api('/api/orders?page=1&pageSize=100');
    state.orders = result.items || [];
    renderAll();
  } catch (error) {
    console.error('订单读取失败', error);
    setError(`订单读取失败：${error.message}`);
  }
}

async function loadExchangeRates() {
  try {
    const result = await api('/api/exchange-rates/usd-cny');
    state.rates = result.rates;
    renderExchangeRates();
  } catch (error) {
    console.error('汇率读取失败', error);
    $('#rate-month-start').textContent = '暂不可用';
    $('#rate-today').textContent = '暂不可用';
  }
}

async function loadLeaderboard() {
  try {
    state.leaderboardReport = await api(`/api/performance/leaderboard?month=${encodeURIComponent(currentMonth())}`);
    renderLeaderboard();
  } catch (error) {
    console.error('排行榜读取失败', error);
    $('#sales-champion').innerHTML = '<span>排行榜暂时不可用</span>';
    $('#sales-leaderboard').innerHTML = '';
    $('#my-performance-content').innerHTML = '<span>个人业绩暂时不可用</span>';
  }
}

const rankingAvatar = (item, className) => item.avatarUrl
  ? `<div class="${className}"><img src="${escapeHtml(item.avatarUrl)}" alt="" /></div>`
  : `<div class="${className}">${escapeHtml((item.name || '航').slice(0, 1))}</div>`;

function renderLeaderboard() {
  const report = state.leaderboardReport;
  if (!report) return;
  const champion = report.champion;
  $('#sales-champion').innerHTML = champion ? `
    ${rankingAvatar(champion, 'sales-champion-avatar')}
    <div class="sales-champion-main"><small>本月销冠</small><strong>${escapeHtml(champion.name)}</strong><span>${champion.orderCount} 笔订单 · 利润 ¥${money(champion.profitCny)}</span></div>
    <div class="sales-champion-value"><strong>¥${money(champion.salesCny)}</strong><small>折算销售额</small></div>` : '<span>本月还没有销售业绩</span>';
  $('#sales-leaderboard').innerHTML = (report.leaders || []).slice(0, 6).map((item) => `
    <div class="sales-rank-row">
      <span class="sales-rank-number">${item.rank}</span>${rankingAvatar(item, 'sales-rank-avatar')}
      <div class="sales-rank-main"><strong>${escapeHtml(item.name)}</strong><small>${item.orderCount} 笔订单${item.title ? ` · ${escapeHtml(item.title)}` : ''}</small></div>
      <span class="sales-rank-value">¥${money(item.salesCny)}</span>
    </div>`).join('') || '<div class="empty-state"><strong>暂无排名</strong></div>';
  const mine = report.me;
  $('#my-performance-content').innerHTML = mine ? `
    <span class="my-performance-rank">本月第 ${mine.rank} 名 · ${mine.orderCount} 笔订单</span>
    <div class="my-performance-total"><strong>¥${money(mine.salesCny)}</strong><span>折算人民币销售额</span></div>
    <div class="my-performance-stats"><div><small>本月利润</small><strong>¥${money(mine.profitCny)}</strong></div><div><small>预计提成</small><strong>¥${money(mine.commissionCny)}</strong></div></div>` : '<span>当前角色没有个人销售业绩</span>';
}

function renderExchangeRates() {
  if (!state.rates) return;
  const first = Number(state.rates.monthStart.rate);
  const latest = Number(state.rates.today.rate);
  const change = latest - first;
  $('#rate-month-start').textContent = first.toFixed(4);
  $('#rate-month-date').textContent = state.rates.monthStart.date;
  $('#rate-today').textContent = latest.toFixed(4);
  $('#rate-today-date').textContent = state.rates.today.date;
  $('#rate-change').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(4)}`;
  $('#rate-change').className = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
}

async function loadPerformance() {
  if (!['sales', 'admin'].includes(state.user?.role)) return;
  if (previewMode) {
    renderPerformance();
    return;
  }
  $('#performance-body').innerHTML = '<tr><td colspan="10"><div class="loading-line"></div></td></tr>';
  try {
    state.performance = await api(`/api/performance/monthly?month=${encodeURIComponent(state.performanceMonth)}`);
    renderPerformance();
  } catch (error) {
    $('#performance-body').innerHTML = `<tr><td colspan="10">业绩读取失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderPerformance() {
  const report = state.performance;
  if (!report) return;
  $('#performance-orders').textContent = report.summary.orderCount;
  $('#performance-received').textContent = `¥${money(report.summary.receivedCny)}`;
  $('#performance-profit').textContent = `¥${money(report.summary.profitCny)}`;
  $('#performance-commission').textContent = `¥${money(report.summary.completedCommissionCny)}`;
  $('#performance-commission-note').textContent = `全部订单预计 ¥${money(report.summary.commissionCny)}`;
  $('#performance-rate-note').textContent = report.exchangeRate
    ? `统一按 ${report.exchangeRate.date} 汇率 ${Number(report.exchangeRate.rate).toFixed(4)} 折算`
    : '美元金额统一按当月 1 日汇率折算';
  $('#performance-body').innerHTML = report.items.map((item) => `<tr data-order-id="${item.id}">
    <td><div class="performance-order"><strong>${escapeHtml(item.customerName)}</strong><span>${escapeHtml(item.orderNo)} · ${escapeHtml(item.orderDate)}</span></div></td>
    <td class="admin-only">${escapeHtml(item.ownerName)}</td>
    <td>${escapeHtml(item.currency)} ${money(item.orderAmount)}</td>
    <td>${item.receivedCny == null ? (item.convertedOrderAmountCny == null ? '待汇率' : `≈ ¥${money(item.convertedOrderAmountCny)}`) : `¥${money(item.receivedCny)}`}</td>
    <td>${escapeHtml(item.currency)} ${money(item.productCost)}</td>
    <td>${escapeHtml(item.currency)} ${money(item.freight)}</td>
    <td class="${Number(item.profitCny) >= 0 ? 'profit-positive' : 'profit-negative'}">${item.profitCny == null ? '待汇率' : `¥${money(item.profitCny)}`}</td>
    <td><strong>${item.commissionCny == null ? '待汇率' : `¥${money(item.commissionCny)}`}</strong><small> · ${Number(item.commissionRatePercent).toFixed(2)}%</small></td>
    <td>${escapeHtml(item.freightForwarder || '未填写')}</td>
    <td><span class="completion-badge ${item.isCompleted ? 'done' : ''}">${item.isCompleted ? '已完结' : '未完结'}</span></td>
  </tr>`).join('') || '<tr><td colspan="10">该月暂无订单</td></tr>';
  const warning = report.warnings?.join('；') || '';
  $('#performance-warning').textContent = warning;
  $('#performance-warning').classList.toggle('is-hidden', !warning);
  renderAccount();
}

const deadlineDays = (value) => {
  if (!value) return 9999;
  const date = String(value).slice(0, 10);
  return Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000);
};

const productText = (order) => {
  const item = order.productSummary;
  if (!item) return '暂无产品摘要';
  return `${item.name || item.sku}${item.variant ? ` / ${item.variant}` : ''}${order.productCount > 1 ? ` 等 ${order.productCount} 款` : ''}`;
};

const filteredOrders = () => state.orders.filter((order) => {
  if (state.orderFilter !== 'all' && order.status !== state.orderFilter) return false;
  if (!state.search) return true;
  const keyword = state.search.toLowerCase();
  return [order.orderNo, order.customerName, order.ownerName, productText(order), order.productSummary?.sku]
    .filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
});

function renderAll() {
  renderDashboard();
  renderOrders();
  renderTasks();
  renderAdminOrders();
}

function renderDashboard() {
  const orders = state.orders;
  const purchase = orders.filter((order) => ['pending_purchase', 'purchasing'].includes(order.status));
  const ready = orders.filter((order) => order.status === 'purchased');
  const shipped = orders.filter((order) => order.status === 'shipped');
  const urgent = orders.filter((order) => !['shipped', 'cancelled'].includes(order.status) && deadlineDays(order.deadline) <= 3);
  $('#metric-urgent').textContent = urgent.length;
  $('#metric-purchase').textContent = purchase.length;
  $('#metric-ready').textContent = ready.length;
  $('#metric-shipped').textContent = shipped.length;
  $('#route-created').textContent = orders.length;
  $('#route-purchase').textContent = purchase.length;
  $('#route-ready').textContent = ready.length;
  $('#route-shipped').textContent = shipped.length;
  $('#route-summary').textContent = orders.length
    ? `${orders.length} 张确认单正在协作，${urgent.length} 张接近出货期限。`
    : '暂无订单，创建第一张客户确认单开始协作。';

  const priority = [...orders]
    .filter((order) => !['shipped', 'cancelled'].includes(order.status))
    .sort((a, b) => deadlineDays(a.deadline) - deadlineDays(b.deadline)).slice(0, 5);
  $('#priority-list').innerHTML = priority.length ? priority.map((order) => {
    const date = String(order.deadline || '').slice(0, 10);
    const days = deadlineDays(order.deadline);
    return `<article class="priority-item" data-order-id="${order.id}">
      <div class="priority-date"><strong>${days < 0 ? `逾期${Math.abs(days)}天` : `${days}天`}</strong><span>${escapeHtml(date || '未定日期')}</span></div>
      <div class="priority-main"><strong>${escapeHtml(order.customerName)}</strong><span>${escapeHtml(productText(order))}</span></div>
      <span class="priority-amount">${escapeHtml(order.currency || 'USD')} ${money(order.totalAmount)}</span>
      ${statusPill(order.status)}
    </article>`;
  }).join('') : emptyMarkup('没有待处理订单');

  $('#latest-list').innerHTML = orders.slice(0, 6).map((order) => `<article class="latest-item" data-order-id="${order.id}">
    <div><strong>${escapeHtml(order.orderNo)}</strong>${statusPill(order.status)}</div>
    <p>${escapeHtml(order.customerName)}</p><small>${escapeHtml(productText(order))}</small>
  </article>`).join('') || emptyMarkup('暂无最近订单');
}

const statusPill = (status) => {
  const meta = statusMeta[status] || { label: status, className: '' };
  return `<span class="status-pill ${meta.className}">${escapeHtml(meta.label)}</span>`;
};

const emptyMarkup = (message) => `<div class="empty-state"><strong>${escapeHtml(message)}</strong><span>新的业务数据会显示在这里。</span></div>`;

function renderOrders() {
  const orders = filteredOrders();
  $('#order-count').textContent = `${orders.length} 条订单`;
  $('#orders-empty').classList.toggle('is-hidden', orders.length > 0);
  $('#orders-body').innerHTML = orders.map((order) => `<tr data-order-id="${order.id}">
    <td><div class="order-cell"><strong>${escapeHtml(order.orderNo)}</strong><span>${escapeHtml(order.customerName)}</span></div></td>
    <td><div class="product-summary">${escapeHtml(productText(order))}</div><span class="muted">${escapeHtml(order.productSummary?.sku || '')}</span></td>
    <td class="money">${escapeHtml(order.currency || 'USD')} ${money(order.totalAmount)}</td>
    <td>${escapeHtml(String(order.deadline || '').slice(0, 10) || '待确认')}</td>
    <td>${escapeHtml(order.ownerName || '—')}</td><td>${statusPill(order.status)}</td><td><button class="row-action" aria-label="查看订单">→</button></td>
  </tr>`).join('');
}

function renderTasks() {
  const purchase = state.orders.filter((order) => ['pending_purchase', 'purchasing'].includes(order.status));
  const shipping = state.orders.filter((order) => order.status === 'purchased');
  const relevantCount = state.user?.role === 'logistics' ? shipping.length
    : state.user?.role === 'purchase' ? purchase.length : purchase.length + shipping.length;
  $('#task-badge').textContent = relevantCount;
  $('#purchase-count').textContent = purchase.length;
  $('#shipping-count').textContent = shipping.length;
  $('#purchase-tasks').innerHTML = taskCards(purchase, false);
  $('#shipping-tasks').innerHTML = taskCards(shipping, true);
}

function renderAdminOrders() {
  const body = $('#admin-orders-body');
  if (!body || state.user?.role !== 'admin') return;
  body.innerHTML = state.orders.map((order) => `<tr data-order-id="${order.id}">
    <td><div class="order-cell"><strong>${escapeHtml(order.orderNo)}</strong><span>${escapeHtml(String(order.deadline || '').slice(0, 10))}</span></div></td>
    <td>${escapeHtml(order.customerName)}</td><td>${order.productCount || 0} 款</td>
    <td class="money">${escapeHtml(order.currency || 'USD')} ${money(order.totalAmount)}</td><td>${statusPill(order.status)}</td>
    <td><div class="admin-actions"><button data-admin-edit="${order.id}">编辑</button><button class="danger-link" data-admin-delete="${order.id}">删除</button></div></td>
  </tr>`).join('') || '<tr><td colspan="6">暂无订单数据</td></tr>';
}

const taskCards = (orders, shipping) => orders.length ? orders.map((order) => `<article class="task-card ${shipping ? 'shipping' : ''}" data-order-id="${order.id}">
  <div><strong>${escapeHtml(order.orderNo)}</strong>${statusPill(order.status)}</div>
  <h4>${escapeHtml(order.customerName)}</h4><p>${escapeHtml(productText(order))}</p>
  <footer><span>${shipping ? '等待物流确认' : '等待采购确认'}</span><span>${escapeHtml(String(order.deadline || '').slice(0, 10))}</span></footer>
</article>`).join('') : emptyMarkup(shipping ? '没有待发货订单' : '没有采购任务');

function switchView(view) {
  if (view === 'admin' && state.user?.role !== 'admin') return;
  if (view === 'performance' && !['sales', 'admin'].includes(state.user?.role)) return;
  state.currentView = view;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  const titles = {
    dashboard: ['OPERATIONS BOARD', '今日协作总览'], orders: ['ORDER MANIFEST', '订单中心'],
    performance: ['COMMISSION LEDGER', '月度业绩'], tasks: ['ACTION QUEUE', '我的待办'],
    admin: ['DATA ADMINISTRATION', '管理员后台']
  };
  $('#view-kicker').textContent = titles[view][0];
  $('#view-title').textContent = titles[view][1];
  if (view === 'admin') loadMembers();
  if (view === 'performance') loadPerformance();
}

async function openDetail(id) {
  $('#detail-drawer').classList.add('open');
  $('#detail-order-no').textContent = '读取中…';
  $('#detail-content').innerHTML = '<div class="loading-line"></div>';
  $('#detail-actions').innerHTML = '';
  if (previewMode) {
    const order = state.orders.find((item) => item.id === id);
    state.currentDetail = {
      ...order,
      shippingAddress: `${order.destination} · 客户指定仓库`, note: '外箱需加贴客户条码，装柜前提供整批照片。',
      paymentAttachments: [], shipment: null,
      products: [
        { id: 'preview-product-1', sku: order.productSummary.sku, name: order.productSummary.name, variant: order.productSummary.variant, unitsPerCarton: 20, cartons: 10, weight: 128, volume: 1.4, quantity: 200, totalPrice: order.totalAmount, purchaseStatus: order.status === 'purchasing' ? 'pending' : 'completed', images: [] },
        { id: 'preview-product-2', sku: `${order.productSummary.sku}-B`, name: order.productSummary.name, variant: '雾灰色', unitsPerCarton: 20, cartons: 6, weight: 76, volume: .8, quantity: 120, totalPrice: order.totalAmount * .45, purchaseStatus: 'completed', images: [] }
      ]
    };
    renderDetail();
    return;
  }
  try {
    const result = await api(`/api/orders/${encodeURIComponent(id)}`);
    state.currentDetail = result.order;
    renderDetail();
  } catch (error) {
    $('#detail-content').innerHTML = emptyMarkup(`订单读取失败：${error.message}`);
  }
}

function closeDetail() {
  $('#detail-drawer').classList.remove('open');
  state.currentDetail = null;
}

function renderDetail() {
  const order = state.currentDetail;
  $('#detail-order-no').textContent = order.orderNo;
  const meta = statusMeta[order.status] || { label: order.status, className: '' };
  $('#detail-status').className = `status-pill ${meta.className}`;
  $('#detail-status').textContent = meta.label;
  const productMarkup = (order.products || []).map((product) => `<article class="detail-product">
    <div class="detail-product-image">${product.images?.[0]?.url ? `<img src="${escapeHtml(product.images[0].url)}" alt="" />` : escapeHtml(product.sku?.slice(0, 5) || '产品')}</div>
    <div><h5>${escapeHtml(product.name)} / ${escapeHtml(product.variant)}</h5><p>${product.sku ? `${escapeHtml(product.sku)} · ` : ''}${product.quantity} 件 · ${product.cartons} 箱<br />${product.weight} kg · ${product.volume} m³ · 装箱 ${product.unitsPerCarton} 件</p></div>
    <aside><strong>USD ${money(product.totalPrice)}</strong>${product.purchaseStatus === 'completed'
      ? '<span class="status-pill purchased">已采购</span>'
      : canPurchase() ? `<button data-purchase-product="${product.id}">确认此款采购</button>` : '<span class="status-pill">待采购</span>'}</aside>
  </article>`).join('');
  const attachments = [...(order.paymentAttachments || []), ...(order.shipment?.attachments || [])];
  $('#detail-content').innerHTML = `
    <div class="detail-summary"><div><span>客户</span><strong>${escapeHtml(order.customerName)}</strong></div><div><span>订单总额</span><strong>${escapeHtml(order.currency)} ${money(order.totalAmount)}</strong></div><div><span>最晚出货</span><strong>${escapeHtml(String(order.deadline).slice(0,10))}</strong></div></div>
    <section class="detail-block"><h4>产品明细 · ${order.products?.length || 0} 款</h4>${productMarkup || emptyMarkup('暂无产品')}</section>
    <section class="detail-block"><h4>财务结算</h4><div class="detail-note">到账人民币：${order.receivedCny == null ? '尚未填写' : `¥${money(order.receivedCny)}`}<br />结算汇率：${order.exchangeRate || '按订单日期自动换算'} · ${order.isCompleted ? '已完结' : '未完结'}</div></section>
    <section class="detail-block"><h4>交付信息</h4><div class="detail-note">${escapeHtml(order.shippingAddress || order.destination || '尚未填写交付地址')}<br />${escapeHtml(order.note || '无补充说明')}</div></section>
    ${order.shipment ? `<section class="detail-block"><h4>物流记录</h4><div class="detail-note">${escapeHtml(order.shipment.logisticsCompany)} · ${escapeHtml(order.shipment.trackingNo)}<br />${escapeHtml(String(order.shipment.shippedOn).slice(0,10))} → ${escapeHtml(String(order.shipment.estimatedArrivalOn).slice(0,10))}</div></section>` : ''}
    ${attachments.length ? `<section class="detail-block"><h4>关联凭证</h4><div class="attachment-list">${attachments.map((file) => `<a href="${escapeHtml(file.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(file.fileName)}</a>`).join('')}</div></section>` : ''}`;

  const actions = [];
  if (state.user?.role === 'admin') {
    actions.push('<button class="button secondary" data-admin-edit-detail>编辑订单</button>');
    if (order.shipment) {
      actions.push('<button class="button secondary" data-admin-edit-shipment>修改物流</button>');
      actions.push('<button class="button secondary" data-admin-delete-shipment>删除物流</button>');
    }
    actions.push('<button class="button danger" data-admin-delete-detail>删除订单</button>');
  }
  if (canPurchase() && ['pending_purchase', 'purchasing'].includes(order.status)) actions.push('<button class="button primary" data-purchase-all>标记全部采购完成</button>');
  if (canShip() && order.status === 'purchased') actions.push('<button class="button primary" data-open-shipment>填写物流并确认发货</button>');
  $('#detail-actions').innerHTML = actions.join('');
}

const canPurchase = () => ['purchase', 'admin'].includes(state.user?.role);
const canShip = () => ['logistics', 'admin'].includes(state.user?.role);

async function completePurchase(productIds) {
  if (!state.currentDetail || state.busy) return;
  setBusy(true);
  try {
    const result = await api(`/api/orders/${state.currentDetail.id}/purchase-complete`, {
      method: 'POST', body: JSON.stringify(productIds ? { productIds } : {})
    });
    state.currentDetail = result.order;
    replaceOrder(result.order);
    renderDetail();
    toast(productIds ? '该产品已确认采购' : '全部产品已确认采购');
  } catch (error) {
    toast(`采购确认失败：${error.message}`);
  } finally { setBusy(false); }
}

function replaceOrder(order) {
  const index = state.orders.findIndex((item) => item.id === order.id);
  const summary = order.products?.[0] || null;
  const listOrder = { ...order, productSummary: summary, productCount: order.products?.length || 0 };
  if (index >= 0) state.orders.splice(index, 1, listOrder); else state.orders.unshift(listOrder);
  renderAll();
}

function openCreate() {
  state.productDrafts = [emptyProduct()];
  state.paymentAttachments = [];
  $('#create-form').reset();
  $('#create-form [name="deadline"]').value = today();
  renderProductEditors();
  renderPaymentPreviews();
  $('#create-dialog').showModal();
}

function renderProductEditors() {
  $('#product-editors').innerHTML = state.productDrafts.map((product, index) => `<article class="product-editor" data-index="${index}">
    <div class="product-editor-head"><strong>产品 ${index + 1}${product.name ? ` · ${escapeHtml(product.name)}` : ''}</strong>${state.productDrafts.length > 1 ? `<button type="button" class="remove-product" data-remove-product="${index}">删除此产品</button>` : ''}</div>
    <div class="product-fields">
      ${productInput(index, 'sku', '货号（选填）', product.sku, 'wide')}${productInput(index, 'name', '名称 *', product.name, 'wide')}${productInput(index, 'variant', '颜色 / 款式 *', product.variant, 'wide')}
      ${productInput(index, 'unitsPerCarton', '装箱数', product.unitsPerCarton, '', 'number')}${productInput(index, 'cartons', '箱数', product.cartons, '', 'number')}${productInput(index, 'weight', '重量 kg', product.weight, '', 'number', '0.01')}${productInput(index, 'volume', '体积 m³', product.volume, '', 'number', '0.001')}${productInput(index, 'quantity', '数量 *', product.quantity, '', 'number')}${productInput(index, 'unitPrice', '单价 USD', product.unitPrice, '', 'number', '0.01')}
      ${productInput(index, 'purchaseCost', '采购成本 USD', product.purchaseCost, '', 'number', '0.01')}
      <label class="product-upload"><span>产品图片 · ${product.images.length}/9</span><input type="file" accept="image/*" multiple data-product-files="${index}" />${miniPreviews(product.images)}</label>
    </div></article>`).join('');
}

const productInput = (index, field, label, value, className = '', type = 'text', step = '1') => `<label class="${className}"><span>${label}</span><input data-product-index="${index}" data-product-field="${field}" type="${type}" ${type === 'number' ? `min="0" step="${step}"` : ''} value="${escapeHtml(value)}" /></label>`;
const miniPreviews = (items) => items.length ? `<div class="mini-previews">${items.slice(0, 5).map((file) => `<img src="${escapeHtml(file.url)}" alt="" />`).join('')}</div>` : '';

async function uploadProductFiles(index, files) {
  const remaining = 9 - state.productDrafts[index].images.length;
  if (remaining <= 0) return toast('每个产品最多 9 张图片');
  setBusy(true, '正在上传产品图片…');
  try {
    for (const file of [...files].slice(0, remaining)) state.productDrafts[index].images.push(await uploadImage(file, 'product'));
    renderProductEditors();
    toast('产品图片已上传至 OSS');
  } catch (error) { toast(`图片上传失败：${error.message}`); }
  finally { setBusy(false); }
}

async function uploadAttachments(files, category) {
  const target = category === 'payment' ? state.paymentAttachments : state.shipmentAttachments;
  const remaining = 9 - target.length;
  if (remaining <= 0) return toast('最多上传 9 张图片');
  setBusy(true, '正在上传图片…');
  try {
    for (const file of [...files].slice(0, remaining)) target.push(await uploadImage(file, category));
    category === 'payment' ? renderPaymentPreviews() : renderShipmentPreviews();
    toast('图片已上传至 OSS');
  } catch (error) { toast(`图片上传失败：${error.message}`); }
  finally { setBusy(false); }
}

const previewMarkup = (items, category) => items.map((file, index) => `<div class="file-chip"><img src="${escapeHtml(file.url)}" alt="" /><button type="button" data-remove-file="${category}:${index}">×</button></div>`).join('');
const renderPaymentPreviews = () => { $('#payment-previews').innerHTML = previewMarkup(state.paymentAttachments, 'payment'); };
const renderShipmentPreviews = () => { $('#shipment-previews').innerHTML = previewMarkup(state.shipmentAttachments, 'shipment'); };

async function submitOrder(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = new FormData(event.currentTarget);
  const invalid = state.productDrafts.some((item) => !item.name.trim() || !item.variant.trim() || Number(item.quantity) <= 0);
  if (invalid) return toast('请填写每款产品的名称、颜色款式和数量');
  const data = {
    customerName: form.get('customerName'), customerContact: form.get('customerContact') || null,
    shippingAddress: form.get('shippingAddress') || null, destination: form.get('destination') || null,
    deadline: form.get('deadline'), paymentMethod: form.get('paymentMethod'), currency: 'USD',
    freight: Number(form.get('freight') || 0), receivedCny: form.get('receivedCny') ? Number(form.get('receivedCny')) : null,
    note: form.get('note') || null,
    products: state.productDrafts.map((item) => ({ ...item,
      unitsPerCarton: Number(item.unitsPerCarton), cartons: Number(item.cartons), weight: Number(item.weight),
      volume: Number(item.volume), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), purchaseCost: Number(item.purchaseCost)
    })), paymentAttachments: state.paymentAttachments
  };
  setBusy(true);
  $('#save-order').textContent = '正在创建…';
  try {
    const result = await api('/api/orders', { method: 'POST', body: JSON.stringify(data) });
    replaceOrder(result.order);
    void loadLeaderboard();
    $('#create-dialog').close();
    toast(`订单 ${result.order.orderNo} 已创建`);
  } catch (error) { toast(`创建失败：${error.message}`); }
  finally { $('#save-order').textContent = '创建并同步采购'; setBusy(false); }
}

async function importPiFile(file) {
  if (!file || state.busy) return;
  if (!/\.xlsx$/i.test(file.name)) return toast('请选择 .xlsx 格式的 PI 报价单');
  const formData = new FormData();
  formData.append('file', file);
  setBusy(true);
  $('#import-pi').textContent = '正在解析 PI…';
  try {
    const result = await api('/api/imports/pi', { method: 'POST', body: formData });
    const imported = result.imported;
    state.productDrafts = imported.products.map((product) => ({ ...emptyProduct(), ...product }));
    const form = $('#create-form');
    if (imported.customerName) form.elements.customerName.value = imported.customerName;
    if (imported.quotationDate && !form.elements.note.value.trim()) {
      form.elements.note.value = `PI 报价日期：${imported.quotationDate}；来源文件：${imported.fileName}`;
    }
    renderProductEditors();
    const warning = imported.warnings?.length ? `；${imported.warnings[0]}` : '';
    toast(`已从 PI 导入 ${imported.products.length} 款产品${warning}`);
  } catch (error) {
    toast(`PI 导入失败：${error.message}`);
  } finally {
    $('#import-pi').textContent = '⇧ 导入 PI 报价单';
    $('#pi-file-input').value = '';
    setBusy(false);
  }
}

function openShipment(mode = 'create') {
  state.shipmentOrderId = state.currentDetail.id;
  state.shipmentMode = mode;
  state.shipmentAttachments = [];
  $('#shipment-form').reset();
  const shipment = state.currentDetail.shipment;
  $('#shipment-dialog .modal-head h3').textContent = mode === 'edit' ? '修改物流数据' : '确认发货';
  $('#save-shipment').textContent = mode === 'edit' ? '保存物流修改' : '确认发货';
  $('#shipment-form [name="shippedOn"]').value = mode === 'edit' ? String(shipment.shippedOn).slice(0, 10) : today();
  if (mode === 'edit') {
    $('#shipment-form [name="logisticsCompany"]').value = shipment.logisticsCompany || '';
    $('#shipment-form [name="trackingNo"]').value = shipment.trackingNo || '';
    $('#shipment-form [name="estimatedArrivalOn"]').value = String(shipment.estimatedArrivalOn || '').slice(0, 10);
    $('#shipment-form [name="note"]').value = shipment.note || '';
  }
  $('#shipment-files').closest('.upload-zone').classList.toggle('is-hidden', mode === 'edit');
  renderShipmentPreviews();
  $('#shipment-dialog').showModal();
}

async function submitShipment(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(['logisticsCompany', 'trackingNo', 'shippedOn', 'estimatedArrivalOn', 'note'].map((key) => [key, form.get(key) || null]));
  data.attachments = state.shipmentAttachments;
  if (!data.logisticsCompany || !data.trackingNo || !data.shippedOn || !data.estimatedArrivalOn) return toast('请完整填写物流公司、单号和日期');
  if (data.estimatedArrivalOn < data.shippedOn) return toast('预计到达不能早于发货日期');
  setBusy(true);
  $('#save-shipment').textContent = '正在发货…';
  try {
    const path = state.shipmentMode === 'edit'
      ? `/api/orders/${state.shipmentOrderId}/shipment`
      : `/api/orders/${state.shipmentOrderId}/shipments`;
    const result = await api(path, { method: state.shipmentMode === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(data) });
    state.currentDetail = result.order;
    replaceOrder(result.order);
    renderDetail();
    $('#shipment-dialog').close();
    toast(state.shipmentMode === 'edit' ? '物流数据已更新' : '物流记录已创建，订单已发货');
  } catch (error) { toast(`发货失败：${error.message}`); }
  finally {
    $('#save-shipment').textContent = state.shipmentMode === 'edit' ? '保存物流修改' : '确认发货';
    setBusy(false);
  }
}

async function openAdminOrderEditor(orderId) {
  if (state.user?.role !== 'admin') return;
  try {
    let order = state.currentDetail?.id === orderId ? state.currentDetail : null;
    if (!order) order = (await api(`/api/orders/${encodeURIComponent(orderId)}`)).order;
    if (!state.members.length) await loadMembers();
    state.currentDetail = order;
    state.adminEditProducts = (order.products || []).map((item) => ({ ...item }));
    const form = $('#admin-order-form');
    form.reset();
    ['customerName', 'customerContact', 'shippingAddress', 'destination', 'deadline', 'paymentMethod', 'currency', 'freight', 'receivedCny', 'exchangeRate', 'note'].forEach((field) => {
      const value = order[field];
      if (form.elements[field]) form.elements[field].value = field === 'deadline' ? String(value || '').slice(0, 10) : (value ?? '');
    });
    $('#admin-order-title').textContent = `编辑 ${order.orderNo}`;
    form.elements.isCompleted.checked = Boolean(order.isCompleted);
    $('#admin-order-owner').innerHTML = state.members.map((member) => `<option value="${member.id}" ${member.id === order.ownerUserId ? 'selected' : ''}>${escapeHtml(member.name)} · ${escapeHtml(roleNames[member.role] || member.role)}</option>`).join('');
    renderAdminProductEditors();
    $('#admin-order-dialog').showModal();
  } catch (error) { toast(`无法打开编辑器：${error.message}`); }
}

function renderAdminProductEditors() {
  $('#admin-product-editors').innerHTML = state.adminEditProducts.map((product, index) => `<article class="admin-product-editor" data-admin-product-index="${index}">
    <div class="product-editor-head"><strong>产品 ${index + 1}${product.id ? '' : ' · 新增'}</strong>${state.adminEditProducts.length > 1 ? `<button type="button" class="remove-product" data-admin-remove-product="${index}">删除</button>` : ''}</div>
    <div class="admin-product-grid">
      ${adminProductInput(index, 'sku', '货号（选填）', product.sku, 'wide')}${adminProductInput(index, 'name', '名称 *', product.name, 'wide')}${adminProductInput(index, 'variant', '颜色 / 款式 *', product.variant, 'wide')}
      ${adminProductInput(index, 'unitsPerCarton', '装箱数', product.unitsPerCarton, '', 'number')}${adminProductInput(index, 'cartons', '箱数', product.cartons, '', 'number')}${adminProductInput(index, 'weight', '重量 kg', product.weight, '', 'number', '.001')}${adminProductInput(index, 'volume', '体积 m³', product.volume, '', 'number', '.0001')}${adminProductInput(index, 'quantity', '数量', product.quantity, '', 'number')}${adminProductInput(index, 'unitPrice', '单价', product.unitPrice, '', 'number', '.01')}
      ${adminProductInput(index, 'purchaseCost', '采购成本', product.purchaseCost, '', 'number', '.01')}
      <label><span>采购状态</span><select data-admin-product-index="${index}" data-admin-product-field="purchaseStatus"><option value="pending" ${product.purchaseStatus === 'pending' ? 'selected' : ''}>待采购</option><option value="completed" ${product.purchaseStatus === 'completed' ? 'selected' : ''}>已采购</option></select></label>
    </div></article>`).join('');
}

const adminProductInput = (index, field, label, value, className = '', type = 'text', step = '1') => `<label class="${className}"><span>${label}</span><input data-admin-product-index="${index}" data-admin-product-field="${field}" type="${type}" ${type === 'number' ? `min="0" step="${step}"` : ''} value="${escapeHtml(value ?? '')}" /></label>`;

async function saveAdminOrder(event) {
  event.preventDefault();
  if (state.busy || !state.currentDetail) return;
  const form = new FormData(event.currentTarget);
  const invalid = state.adminEditProducts.some((item) => !String(item.name).trim() || !String(item.variant).trim() || Number(item.quantity) <= 0);
  if (invalid) return toast('产品名称、款式和数量不能为空');
  const body = {
    customerName: form.get('customerName'), customerContact: form.get('customerContact') || null,
    shippingAddress: form.get('shippingAddress') || null, destination: form.get('destination') || null,
    deadline: form.get('deadline'), paymentMethod: form.get('paymentMethod'), currency: String(form.get('currency') || 'USD').toUpperCase(),
    freight: Number(form.get('freight') || 0), receivedCny: form.get('receivedCny') ? Number(form.get('receivedCny')) : null,
    exchangeRate: form.get('exchangeRate') ? Number(form.get('exchangeRate')) : null,
    isCompleted: form.get('isCompleted') === 'on', note: form.get('note') || null, ownerUserId: form.get('ownerUserId'),
    products: state.adminEditProducts.map((item) => ({
      ...(item.id ? { id: item.id } : {}), sku: item.sku, name: item.name, variant: item.variant,
      unitsPerCarton: Number(item.unitsPerCarton), cartons: Number(item.cartons), weight: Number(item.weight), volume: Number(item.volume),
      quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), purchaseCost: Number(item.purchaseCost), purchaseStatus: item.purchaseStatus || 'pending'
    }))
  };
  setBusy(true);
  try {
    const result = await api(`/api/orders/${state.currentDetail.id}`, { method: 'PUT', body: JSON.stringify(body) });
    state.currentDetail = result.order;
    replaceOrder(result.order);
    renderDetail();
    $('#admin-order-dialog').close();
    toast('订单及产品数据已更新');
  } catch (error) { toast(`保存失败：${error.message}`); }
  finally { setBusy(false); }
}

async function deleteAdminOrder(id) {
  const order = state.orders.find((item) => item.id === id) || state.currentDetail;
  if (!window.confirm(`确认删除订单 ${order?.orderNo || id}？该订单的产品、凭证关联、物流和历史记录也会删除。`)) return;
  try {
    await api(`/api/orders/${id}`, { method: 'DELETE' });
    state.orders = state.orders.filter((item) => item.id !== id);
    closeDetail();
    renderAll();
    toast('订单数据已删除');
  } catch (error) { toast(`删除失败：${error.message}`); }
}

async function deleteAdminShipment() {
  if (!state.currentDetail?.shipment || !window.confirm('确认删除该物流记录？订单将退回待发货状态。')) return;
  try {
    const result = await api(`/api/orders/${state.currentDetail.id}/shipment`, { method: 'DELETE' });
    state.currentDetail = result.order;
    replaceOrder(result.order);
    renderDetail();
    toast('物流记录已删除');
  } catch (error) { toast(`删除物流失败：${error.message}`); }
}

async function loadMembers() {
  if (state.user?.role !== 'admin') return;
  $('#members-body').innerHTML = '<tr><td colspan="6"><div class="loading-line"></div></td></tr>';
  try {
    const result = await api('/api/admin/users');
    state.members = result.items || result.users || [];
    renderMembers();
    if (result.sync?.ok === false) toast(`钉钉通讯录同步失败，当前显示本地数据：${result.sync.error}`);
  } catch (error) { $('#members-body').innerHTML = `<tr><td colspan="6">读取失败：${escapeHtml(error.message)}</td></tr>`; }
}

function renderMembers() {
  $('#members-body').innerHTML = state.members.map((member) => `<tr data-member-id="${member.id}">
    <td><div class="member-info"><div class="avatar">${escapeHtml((member.name || '·').slice(0,1))}</div><div><strong>${escapeHtml(member.name)}${member.isDingAdmin ?? member.is_ding_admin ? '<em class="ding-admin-mark">钉钉管理员</em>' : ''}</strong><span>${escapeHtml(member.title || member.mobile || '未填写职位')}</span></div></div></td>
    <td class="muted">${escapeHtml(member.dingUserId || member.ding_user_id || '—')}</td>
    <td><select class="role-select" data-member-role="${member.id}" ${member.id === state.user.id || (member.isDingAdmin ?? member.is_ding_admin) ? 'disabled' : ''}>${Object.entries(roleNames).map(([value, label]) => `<option value="${value}" ${member.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
    <td>${['sales', 'admin'].includes(member.role) ? `<input class="commission-input" data-member-commission="${member.id}" type="number" min="0" max="100" step="0.01" value="${Number(member.commissionRatePercent ?? member.commission_rate_percent ?? 0)}" aria-label="${escapeHtml(member.name)}提成比例" /> %` : '—'}</td>
    <td>${member.lastLoginAt || member.last_login_at ? escapeHtml(String(member.lastLoginAt || member.last_login_at).replace('T',' ').slice(0,16)) : '尚未登录'}</td>
    <td><button class="switch ${member.isActive ?? member.is_active ? 'on' : ''}" data-member-active="${member.id}" ${member.id === state.user.id ? 'disabled' : ''} aria-label="切换账号状态"></button></td>
  </tr>`).join('');
}

async function changeMemberRole(id, role) {
  try { await api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); toast('成员角色已更新'); await loadMembers(); }
  catch (error) { toast(`角色更新失败：${error.message}`); await loadMembers(); }
}

async function changeMemberCommission(id, commissionRatePercent) {
  try {
    await api(`/api/admin/users/${id}/commission`, {
      method: 'PATCH', body: JSON.stringify({ commissionRatePercent: Number(commissionRatePercent) })
    });
    toast('提成比例已更新');
  } catch (error) {
    toast(`提成比例更新失败：${error.message}`);
    await loadMembers();
  }
}

async function toggleMember(id) {
  const member = state.members.find((item) => item.id === id);
  if (!member) return;
  const active = Boolean(member.isActive ?? member.is_active);
  try { await api(`/api/admin/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) }); toast(!active ? '账号已启用' : '账号已停用'); await loadMembers(); }
  catch (error) { toast(`账号更新失败：${error.message}`); }
}

function bindEvents() {
  $('#auth-retry').addEventListener('click', authenticate);
  $('#logout-button').addEventListener('click', () => logout());
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-view-jump]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewJump)));
  $('#create-button').addEventListener('click', openCreate);
  $('#admin-create-order').addEventListener('click', openCreate);
  $('#refresh-button').addEventListener('click', loadOrders);
  $('#performance-month').addEventListener('change', (event) => {
    state.performanceMonth = event.target.value || currentMonth();
    loadPerformance();
  });
  $('#global-search').addEventListener('input', (event) => { state.search = event.target.value.trim(); renderOrders(); if (state.currentView === 'dashboard') switchView('orders'); });
  $('#order-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]'); if (!button) return;
    state.orderFilter = button.dataset.status;
    $$('#order-filters button').forEach((item) => item.classList.toggle('active', item === button));
    renderOrders();
  });
  document.addEventListener('click', (event) => {
    const adminEdit = event.target.closest('[data-admin-edit]');
    if (adminEdit) { event.stopPropagation(); openAdminOrderEditor(adminEdit.dataset.adminEdit); return; }
    const adminDelete = event.target.closest('[data-admin-delete]');
    if (adminDelete) { event.stopPropagation(); deleteAdminOrder(adminDelete.dataset.adminDelete); return; }
    const orderElement = event.target.closest('[data-order-id]');
    if (orderElement && !event.target.closest('[data-purchase-product]')) openDetail(orderElement.dataset.orderId);
    const close = event.target.closest('.modal-close'); if (close) { event.preventDefault(); close.closest('dialog').close(); }
    const remove = event.target.closest('[data-remove-file]');
    if (remove) {
      const [category, indexText] = remove.dataset.removeFile.split(':');
      const target = category === 'payment' ? state.paymentAttachments : state.shipmentAttachments;
      target.splice(Number(indexText), 1); category === 'payment' ? renderPaymentPreviews() : renderShipmentPreviews();
    }
  });
  $('#close-detail').addEventListener('click', closeDetail);
  $('#drawer-mask').addEventListener('click', closeDetail);
  $('#detail-drawer').addEventListener('click', (event) => {
    const product = event.target.closest('[data-purchase-product]'); if (product) completePurchase([product.dataset.purchaseProduct]);
    if (event.target.closest('[data-purchase-all]')) completePurchase();
    if (event.target.closest('[data-open-shipment]')) openShipment('create');
    if (event.target.closest('[data-admin-edit-detail]')) openAdminOrderEditor(state.currentDetail.id);
    if (event.target.closest('[data-admin-delete-detail]')) deleteAdminOrder(state.currentDetail.id);
    if (event.target.closest('[data-admin-edit-shipment]')) openShipment('edit');
    if (event.target.closest('[data-admin-delete-shipment]')) deleteAdminShipment();
  });
  $('#add-product').addEventListener('click', () => { state.productDrafts.push(emptyProduct()); renderProductEditors(); });
  $('#import-pi').addEventListener('click', () => $('#pi-file-input').click());
  $('#pi-file-input').addEventListener('change', (event) => importPiFile(event.target.files?.[0]));
  $('#product-editors').addEventListener('input', (event) => {
    const input = event.target.closest('[data-product-field]'); if (!input) return;
    state.productDrafts[Number(input.dataset.productIndex)][input.dataset.productField] = input.value;
  });
  $('#product-editors').addEventListener('change', (event) => {
    const input = event.target.closest('[data-product-files]'); if (input?.files?.length) uploadProductFiles(Number(input.dataset.productFiles), input.files);
  });
  $('#product-editors').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-product]'); if (!button) return;
    state.productDrafts.splice(Number(button.dataset.removeProduct), 1); renderProductEditors();
  });
  $('#payment-files').addEventListener('change', (event) => uploadAttachments(event.target.files, 'payment'));
  $('#shipment-files').addEventListener('change', (event) => uploadAttachments(event.target.files, 'logistics'));
  $('#create-form').addEventListener('submit', submitOrder);
  $('#shipment-form').addEventListener('submit', submitShipment);
  $('#admin-order-form').addEventListener('submit', saveAdminOrder);
  $('#admin-add-product').addEventListener('click', () => {
    state.adminEditProducts.push({ ...emptyProduct(), purchaseStatus: 'pending' });
    renderAdminProductEditors();
  });
  $('#admin-product-editors').addEventListener('input', (event) => {
    const input = event.target.closest('[data-admin-product-field]'); if (!input) return;
    state.adminEditProducts[Number(input.dataset.adminProductIndex)][input.dataset.adminProductField] = input.value;
  });
  $('#admin-product-editors').addEventListener('change', (event) => {
    const input = event.target.closest('[data-admin-product-field]'); if (!input) return;
    state.adminEditProducts[Number(input.dataset.adminProductIndex)][input.dataset.adminProductField] = input.value;
  });
  $('#admin-product-editors').addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-remove-product]'); if (!button) return;
    state.adminEditProducts.splice(Number(button.dataset.adminRemoveProduct), 1);
    renderAdminProductEditors();
  });
  $('#admin-refresh').addEventListener('click', loadMembers);
  $('#members-body').addEventListener('change', (event) => {
    const select = event.target.closest('[data-member-role]');
    if (select) changeMemberRole(select.dataset.memberRole, select.value);
    const commission = event.target.closest('[data-member-commission]');
    if (commission) changeMemberCommission(commission.dataset.memberCommission, commission.value);
  });
  $('#members-body').addEventListener('click', (event) => { const button = event.target.closest('[data-member-active]'); if (button) toggleMember(button.dataset.memberActive); });
}

bindEvents();
if (previewMode) {
  state.user = { id: 'preview-admin', name: '林航', role: 'admin', title: '外贸业务总监', avatarUrl: '' };
  state.rates = {
    monthStart: { date: '2026-08-03', rate: 6.7476 },
    today: { date: '2026-08-10', rate: 6.7439 }
  };
  state.performance = {
    month: '2026-08',
    summary: { orderCount: 3, receivedCny: 579480, profitCny: 142632, commissionCny: 4516.46, completedCommissionCny: 2680.20 },
    warnings: [],
    items: [
      { id: 'preview-1', orderNo: 'SO-260810-A1F92C', orderDate: '2026-08-10', customerName: 'Nordhavn Living', ownerName: '林航', currency: 'USD', orderAmount: 28640, receivedCny: 193420, convertedOrderAmountCny: 193174, productCost: 17800, freight: 1320, profitCny: 64433, commissionRatePercent: 3.2, commissionCny: 2061.86, freightForwarder: '宁波远洋', isCompleted: false },
      { id: 'preview-2', orderNo: 'SO-260809-8C70D4', orderDate: '2026-08-09', customerName: 'Maison Épure', ownerName: '周黎', currency: 'USD', orderAmount: 15820, receivedCny: 106860, convertedOrderAmountCny: 106704, productCost: 9600, freight: 880, profitCny: 36171, commissionRatePercent: 2.5, commissionCny: 904.28, freightForwarder: '海程国际', isCompleted: true },
      { id: 'preview-3', orderNo: 'SO-260805-3D8E11', orderDate: '2026-08-05', customerName: 'Atelier Form', ownerName: '林航', currency: 'USD', orderAmount: 42100, receivedCny: 279200, convertedOrderAmountCny: 284080, productCost: 26800, freight: 2300, profitCny: 42028, commissionRatePercent: 3.2, commissionCny: 1344.90, freightForwarder: '迅达货运', isCompleted: true }
    ]
  };
  state.leaderboardReport = {
    month: '2026-08',
    champion: { userId: 'preview-admin', name: '林航', title: '外贸业务总监', avatarUrl: '', rank: 1, orderCount: 4, salesCny: 476820, profitCny: 108640, commissionCny: 3476.48 },
    leaders: [
      { userId: 'preview-admin', name: '林航', title: '外贸业务总监', avatarUrl: '', rank: 1, orderCount: 4, salesCny: 476820, profitCny: 108640, commissionCny: 3476.48 },
      { userId: 'preview-sales-2', name: '周黎', title: '外贸业务员', avatarUrl: '', rank: 2, orderCount: 3, salesCny: 328460, profitCny: 74120, commissionCny: 1853 },
      { userId: 'preview-sales-3', name: '唐允', title: '外贸业务员', avatarUrl: '', rank: 3, orderCount: 2, salesCny: 186900, profitCny: 39540, commissionCny: 988.5 }
    ],
    me: { userId: 'preview-admin', name: '林航', title: '外贸业务总监', avatarUrl: '', rank: 1, orderCount: 4, salesCny: 476820, profitCny: 108640, commissionCny: 3476.48 }
  };
  state.orders = [
    { id: 'preview-1', orderNo: 'SO-260810-A1F92C', customerName: 'Nordhavn Living', destination: '丹麦', deadline: '2026-08-12', currency: 'USD', totalAmount: 28640, ownerName: '林航', status: 'purchasing', productCount: 3, productSummary: { sku: 'BLK-072', name: '云朵绒毯', variant: '奶油白' } },
    { id: 'preview-2', orderNo: 'SO-260809-8C70D4', customerName: 'Maison Épure', destination: '法国', deadline: '2026-08-14', currency: 'USD', totalAmount: 15820, ownerName: '周黎', status: 'purchased', productCount: 2, productSummary: { sku: 'CER-118', name: '手工陶瓷餐具', variant: '雾蓝釉' } },
    { id: 'preview-3', orderNo: 'SO-260805-3D8E11', customerName: 'Atelier Form', destination: '澳大利亚', deadline: '2026-08-20', currency: 'USD', totalAmount: 42100, ownerName: '林航', status: 'shipped', productCount: 4, productSummary: { sku: 'LMP-042', name: '纸艺吊灯', variant: '原木色' } },
    { id: 'preview-4', orderNo: 'SO-260810-F09A27', customerName: 'North & Pine', destination: '加拿大', deadline: '2026-08-11', currency: 'USD', totalAmount: 9340, ownerName: '唐允', status: 'pending_purchase', productCount: 1, productSummary: { sku: 'BAG-220', name: '帆布旅行包', variant: '橄榄绿' } }
  ];
  enterApp();
  renderExchangeRates();
} else {
  authenticate();
}
