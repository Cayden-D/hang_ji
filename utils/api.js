const { apiBaseUrl } = require('../config');

const parseData = (data) => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch (_error) {
    return data;
  }
};

const request = ({ path, method = 'GET', data, authenticated = true }) => new Promise((resolve, reject) => {
  if (typeof dd === 'undefined' || !dd.httpRequest) {
    reject(new Error('请在钉钉客户端或开发者工具中运行'));
    return;
  }
  const app = getApp();
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  };
  if (authenticated && app.globalData.sessionToken) {
    headers.Authorization = 'Bearer ' + app.globalData.sessionToken;
  }
  dd.httpRequest({
    url: apiBaseUrl + path + (method === 'GET' ? (path.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now() : ''),
    method,
    headers,
    data: data === undefined ? undefined : JSON.stringify(data),
    dataType: 'json',
    timeout: 15000,
    success: (res) => {
      const body = parseData(res.data);
      if (res.status >= 200 && res.status < 300) {
        resolve(body);
        return;
      }
      const message = body && body.error && body.error.message
        ? body.error.message
        : '服务请求失败（' + res.status + '）';
      const error = new Error(message);
      error.status = res.status;
      error.data = body;
      reject(error);
    },
    fail: (error) => reject(new Error(error.errorMessage || error.errMsg || '网络请求失败'))
  });
});

const uploadImage = (filePath, category) => new Promise((resolve, reject) => {
  if (typeof dd === 'undefined' || !dd.uploadFile) {
    reject(new Error('当前钉钉版本不支持图片上传'));
    return;
  }
  const token = getApp().globalData.sessionToken;
  dd.uploadFile({
    url: apiBaseUrl + '/api/uploads/image',
    fileType: 'image',
    fileName: 'file',
    filePath,
    header: {
      Authorization: 'Bearer ' + token
    },
    formData: { category },
    success: (res) => {
      const body = parseData(res.data);
      const status = Number(res.statusCode || res.status || 0);
      if (status >= 200 && status < 300 && body && body.attachment) {
        resolve(body.attachment);
        return;
      }
      const message = body && body.error && body.error.message
        ? body.error.message
        : '图片上传失败（' + (status || '未知状态') + '）';
      reject(new Error(message));
    },
    fail: (error) => reject(new Error(error.errorMessage || error.errMsg || '图片上传失败'))
  });
});

const uploadPi = (filePath, fileName = 'PI.xlsx') => new Promise((resolve, reject) => {
  if (typeof dd === 'undefined' || !dd.uploadFile) {
    reject(new Error('当前钉钉版本不支持文件上传'));
    return;
  }
  dd.uploadFile({
    url: apiBaseUrl + '/api/imports/pi',
    fileType: 'file',
    fileName: 'file',
    filePath,
    header: { Authorization: 'Bearer ' + getApp().globalData.sessionToken },
    formData: { fileName },
    success: (res) => {
      const body = parseData(res.data);
      const status = Number(res.statusCode || res.status || 0);
      if (status >= 200 && status < 300 && body && body.imported) return resolve(body);
      reject(new Error(body && body.error && body.error.message ? body.error.message : 'PI 导入失败（' + (status || '未知状态') + '）'));
    },
    fail: (error) => reject(new Error(error.errorMessage || error.errMsg || 'PI 文件上传失败'))
  });
});

const uploadAttachment = (filePath, fileName = '附件') => new Promise((resolve, reject) => {
  if (typeof dd === 'undefined' || !dd.uploadFile) {
    reject(new Error('当前钉钉版本不支持文件上传'));
    return;
  }
  dd.uploadFile({
    url: apiBaseUrl + '/api/uploads/file',
    fileType: 'file',
    fileName: 'file',
    filePath,
    header: { Authorization: 'Bearer ' + getApp().globalData.sessionToken },
    formData: { category: 'expense', originalName: fileName },
    success: (res) => {
      const body = parseData(res.data);
      const status = Number(res.statusCode || res.status || 0);
      if (status >= 200 && status < 300 && body && body.attachment) return resolve(body.attachment);
      reject(new Error(body && body.error && body.error.message ? body.error.message : '文件上传失败（' + (status || '未知状态') + '）'));
    },
    fail: (error) => reject(new Error(error.errorMessage || error.errMsg || '文件上传失败'))
  });
});

const loginWithDingTalk = (code) => request({
  path: '/api/auth/dingtalk',
  method: 'POST',
  data: { code },
  authenticated: false
});

const orders = {
  list: (filters = {}) => {
    const query = ['page=1', 'pageSize=100'];
    if (filters.dateFrom) query.push('dateFrom=' + encodeURIComponent(filters.dateFrom));
    if (filters.dateTo) query.push('dateTo=' + encodeURIComponent(filters.dateTo));
    return request({ path: '/api/orders?' + query.join('&') });
  },
  detail: (id) => request({ path: '/api/orders/' + encodeURIComponent(id) }),
  create: (data) => request({ path: '/api/orders', method: 'POST', data }),
  completePurchase: (id, productIds, products, purchaseTotal) => request({
    path: '/api/orders/' + encodeURIComponent(id) + '/purchase-complete',
    method: 'POST',
    data: purchaseTotal !== undefined && purchaseTotal !== null
      ? { purchaseTotal }
      : (products && products.length ? { products } : (productIds && productIds.length ? { productIds } : {}))
  }),
  createShipment: (id, data) => request({
    path: '/api/orders/' + encodeURIComponent(id) + '/shipments',
    method: 'POST',
    data
  })
};

const adminUsers = {
  list: () => request({ path: '/api/admin/users' }),
  setRole: (id, role) => request({ path: '/api/admin/users/' + encodeURIComponent(id) + '/role', method: 'PATCH', data: { role } }),
  setActive: (id, isActive) => request({ path: '/api/admin/users/' + encodeURIComponent(id) + '/active', method: 'PATCH', data: { isActive } }),
  setCommission: (id, commissionRatePercent) => request({ path: '/api/admin/users/' + encodeURIComponent(id) + '/commission', method: 'PATCH', data: { commissionRatePercent } })
};

const exchangeRates = {
  usdCny: () => request({ path: '/api/exchange-rates/usd-cny' })
};

const performance = {
  monthly: (month) => request({ path: '/api/performance/monthly?month=' + encodeURIComponent(month) }),
  leaderboard: (month) => request({ path: '/api/performance/leaderboard?month=' + encodeURIComponent(month) })
};

const expenses = {
  list: () => request({ path: '/api/expenses' }),
  create: (data) => request({ path: '/api/expenses', method: 'POST', data }),
  decide: (id, status, comment) => request({
    path: '/api/expenses/' + encodeURIComponent(id) + '/decision',
    method: 'PATCH',
    data: { status, comment }
  })
};

module.exports = { request, uploadImage, uploadPi, uploadAttachment, loginWithDingTalk, orders, adminUsers, exchangeRates, performance, expenses };
