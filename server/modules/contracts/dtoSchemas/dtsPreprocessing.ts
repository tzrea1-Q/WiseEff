import { z } from "zod";

/** v1 fixes the server-owned compiler options and sandbox limits; no arbitrary flags. */
export const dtsPreprocessingReceiptSchema = z.object({
  schemaVersion: z.literal("dts-cpp/v1"), image: z.string().regex(/^gcc@sha256:[a-f0-9]{64}$/u),
  platform: z.literal("linux/amd64"), compilerVersion: z.literal("14.2.0"), language: z.literal("c17"),
  encoding: z.literal("UTF-8"), locale: z.literal("C"),
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u), outputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();
