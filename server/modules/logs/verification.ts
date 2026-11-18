import { z } from "zod";

export const logVerificationSchema = z.object({
  status: z.enum(["passed", "revised", "failed", "skipped"]),
  checkedClaims: z.number().int().nonnegative(),
  unsupportedClaims: z.number().int().nonnegative(),
  model: z.string().min(1)
});

export type LogVerification = z.infer<typeof logVerificationSchema>;
