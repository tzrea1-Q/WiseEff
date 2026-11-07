import { ApiError } from "../../../shared/http/errors";
import type { z } from "zod";

type Subject = { subjectId: string; kind?: "driver" | "node-type" | "configuration-schema"; displayAlias?: string | null };
type Rule = { mode?: "inherit" | "override"; override?: Record<string, unknown> | null; effective?: Record<string, unknown> } | null | undefined;
const subjectContext = (index: number, subject: Subject) => ({ index, subjectId: subject.subjectId,
  ...(subject.kind ? { kind: subject.kind } : {}), ...(subject.displayAlias != null ? { displayAlias: subject.displayAlias } : {}) });
export type RecognitionImportIssue = {
  path: string; code: string; message: string; received?: unknown; expected?: unknown;
  rule?: string; hint: string; example?: unknown; allowedValues?: unknown[];
};

export function prefixSubjectSchemaIssues(issues: readonly z.ZodIssue[]): Record<string, unknown>[] {
  return issues.map(issue => ({ ...issue, path: ["document", "subjects", ...issue.path],
    ...(issue.code === "invalid_union" ? { unionErrors: issue.unionErrors.map(error => ({ issues: prefixSubjectSchemaIssues(error.issues) })) } : {}),
    hint: "复制模式要求完整主体快照；请从原始导出恢复此字段及其类型，再修改允许编辑的内容。" }));
}

const fieldRules: Record<string, Pick<RecognitionImportIssue, "rule" | "example" | "allowedValues">> = {
  compatibles: { rule: "driver 的 compatibles 是 compatible 字符串数组，不能为 null。", example: ["acme,power"] },
  nodeTypeName: { rule: "node-type 的 nodeTypeName 是不带 @地址的节点类型名，不能为 null。", example: "battery_checker" },
  driverNature: { rule: "driverNature 必须使用支持的驱动类别。", allowedValues: ["physical-device", "logical-service"] },
  instanceCardinality: { rule: "instanceCardinality 必须使用支持的实例容量。", allowedValues: ["multiple", "singleton-per-project"] },
};

export function requiredRecognitionField(field: string, received: unknown): RecognitionImportIssue {
  return { path: `override.${field}`, code: "required-recognition-field", message: `${field} 不能清空为 null。`, received,
    ...fieldRules[field], hint: `将 ${field} 改为符合规则的值；更新现有主体时，也可以删除该字段以保留原值。` };
}

/** Explanations for guards that have already rejected the request; this does not choose acceptance. */
export function recognitionShapeIssues(kind: Subject["kind"], rule: Rule, profile: "new" | "copy"): RecognitionImportIssue[] {
  if (kind === "configuration-schema") return [{ path: "", code: "recognition-not-supported", received: rule,
    message: "configuration-schema 主体不支持驱动或节点识别规则。", expected: null,
    rule: "configuration-schema 的 recognition 必须为 null 或在更新文件中省略。", hint: "恢复 recognition 为 null；不要更改主体 kind 来适配识别规则。" }];
  if (!rule) return [{ path: "", code: "recognition-required", received: rule ?? null,
    message: `${kind} 主体需要识别规则。`, rule: "保留完整导出规则，或在新增登记时显式选择 inherit / override。",
    hint: "从原始导出恢复 recognition；新增登记可使用示例继承目录默认规则。", example: { mode: "inherit", override: null } }];
  const issues: RecognitionImportIssue[] = [];
  if (profile === "new" && rule.effective !== undefined) issues.push({ path: "effective", code: "readonly-recognition-effective", received: rule.effective,
    message: "新增登记不能提交 effective。", rule: "effective 由目录默认规则和 override 计算，新增登记时必须省略。",
    hint: "删除 recognition.effective；需要自定义时只修改 recognition.override。" });
  if (rule.mode !== "inherit" && rule.mode !== "override") issues.push({ path: "mode", code: "recognition-mode-required", received: rule.mode ?? null,
    message: "新增登记必须明确选择识别规则模式。", allowedValues: ["inherit", "override"],
    hint: "使用 inherit 继承目录规则，或使用 override 并提供适用于该主体类型的字段。", example: "inherit" });
  if (rule.mode === "inherit") {
    if (rule.override != null) issues.push({ path: "override", code: "inherited-rule-has-override", received: rule.override, expected: null,
      message: "inherit 模式不能同时提交覆盖规则。", rule: "recognition.mode 为 inherit 时，override 应为 null（更新/新增时也可省略）。",
      hint: "保留 inherit 并将 override 改为 null；如果确实要自定义规则，则改用 override 模式。" });
    return issues;
  }
  if (!rule.override) {
    issues.push({ path: "override", code: "recognition-override-required", received: rule.override ?? null,
      message: "override 模式需要提供覆盖规则。", rule: kind === "driver" ? "driver 使用 compatibles、driverNature、instanceCardinality。" : "node-type 使用 nodeTypeName。",
      hint: "提供适用于该主体类型的 override，或切换为 inherit 并将 override 设为 null。",
      example: kind === "driver" ? { compatibles: ["acme,power"], driverNature: "physical-device", instanceCardinality: "multiple", nodeTypeName: null }
        : { nodeTypeName: "battery_checker", compatibles: [], driverNature: null, instanceCardinality: null } });
    return issues;
  }
  const override = rule.override;
  const required = kind === "driver" ? ["compatibles", "driverNature", "instanceCardinality"] : ["nodeTypeName"];
  for (const field of required) if (override[field] === null) issues.push(requiredRecognitionField(field, override[field]));
  const neutral = kind === "driver" ? { nodeTypeName: null } : { compatibles: [], driverNature: null, instanceCardinality: null };
  for (const [field, expected] of Object.entries(neutral)) {
    const received = override[field];
    const invalid = field === "compatibles" ? Array.isArray(received) && received.length > 0
      : profile === "copy" ? received !== null : received != null;
    if (invalid) issues.push({ path: `override.${field}`, code: "recognition-field-kind-mismatch", received, expected,
      message: `${kind} 主体不能使用 ${field} 作为识别规则。`,
      rule: kind === "driver" ? "driver 通过 compatibles 识别；nodeTypeName 仅用于 node-type。" : "node-type 通过 nodeTypeName 识别；驱动字段不适用。",
      hint: `将 ${field} 恢复为 ${Array.isArray(expected) ? "空数组 []" : "null"}${profile === "new" ? "，或在新增登记中省略该字段" : ""}；不要修改主体 kind。` });
  }
  return issues;
}

export function recognitionShapeError(index: number, subject: Subject, message: string, issues: RecognitionImportIssue[]): ApiError {
  return new ApiError("VALIDATION_FAILED", message, {
    reason: "invalid-recognition-shape", path: `subjects.${index}.recognition`,
    issues: issues.map(issue => ({ ...issue, path: `document.subjects.${index}.recognition${issue.path ? `.${issue.path}` : ""}`,
      subject: subjectContext(index, subject) })),
  });
}

export async function withRecognitionImportContext<T>(index: number, subject: Subject, section: "override" | "effective", operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof ApiError) || (error.code !== "VALIDATION_FAILED" && error.code !== "CONFLICT")) throw error;
    const prefix = `document.subjects.${index}.recognition.${section}`;
    const sourceIssues = Array.isArray(error.details.issues) ? error.details.issues : [];
    const issues = sourceIssues.length ? sourceIssues.map(issue => {
      const value = issue as Record<string, unknown>;
      const path = Array.isArray(value.path) ? value.path.join(".") : typeof value.path === "string" ? value.path : "";
      return { ...value, path: path.startsWith("document.") ? path : `${prefix}${path ? `.${path}` : ""}`, subject: subjectContext(index, subject) };
    }) : [{ path: error.message === "已有项目实例超过单例容量。" ? `${prefix}.instanceCardinality` : prefix,
      code: error.code, message: error.message, subject: subjectContext(index, subject),
      ...(error.message === "已有项目实例超过单例容量。" ? { received: "singleton-per-project", rule: "单例容量要求每个项目最多存在一个匹配实例。",
        hint: "先处理已有项目中的多个实例；如果业务允许多实例，可显式选择 override，并将 override.instanceCardinality 设为 multiple。继承模式的 effective 不可直接修改。",
        allowedValues: ["multiple", "singleton-per-project"] } : { hint: "根据该主体的具体原因处理后重新预览；目录或登记已变化时，请重新导出。" }) }];
    throw new ApiError(error.code, error.message, { ...error.details, path: `subjects.${index}.recognition.${section}`, issues });
  }
}
