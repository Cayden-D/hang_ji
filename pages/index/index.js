const api = require('../../utils/api');

const emptyProduct = () => ({
  images: [],
  sku: '',
  name: '',
  variant: '',
  unitsPerCarton: '',
  cartons: '',
  weight: '',
  volume: '',
  quantity: '',
  unitPrice: '',
  totalPrice: '0.00',
  purchaseCost: ''
});

const dateOnly = (value) => value ? String(value).slice(0, 10) : '';
const todayString = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
};
const displayDate = (value) => {
  const date = dateOnly(value);
  if (!date) return '待确认';
  const parts = date.split('-');
  return Number(parts[1]) + '月' + Number(parts[2]) + '日';
};
const numberText = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const currentMonthString = () => todayString().slice(0, 7);
const shiftMonth = (month, delta) => {
  const parts = String(month).split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1 + delta, 1);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
};

const statusView = (apiStatus) => {
  const views = {
    pending_purchase: { status: 'purchasing', statusText: '待采购', progress: 25, activeStep: 1, steps: ['已确认', '待采购', '待发货', '运输中'] },
    purchasing: { status: 'purchasing', statusText: '采购中', progress: 50, activeStep: 1, steps: ['已确认', '采购中', '待发货', '运输中'] },
    purchased: { status: 'ready', statusText: '待发货', progress: 75, activeStep: 2, steps: ['已确认', '已采购', '待发货', '运输中'] },
    shipped: { status: 'shipped', statusText: '已发货', progress: 100, activeStep: 3, steps: ['已确认', '已采购', '已发货', '运输中'] },
    cancelled: { status: 'cancelled', statusText: '已取消', progress: 0, activeStep: 0, steps: ['已取消', '—', '—', '—'] }
  };
  return views[apiStatus] || views.pending_purchase;
};

const mapOrder = (source) => {
  const view = statusView(source.status);
  const products = source.products || [];
  const first = source.productSummary || products[0] || {};
  const productCount = source.productCount || products.length;
  const summary = first.name
    ? first.name + (first.variant ? ' / ' + first.variant : '') + (productCount > 1 ? ' 等 ' + productCount + ' 款' : '')
    : '暂无产品明细';
  const deadlineValue = dateOnly(source.deadline);
  const daysLeft = deadlineValue ? Math.ceil((new Date(deadlineValue + 'T00:00:00').getTime() - Date.now()) / 86400000) : 999;
  return Object.assign({}, source, view, {
    apiStatus: source.status,
    orderNo: source.orderNo || source.id,
    customer: source.customerName || '',
    country: source.destination || '目的地待补充',
    product: summary,
    sku: first.sku || '',
    thumb: (first.sku || 'PR').slice(0, 2).toUpperCase(),
    quantity: source.totalQuantity || products.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    amount: numberText(source.totalAmount),
    deadline: displayDate(source.deadline),
    deadlineValue,
    daysLeft,
    owner: source.ownerName || '我',
    note: source.note || (source.shipment ? '运单：' + source.shipment.trackingNo : '暂无补充说明'),
    products,
    productCount
  });
};

Page({
  data: {
    currentTab: 'home',
    role: 'sales',
    roleLabel: '业务视角',
    showRoleMenu: false,
    showCreate: false,
    showDetail: false,
    detail: {},
    detailLoading: false,
    purchaseTotalDraft: '',
    filter: 'all',
    searchValue: '',
    orders: [],
    dateFilteredOrders: null,
    orderDateFrom: '',
    orderDateTo: '',
    dateFilterLoading: false,
    visibleOrders: [],
    taskOrders: [],
    urgentOrder: null,
    loading: true,
    submitting: false,
    uploading: false,
    importingPi: false,
    apiError: '',
    exchangeRates: null,
    exchangeRateError: '',
    performanceMonth: currentMonthString(),
    performanceLoading: false,
    performanceWarning: '',
    performanceRateText: '美元金额统一按当月 1 日汇率折算',
    performanceItems: [],
    performanceSummary: { orderCount: 0, orderAmount: '0.00', receivedCny: '0.00', profitCny: '0.00', commissionCny: '0.00' },
    leaderboardLoading: false,
    leaderboard: [],
    monthlyChampion: null,
    myMonthlyPerformance: null,
    showShipment: false,
    showUserAdmin: false,
    userAdminLoading: false,
    adminUsers: [],
    showExpenses: false,
    showExpenseCreate: false,
    expensesLoading: false,
    expenses: [],
    expenseForm: {
      category: 'travel', categoryText: '差旅费', amount: '', currency: 'CNY', incurredOn: todayString(),
      description: '', attachments: []
    },
    expenseDecisionComment: '',
    shipmentOrderId: '',
    toast: '',
    currentUser: {
      name: '正在获取用户信息',
      initial: '…',
      avatarUrl: '',
      role: 'sales',
      roleText: '业务员',
      title: '',
      subtitle: '钉钉免登中',
      mobile: '',
      email: '',
      orgEmail: '',
      jobNumber: '',
      workPlace: '',
      dingUserId: '',
      dingRoles: [],
      dingRoleText: '未配置通讯录角色',
      identityText: '普通成员'
    },
    stats: { urgent: 0, purchasing: 0, ready: 0, shipped: 0 },
    form: {
      customer: '', customerContact: '', shippingAddress: '', country: '', deadline: '', payment: 'T/T',
      freight: '', receivedCny: '', note: '', paymentAttachments: [], products: [emptyProduct()]
    },
    shippingForm: {
      logisticsCompany: '', trackingNo: '', shippedOn: '', estimatedArrivalOn: '', note: '', attachments: []
    }
  },

  onLoad() {
    this._hasShown = false;
    this.syncCurrentUser();
    this.loadOrders();
    this.loadExchangeRates();
    this.loadLeaderboard();
  },

  onShow() {
    this.syncCurrentUser();
    if (this._hasShown) this.refreshRemoteData();
    this._hasShown = true;
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  onPullDownRefresh() {
    this.refreshRemoteData().then(() => {
      if (typeof dd !== 'undefined' && dd.stopPullDownRefresh) dd.stopPullDownRefresh();
    });
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      if (!this.data.submitting && !this.data.uploading && !this.data.importingPi) {
        this.refreshRemoteData();
      }
    }, 30000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  refreshRemoteData() {
    if (this._refreshing) return this._refreshing;
    const tasks = [
      this.loadOrders({ silent: true }),
      this.loadExchangeRates(),
      this.loadLeaderboard()
    ];
    if (this.data.orderDateFrom || this.data.orderDateTo) tasks.push(this.loadDateFilteredOrders());
    if (this.data.currentTab === 'performance') tasks.push(this.loadPerformance());
    this._refreshing = Promise.all(tasks).then(() => {
      this._refreshing = null;
    }, (error) => {
      console.error('自动刷新数据失败', error);
      this._refreshing = null;
    });
    return this._refreshing;
  },

  syncCurrentUser() {
    const app = getApp();
    if (app.globalData.currentUser) {
      this.applyCurrentUser(app.globalData.currentUser);
      return;
    }
    if (app.loginPromise) {
      app.loginPromise.then((result) => {
        if (result && result.user) this.applyCurrentUser(result.user);
        else if (app.globalData.loginError) {
          this.setData({ 'currentUser.name': '用户信息加载失败', 'currentUser.subtitle': app.globalData.loginError });
        }
      });
    }
  },

  waitForLogin() {
    const app = getApp();
    if (app.globalData.sessionToken) return Promise.resolve(true);
    if (!app.loginPromise) return Promise.resolve(false);
    return app.loginPromise.then((result) => Boolean(result && result.token));
  },

  async loadOrders(options) {
    const silent = Boolean(options && options.silent);
    if (!silent) this.setData({ loading: true, apiError: '' });
    try {
      const loggedIn = await this.waitForLogin();
      if (!loggedIn) throw new Error(getApp().globalData.loginError || '免登尚未完成');
      const result = await api.orders.list();
      const orders = (result.items || []).map(mapOrder);
      this.setData({ orders, loading: false, apiError: '' });
      this.rebuildDerivedData();
    } catch (error) {
      console.error('加载订单失败', error);
      if (!silent) {
        this.setData({ loading: false, apiError: error.message, orders: [], visibleOrders: [], taskOrders: [] });
        this.showToast('订单加载失败：' + error.message);
      }
    }
  },

  rebuildDerivedData() {
    const orders = this.data.orders;
    const urgentOrders = orders
      .filter((item) => item.apiStatus !== 'shipped' && item.apiStatus !== 'cancelled' && item.daysLeft <= 3)
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const stats = {
      urgent: urgentOrders.length,
      purchasing: orders.filter((item) => ['pending_purchase', 'purchasing'].includes(item.apiStatus)).length,
      ready: orders.filter((item) => item.apiStatus === 'purchased').length,
      shipped: orders.filter((item) => item.apiStatus === 'shipped').length
    };
    this.setData({ stats, urgentOrder: urgentOrders[0] || null });
    this.refreshVisible();
    this.refreshTaskOrders();
  },

  refreshTaskOrders(roleOverride) {
    const role = roleOverride || this.data.role;
    let taskOrders = [];
    if (role === 'purchase') taskOrders = this.data.orders.filter((item) => ['pending_purchase', 'purchasing'].includes(item.apiStatus));
    else if (role === 'logistics') taskOrders = this.data.orders.filter((item) => item.apiStatus === 'purchased');
    else if (this.data.currentUser.role === 'admin') taskOrders = this.data.orders.filter((item) => item.apiStatus !== 'shipped' && item.apiStatus !== 'cancelled');
    this.setData({ taskOrders });
  },

  applyCurrentUser(user) {
    const roleNames = { sales: '业务员', purchase: '采购员', logistics: '物流人员', admin: '外贸经理' };
    const roleText = roleNames[user.role] || '企业成员';
    const dingRoles = Array.isArray(user.dingRoles) ? user.dingRoles : [];
    const dingRoleText = dingRoles.length
      ? dingRoles.map((item) => item.groupName ? item.groupName + ' · ' + item.name : item.name).join('、')
      : '未配置通讯录角色';
    const identities = [];
    if (user.isBoss) identities.push('企业老板');
    if (user.isDingAdmin) identities.push('超级管理员');
    if (user.isSenior) identities.push('企业高管');
    if (user.isLeader) identities.push('部门负责人');
    const identityText = identities.length ? identities.join('、') : '普通成员';
    const subtitle = [user.title, dingRoles.length ? dingRoles.map((item) => item.name).join('、') : ''].filter(Boolean).join(' · ');
    const activeRole = user.role === 'admin' ? 'sales' : user.role;
    this.setData({
      currentUser: Object.assign({}, user, {
        initial: (user.name || '钉').slice(0, 1),
        roleText,
        dingRoleText,
        identityText,
        subtitle: subtitle || roleText
      }),
      role: activeRole,
      roleLabel: user.role === 'admin' ? '外贸经理视角' : (roleText + '视角')
    }, () => this.refreshTaskOrders(activeRole));
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, showRoleMenu: false });
    if (tab === 'orders') this.refreshVisible();
    if (tab === 'performance') this.loadPerformance();
  },

  async loadExchangeRates() {
    try {
      const loggedIn = await this.waitForLogin();
      if (!loggedIn) return;
      const result = await api.exchangeRates.usdCny();
      const rates = result.rates || {};
      const first = Number(rates.monthStart && rates.monthStart.rate || 0);
      const latest = Number(rates.today && rates.today.rate || 0);
      this.setData({
        exchangeRates: {
          monthFirst: first.toFixed(4),
          monthFirstDate: rates.monthStart && rates.monthStart.date,
          latest: latest.toFixed(4),
          latestDate: rates.today && rates.today.date,
          changePercent: first ? (((latest - first) / first) * 100).toFixed(2) : '0.00',
          isUp: latest >= first
        },
        exchangeRateError: ''
      });
    } catch (error) {
      console.error('加载汇率失败', error);
      this.setData({ exchangeRateError: error.message });
    }
  },

  async loadPerformance() {
    if (!['sales', 'admin'].includes(this.data.currentUser.role)) return;
    this.setData({ performanceLoading: true, performanceWarning: '' });
    try {
      const result = await api.performance.monthly(this.data.performanceMonth);
      const items = (result.items || []).map((item) => ({
        ...item,
        orderAmountText: Number(item.orderAmount || 0).toFixed(2),
        receivedCnyText: item.revenueCny === null ? '待录入' : Number(item.revenueCny || 0).toFixed(2),
        productCostText: Number(item.productCost || 0).toFixed(2),
        freightText: Number(item.freight || 0).toFixed(2),
        profitCnyText: item.profitCny === null ? '待汇率' : Number(item.profitCny || 0).toFixed(2),
        commissionCnyText: item.commissionCny === null ? '待汇率' : Number(item.commissionCny || 0).toFixed(2),
        profitClass: Number(item.profitCny || 0) < 0 ? 'negative' : 'positive'
      }));
      const summary = result.summary || {};
      this.setData({
        performanceItems: items,
        performanceSummary: {
          orderCount: summary.orderCount || 0,
          orderAmount: Number(summary.orderAmount || 0).toFixed(2),
          receivedCny: Number(summary.receivedCny || 0).toFixed(2),
          profitCny: Number(summary.profitCny || 0).toFixed(2),
          commissionCny: Number(summary.commissionCny || 0).toFixed(2)
        },
        performanceWarning: (result.warnings || []).join('；'),
        performanceRateText: result.exchangeRate
          ? result.exchangeRate.date + ' · USD/CNY ' + Number(result.exchangeRate.rate).toFixed(4)
          : '美元金额统一按当月 1 日汇率折算',
        performanceLoading: false
      });
    } catch (error) {
      console.error('加载月度业绩失败', error);
      this.setData({ performanceLoading: false, performanceWarning: error.message, performanceItems: [] });
    }
  },

  async loadLeaderboard() {
    this.setData({ leaderboardLoading: true });
    try {
      const loggedIn = await this.waitForLogin();
      if (!loggedIn) return this.setData({ leaderboardLoading: false });
      const result = await api.performance.leaderboard(currentMonthString());
      const format = (item) => item ? Object.assign({}, item, {
        initial: (item.name || '航').slice(0, 1),
        salesCnyText: Number(item.salesCny || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        profitCnyText: Number(item.profitCny || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
        commissionCnyText: Number(item.commissionCny || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }) : null;
      this.setData({
        leaderboard: (result.leaders || []).map(format),
        monthlyChampion: format(result.champion),
        myMonthlyPerformance: format(result.me),
        leaderboardLoading: false
      });
    } catch (error) {
      console.error('加载业绩排行榜失败', error);
      this.setData({ leaderboardLoading: false });
    }
  },

  changePerformanceMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const month = shiftMonth(this.data.performanceMonth, delta);
    if (month > currentMonthString()) return;
    this.setData({ performanceMonth: month }, () => this.loadPerformance());
  },

  toggleRoleMenu() {
    if (this.data.currentUser.role !== 'admin') return;
    this.setData({ showRoleMenu: !this.data.showRoleMenu });
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role;
    if (this.data.currentUser.role !== 'admin' && role !== this.data.currentUser.role) return;
    const labels = { sales: '业务视角', purchase: '采购视角', logistics: '物流视角' };
    const tab = role === 'sales' ? 'home' : 'tasks';
    this.setData({ role, roleLabel: labels[role], showRoleMenu: false, currentTab: tab });
    this.refreshTaskOrders(role);
    this.showToast('已切换至' + labels[role]);
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.filter });
    this.refreshVisible();
  },

  setOrderDateFrom(e) {
    this.setData({ orderDateFrom: e.detail.value }, () => this.loadDateFilteredOrders());
  },

  setOrderDateTo(e) {
    this.setData({ orderDateTo: e.detail.value }, () => this.loadDateFilteredOrders());
  },

  async loadDateFilteredOrders() {
    const { orderDateFrom, orderDateTo } = this.data;
    if (orderDateFrom && orderDateTo && orderDateTo < orderDateFrom) {
      this.showToast('结束日期不能早于开始日期');
      return;
    }
    if (!orderDateFrom && !orderDateTo) {
      this.setData({ dateFilteredOrders: null, dateFilterLoading: false });
      this.refreshVisible();
      return;
    }
    this.setData({ dateFilterLoading: true });
    try {
      const result = await api.orders.list({ dateFrom: orderDateFrom, dateTo: orderDateTo });
      this.setData({ dateFilteredOrders: (result.items || []).map(mapOrder), dateFilterLoading: false });
      this.refreshVisible();
    } catch (error) {
      this.setData({ dateFilterLoading: false });
      this.showToast('日期筛选失败：' + error.message);
    }
  },

  clearOrderDateFilter() {
    this.setData({ orderDateFrom: '', orderDateTo: '', dateFilteredOrders: null, dateFilterLoading: false });
    this.refreshVisible();
  },

  onSearch(e) {
    this.setData({ searchValue: e.detail.value });
    this.refreshVisible();
  },

  refreshVisible() {
    const filter = this.data.filter;
    const keyword = (this.data.searchValue || '').toLowerCase();
    const source = this.data.dateFilteredOrders === null ? this.data.orders : this.data.dateFilteredOrders;
    const list = source.filter((item) => {
      const matchesFilter = filter === 'all' || item.status === filter;
      const haystack = (item.id + item.customer + item.product + item.sku).toLowerCase();
      return matchesFilter && (!keyword || haystack.indexOf(keyword) > -1);
    });
    this.setData({ visibleOrders: list });
  },

  openCreate() {
    if (!['sales', 'admin'].includes(this.data.currentUser.role)) {
      this.showToast('当前角色不能创建出货单');
      return;
    }
    this.setData({ showCreate: true });
  },

  closeCreate() {
    this.setData({ showCreate: false });
  },

  stopBubble() {},

  updateForm(e) {
    const field = e.currentTarget.dataset.field;
    const key = 'form.' + field;
    this.setData({ [key]: e.detail.value });
  },

  choosePayment() {
    const values = ['T/T', 'L/C', 'D/P', 'D/A', '信保全款', 'OTHER'];
    const next = (values.indexOf(this.data.form.payment) + 1) % values.length;
    this.setData({ 'form.payment': values[next] });
  },

  addProduct() {
    const products = this.data.form.products.concat([emptyProduct()]);
    this.setData({ 'form.products': products });
  },

  removeProduct(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.form.products.length === 1) {
      this.showToast('订单至少保留一个产品');
      return;
    }
    const products = this.data.form.products.filter((item, idx) => idx !== index);
    this.setData({ 'form.products': products });
  },

  updateProductField(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const products = this.data.form.products.slice();
    products[index][field] = e.detail.value;
    if (field === 'quantity' || field === 'unitPrice') {
      const quantity = Number(products[index].quantity || 0);
      const unitPrice = Number(products[index].unitPrice || 0);
      products[index].totalPrice = (quantity * unitPrice).toFixed(2);
    }
    this.setData({ 'form.products': products });
  },

  importPi() {
    if (this.data.importingPi) return;
    if (typeof dd === 'undefined' || !dd.chooseFile || !dd.uploadFile) {
      this.showToast('当前钉钉版本不支持选择 Excel，请在 PC 端管理页面导入');
      return;
    }
    dd.chooseFile({
      count: 1,
      extension: ['xlsx'],
      success: async (result) => {
        const files = result.tempFiles || result.files || [];
        const paths = result.apFilePaths || result.tempFilePaths || result.filePaths || [];
        const selected = files[0] || {};
        const filePath = selected.path || selected.tempFilePath || paths[0];
        const fileName = selected.name || result.fileName || 'PI.xlsx';
        if (!filePath) return this.showToast('没有取得所选文件的本地路径');
        this.setData({ importingPi: true });
        try {
          const response = await api.uploadPi(filePath, fileName);
          const imported = response.imported;
          const products = imported.products.map((item) => Object.assign(emptyProduct(), item, {
            totalPrice: (Number(item.quantity || 0) * Number(item.unitPrice || 0)).toFixed(2)
          }));
          const update = { 'form.products': products };
          if (imported.customerName) update['form.customer'] = imported.customerName;
          if (imported.quotationDate && !this.data.form.note) {
            update['form.note'] = 'PI 报价日期：' + imported.quotationDate + '；来源文件：' + imported.fileName;
          }
          this.setData(update);
          this.showToast('已导入 ' + products.length + ' 款产品' + (imported.warnings && imported.warnings.length ? '，请补充缺少字段' : ''));
        } catch (error) {
          console.error('PI 导入失败', error);
          this.showToast('PI 导入失败：' + error.message);
        } finally {
          this.setData({ importingPi: false });
        }
      },
      fail: (error) => {
        if (!/cancel/i.test(error.errorMessage || error.errMsg || '')) this.showToast('选择 PI 文件失败');
      }
    });
  },

  chooseAndUploadImages({ remaining, category, onComplete }) {
    if (this.data.uploading) {
      this.showToast('图片正在上传，请稍候');
      return;
    }
    if (remaining <= 0) {
      this.showToast('最多上传 9 张图片');
      return;
    }
    if (typeof dd === 'undefined' || !dd.chooseImage || !dd.uploadFile) {
      this.showToast('当前钉钉版本不支持图片选择或上传');
      return;
    }
    dd.chooseImage({
      count: remaining,
      sourceType: ['camera', 'album'],
      success: async (result) => {
        const paths = result.apFilePaths || result.tempFilePaths || result.filePaths || [];
        if (!paths.length) return;
        this.setData({ uploading: true });
        const attachments = [];
        try {
          for (const filePath of paths.slice(0, remaining)) {
            attachments.push(await api.uploadImage(filePath, category));
          }
          onComplete(attachments);
          this.showToast('已上传 ' + attachments.length + ' 张图片到 OSS');
        } catch (error) {
          console.error('OSS 图片上传失败', error);
          if (attachments.length) onComplete(attachments);
          this.showToast((attachments.length ? '部分图片已上传，' : '') + '上传失败：' + error.message);
        } finally {
          this.setData({ uploading: false });
        }
      },
      fail: (error) => {
        if (!/cancel/i.test(error.errorMessage || error.errMsg || '')) {
          console.error('选择图片失败', error);
          this.showToast('选择图片失败');
        }
      }
    });
  },

  uploadProductImages(e) {
    const productIndex = Number(e.currentTarget.dataset.index);
    const currentImages = this.data.form.products[productIndex].images || [];
    const remaining = 9 - currentImages.length;
    this.chooseAndUploadImages({
      remaining,
      category: 'product',
      onComplete: (attachments) => {
      const products = this.data.form.products.slice();
      products[productIndex].images = currentImages.concat(attachments).slice(0, 9);
      this.setData({ 'form.products': products });
      }
    });
  },

  removeProductImage(e) {
    const productIndex = Number(e.currentTarget.dataset.productIndex);
    const imageIndex = Number(e.currentTarget.dataset.imageIndex);
    const products = this.data.form.products.slice();
    products[productIndex].images = products[productIndex].images.filter((item, idx) => idx !== imageIndex);
    this.setData({ 'form.products': products });
    this.showToast('已移除订单中的附件引用');
  },

  uploadPaymentAttachments() {
    const current = this.data.form.paymentAttachments || [];
    const remaining = 9 - current.length;
    this.chooseAndUploadImages({
      remaining,
      category: 'payment',
      onComplete: (attachments) => {
        this.setData({ 'form.paymentAttachments': current.concat(attachments).slice(0, 9) });
      }
    });
  },

  removePaymentAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      'form.paymentAttachments': this.data.form.paymentAttachments.filter((item, idx) => idx !== index)
    });
  },

  async createOrder() {
    if (this.data.uploading || this.data.importingPi) {
      this.showToast('请等待文件处理完成');
      return;
    }
    const f = this.data.form;
    const invalidProduct = f.products.some((item) => !item.name || !item.variant || !item.quantity);
    if (!f.customer || invalidProduct) {
      this.showToast('请填写客户及每条产品的名称、款式和数量');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deadline)) {
      this.showToast('最晚出货日请填写为 YYYY-MM-DD');
      return;
    }
    const products = f.products.map((item) => Object.assign({}, item, {
      unitsPerCarton: Number(item.unitsPerCarton || 0),
      cartons: Number(item.cartons || 0),
      weight: Number(item.weight || 0),
      volume: Number(item.volume || 0),
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      purchaseCost: Number(item.purchaseCost || 0)
    }));
    this.setData({ submitting: true });
    try {
      const result = await api.orders.create({
        customerName: f.customer,
        customerContact: f.customerContact || null,
        shippingAddress: f.shippingAddress || null,
        destination: f.country || null,
        deadline: f.deadline,
        paymentMethod: f.payment,
        currency: 'USD',
        freight: Number(f.freight || 0),
        receivedCny: f.receivedCny === '' ? null : Number(f.receivedCny),
        note: f.note || null,
        products,
        paymentAttachments: f.paymentAttachments || []
      });
      const order = mapOrder(result.order);
      this.setData({
        orders: [order].concat(this.data.orders.filter((item) => item.id !== order.id)),
        showCreate: false,
        currentTab: 'orders',
        filter: 'all',
        submitting: false,
        form: { customer: '', customerContact: '', shippingAddress: '', country: '', deadline: '', payment: 'T/T', freight: '', receivedCny: '', note: '', paymentAttachments: [], products: [emptyProduct()] }
      });
      this.rebuildDerivedData();
      if (this.data.orderDateFrom || this.data.orderDateTo) this.loadDateFilteredOrders();
      this.loadLeaderboard();
      this.showToast('订单已创建，采购待办已同步');
    } catch (error) {
      console.error('创建订单失败', error);
      this.setData({ submitting: false });
      this.showToast('创建失败：' + error.message);
    }
  },

  async openDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ showDetail: true, detailLoading: true, detail: this.data.orders.find((item) => item.id === id) || {}, purchaseTotalDraft: '' });
    try {
      const result = await api.orders.detail(id);
      this.setData({
        detail: mapOrder(result.order),
        detailLoading: false,
        purchaseTotalDraft: result.order.purchaseTotal === null || result.order.purchaseTotal === undefined
          ? ''
          : String(result.order.purchaseTotal)
      });
    } catch (error) {
      console.error('加载订单详情失败', error);
      this.setData({ detailLoading: false, showDetail: false });
      this.showToast('详情加载失败：' + error.message);
    }
  },

  closeDetail() {
    this.setData({ showDetail: false });
  },

  async advanceOrder(e) {
    const id = e.currentTarget.dataset.id;
    const order = this.data.showDetail && this.data.detail.id === id
      ? this.data.detail
      : (this.data.orders.find((item) => item.id === id) || this.data.detail);
    if (!order) return;
    if (order.apiStatus === 'purchased') {
      this.openShipment(order);
      return;
    }
    if (!['pending_purchase', 'purchasing'].includes(order.apiStatus)) return;
    if (!this.data.showDetail) {
      this.openDetail(e);
      this.showToast('请填写整单采购总成本');
      return;
    }
    const totalValue = this.data.purchaseTotalDraft;
    if (totalValue === '' || totalValue === null || totalValue === undefined) {
      this.showToast('请填写整单采购总成本');
      return;
    }
    const purchaseTotal = Number(totalValue);
    if (!isFinite(purchaseTotal) || purchaseTotal < 0) {
      this.showToast('整单采购总成本必须是大于或等于 0 的数字');
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await api.orders.completePurchase(id, null, null, purchaseTotal);
      this.replaceOrder(mapOrder(result.order));
      this.setData({ submitting: false, showDetail: false });
      this.showToast('整单采购总成本已保存，订单已同步至物流');
    } catch (error) {
      console.error('采购确认失败', error);
      this.setData({ submitting: false });
      this.showToast('采购确认失败：' + error.message);
    }
  },

  updatePurchaseCost(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ ['detail.products[' + index + '].purchaseCost']: e.detail.value });
  },

  updatePurchaseTotal(e) {
    this.setData({ purchaseTotalDraft: e.detail.value });
  },

  async completeProductPurchase(e) {
    const orderId = e.currentTarget.dataset.orderId;
    const productId = e.currentTarget.dataset.productId;
    const product = (this.data.detail.products || []).find((item) => item.id === productId);
    if (!orderId || !productId || !product || this.data.submitting) return;
    if (product.purchaseCost === '' || product.purchaseCost === null || product.purchaseCost === undefined) {
      this.showToast('请填写该产品的实际采购成本');
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await api.orders.completePurchase(orderId, null, [{
        id: productId,
        purchaseCost: Number(product.purchaseCost)
      }]);
      const order = mapOrder(result.order);
      this.replaceOrder(order);
      this.setData({ detail: order, submitting: false });
      this.showToast('采购成本已保存，该产品已确认采购');
    } catch (error) {
      console.error('单品采购确认失败', error);
      this.setData({ submitting: false });
      this.showToast('确认失败：' + error.message);
    }
  },

  replaceOrder(order) {
    const orders = this.data.orders.map((item) => item.id === order.id ? order : item);
    if (!orders.some((item) => item.id === order.id)) orders.unshift(order);
    this.setData({ orders, detail: order });
    this.rebuildDerivedData();
  },

  openShipment(order) {
    this.setData({
      showDetail: false,
      showShipment: true,
      shipmentOrderId: order.id,
      shippingForm: {
        logisticsCompany: '',
        trackingNo: '',
        shippedOn: todayString(),
        estimatedArrivalOn: '',
        note: '',
        attachments: []
      }
    });
  },

  closeShipment() {
    if (!this.data.submitting) this.setData({ showShipment: false });
  },

  updateShippingForm(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['shippingForm.' + field]: e.detail.value });
  },

  uploadShipmentAttachments() {
    const current = this.data.shippingForm.attachments || [];
    const remaining = 9 - current.length;
    if (remaining <= 0) {
      this.showToast('物流凭证最多 9 个');
      return;
    }
    this.chooseAndUploadImages({
      remaining,
      category: 'logistics',
      onComplete: (attachments) => {
        this.setData({ 'shippingForm.attachments': current.concat(attachments).slice(0, 9) });
      }
    });
  },

  removeShipmentAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      'shippingForm.attachments': this.data.shippingForm.attachments.filter((item, idx) => idx !== index)
    });
  },

  async submitShipment() {
    if (this.data.uploading) {
      this.showToast('请等待图片上传完成');
      return;
    }
    const form = this.data.shippingForm;
    if (!form.logisticsCompany || !form.trackingNo || !/^\d{4}-\d{2}-\d{2}$/.test(form.shippedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(form.estimatedArrivalOn)) {
      this.showToast('请完整填写物流公司、单号和日期');
      return;
    }
    if (form.estimatedArrivalOn < form.shippedOn) {
      this.showToast('预计到达日期不能早于发货日期');
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await api.orders.createShipment(this.data.shipmentOrderId, form);
      this.replaceOrder(mapOrder(result.order));
      this.setData({ submitting: false, showShipment: false });
      this.showToast('发货完成，业务员将收到通知');
    } catch (error) {
      console.error('提交发货失败', error);
      this.setData({ submitting: false });
      this.showToast('发货失败：' + error.message);
    }
  },

  async openUserAdmin() {
    if (!this.data.currentUser.isDingAdmin) return;
    this.setData({ showUserAdmin: true, userAdminLoading: true });
    try {
      const result = await api.adminUsers.list();
      const roleNames = { sales: '业务员', purchase: '采购员', logistics: '物流人员', admin: '外贸经理' };
      const users = (result.items || []).map((item) => Object.assign({}, item, {
        roleText: roleNames[item.role] || item.role,
        initial: (item.name || '钉').slice(0, 1),
        isActive: Boolean(item.is_active),
        commissionRatePercent: Number(
          item.commissionRatePercent !== undefined && item.commissionRatePercent !== null
            ? item.commissionRatePercent
            : (item.commission_rate_percent !== undefined && item.commission_rate_percent !== null
              ? item.commission_rate_percent
              : 0)
        )
      }));
      this.setData({ adminUsers: users, userAdminLoading: false });
    } catch (error) {
      this.setData({ userAdminLoading: false, showUserAdmin: false });
      this.showToast('用户列表加载失败：' + error.message);
    }
  },

  closeUserAdmin() {
    if (!this.data.submitting) this.setData({ showUserAdmin: false });
  },

  async cycleUserRole(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.currentUser.id) {
      this.showToast('不能修改自己的外贸经理角色');
      return;
    }
    const user = this.data.adminUsers.find((item) => item.id === id);
    if (!user) return;
    const roles = ['sales', 'purchase', 'logistics', 'admin'];
    const nextRole = roles[(roles.indexOf(user.role) + 1) % roles.length];
    try {
      await api.adminUsers.setRole(id, nextRole);
      await this.openUserAdmin();
      this.showToast('成员角色已更新');
    } catch (error) {
      this.showToast('角色更新失败：' + error.message);
    }
  },

  async toggleUserActive(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.currentUser.id) {
      this.showToast('不能停用当前账号');
      return;
    }
    const user = this.data.adminUsers.find((item) => item.id === id);
    if (!user) return;
    try {
      await api.adminUsers.setActive(id, !user.isActive);
      await this.openUserAdmin();
      this.showToast(user.isActive ? '成员已停用' : '成员已启用');
    } catch (error) {
      this.showToast('状态更新失败：' + error.message);
    }
  },

  async changeUserCommission(e) {
    const id = e.currentTarget.dataset.id;
    const current = Number(e.currentTarget.dataset.current || 0);
    const value = Number(e.detail.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      this.showToast('提成比例需在 0% 到 100% 之间');
      await this.openUserAdmin();
      return;
    }
    if (value === current) return;
    try {
      await api.adminUsers.setCommission(id, value);
      const users = this.data.adminUsers.map((item) => item.id === id
        ? Object.assign({}, item, { commissionRatePercent: value }) : item);
      this.setData({ adminUsers: users });
      this.showToast('提成比例已更新');
    } catch (error) {
      this.showToast('提成比例更新失败：' + error.message);
      await this.openUserAdmin();
    }
  },

  async openExpenses() {
    this.setData({ showExpenses: true, expensesLoading: true, showExpenseCreate: false });
    try {
      const result = await api.expenses.list();
      const categoryNames = { travel: '差旅费', transport: '交通费', meals: '餐饮费', office: '办公费', freight: '物流费', client: '客户招待', other: '其他' };
      const statusNames = { pending: '待审批', approved: '已通过', rejected: '已驳回' };
      const expenses = (result.items || []).map((item) => Object.assign({}, item, {
        categoryText: categoryNames[item.category] || item.category,
        statusText: statusNames[item.status] || item.status,
        amountText: Number(item.amount || 0).toFixed(2),
        createdDate: dateOnly(item.createdAt),
        applicantInitial: (item.applicantName || '报').slice(0, 1)
      }));
      this.setData({ expenses, expensesLoading: false });
    } catch (error) {
      this.setData({ expensesLoading: false, showExpenses: false });
      this.showToast('报销记录加载失败：' + error.message);
    }
  },

  closeExpenses() {
    if (!this.data.submitting && !this.data.uploading) this.setData({ showExpenses: false, showExpenseCreate: false });
  },

  openExpenseCreate() {
    this.setData({
      showExpenseCreate: true,
      expenseForm: { category: 'travel', categoryText: '差旅费', amount: '', currency: 'CNY', incurredOn: todayString(), description: '', attachments: [] }
    });
  },

  closeExpenseCreate() {
    if (!this.data.submitting && !this.data.uploading) this.setData({ showExpenseCreate: false });
  },

  updateExpenseForm(e) {
    this.setData({ ['expenseForm.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  setExpenseDate(e) {
    this.setData({ 'expenseForm.incurredOn': e.detail.value });
  },

  chooseExpenseCategory() {
    const values = [
      ['travel', '差旅费'], ['transport', '交通费'], ['meals', '餐饮费'], ['office', '办公费'],
      ['freight', '物流费'], ['client', '客户招待'], ['other', '其他']
    ];
    const index = values.findIndex((item) => item[0] === this.data.expenseForm.category);
    const next = values[(index + 1) % values.length];
    this.setData({ 'expenseForm.category': next[0], 'expenseForm.categoryText': next[1] });
  },

  chooseExpenseCurrency() {
    const values = ['CNY', 'USD', 'EUR'];
    const next = values[(values.indexOf(this.data.expenseForm.currency) + 1) % values.length];
    this.setData({ 'expenseForm.currency': next });
  },

  uploadExpenseAttachments() {
    const current = this.data.expenseForm.attachments || [];
    this.chooseAndUploadImages({
      remaining: 9 - current.length,
      category: 'expense',
      onComplete: (attachments) => this.setData({ 'expenseForm.attachments': current.concat(attachments).slice(0, 9) })
    });
  },

  removeExpenseAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ 'expenseForm.attachments': this.data.expenseForm.attachments.filter((_item, idx) => idx !== index) });
  },

  async submitExpense() {
    const form = this.data.expenseForm;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(form.incurredOn) || !String(form.description || '').trim()) {
      this.showToast('请完整填写金额、发生日期和费用说明');
      return;
    }
    if (this.data.uploading) return this.showToast('请等待凭证上传完成');
    this.setData({ submitting: true });
    try {
      await api.expenses.create({
        category: form.category, amount, currency: form.currency, incurredOn: form.incurredOn,
        description: String(form.description).trim(), attachments: form.attachments
      });
      this.setData({ submitting: false, showExpenseCreate: false });
      await this.openExpenses();
      this.showToast('报销申请已提交给超级管理员');
    } catch (error) {
      this.setData({ submitting: false });
      this.showToast('报销申请提交失败：' + error.message);
    }
  },

  updateExpenseDecisionComment(e) {
    this.setData({ expenseDecisionComment: e.detail.value });
  },

  async decideExpense(e) {
    if (!this.data.currentUser.isDingAdmin || this.data.submitting) return;
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    const comment = String(this.data.expenseDecisionComment || '').trim();
    if (status === 'rejected' && !comment) return this.showToast('驳回时请填写审批意见');
    this.setData({ submitting: true });
    try {
      await api.expenses.decide(id, status, comment);
      this.setData({ submitting: false, expenseDecisionComment: '' });
      await this.openExpenses();
      this.showToast(status === 'approved' ? '报销已通过' : '报销已驳回');
    } catch (error) {
      this.setData({ submitting: false });
      this.showToast('审批失败：' + error.message);
    }
  },

  showToast(message) {
    this.setData({ toast: message });
    setTimeout(() => this.setData({ toast: '' }), 2200);
  }
});
