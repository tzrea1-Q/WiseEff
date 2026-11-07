import { ApiError } from "../../../shared/http/errors";
import type { z } from "zod";
import type { moduleStructureExportSchema } from "../../contracts/dtoSchemas/moduleStructure";

const ISSUE_LIMIT = 50;
const VALUE_LIMIT = 1000;
type ReadonlyDocument = Pick<z.infer<typeof moduleStructureExportSchema>, "source" | "limits" | "counts" | "references">;
type Issue = {
  path: string;
  code: "readonly_field";
  message: string;
  hint: string;
  expected: unknown;
  received: unknown;
  expectedTruncated?: boolean;
  receivedTruncated?: boolean;
};

const hints: Record<keyof ReadonlyDocument, string> = {
  source: "保留同一次原始导出的 source；不要替换导出 ID、来源组织或 Catalog 版本。",
  limits: "恢复原始导出的 limits；修改文件中的限制不能放宽服务端限制。",
  counts: "恢复原始导出的 counts；它记录导出时的数量，新增或删除模块、登记主体后也不要重新计算。",
  references: "恢复同一次原始导出的 references，包括条目内容与数组顺序；请在 modules 中编辑业务模块。",
};

function preview(value: unknown): { value: unknown; truncated: boolean } {
  const serialized = JSON.stringify(value);
  return serialized.length > VALUE_LIMIT
    ? { value: `${serialized.slice(0, VALUE_LIMIT)}…`, truncated: true }
    : { value, truncated: false };
}

/** Compare only the already-authorized export's immutable envelope, never the live organization. */
export function assertReadonlyModuleStructure(document: ReadonlyDocument, baseline: ReadonlyDocument): void {
  const issues: Issue[] = [];
  let truncated = false;
  const add = (path: string, expected: unknown, received: unknown, field: keyof ReadonlyDocument) => {
    if (issues.length === ISSUE_LIMIT) { truncated = true; return; }
    const before = preview(expected), after = preview(received);
    issues.push({ path, code: "readonly_field", message: "此字段是只读导出信息，与原始导出基准不一致。", hint: hints[field],
      expected: before.value, received: after.value,
      ...(before.truncated ? { expectedTruncated: true } : {}), ...(after.truncated ? { receivedTruncated: true } : {}) });
  };
  const compare = (expected: unknown, received: unknown, path: string, field: keyof ReadonlyDocument): void => {
    if (truncated || expected === received) return;
    if (Array.isArray(expected) && Array.isArray(received)) {
      if (expected.length !== received.length) add(`${path}.length`, expected.length, received.length, field);
      for (let index = 0; index < Math.min(expected.length, received.length) && !truncated; index++) {
        compare(expected[index], received[index], `${path}.${index}`, field);
      }
    } else if (expected && received && typeof expected === "object" && typeof received === "object" && !Array.isArray(expected) && !Array.isArray(received)) {
      const before = expected as Record<string, unknown>, after = received as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        // Parsed protected fields are required; a legacy baseline can still lack a field.
        if (!(key in before) || !(key in after)) add(`${path}.${key}`, before[key] ?? null, after[key] ?? null, field);
        else compare(before[key], after[key], `${path}.${key}`, field);
        if (truncated) break;
      }
    } else add(path, expected ?? null, received ?? null, field);
  };
  for (const field of ["source", "limits", "counts", "references"] as const) compare(baseline[field], document[field], `document.${field}`, field);
  if (issues.length) throw new ApiError("VALIDATION_FAILED", "Unsupported changes outside module metadata.", {
    reason: "readonly-module-structure-fields", issues, truncated, issueLimit: ISSUE_LIMIT,
  });
}
