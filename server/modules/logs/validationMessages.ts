import type { z } from "zod";

/** Human-readable diagnostics shared by log API and skill-package validation. */
export function logValidationMessage(issue: z.ZodIssue): string {
  if (/[\u3400-\u9fff]/.test(issue.message)) return issue.message;
  if (issue.code === "invalid_type") return `${issue.received === "undefined" ? "缺少必需字段" : "字段类型无效"}（预期 ${issue.expected}，实际 ${issue.received}）`;
  if (issue.code === "too_big") return `超出上限（${issue.maximum}）`;
  if (issue.code === "too_small") return `未达到最小值（${issue.minimum}）`;
  if (issue.code === "invalid_literal") return `必须为 ${String(issue.expected)}`;
  if (issue.code === "invalid_enum_value") return `值不在允许的选项中（允许 ${issue.options.join("、")}，实际 ${String(issue.received)}）`;
  if (issue.code === "unrecognized_keys") return "包含不支持的字段";
  if (issue.code === "invalid_string") return `字段格式无效（${JSON.stringify(issue.validation)}）`;
  return `配置无效：${issue.message}`;
}

export function logValidationIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => ({ ...issue, message: logValidationMessage(issue) }));
}
