import { z } from "zod";

const rowSchema = z.object({ row: z.number().int().min(2).max(5000), name: z.string(), username: z.string(), password: z.string(), title: z.string(), roles: z.string() }).strict();
export const userImportPreviewBodySchema = z.object({ rows: z.array(rowSchema).min(1).max(500) }).strict();
export const userImportCreateBodySchema = z.object({ importId: z.string().uuid(), previewToken: z.string(), rows: z.array(rowSchema).min(1).max(500) }).strict();
export const userImportReceiptSchema = z.object({ item: z.object({ importId: z.string().uuid(), organizationId: z.string(), count: z.number(), rows: z.array(z.object({ row: z.number(), userId: z.string(), name: z.string().optional(), username: z.string().nullable().optional() })) }) });
export const userImportPreviewResponseSchema = z.object({ item: z.object({
  organization: z.object({ id: z.string(), name: z.string(), status: z.string() }),
  rows: z.array(z.object({ row: z.number(), name: z.string(), username: z.string(), title: z.string(), roles: z.array(z.string()) })),
  errors: z.array(z.object({ row: z.number(), field: z.string(), message: z.string() })),
  total: z.number(), privilegedCount: z.number(), token: z.string().nullable()
}) });
