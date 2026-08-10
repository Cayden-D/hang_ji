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
    filter: 'all',
    searchValue: '',
    orders: [],
    visibleOrders: [],
    taskOrders: [],
    urgentOrder: null,
    loading: true,
    submitting: false,
    uploading: false,
    apiError: '',
    showShipment: false,
    showUserAdmin: false,
    userAdminLoading: false,
    adminUsers: [],
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
      freight: '', note: '', paymentAttachments: [], products: [emptyProduct()]
    },
    shippingForm: {
      logisticsCompany: '', trackingNo: '', shippedOn: '', estimatedArrivalOn: '', note: '', attachments: []
    }
  },

  onLoad() {
    this.syncCurrentUser();
    this.loadOrders();
  },

  onShow() {
    this.syncCurrentUser();
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

  async loadOrders() {
    this.setData({ loading: true, apiError: '' });
    try {
      const loggedIn = await this.waitForLogin();
      if (!loggedIn) throw new Error(getApp().globalData.loginError || '免登尚未完成');
      const result = await api.orders.list();
      const orders = (result.items || []).map(mapOrder);
      this.setData({ orders, loading: false });
      this.rebuildDerivedData();
    } catch (error) {
      console.error('加载订单失败', error);
      this.setData({ loading: false, apiError: error.message, orders: [], visibleOrders: [], taskOrders: [] });
      this.showToast('订单加载失败：' + error.message);
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
    const roleNames = { sales: '业务员', purchase: '采购员', logistics: '物流人员', admin: '管理员' };
    const roleText = roleNames[user.role] || '企业成员';
    const dingRoles = Array.isArray(user.dingRoles) ? user.dingRoles : [];
    const dingRoleText = dingRoles.length
      ? dingRoles.map((item) => item.groupName ? item.groupName + ' · ' + item.name : item.name).join('、')
      : '未配置通讯录角色';
    const identities = [];
    if (user.isBoss) identities.push('企业老板');
    if (user.isDingAdmin) identities.push('企业管理员');
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
      roleLabel: user.role === 'admin' ? '管理员视角' : (roleText + '视角')
    }, () => this.refreshTaskOrders(activeRole));
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, showRoleMenu: false });
    if (tab === 'orders') this.refreshVisible();
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

  onSearch(e) {
    this.setData({ searchValue: e.detail.value });
    this.refreshVisible();
  },

  refreshVisible() {
    const filter = this.data.filter;
    const keyword = (this.data.searchValue || '').toLowerCase();
    const list = this.data.orders.filter((item) => {
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
    const values = ['T/T', 'L/C', 'D/P'];
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
    if (this.data.uploading) {
      this.showToast('请等待图片上传完成');
      return;
    }
    const f = this.data.form;
    const invalidProduct = f.products.some((item) => !item.sku || !item.name || !item.variant || !item.quantity);
    if (!f.customer || invalidProduct) {
      this.showToast('请填写客户及每条产品的货号、名称、款式和数量');
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
        form: { customer: '', customerContact: '', shippingAddress: '', country: '', deadline: '', payment: 'T/T', freight: '', note: '', paymentAttachments: [], products: [emptyProduct()] }
      });
      this.rebuildDerivedData();
      this.showToast('订单已创建，采购待办已同步');
    } catch (error) {
      console.error('创建订单失败', error);
      this.setData({ submitting: false });
      this.showToast('创建失败：' + error.message);
    }
  },

  async openDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ showDetail: true, detailLoading: true, detail: this.data.orders.find((item) => item.id === id) || {} });
    try {
      const result = await api.orders.detail(id);
      this.setData({ detail: mapOrder(result.order), detailLoading: false });
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
    const order = this.data.orders.find((item) => item.id === id) || this.data.detail;
    if (!order) return;
    if (order.apiStatus === 'purchased') {
      this.openShipment(order);
      return;
    }
    if (!['pending_purchase', 'purchasing'].includes(order.apiStatus)) return;
    this.setData({ submitting: true });
    try {
      const result = await api.orders.completePurchase(id);
      this.replaceOrder(mapOrder(result.order));
      this.setData({ submitting: false, showDetail: false });
      this.showToast('采购完成，订单已同步至物流');
    } catch (error) {
      console.error('采购确认失败', error);
      this.setData({ submitting: false });
      this.showToast('采购确认失败：' + error.message);
    }
  },

  async completeProductPurchase(e) {
    const orderId = e.currentTarget.dataset.orderId;
    const productId = e.currentTarget.dataset.productId;
    if (!orderId || !productId || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await api.orders.completePurchase(orderId, [productId]);
      const order = mapOrder(result.order);
      this.replaceOrder(order);
      this.setData({ detail: order, submitting: false });
      this.showToast('该产品已确认采购');
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
    if (this.data.currentUser.role !== 'admin') return;
    this.setData({ showUserAdmin: true, userAdminLoading: true });
    try {
      const result = await api.adminUsers.list();
      const roleNames = { sales: '业务员', purchase: '采购员', logistics: '物流人员', admin: '管理员' };
      const users = (result.items || []).map((item) => Object.assign({}, item, {
        roleText: roleNames[item.role] || item.role,
        initial: (item.name || '钉').slice(0, 1),
        isActive: Boolean(item.is_active)
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
      this.showToast('不能修改自己的管理员角色');
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

  showToast(message) {
    this.setData({ toast: message });
    setTimeout(() => this.setData({ toast: '' }), 2200);
  }
});
