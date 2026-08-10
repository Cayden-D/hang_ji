import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { calculateOrderPerformance } from '../domain/commission.js';
import { forbidden } from '../errors.js';
import { logger } from '../logger.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { currentShanghaiDate, getUsdCnyRange, getUsdCnyRate } from '../services/exchange-rates.js';

const router = Router();
router.use(authenticate);

const performanceQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  ownerUserId: z.string().uuid().optional()
});

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

router.get('/monthly', validate(performanceQuery, 'query'), async (req, res) => {
  if (!['sales', 'admin'].includes(req.user.role)) throw forbidden('Only sales staff and administrators can view performance');
  const month = req.validatedQuery.month || currentShanghaiDate().slice(0, 7);
  const { from, toExclusive } = monthBounds(month);
  const where = ['o.created_at >= ?', 'o.created_at < ?'];
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

  let rates = new Map();
  let exchangeWarning = null;
  if (rows.some((row) => row.currency === 'USD' && !row.exchange_rate)) {
    const dates = rows.map((row) => dateText(row.created_at)).filter(Boolean).sort();
    if (dates.length) {
      try {
        rates = await getUsdCnyRange(dates[0], dates[dates.length - 1]);
        const missingDates = [...new Set(dates.filter((date) => !rates.has(date)))];
        const missingRates = await Promise.all(missingDates.map((date) => getUsdCnyRate(date)));
        missingDates.forEach((date, index) => rates.set(date, missingRates[index].rate));
      } catch (error) {
        exchangeWarning = '暂时无法取得历史汇率，未锁定汇率的订单将不显示人民币利润';
        logger.warn({ err: error, month }, 'Unable to load monthly exchange rates');
      }
    }
  }

  const items = rows.map((row) => {
    const orderDate = dateText(row.created_at);
    const effectiveRate = Number(row.exchange_rate || (row.currency === 'USD' ? rates.get(orderDate) : 0)) || null;
    const effectiveCommissionRate = Number(row.commission_rate_percent ?? row.current_commission_rate ?? 0);
    const calculated = calculateOrderPerformance({
      // total_amount 在订单表中已包含运费；业绩口径的“订单金额”是产品销售额，
      // 再单独减去采购成本和运费，避免运费先加后减导致利润虚高。
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
  });
  const sum = (field, filter = () => true) => Math.round(items.filter(filter).reduce(
    (total, item) => total + Number(item[field] || 0), 0
  ) * 100) / 100;
  res.json({
    month,
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

export default router;
