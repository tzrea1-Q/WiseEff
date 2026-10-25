import { z } from "zod";

const searchPath = z.string().min(1).max(240).refine(value => value === value.trim() && !value.startsWith("/")
  && !/[:\\\u0000-\u001f\u007f]/u.test(value) && (value === "." || value.split("/").every(part => part !== "" && part !== "." && part !== "..")),
"搜索目录必须是清单内的相对目录。");
export const dtsDefinesSchema = z.record(z.string().regex(/^(?!__)[A-Za-z_][A-Za-z_0-9]*$/u),
  z.string().max(256).regex(/^[^\u0000-\u001f\u007f]*$/u)).refine(value => Object.keys(value).length <= 32, "最多声明 32 个构建宏。");
export const dtsBuildInputsSchema = z.object({ includeSearchPaths: z.array(searchPath).max(16).default([]), defines: dtsDefinesSchema.default({}) }).strict();
export type DtsBuildInputs = z.infer<typeof dtsBuildInputsSchema>;

/** v1 fixes the server-owned compiler options and sandbox limits; no arbitrary flags. */
export const dtsPreprocessingReceiptSchema = z.object({
  schemaVersion: z.literal("dts-cpp/v1"), image: z.string().regex(/^gcc@sha256:[a-f0-9]{64}$/u),
  platform: z.literal("linux/amd64"), compilerVersion: z.literal("14.2.0"), language: z.literal("c17"),
  encoding: z.literal("UTF-8"), locale: z.literal("C"),
  defines: dtsDefinesSchema.optional(),
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u), outputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();
