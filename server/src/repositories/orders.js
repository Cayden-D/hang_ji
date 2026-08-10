import { query } from '../db.js';
import { getOssDownloadUrl } from '../services/oss.js';

const mapAttachment = (row) => {
  const provider = row.storage_provider || (row.source_type === 'oss' ? 'oss' : 'dingtalk');
  const objectKey = provider === 'oss' ? (row.object_key || row.file_id) : null;
  return {
    id: row.id,
    category: row.category,
    provider,
    objectKey,
    url: provider === 'oss' ? getOssDownloadUrl(objectKey) : null,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileType: row.file_type,
    sourceType: row.source_type
  };
};

const mapProduct = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  variant: row.variant,
  unitsPerCarton: row.units_per_carton,
  cartons: row.carton_count,
  weight: row.weight_kg,
  volume: row.volume_m3,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  totalPrice: row.total_price,
  purchaseCost: row.purchase_cost,
  purchaseStatus: row.purchase_status,
  purchasedAt: row.purchased_at,
  images: []
});

export const mapOrder = (row) => ({
  id: row.id,
  orderNo: row.order_no,
  customerName: row.customer_name,
  customerContact: row.customer_contact,
  shippingAddress: row.shipping_address,
  destination: row.destination,
  deadline: row.deadline,
  paymentMethod: row.payment_method,
  currency: row.currency,
  freight: row.freight,
  goodsTotal: row.goods_total,
  totalAmount: row.total_amount,
  purchaseTotal: row.purchase_total,
  totalQuantity: row.total_quantity,
  status: row.status,
  note: row.note,
  ownerUserId: row.owner_user_id,
  ownerName: row.owner_name,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const getOrderDetail = async (id) => {
  const rows = await query(
    `SELECT o.*, u.name AS owner_name
     FROM orders o JOIN users u ON u.id = o.owner_user_id
     WHERE o.id = ? LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const [productRows, attachmentRows, shipmentRows, historyRows] = await Promise.all([
    query('SELECT * FROM products WHERE order_id = ? ORDER BY created_at, id', [id]),
    query('SELECT * FROM attachments WHERE order_id = ? ORDER BY created_at', [id]),
    query('SELECT * FROM shipments WHERE order_id = ? LIMIT 1', [id]),
    query(
      `SELECT h.*, u.name AS actor_name FROM order_status_history h
       JOIN users u ON u.id = h.actor_user_id WHERE h.order_id = ? ORDER BY h.created_at`,
      [id]
    )
  ]);
  const products = productRows.map(mapProduct);
  const productMap = new Map(products.map((item) => [item.id, item]));
  const paymentAttachments = [];
  const logisticsAttachments = [];
  for (const row of attachmentRows) {
    const item = mapAttachment(row);
    if (row.product_id && productMap.has(row.product_id)) productMap.get(row.product_id).images.push(item);
    else if (row.category === 'payment') paymentAttachments.push(item);
    else if (row.category === 'logistics') logisticsAttachments.push(item);
  }
  const shipment = shipmentRows[0] ? {
    id: shipmentRows[0].id,
    logisticsCompany: shipmentRows[0].logistics_company,
    trackingNo: shipmentRows[0].tracking_no,
    shippedOn: shipmentRows[0].shipped_on,
    estimatedArrivalOn: shipmentRows[0].estimated_arrival_on,
    note: shipmentRows[0].note,
    attachments: logisticsAttachments
  } : null;
  return {
    ...mapOrder(rows[0]),
    products,
    paymentAttachments,
    shipment,
    history: historyRows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      action: row.action,
      actorName: row.actor_name,
      detail: row.detail,
      createdAt: row.created_at
    }))
  };
};
