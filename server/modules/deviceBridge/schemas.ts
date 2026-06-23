import { z } from "zod";

const nonEmptyString = z.string().min(1);
const pairingCodeString = z.string().regex(/^\d{6}$/, "Expected a 6-digit pairing code.");

export const pairWithCodeBodySchema = z.object({
  code: pairingCodeString,
  machineLabel: nonEmptyString,
  platform: z.enum(["windows", "darwin", "linux"]),
  arch: nonEmptyString,
  clientVersion: nonEmptyString.optional()
});

export const issuePairingCodeResponseSchema = z.object({
  code: pairingCodeString,
  expiresAt: nonEmptyString
});

export const pairWithCodeResponseSchema = z.object({
  bridgeId: nonEmptyString,
  bridgeToken: z.string().regex(/^wb_/),
  tokenExpiresAt: nonEmptyString
});

export const bridgeIdParamsSchema = z.object({
  bridgeId: z.string().trim().min(1)
});

export type PairWithCodeBody = z.infer<typeof pairWithCodeBodySchema>;
export type IssuePairingCodeResponse = z.infer<typeof issuePairingCodeResponseSchema>;
export type PairWithCodeResponse = z.infer<typeof pairWithCodeResponseSchema>;
