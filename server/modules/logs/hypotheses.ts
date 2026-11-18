import { z } from "zod";

const line = z.number().int().safe().positive();
export const logGroundedAnchorSchema = z.union([
  z.object({ file: z.string().max(1024), line }).strict(),
  z.object({ snapshotId: z.string().min(1).max(200), path: z.string().min(1).max(1024), line }).strict()
]);
const text = z.string().trim().min(1).max(240).regex(/^[^\p{Cc}\p{Cs}]*$/u);
const anchors = z.array(logGroundedAnchorSchema).max(4);
const MAX_HYPOTHESES = 8;
export const MAX_HYPOTHESIS_BYTES = 4096;

export const logHypothesesSchema = z.array(z.object({
  id: text.max(48),
  statement: text,
  status: z.enum(["open", "supported", "refuted", "inconclusive"]),
  anchors
})).max(MAX_HYPOTHESES);

export const logAlternativeHypothesesSchema = z.array(z.object({
  statement: text,
  reason: text,
  anchors: anchors.min(1)
})).min(1).max(MAX_HYPOTHESES);

export type LogHypothesisAnchor = z.infer<typeof logGroundedAnchorSchema>;
export type LogHypothesis = z.infer<typeof logHypothesesSchema>[number];
export type LogAlternativeHypothesis = z.infer<typeof logAlternativeHypothesesSchema>[number];
