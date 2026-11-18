import { z } from "zod";
import { MAX_PROCEDURE_CHECKS, MAX_PROCEDURE_CHECK_DESCRIPTION, PROCEDURE_CHECK_ID } from "../../../src/domain/logs/procedureChecks";

const line = z.number().int().safe().positive();
export const logGroundedAnchorSchema = z.union([
  z.object({ file: z.string().max(1024), line }).strict(),
  z.object({ snapshotId: z.string().min(1).max(200), path: z.string().min(1).max(1024), line }).strict()
]);
const text = z.string().trim().min(1).max(240).regex(/^[^\p{Cc}\p{Cs}]*$/u);
const anchors = z.array(logGroundedAnchorSchema).max(4);
const MAX_HYPOTHESES = 8;
export const MAX_HYPOTHESIS_BYTES = 4096;

const logHypothesisSchema = z.object({
  id: text.max(48),
  statement: text,
  status: z.enum(["open", "supported", "refuted", "inconclusive"]),
  anchors
});
export const logHypothesesSchema = z.array(logHypothesisSchema).max(MAX_HYPOTHESES);
export const logTraceHypothesesSchema = z.array(logHypothesisSchema.omit({ statement: true })).max(MAX_HYPOTHESES)
  .transform((items) => items.map(({ status, anchors }, index) => ({ id: String(index + 1), status, anchors })));

export const logAlternativeHypothesesSchema = z.array(z.object({
  statement: text,
  reason: text,
  anchors: anchors.min(1)
})).min(1).max(MAX_HYPOTHESES);

export type LogHypothesisAnchor = z.infer<typeof logGroundedAnchorSchema>;
export type LogHypothesis = z.infer<typeof logHypothesesSchema>[number];
export type LogTraceHypothesis = z.infer<typeof logTraceHypothesesSchema>[number];
export type LogAlternativeHypothesis = z.infer<typeof logAlternativeHypothesesSchema>[number];

const checkId = z.string().regex(PROCEDURE_CHECK_ID);
const procedureCheckSchema = z.object({ id: checkId,
  description: z.string().min(1).max(MAX_PROCEDURE_CHECK_DESCRIPTION), required: z.boolean() }).strict();
export const procedureChecksSchema = z.array(procedureCheckSchema).max(MAX_PROCEDURE_CHECKS);
export function readStoredProcedureChecks(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_PROCEDURE_CHECKS) return undefined;
  const result = procedureChecksSchema.safeParse(value);
  return result.success && new Set(result.data.map(({ id }) => id)).size === result.data.length ? result.data : undefined;
}
const checkUpdateSchema = z.object({ id: checkId, status: z.enum(["done", "skipped"]), reason: text.optional(), anchors });
export const logCheckUpdatesSchema = z.array(checkUpdateSchema).max(MAX_PROCEDURE_CHECKS);
export const logReportChecksSchema = z.array(procedureCheckSchema.extend({
  status: z.enum(["done", "skipped", "pending"]), reason: text.optional(), anchors
})).min(1).max(MAX_PROCEDURE_CHECKS);
export type LogCheckUpdate = z.infer<typeof checkUpdateSchema>;
export type LogReportCheck = z.infer<typeof logReportChecksSchema>[number];
