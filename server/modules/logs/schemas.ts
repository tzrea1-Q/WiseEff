import { z } from "zod";

import { logRecordStatuses } from "./status";

const nonEmptyString = z.string().min(1);
const base64String = nonEmptyString.refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").toString("base64") === value;
    } catch {
      return false;
    }
  },
  { message: "Expected valid base64 content." }
);
const booleanQuerySchema = z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) => value === true || value === "true");

export const createLogFileBodySchema = z.object({
  fileName: nonEmptyString,
  contentType: nonEmptyString,
  contentBase64: base64String,
  analysisQuestion: z.string().optional(),
  relatedParameterId: nonEmptyString.optional()
});

export const createLogBodySchema = z.object({
  fileObjectId: nonEmptyString,
  fileName: nonEmptyString,
  analysisQuestion: z.string().optional(),
  relatedParameterId: nonEmptyString.optional()
});

export const listLogsQuerySchema = z.object({
  status: z.enum(logRecordStatuses).optional(),
  timeWindow: z.enum(["today", "7d", "30d"]).optional(),
  includeArchived: booleanQuerySchema.optional()
});

export const logFeedbackBodySchema = z.object({
  rating: z.enum(["helpful", "not_helpful"]),
  note: z.string().max(2000).optional()
});

export const rerunLogBodySchema = z.object({
  analysisQuestion: z.string().optional()
});

export type CreateLogFileBody = z.infer<typeof createLogFileBodySchema>;
export type CreateLogBody = z.infer<typeof createLogBodySchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
export type LogFeedbackBody = z.infer<typeof logFeedbackBodySchema>;
export type RerunLogBody = z.infer<typeof rerunLogBodySchema>;
