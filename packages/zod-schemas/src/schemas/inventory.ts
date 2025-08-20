import { z } from 'zod'

export const itemTypeEnum = z.enum(['raw', 'packaging', 'finished', 'misc'])

export const createItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sku: z.string().optional(),
  type: itemTypeEnum,
  category: z.string().optional(),
  subcategory: z.string().optional(),
  uom: z.string().min(1, 'Unit of measure is required'),
  conversions: z.record(z.number()).optional(),
  reorderLevel: z.number().positive().optional(),
  reorderQty: z.number().positive().optional(),
  vendorId: z.string().uuid().optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

export const updateItemSchema = createItemSchema.partial()

export const createItemLotSchema = z.object({
  itemId: z.string().uuid(),
  lotCode: z.string().min(1, 'Lot code is required'),
  qty: z.number().min(0, 'Quantity must be non-negative'),
  uom: z.string().min(1, 'Unit of measure is required'),
  unitCost: z.number().positive().optional(),
  expiry: z.string().datetime().optional(),
  locationId: z.string().uuid(),
  receivedDate: z.string().datetime().optional(),
})

export const inventoryAdjustmentSchema = z.object({
  itemId: z.string().uuid(),
  itemLotId: z.string().uuid().optional(),
  qty: z.number(),
  uom: z.string().min(1),
  locationId: z.string().uuid(),
  reason: z.string().min(1, 'Reason is required'),
  notes: z.string().optional(),
})

export const inventoryTransferSchema = z.object({
  itemLotId: z.string().uuid(),
  qty: z.number().positive(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>
export type CreateItemLotInput = z.infer<typeof createItemLotSchema>
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>
export type InventoryTransferInput = z.infer<typeof inventoryTransferSchema>