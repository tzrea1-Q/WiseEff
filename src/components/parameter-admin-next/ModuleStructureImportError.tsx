import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

type ImportIssue = {
  path: string;
  message: string;
  code?: string;
  hint?: string;
  jsonPointer?: string;
  rule?: string;
  subject?: { subjectId?: string; kind?: string; displayAlias?: string | null; index?: number };
  module?: { ref?: string; sourceId?: string; name?: string; index?: number };
  expected?: unknown;
  received?: unknown;
  allowedValues?: unknown;
  example?: unknown;
  expectedTruncated?: boolean;
  receivedTruncated?: boolean;
  allowedValuesTruncated?: boolean;
  exampleTruncated?: boolean;
};
export type ImportDiagnostic = {
  summary: string;
  code: string;
  message: string;
  reason?: string;
  status?: number;
  requestId?: string;
  issues: ImportIssue[];
  truncated: boolean;
  phase: "read" | "preview" | "apply";
};
const MAX_ISSUES = 50;
const MAX_TEXT = 2048;
const boundedText = (text: string) => text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…（已截断）` : text;
const labels: Record<string, string> = {
  "Unsupported changes outside module metadata.": "导入文件修改了只读的导出信息，请按下列提示恢复后重试。",
  "Invalid module structure document.": "模块结构文件未通过格式校验，请检查下列字段。",
  "Subject changes are not supported.": "主体中包含不支持的修改，请检查指定字段。",
  "New, structural, or reference changes are not supported.": "暂不支持新增、结构或引用变更。",
  "Unknown or duplicate Subject.": "主体未知或重复。",
  "Duplicate module reference.": "模块引用重复。",
  "A module was deleted after export.": "模块在导出后已被删除。",
  "Module name is required.": "模块名称不能为空。",
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const pathText = (path: unknown) => Array.isArray(path) ? path.filter(part => typeof part === "string" || typeof part === "number").join(".") : typeof path === "string" ? path : "$";
const displayValue = (value: unknown) => boundedText(JSON.stringify(value) ?? "（未提供）");
const subjectKinds: Record<string, string> = { driver: "驱动主体（driver）", "node-type": "节点主体（node-type）", "configuration-schema": "配置主体（configuration-schema）" };
const issueIdentity = (value: unknown, keys: string[]) => {
  if (!record(value)) return undefined;
  return Object.fromEntries([
    ...keys.flatMap(key => typeof value[key] === "string" ? [[key, boundedText(value[key])]] : key === "displayAlias" && value[key] === null ? [[key, null]] : []),
    ...(typeof value.index === "number" && Number.isSafeInteger(value.index) && value.index >= 0 ? [["index", value.index]] : []),
  ]);
};
const normalizeIssue = (issue: Record<string, unknown>): ImportIssue => ({
  path: boundedText(pathText(issue.path)),
  message: boundedText(typeof issue.message === "string" ? issue.message : "字段无效"),
  ...Object.fromEntries(["code", "hint", "jsonPointer", "rule"].flatMap(key => typeof issue[key] === "string" ? [[key, boundedText(issue[key])]] : [])),
  ...(record(issue.subject) ? { subject: issueIdentity(issue.subject, ["subjectId", "kind", "displayAlias"]) } : {}),
  ...(record(issue.module) ? { module: issueIdentity(issue.module, ["ref", "sourceId", "name"]) } : {}),
  ...Object.fromEntries(["expected", "received", "allowedValues", "example"].flatMap(key => {
    if (!Object.prototype.hasOwnProperty.call(issue, key)) return [];
    const serialized = JSON.stringify(issue[key]) ?? "";
    const truncated = serialized.length > MAX_TEXT || issue[`${key}Truncated`] === true;
    return [[key, serialized.length > MAX_TEXT ? boundedText(serialized) : issue[key]], [`${key}Truncated`, truncated]];
  })),
});

export function importDiagnostic(cause: unknown, fallback: string, phase: ImportDiagnostic["phase"]): ImportDiagnostic {
  const apiError = cause instanceof WiseEffApiError ? cause : null;
  const rawIssues = apiError && Array.isArray(apiError.details.issues) ? apiError.details.issues : [];
  const issues = rawIssues.filter(record).slice(0, MAX_ISSUES).map(normalizeIssue);
  if (!issues.length && apiError && (typeof apiError.details.path === "string" || Array.isArray(apiError.details.path))) {
    issues.push(normalizeIssue({ ...apiError.details, message: apiError.message }));
  }
  return {
    summary: boundedText(apiError && labels[apiError.message] || presentError(cause, fallback)),
    code: apiError ? boundedText(apiError.code) : phase === "read" ? "INVALID_JSON" : "REQUEST_FAILED",
    message: boundedText(cause instanceof Error ? cause.message : fallback),
    ...(typeof apiError?.details.reason === "string" ? { reason: boundedText(apiError.details.reason) } : {}),
    ...(apiError?.status !== undefined ? { status: apiError.status } : {}),
    ...(apiError?.requestId ? { requestId: boundedText(apiError.requestId) } : {}),
    issues,
    truncated: apiError?.details.truncated === true || rawIssues.length > MAX_ISSUES,
    phase,
  };
}

export function ModuleStructureImportError({ diagnostic, context }: {
  diagnostic: ImportDiagnostic;
  context: { fileName: string; mode: "update" | "copy"; targetOrganizationId?: string; sourceOrganizationId?: string; exportId?: string };
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const boundedContext = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, typeof value === "string" ? boundedText(value) : value]));
  const report = JSON.stringify({ format: "wiseeff-module-structure-import-diagnostics", ...boundedContext, ...diagnostic }, null, 2);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(report);
      setCopyStatus("诊断信息已复制，可粘贴给编码代理。");
    } catch {
      if (detailsRef.current) detailsRef.current.open = true;
      textRef.current?.focus();
      textRef.current?.select();
      setCopyStatus("自动复制不可用，已选中诊断信息，请按 Ctrl+C 或手动复制。");
    }
  };
  return <section className="min-w-0 space-y-3" aria-label="导入错误诊断">
    <div role="alert" className="space-y-2 break-words">
      <p className="form-error">{diagnostic.summary}</p>
      {diagnostic.phase === "apply" && diagnostic.code === "CONFLICT" ? <p>请处理以下原因，再重新预览后确认。</p> : null}
      {diagnostic.issues.length ? <ol className="max-h-64 space-y-3 overflow-auto">
        {diagnostic.issues.map((issue, index) => <li key={`${index}:${issue.path}`}>
          <p><strong>字段：<code>{issue.path}</code></strong></p>
          {issue.subject ? <p>主体：{issue.subject.displayAlias ? `${issue.subject.displayAlias} · ` : ""}<code>{issue.subject.subjectId}</code>
            {issue.subject.kind ? ` · ${subjectKinds[issue.subject.kind] ?? issue.subject.kind}` : ""}
            {issue.subject.index !== undefined ? ` · subjects[${issue.subject.index}]（第 ${issue.subject.index + 1} 个主体）` : ""}</p> : null}
          {issue.module ? <p>模块：{issue.module.name ? `${issue.module.name} · ` : ""}<code>{issue.module.ref ?? issue.module.sourceId}</code>
            {issue.module.index !== undefined ? ` · modules[${issue.module.index}]（第 ${issue.module.index + 1} 个模块）` : ""}</p> : null}
          {issue.jsonPointer !== undefined ? <p>文件位置（JSON Pointer）：<code>{issue.jsonPointer || "（文档根节点，空指针）"}</code></p> : null}
          <p>{issue.message}</p>
          {Object.prototype.hasOwnProperty.call(issue, "expected") ? <p>期望值：<code>{displayValue(issue.expected)}</code>{issue.expectedTruncated ? "（仅显示部分值）" : ""}</p> : null}
          {Object.prototype.hasOwnProperty.call(issue, "received") ? <p>文件值：<code>{displayValue(issue.received)}</code>{issue.receivedTruncated ? "（仅显示部分值）" : ""}</p> : null}
          {issue.rule ? <p>校验规则：{issue.rule}</p> : null}
          {Object.prototype.hasOwnProperty.call(issue, "allowedValues") ? <p>允许值：<code>{displayValue(issue.allowedValues)}</code>{issue.allowedValuesTruncated ? "（仅显示部分值）" : ""}</p> : null}
          {issue.hint ? <p>修复建议：{issue.hint}</p> : null}
          {Object.prototype.hasOwnProperty.call(issue, "example") ? <p>格式示例（仅示意，请按实际业务填写）：<code>{displayValue(issue.example)}</code>{issue.exampleTruncated ? "（仅显示部分值）" : ""}</p> : null}
        </li>)}
      </ol> : <p>具体原因：<code>{diagnostic.message}</code></p>}
      {diagnostic.truncated ? <p>错误较多，当前仅显示前 {diagnostic.issues.length} 条。修复后重新预览以检查剩余问题。</p> : null}
      {diagnostic.requestId ? <p>请求 ID：<code>{diagnostic.requestId}</code></p> : null}
    </div>
    <Button type="button" variant="outline" onClick={() => void copy()}>复制诊断信息</Button>
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
    <details ref={detailsRef}>
      <summary>诊断详情（可提供给编码代理）</summary>
      <p>包含文件信息、错误原因和字段差异。请结合原始导出文件修复，再重新上传预览。</p>
      <Textarea ref={textRef} aria-label="导入诊断信息" readOnly value={report} rows={12} className="field-sizing-fixed max-h-64 font-mono" onFocus={event => event.currentTarget.select()} />
    </details>
  </section>;
}
