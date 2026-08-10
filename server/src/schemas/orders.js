import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(0).max(999999999999);
const attachment = z.object({
  provider: z.literal('oss'),
  objectKey: z.string().trim().min(1).max(1024),
  url: z.string().url().max(4096).optional().nullable(),
  fileName: z.string().trim().min(1).max(512),
  fileSize: z.coerce.number().int().nonnegative().optional().nullable(),
  fileType: z.string().trim().max(128).optional().nullable(),
  sourceType: z.literal('oss').default('oss')
});

const product = z.object({
  sku: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(255),
  variant: z.string().trim().min(1).max(255),
  unitsPerCarton: z.coerce.number().int().nonnegative(),
  cartons: z.coerce.number().int().nonnegative(),
  weight: z.coerce.number().nonnegative(),
  volume: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: money,
  purchaseCost: money,
  images: z.array(attachment).max(9).default([])
});

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(255),
  customerContact: z.string().trim().max(255).optional().nullable(),
  shippingAddress: z.string().trim().max(1000).optional().nullable(),
  destination: z.string().trim().max(255).optional().nullable(),
  deadline: date,
  paymentMethod: z.enum(['T/T', 'L/C', 'D/P', 'D/A', 'OTHER']),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  freight: money.default(0),
  note: z.string().trim().max(5000).optional().nullable(),
  products: z.array(product).min(1).max(100),
  paymentAttachments: z.array(attachment).max(9).default([])
});

export const listOrdersSchema = z.object({
  status: z.enum(['pending_purchase', 'purchasing', 'purchased', 'shipped', 'cancelled']).optional(),
  search: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const purchaseSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(100).optional()
});

export const shipmentSchema = z.object({
  logisticsCompany: z.string().trim().min(1).max(255),
  trackingNo: z.string().trim().min(1).max(255),
  shippedOn: date,
  estimatedArrivalOn: date,
  note: z.string().trim().max(5000).optional().nullable(),
  attachments: z.array(attachment).max(9).default([])
}).refine((value) => value.estimatedArrivalOn >= value.shippedOn, {
  message: 'Estimated arrival cannot be earlier than shipment date',
  path: ['estimatedArrivalOn']
});

const adminProduct = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(255),
  variant: z.string().trim().min(1).max(255),
  unitsPerCarton: z.coerce.number().int().nonnegative(),
  cartons: z.coerce.number().int().nonnegative(),
  weight: z.coerce.number().nonnegative(),
  volume: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: money,
  purchaseCost: money,
  purchaseStatus: z.enum(['pending', 'completed'])
});

export const adminReplaceOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(255),
  customerContact: z.string().trim().max(255).optional().nullable(),
  shippingAddress: z.string().trim().max(1000).optional().nullable(),
  destination: z.string().trim().max(255).optional().nullable(),
  deadline: date,
  paymentMethod: z.enum(['T/T', 'L/C', 'D/P', 'D/A', 'OTHER']),
  currency: z.string().trim().toUpperCase().length(3),
  freight: money,
  note: z.string().trim().max(5000).optional().nullable(),
  ownerUserId: z.string().uuid(),
  products: z.array(adminProduct).min(1).max(100)
});

export const adminUpdateShipmentSchema = z.object({
  logisticsCompany: z.string().trim().min(1).max(255),
  trackingNo: z.string().trim().min(1).max(255),
  shippedOn: date,
  estimatedArrivalOn: date,
  note: z.string().trim().max(5000).optional().nullable()
}).refine((value) => value.estimatedArrivalOn >= value.shippedOn, {
  message: 'Estimated arrival cannot be earlier than shipment date',
  path: ['estimatedArrivalOn']
});
