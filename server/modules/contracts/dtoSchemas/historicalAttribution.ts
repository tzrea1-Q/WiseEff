import { z } from "zod";

const identity = z.object({ id: z.string().nullable(), name: z.string().nullable(),
  source: z.enum(["recorded", "legacy-current", "unknown"]) });

export const historicalAttributionSchema = z.object({ organization: identity,
  actors: z.record(z.string(), identity) });
