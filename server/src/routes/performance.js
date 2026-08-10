import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { calculateOrderPerformance } from '../domain/commission.js';
import { forbidden } from '../errors.js';
import { logger } from '../logger.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { currentShanghaiDate, getUsdCnyRate } from '../services/exchange-rates.js';

const router = Router();
router.use(authenticate);

const performanceQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  ownerUserId: z.string().uuid().optional()
});
const leaderboardQuery = performanceQuery.pick({ month: true });

const monthBounds = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return { from: `${month}-01`, toExclusive: next };
};

const dateText = (value) => {
  if (value instanceof Date) return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
  return String(value || '').slice(0, 10);
};

const resolveRates = async (rows, month) => {
  let monthRate = null;
  let monthRateDate = null;
  let exchangeWarning = null;
  if (rows.some((row) => row.currency === 'USD')) {
    try {
      const result = await getUsdCnyRate(`${month}-01`);
      monthRate = result.rate;
      monthRateDate = result.date;
    } catch (error) {
      exchangeWarning = '暂时无法取得当月 1 日汇率，美元订单将不显示人民币业绩';
      logger.warn({ err: error, month }, 'Unable to load month-start exchange rate');
    }
  }
  return { monthRate, monthRateDate, exchangeWarning };
};

const mapPerformanceItem = (row, monthRate) => {
  const orderDate = dateText(row.created_at);
  const effectiveRate = row.currency === 'CNY'
    ? 1
    : (Number(row.currency === 'USD' ? monthRate : row.exchange_rate) || null);
  const effectiveCommissionRate = Number(row.commission_rate_percent ?? row.current_commission_rate ?? 0);
  const calculated = calculateOrderPerformance({
    // total_amount 已包含运费；业绩中的订单金额使用产品销售额，再单独扣除运费。
    totalAmount: row.goods_total,
    purchaseTotal: row.purchase_total,
    freight: row.freight,
    receivedCny: row.received_cny,
    exchangeRate: effectiveRate,
    commissionRatePercent: effectiveCommissionRate
  });
  return {
    id: row.id,
    orderNo: row.order_no,
    orderDate,
    customerName: row.customer_name,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    currency: row.currency,
    orderAmount: row.goods_total,
    receivedCny: row.received_cny,
    productCost: row.purchase_total,
    freight: row.freight,
    exchangeRate: effectiveRate,
    commissionRatePercent: effectiveCommissionRate,
    freightForwarder: row.logistics_company,
    isCompleted: Boolean(row.is_completed),
    completedAt: row.completed_at,
    ...calculated
  };
};

router.get('/monthly', validate(performanceQuery, 'query'), async (req, res) => {
  if (!['sales', 'admin'].includes(req.user.role)) throw forbidden('Only sales staff and administrators can view performance');
  const month = req.validatedQuery.month || currentShanghaiDate().slice(0, 7);
  const { from, toExclusive } = monthBounds(month);
  const where = ['o.created_at >= ?', 'o.created_at < ?', "o.status <> 'cancelled'"];
  const params = [from, toExclusive];
  if (req.user.role === 'sales') {
    where.push('o.owner_user_id = ?');
    params.push(req.user.sub);
  } else if (req.validatedQuery.ownerUserId) {
    where.push('o.owner_user_id = ?');
    params.push(req.validatedQuery.ownerUserId);
  }
  const rows = await query(
    `SELECT o.*, u.name AS owner_name, u.commission_rate_percent AS current_commission_rate,
      s.logistics_company
     FROM orders o
     JOIN users u ON u.id = o.owner_user_id
     LEFT JOIN shipments s ON s.order_id = o.id
     WHERE ${where.join(' AND ')}
     ORDER BY o.created_at DESC`,
    params
  );

  const { monthRate, monthRateDate, exchangeWarning } = await resolveRates(rows, month);
  const items = rows.map((row) => mapPerformanceItem(row, monthRate));
  const sum = (field, filter = () => true) => Math.round(items.filter(filter).reduce(
    (total, item) => total + Number(item[field] || 0), 0
  ) * 100) / 100;
  res.json({
    month,
    exchangeRate: monthRate ? { date: monthRateDate, rate: monthRate, base: 'USD', quote: 'CNY' } : null,
    items,
    summary: {
      orderCount: items.length,
      orderAmount: sum('orderAmount'),
      receivedCny: sum('revenueCny'),
      profitCny: sum('profitCny'),
      commissionCny: sum('commissionCny'),
      completedCommissionCny: sum('commissionCny', (item) => item.isCompleted)
    },
    warnings: exchangeWarning ? [exchangeWarning] : []
  });
});

router.get('/leaderboard', validate(leaderboardQuery, 'query'), async (req, res) => {
  const month = req.validatedQuery.month || currentShanghaiDate().slice(0, 7);
  const { from, toExclusive } = monthBounds(month);
  const [users, rows] = await Promise.all([
    query(`SELECT id, name, avatar_url, title, role FROM users
      WHERE role IN ('sales', 'admin') AND is_active = TRUE ORDER BY name`),
    query(
      `SELECT o.*, u.name AS owner_name, u.commission_rate_percent AS current_commission_rate,
        s.logistics_company
       FROM orders o
       JOIN users u ON u.id = o.owner_user_id
       LEFT JOIN shipments s ON s.order_id = o.id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.status <> 'cancelled'
         AND u.role IN ('sales', 'admin')`,
      [from, toExclusive]
    )
  ]);
  const { monthRate, monthRateDate, exchangeWarning } = await resolveRates(rows, month);
  const totals = new Map(users.map((user) => [user.id, {
    userId: user.id,
    name: user.name,
    avatarUrl: user.avatar_url,
    title: user.title,
    role: user.role,
    orderCount: 0,
    salesCny: 0,
    receivedCny: 0,
    profitCny: 0,
    commissionCny: 0
  }]));
  rows.map((row) => mapPerformanceItem(row, monthRate)).forEach((item) => {
    const total = totals.get(item.ownerUserId);
    if (!total) return;
    total.orderCount += 1;
    total.salesCny += Number(item.convertedOrderAmountCny || 0);
    total.receivedCny += Number(item.revenueCny || 0);
    total.profitCny += Number(item.profitCny || 0);
    total.commissionCny += Number(item.commissionCny || 0);
  });
  const round = (value) => Math.round(value * 100) / 100;
  const leaders = [...totals.values()]
    .map((item) => ({ ...item, salesCny: round(item.salesCny), receivedCny: round(item.receivedCny), profitCny: round(item.profitCny), commissionCny: round(item.commissionCny) }))
    .sort((a, b) => b.salesCny - a.salesCny || b.profitCny - a.profitCny || a.name.localeCompare(b.name, 'zh-CN'))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  res.json({
    month,
    exchangeRate: monthRate ? { date: monthRateDate, rate: monthRate, base: 'USD', quote: 'CNY' } : null,
    champion: leaders[0]?.orderCount ? leaders[0] : null,
    leaders: leaders.slice(0, 10),
    me: leaders.find((item) => item.userId === req.user.sub) || null,
    warnings: exchangeWarning ? [exchangeWarning] : []
  });
});

export default router;
