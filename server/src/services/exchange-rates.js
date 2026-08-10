import { AppError } from '../errors.js';

const API_ROOT = 'https://api.frankfurter.dev/v2';
const cache = new Map();

const shanghaiDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const cachedFetch = async (key, url, ttlMs) => {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(502, 'EXCHANGE_RATE_HTTP_ERROR', `汇率服务返回 HTTP ${response.status}`, data);
  cache.set(key, { value: data, expiresAt: Date.now() + ttlMs });
  return data;
};

export const getUsdCnyRate = async (date) => {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const data = await cachedFetch(`USD-CNY:${date || 'latest'}`, `${API_ROOT}/rate/USD/CNY${query}`, date ? 86_400_000 : 1_800_000);
  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new AppError(502, 'EXCHANGE_RATE_INVALID', '汇率服务没有返回有效的 USD/CNY 汇率', data);
  return { date: data.date, rate };
};

export const getUsdCnySnapshot = async () => {
  const today = shanghaiDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [first, latest] = await Promise.all([getUsdCnyRate(monthStart), getUsdCnyRate()]);
  return { base: 'USD', quote: 'CNY', monthStart: first, today: latest };
};

export const getUsdCnyRange = async (from, to) => {
  const url = `${API_ROOT}/rates?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&base=USD&quotes=CNY`;
  const data = await cachedFetch(`USD-CNY:${from}:${to}`, url, 1_800_000);
  if (!Array.isArray(data)) throw new AppError(502, 'EXCHANGE_RATE_INVALID', '汇率服务没有返回有效的汇率序列', data);
  return new Map(data.map((item) => [item.date, Number(item.rate)]).filter(([, rate]) => Number.isFinite(rate) && rate > 0));
};

export const currentShanghaiDate = shanghaiDate;

export const clearExchangeRateCacheForTest = () => cache.clear();
