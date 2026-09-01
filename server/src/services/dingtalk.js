import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const USER_BY_CODE_URL = 'https://oapi.dingtalk.com/topapi/v2/user/getuserinfo';
const USER_DETAIL_URL = 'https://oapi.dingtalk.com/topapi/v2/user/get';
const DEPARTMENT_USERS_URL = 'https://oapi.dingtalk.com/topapi/v2/user/list';
const DEPARTMENT_DETAIL_URL = 'https://oapi.dingtalk.com/topapi/v2/department/get';
const NOTIFY_URL = 'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2';

let tokenCache = { value: '', expiresAt: 0 };
const departmentNameCache = new Map();

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(502, 'DINGTALK_HTTP_ERROR', `DingTalk returned HTTP ${response.status}`, data);
  return data;
};

const assertConfigured = () => {
  if (!config.dingTalk.appKey || !config.dingTalk.appSecret) {
    throw new AppError(503, 'DINGTALK_NOT_CONFIGURED', 'DingTalk AppKey/AppSecret are not configured');
  }
};

export const getAppAccessToken = async () => {
  assertConfigured();
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const data = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appKey: config.dingTalk.appKey, appSecret: config.dingTalk.appSecret })
  });
  if (!data.accessToken) throw new AppError(502, 'DINGTALK_TOKEN_ERROR', 'DingTalk did not return an access token', data);
  tokenCache = { value: data.accessToken, expiresAt: Date.now() + Number(data.expireIn || 7200) * 1000 };
  return tokenCache.value;
};

const callLegacyApi = async (url, body) => {
  const accessToken = await getAppAccessToken();
  const data = await fetchJson(`${url}?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (Number(data.errcode) !== 0) throw new AppError(502, 'DINGTALK_API_ERROR', data.errmsg || 'DingTalk API failed', data);
  return data.result;
};

const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

export const normalizeDingUserProfile = (detail = {}, fallback = {}) => {
  const roleList = Array.isArray(detail.role_list)
    ? detail.role_list
    : (detail.role_list ? [detail.role_list] : []);
  const leaderList = Array.isArray(detail.leader_in_dept)
    ? detail.leader_in_dept
    : (detail.leader_in_dept ? [detail.leader_in_dept] : []);
  const dingUserId = detail.userid || detail.userId || fallback.dingUserId;
  const departmentIds = (Array.isArray(detail.dept_id_list) ? detail.dept_id_list : [])
    .map((item) => Number(item)).filter(Number.isFinite);
  return {
    dingUserId,
    unionId: detail.unionid || fallback.unionId || null,
    name: detail.name || fallback.name || dingUserId,
    avatarUrl: detail.avatar || null,
    mobile: detail.mobile || null,
    email: detail.email || null,
    orgEmail: detail.org_email || null,
    title: detail.title || null,
    jobNumber: detail.job_number || null,
    workPlace: detail.work_place || null,
    departmentIds,
    departmentName: detail.department_name || detail.dept_name || fallback.departmentName || null,
    dingRoles: roleList.map((item) => ({
      id: item.id == null ? null : String(item.id),
      name: item.name || '',
      groupName: item.group_name || ''
    })).filter((item) => item.name),
    isDingAdmin: toBoolean(detail.admin),
    isBoss: toBoolean(detail.boss),
    isSenior: toBoolean(detail.senior),
    isLeader: toBoolean(detail.leader) || leaderList.some((item) => toBoolean(item.leader)),
    managerUserId: detail.manager_userid || null
  };
};

const getDepartmentName = async (departmentId) => {
  if (!departmentNameCache.has(departmentId)) {
    departmentNameCache.set(departmentId, callLegacyApi(DEPARTMENT_DETAIL_URL, {
      dept_id: departmentId,
      language: 'zh_CN'
    }).then((detail) => detail?.name || '').catch((error) => {
      departmentNameCache.delete(departmentId);
      throw error;
    }));
  }
  return departmentNameCache.get(departmentId);
};

const enrichDepartmentName = async (profile) => {
  if (profile.departmentName || !profile.departmentIds.length) return profile;
  try {
    const names = await Promise.all(profile.departmentIds.map(getDepartmentName));
    return { ...profile, departmentName: [...new Set(names.filter(Boolean))].join(' / ') || null };
  } catch (error) {
    logger.warn({ err: error, dingUserId: profile.dingUserId }, 'Unable to load DingTalk department name');
    return profile;
  }
};

export const getUserByAuthCode = async (code) => {
  const login = await callLegacyApi(USER_BY_CODE_URL, { code });
  const dingUserId = login.userid || login.userId;
  if (!dingUserId) throw new AppError(502, 'DINGTALK_USER_ERROR', 'DingTalk did not return a user ID', login);
  let detail = {};
  try {
    detail = await callLegacyApi(USER_DETAIL_URL, { userid: dingUserId, language: 'zh_CN' });
  } catch (error) {
    logger.warn({ err: error, dingUserId }, 'Unable to load optional DingTalk user detail');
  }
  return enrichDepartmentName(normalizeDingUserProfile(detail, {
    dingUserId,
    unionId: login.associated_unionid,
    name: login.name
  }));
};

export const listRootDepartmentUsers = async () => {
  const users = [];
  let cursor = 0;
  for (let page = 0; page < 100; page += 1) {
    const result = await callLegacyApi(DEPARTMENT_USERS_URL, {
      dept_id: 1,
      cursor,
      size: 100,
      order_field: 'custom',
      contain_access_limit: false,
      language: 'zh_CN'
    });
    const list = Array.isArray(result?.list) ? result.list : (result?.list ? [result.list] : []);
    for (const detail of list) {
      const profile = await enrichDepartmentName(normalizeDingUserProfile(detail));
      if (profile.dingUserId) users.push(profile);
    }
    if (!toBoolean(result?.has_more)) return users;
    const nextCursor = Number(result?.next_cursor);
    if (!Number.isFinite(nextCursor) || nextCursor === cursor) {
      throw new AppError(502, 'DINGTALK_PAGINATION_ERROR', 'DingTalk returned an invalid department cursor', result);
    }
    cursor = nextCursor;
  }
  throw new AppError(502, 'DINGTALK_PAGINATION_ERROR', 'DingTalk department listing exceeded 100 pages');
};

export const resolveInitialRole = (dingUserId) => {
  if (config.dingTalk.roleUsers.admin.has(dingUserId)) return 'admin';
  if (config.dingTalk.roleUsers.purchase.has(dingUserId)) return 'purchase';
  if (config.dingTalk.roleUsers.logistics.has(dingUserId)) return 'logistics';
  return 'sales';
};

export const sendWorkNotification = async ({ userIds, title, markdown, orderId }) => {
  if (!config.dingTalk.agentId || !userIds.length) return false;
  try {
    await callLegacyApi(NOTIFY_URL, {
      agent_id: Number(config.dingTalk.agentId),
      userid_list: userIds.join(','),
      msg: {
        msgtype: 'markdown',
        markdown: { title, text: markdown }
      },
      to_all_user: false
    });
    logger.info({ orderId, recipients: userIds.length }, 'DingTalk work notification sent');
    return true;
  } catch (error) {
    logger.error({ err: error, orderId }, 'DingTalk work notification failed');
    return false;
  }
};

export const clearTokenCacheForTest = () => {
  tokenCache = { value: '', expiresAt: 0 };
  departmentNameCache.clear();
};
