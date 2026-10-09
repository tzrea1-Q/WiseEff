import { z } from "zod";

export const driverSchemaPromotionHistoryItemSchema = z.object({
  id: z.string(),
  platformSchemaId: z.string(),
  sourceSchemaId: z.string(),
  sourceOrganizationId: z.string(),
  promotedByUserId: z.string().nullable(),
  promotedAt: z.string().datetime(),
  documentationSource: z.string().nullable(),
}).strict();

export const driverSchemaPromotionHistoryListResponseSchema = z.object({
  items: z.array(driverSchemaPromotionHistoryItemSchema),
}).strict();

export type DriverSchemaPromotionHistoryItem = z.infer<typeof driverSchemaPromotionHistoryItemSchema>;
