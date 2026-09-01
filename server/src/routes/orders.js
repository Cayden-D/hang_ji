import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { authenticate, requireDingAdmin, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { canViewOrder, derivePurchaseStatus } from '../domain/order-state.js';
import { getOrderDetail, mapOrder } from '../repositories/orders.js';
import {
  adminReplaceOrderSchema, adminUpdateShipmentSchema, createOrderSchema, listOrdersSchema, purchaseSchema, shipmentSchema
} from '../schemas/orders.js';
import { sendWorkNotification } from '../services/dingtalk.js';

const router = Router();
router.use(authenticate);

const generateOrderNo = () => {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: '2-digit', month: '2-digit', day: '2-digit'
  }).format(new Date()).replaceAll('-', '');
  return `SO-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
};

const insertAttachment = async (connection, { orderId, productId = null, shipmentId = null, category, attachment, userId }) => {
  await connection.execute(
    `INSERT INTO attachments
      (id, order_id, product_id, shipment_id, category, file_name, file_size, file_type,
       source_type, storage_provider, object_key, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), orderId, productId, shipmentId, category, attachment.fileName,
      attachment.fileSize ?? null, attachment.fileType ?? null, 'oss', 'oss', attachment.objectKey, userId]
  );
};

router.get('/', validate(listOrdersSchema, 'query'), async (req, res) => {
  const { status, search, dateFrom, dateTo, page, pageSize } = req.validatedQuery;
  const where = [];
  const params = [];
  if (req.user.role === 'sales') {
    where.push('o.owner_user_id = ?');
    params.push(req.user.sub);
  } else if (req.user.role === 'logistics') {
    where.push("o.status IN ('purchased', 'shipped')");
  }
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR EXISTS (SELECT 1 FROM products sp WHERE sp.order_id = o.id AND (sp.sku LIKE ? OR sp.name LIKE ?)))');
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword);
  }
  if (dateFrom) {
    where.push('o.created_at >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(dateTo);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRows = await query(`SELECT COUNT(*) AS total FROM orders o ${clause}`, params);
  const rows = await query(
    `SELECT o.*, u.name AS owner_name FROM orders o
     JOIN users u ON u.id = o.owner_user_id ${clause}
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const ids = rows.map((row) => row.id);
  const productsByOrder = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const products = await query(
      `SELECT order_id, sku, name, variant, quantity FROM products WHERE order_id IN (${placeholders}) ORDER BY created_at, id`,
      ids
    );
    for (const product of products) {
      if (!productsByOrder.has(product.order_id)) productsByOrder.set(product.order_id, []);
      productsByOrder.get(product.order_id).push(product);
    }
  }
  const items = rows.map((row) => {
    const products = productsByOrder.get(row.id) || [];
    return { ...mapOrder(row), productCount: products.length, productSummary: products[0] || null };
  });
  res.json({ items, pagination: { page, pageSize, total: countRows[0].total } });
});

router.post('/', requireRoles('sales', 'admin'), validate(createOrderSchema), async (req, res) => {
  const body = req.body;
  const orderId = randomUUID();
  const orderNo = generateOrderNo();
  const goodsTotal = body.products.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const purchaseTotal = body.products.reduce((sum, item) => sum + item.purchaseCost, 0);
  const totalQuantity = body.products.reduce((sum, item) => sum + item.quantity, 0);
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO orders
        (id, order_no, customer_name, customer_contact, shipping_address, destination, deadline,
         payment_method, currency, freight, goods_total, total_amount, purchase_total, total_quantity,
         received_usd, status, note, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_purchase', ?, ?)`,
      [orderId, orderNo, body.customerName, body.customerContact ?? null, body.shippingAddress ?? null,
        body.destination ?? null, body.deadline, body.paymentMethod, body.currency, body.freight,
        goodsTotal, goodsTotal + body.freight, purchaseTotal, totalQuantity, body.receivedUsd ?? null,
        body.note ?? null, req.user.sub]
    );
    for (const product of body.products) {
      const productId = randomUUID();
      const totalPrice = product.quantity * product.unitPrice;
      await connection.execute(
        `INSERT INTO products
          (id, order_id, sku, name, variant, units_per_carton, carton_count, weight_kg, volume_m3,
           quantity, unit_price, total_price, purchase_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, orderId, product.sku || null, product.name, product.variant, product.unitsPerCarton,
          product.cartons, product.weight, product.volume, product.quantity, product.unitPrice, totalPrice, product.purchaseCost]
      );
      for (const attachment of product.images) {
        await insertAttachment(connection, { orderId, productId, category: 'product', attachment, userId: req.user.sub });
      }
    }
    for (const attachment of body.paymentAttachments) {
      await insertAttachment(connection, { orderId, category: 'payment', attachment, userId: req.user.sub });
    }
    await connection.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
       VALUES (?, NULL, 'pending_purchase', 'order_created', ?, ?)`,
      [orderId, req.user.sub, JSON.stringify({ orderNo, productCount: body.products.length })]
    );
  });
  const recipients = await query("SELECT ding_user_id FROM users WHERE role IN ('purchase', 'admin') AND is_active = TRUE");
  void sendWorkNotification({
    userIds: recipients.map((item) => item.ding_user_id),
    title: `新采购任务 ${orderNo}`,
    markdown: `### 新采购任务\n客户：${body.customerName}\n产品明细：${body.products.length} 款\n最晚出货：${body.deadline}`,
    orderId
  });
  res.status(201).json({ order: await getOrderDetail(orderId) });
});

router.get('/:id', async (req, res) => {
  const order = await getOrderDetail(req.params.id);
  if (!order) throw notFound('Order not found');
  if (!canViewOrder(req.user, { status: order.status, owner_user_id: order.ownerUserId })) throw forbidden();
  res.json({ order });
});

router.put('/:id', requireDingAdmin, validate(adminReplaceOrderSchema), async (req, res) => {
  const body = req.body;
  await withTransaction(async (connection) => {
    const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (!order) throw notFound('Order not found');
    const [owners] = await connection.execute(
      'SELECT id, commission_rate_percent FROM users WHERE id = ? LIMIT 1',
      [body.ownerUserId]
    );
    if (!owners[0]) throw notFound('Order owner not found');

    const [existingProducts] = await connection.execute('SELECT id FROM products WHERE order_id = ? FOR UPDATE', [order.id]);
    const existingIds = new Set(existingProducts.map((item) => item.id));
    const incomingIds = body.products.filter((item) => item.id).map((item) => item.id);
    if (new Set(incomingIds).size !== incomingIds.length || incomingIds.some((id) => !existingIds.has(id))) {
      throw conflict('Product IDs do not belong to this order');
    }
    const removedIds = [...existingIds].filter((id) => !incomingIds.includes(id));
    if (removedIds.length) {
      const placeholders = removedIds.map(() => '?').join(',');
      await connection.execute(`DELETE FROM products WHERE order_id = ? AND id IN (${placeholders})`, [order.id, ...removedIds]);
    }

    for (const product of body.products) {
      const totalPrice = product.quantity * product.unitPrice;
      if (product.id) {
        await connection.execute(
          `UPDATE products SET sku = ?, name = ?, variant = ?, units_per_carton = ?, carton_count = ?,
            weight_kg = ?, volume_m3 = ?, quantity = ?, unit_price = ?, total_price = ?, purchase_cost = ?,
            purchase_status = ?, purchased_by = IF(? = 'completed', COALESCE(purchased_by, ?), NULL),
            purchased_at = IF(? = 'completed', COALESCE(purchased_at, NOW(3)), NULL)
           WHERE id = ? AND order_id = ?`,
          [product.sku || null, product.name, product.variant, product.unitsPerCarton, product.cartons,
            product.weight, product.volume, product.quantity, product.unitPrice, totalPrice, product.purchaseCost,
            product.purchaseStatus, product.purchaseStatus, req.user.sub, product.purchaseStatus, product.id, order.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO products
            (id, order_id, sku, name, variant, units_per_carton, carton_count, weight_kg, volume_m3,
             quantity, unit_price, total_price, purchase_cost, purchase_status, purchased_by, purchased_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'completed', NOW(3), NULL))`,
          [randomUUID(), order.id, product.sku || null, product.name, product.variant, product.unitsPerCarton,
            product.cartons, product.weight, product.volume, product.quantity, product.unitPrice, totalPrice,
            product.purchaseCost, product.purchaseStatus,
            product.purchaseStatus === 'completed' ? req.user.sub : null, product.purchaseStatus]
        );
      }
    }

    const goodsTotal = body.products.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const purchaseTotal = body.products.reduce((sum, item) => sum + item.purchaseCost, 0);
    const totalQuantity = body.products.reduce((sum, item) => sum + item.quantity, 0);
    const completed = body.products.filter((item) => item.purchaseStatus === 'completed').length;
    const derivedStatus = derivePurchaseStatus(completed, body.products.length);
    const nextStatus = ['shipped', 'cancelled'].includes(order.status) ? order.status : derivedStatus;
    const nextIsCompleted = body.isCompleted ?? Boolean(order.is_completed);
    const receivedUsd = body.receivedUsd === undefined ? order.received_usd : body.receivedUsd;
    const exchangeRate = body.exchangeRate === undefined ? order.exchange_rate : body.exchangeRate;
    const commissionSnapshot = nextIsCompleted
      ? (order.commission_rate_percent ?? owners[0].commission_rate_percent)
      : null;
    await connection.execute(
      `UPDATE orders SET customer_name = ?, customer_contact = ?, shipping_address = ?, destination = ?,
       deadline = ?, payment_method = ?, currency = ?, freight = ?, goods_total = ?, total_amount = ?,
       purchase_total = ?, total_quantity = ?, received_usd = ?, exchange_rate = ?,
       commission_rate_percent = ?, is_completed = ?,
       completed_at = CASE WHEN ? = TRUE THEN COALESCE(completed_at, NOW(3)) ELSE NULL END,
       status = ?, note = ?, owner_user_id = ?, version = version + 1
       WHERE id = ?`,
      [body.customerName, body.customerContact ?? null, body.shippingAddress ?? null, body.destination ?? null,
        body.deadline, body.paymentMethod, body.currency, body.freight, goodsTotal, goodsTotal + body.freight,
        purchaseTotal, totalQuantity, receivedUsd ?? null, exchangeRate ?? null, commissionSnapshot,
        nextIsCompleted, nextIsCompleted, nextStatus, body.note ?? null, body.ownerUserId, order.id]
    );
    await connection.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
       VALUES (?, ?, ?, 'admin_order_updated', ?, ?)`,
      [order.id, order.status, nextStatus, req.user.sub, JSON.stringify({ productCount: body.products.length })]
    );
  });
  res.json({ order: await getOrderDetail(req.params.id) });
});

router.delete('/:id', requireDingAdmin, async (req, res) => {
  await withTransaction(async (connection) => {
    const [orders] = await connection.execute('SELECT id FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!orders[0]) throw notFound('Order not found');
    await connection.execute('DELETE FROM shipments WHERE order_id = ?', [req.params.id]);
    await connection.execute('DELETE FROM orders WHERE id = ?', [req.params.id]);
  });
  res.status(204).end();
});

router.post('/:id/purchase-complete', requireRoles('purchase', 'admin'), validate(purchaseSchema), async (req, res) => {
  const { productIds, purchaseTotal, products: purchaseUpdates } = req.body;
  let transition;
  await withTransaction(async (connection) => {
    const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (!order) throw notFound('Order not found');
    if (!['pending_purchase', 'purchasing'].includes(order.status)) throw conflict('Order is not in a purchasable state');
    const [allProducts] = await connection.execute('SELECT id, purchase_status FROM products WHERE order_id = ? FOR UPDATE', [order.id]);
    const requestedIds = purchaseUpdates ? purchaseUpdates.map((item) => item.id) : productIds;
    const targets = requestedIds
      ? allProducts.filter((item) => requestedIds.includes(item.id) && item.purchase_status === 'pending')
      : allProducts.filter((item) => item.purchase_status === 'pending');
    if (!targets.length) throw conflict('No pending products matched this request');
    if (requestedIds && targets.length !== new Set(requestedIds).size) {
      throw conflict('Some products are not pending or do not belong to this order');
    }
    const costs = new Map((purchaseUpdates || []).map((item) => [item.id, item.purchaseCost]));
    for (const target of targets) {
      if (costs.has(target.id)) {
        await connection.execute(
          `UPDATE products SET purchase_cost = ?, purchase_status = 'completed', purchased_by = ?, purchased_at = NOW(3)
           WHERE order_id = ? AND id = ?`,
          [costs.get(target.id), req.user.sub, order.id, target.id]
        );
      } else {
        await connection.execute(
          `UPDATE products SET purchase_status = 'completed', purchased_by = ?, purchased_at = NOW(3)
           WHERE order_id = ? AND id = ?`,
          [req.user.sub, order.id, target.id]
        );
      }
    }
    const [counts] = await connection.execute(
      "SELECT COUNT(*) AS total, SUM(purchase_status = 'completed') AS completed, SUM(purchase_cost) AS purchase_total FROM products WHERE order_id = ?",
      [order.id]
    );
    const nextStatus = derivePurchaseStatus(Number(counts[0].completed), Number(counts[0].total));
    const finalPurchaseTotal = purchaseTotal === undefined
      ? Number(counts[0].purchase_total || 0)
      : Number(purchaseTotal);
    await connection.execute(
      'UPDATE orders SET status = ?, purchase_total = ?, version = version + 1 WHERE id = ?',
      [nextStatus, finalPurchaseTotal, order.id]
    );
    await connection.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
       VALUES (?, ?, ?, 'purchase_completed', ?, ?)`,
      [order.id, order.status, nextStatus, req.user.sub, JSON.stringify({
        productIds: targets.map((item) => item.id),
        purchaseCosts: purchaseUpdates || null,
        purchaseTotal: purchaseTotal === undefined ? null : purchaseTotal
      })]
    );
    transition = { from: order.status, to: nextStatus, ownerUserId: order.owner_user_id, orderNo: order.order_no };
  });
  if (transition.to === 'purchased') {
    const recipients = await query(
      "SELECT ding_user_id FROM users WHERE id = ? OR (role IN ('logistics', 'admin') AND is_active = TRUE)",
      [transition.ownerUserId]
    );
    void sendWorkNotification({
      userIds: [...new Set(recipients.map((item) => item.ding_user_id))],
      title: `采购完成 ${transition.orderNo}`,
      markdown: `### 采购已全部完成\n订单 ${transition.orderNo} 已进入待发货队列。`,
      orderId: req.params.id
    });
  }
  res.json({ order: await getOrderDetail(req.params.id) });
});

router.post('/:id/shipments', requireRoles('logistics', 'admin'), validate(shipmentSchema), async (req, res) => {
  const body = req.body;
  const shipmentId = randomUUID();
  let ownerUserId;
  let orderNo;
  await withTransaction(async (connection) => {
    const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (!order) throw notFound('Order not found');
    if (order.status !== 'purchased') throw conflict('All products must be purchased before shipping');
    await connection.execute(
      `INSERT INTO shipments
        (id, order_id, logistics_company, tracking_no, shipped_on, estimated_arrival_on, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [shipmentId, order.id, body.logisticsCompany, body.trackingNo, body.shippedOn,
        body.estimatedArrivalOn, body.note ?? null, req.user.sub]
    );
    for (const attachment of body.attachments) {
      await insertAttachment(connection, {
        orderId: order.id, shipmentId, category: 'logistics', attachment, userId: req.user.sub
      });
    }
    await connection.execute("UPDATE orders SET status = 'shipped', version = version + 1 WHERE id = ?", [order.id]);
    await connection.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
       VALUES (?, 'purchased', 'shipped', 'shipment_created', ?, ?)`,
      [order.id, req.user.sub, JSON.stringify({ shipmentId, trackingNo: body.trackingNo })]
    );
    ownerUserId = order.owner_user_id;
    orderNo = order.order_no;
  });
  const owners = await query('SELECT ding_user_id FROM users WHERE id = ?', [ownerUserId]);
  void sendWorkNotification({
    userIds: owners.map((item) => item.ding_user_id),
    title: `订单已发货 ${orderNo}`,
    markdown: `### 订单已发货\n物流公司：${body.logisticsCompany}\n运单号：${body.trackingNo}\n预计抵达：${body.estimatedArrivalOn}`,
    orderId: req.params.id
  });
  res.status(201).json({ order: await getOrderDetail(req.params.id) });
});

router.put('/:id/shipment', requireDingAdmin, validate(adminUpdateShipmentSchema), async (req, res) => {
  const body = req.body;
  const result = await query(
    `UPDATE shipments SET logistics_company = ?, tracking_no = ?, shipped_on = ?, estimated_arrival_on = ?, note = ?
     WHERE order_id = ?`,
    [body.logisticsCompany, body.trackingNo, body.shippedOn, body.estimatedArrivalOn, body.note ?? null, req.params.id]
  );
  if (!result.affectedRows) throw notFound('Shipment not found');
  await query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
     VALUES (?, 'shipped', 'shipped', 'admin_shipment_updated', ?, ?)`,
    [req.params.id, req.user.sub, JSON.stringify({ trackingNo: body.trackingNo })]
  );
  res.json({ order: await getOrderDetail(req.params.id) });
});

router.delete('/:id/shipment', requireDingAdmin, async (req, res) => {
  await withTransaction(async (connection) => {
    const [shipments] = await connection.execute(
      `SELECT s.id, o.status FROM shipments s
       JOIN orders o ON o.id = s.order_id WHERE s.order_id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!shipments[0]) throw notFound('Shipment not found');
    await connection.execute(
      "DELETE FROM attachments WHERE order_id = ? AND shipment_id = ? AND category = 'logistics'",
      [req.params.id, shipments[0].id]
    );
    await connection.execute('DELETE FROM shipments WHERE order_id = ?', [req.params.id]);
    const [counts] = await connection.execute(
      "SELECT COUNT(*) AS total, SUM(purchase_status = 'completed') AS completed FROM products WHERE order_id = ?",
      [req.params.id]
    );
    const nextStatus = derivePurchaseStatus(Number(counts[0].completed), Number(counts[0].total));
    await connection.execute('UPDATE orders SET status = ?, version = version + 1 WHERE id = ?', [nextStatus, req.params.id]);
    await connection.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, action, actor_user_id, detail)
       VALUES (?, ?, ?, 'admin_shipment_deleted', ?, NULL)`,
      [req.params.id, shipments[0].status, nextStatus, req.user.sub]
    );
  });
  res.json({ order: await getOrderDetail(req.params.id) });
});

export default router;
