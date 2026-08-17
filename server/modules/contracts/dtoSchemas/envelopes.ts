import { z } from "zod";

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
    requestId: z.string()
  })
});

export const okEnvelopeSchema = z.object({
  ok: z.literal(true)
});

export function itemsEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema)
  });
}

export function itemEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    item: itemSchema
  });
}

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type OkEnvelope = z.infer<typeof okEnvelopeSchema>;
