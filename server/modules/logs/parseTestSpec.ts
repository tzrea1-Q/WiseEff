import { z } from "zod";
import { decodedEventSchema, MAX_PARSING_LINE_CHARS } from "./parsing/spec";

export const MAX_PARSE_TESTS = 50;
export const MAX_PARSE_TEST_LINES = 200;
export const MAX_PARSE_TEST_CHARS = 1024 * 1024;
export const MAX_PARSE_TEST_RUN_LINES = 5000;
export const MAX_PARSE_TEST_EXPECT_CHARS = 64 * 1024;

export type ParseTestValue = string | number | boolean | null | ParseTestValue[] | { [key: string]: ParseTestValue };
function isTestValue(value: unknown, depth = 0): value is ParseTestValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth >= 12) return false;
  return Object.values(value).every((child) => isTestValue(child, depth + 1));
}
const testValueSchema = z.custom<ParseTestValue>(isTestValue, "Expected a JSON value with depth at most 12");
const fieldPath = z.string().min(1).max(1024).regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/)
  .refine((path) => !path.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part)), "Unsafe field path");
export const parseTestSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200),
  lines: z.array(z.string().max(MAX_PARSING_LINE_CHARS).refine((line) => !/[\r\n]/.test(line), "Each item must contain one line")).min(1).max(MAX_PARSE_TEST_LINES),
  fileName: z.string().min(1).max(1024).optional(),
  expect: z.object({
    fields: z.record(fieldPath, testValueSchema).refine((fields) => Object.keys(fields).length <= 200, "At most 200 expected field paths").optional(),
    signals: z.array(z.string().min(1).max(200)).max(200).optional(), exactSignals: z.boolean().optional()
  }).strict().refine((expect) => JSON.stringify(expect).length <= MAX_PARSE_TEST_EXPECT_CHARS, "Expectations exceed 64 KiB")
}).strict();
export const parseTestsSchema = z.array(parseTestSchema).max(MAX_PARSE_TESTS).superRefine((tests, ctx) => {
  const ids = new Set<string>();
  for (const [index, test] of tests.entries()) {
    if (ids.has(test.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate parse test id" });
    ids.add(test.id);
  }
  if (tests.reduce((sum, test) => sum + test.lines.length, 0) > MAX_PARSE_TEST_RUN_LINES) ctx.addIssue({ code: "custom", message: "Parse tests exceed 5000 total lines" });
  if (tests.reduce((sum, test) => sum + test.lines.reduce((chars, line) => chars + line.length, 0), 0) > MAX_PARSE_TEST_CHARS) ctx.addIssue({ code: "custom", message: "Parse tests exceed 1 MiB of sample characters" });
});
export const parseTestResultSchema = z.object({
  id: z.string(), name: z.string(), passed: z.boolean(),
  // A deadline can expire before the runner evaluates this file's applicability.
  applicability: z.object({ skillMatched: z.boolean(), role: z.string().nullable() }).strict().optional(),
  diffs: z.array(z.object({ path: z.string(), expected: testValueSchema, actual: testValueSchema, missing: z.boolean().optional() }).strict()),
  missingSignals: z.array(z.string()), unexpectedSignals: z.array(z.string()),
  events: z.array(decodedEventSchema), signals: z.array(z.string()), error: z.string().optional()
}).strict();
export const parseTestRunSchema = z.object({ total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), results: z.array(parseTestResultSchema), truncated: z.boolean() }).strict();
export type ParseTest = z.infer<typeof parseTestSchema>;
export type ParseTestResult = z.infer<typeof parseTestResultSchema>;
export type ParseTestRun = z.infer<typeof parseTestRunSchema>;
