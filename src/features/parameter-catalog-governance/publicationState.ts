import type { CatalogAuthorizedAction, CatalogActorKind } from "@/application/parameter-catalog/authority";
import { isCatalogActionEnabled } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import { catalogStateFromFailure } from "@/application/parameter-catalog/states";
import { catalogErrorCopy } from "@/features/parameter-catalog/copy";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import { decodeDtsString } from "@/domain/dts/dtsValueClient";
import type {
  CatalogCreatePublicationCandidateRequest,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";

export const publicationSupportedValueTypes = [
  "integer",
  "number",
  "string",
  "boolean",
  "empty",
  "u32-array",
  "string-list",
  "bytes",
  "phandle-list",
  "mixed"
] as const;
export type PublicationValueType = (typeof publicationSupportedValueTypes)[number];

export const publicationSupportedUnits = ["mA", "mV", "ms", "uOhm", "µA"] as const;
export type PublicationUnit = string;

export const publicationModes = [
  "create-definition",
  "create-subject",
  "revise-definition",
  /**
   * Issue #847 decision 10: reversible definition lifecycle. `retire-definition`
   * publishes canonical soft retirement (blocks new matching/use, keeps the
   * permanent identity, revisions and pinned historical references) and
   * `restore-definition` publishes `active` for the same identity and key.
   */
  "retire-definition",
  "restore-definition"
] as const;
export type PublicationMode = (typeof publicationModes)[number];

export const publicationSubjectKinds = ["driver", "node-type", "configuration-schema"] as const;
export type PublicationSubjectKind = (typeof publicationSubjectKinds)[number];

export const publicationDriverNatures = ["physical-device", "logical-service"] as const;
export type PublicationDriverNature = (typeof publicationDriverNatures)[number];

export const publicationDriverCardinalities = ["multiple", "singleton-per-project"] as const;
export type PublicationDriverCardinality = (typeof publicationDriverCardinalities)[number];

export const publicationReviseClasses = ["documentation", "semantic"] as const;
export type PublicationReviseClass = (typeof publicationReviseClasses)[number];

export type PublicationDraft = {
  mode: PublicationMode;
  subjectId: string;
  subjectKind: PublicationSubjectKind;
  canonicalKey: string;
  selectorValue: string;
  nature: PublicationDriverNature | "";
  cardinality: PublicationDriverCardinality | "";
  definitionId: string;
  reviseClass: PublicationReviseClass;
  propertyKey: string;
  displayName: string;
  documentation: string;
  /** Optional author description, distinct from long-form documentation. */
  description: string;
  valueType: PublicationValueType;
  minimum: string;
  maximum: string;
  unit: string;
  examples: string;
  reason: string;
};

export const emptyPublicationDraft = (): PublicationDraft => ({
  mode: "create-definition",
  subjectId: "",
  subjectKind: "driver",
  canonicalKey: "",
  selectorValue: "",
  nature: "physical-device",
  cardinality: "multiple",
  definitionId: "",
  reviseClass: "documentation",
  propertyKey: "",
  displayName: "",
  documentation: "",
  description: "",
  valueType: "integer",
  minimum: "",
  maximum: "",
  unit: "",
  examples: "",
  reason: ""
});

export const publicationCopy = {
  entry: "新增定义",
  title: "向已发布主体新增定义",
  titleCreateSubject: "新增主体",
  titleRevise: "修订已有定义",
  mode: "变更类型",
  modeCreateDefinition: "新增定义",
  modeCreateSubject: "新增主体",
  modeRevise: "修订定义",
  unpublishedEmpty: "暂无可新增定义的主体。请先创建主体。",
  subjectKindPick: "主体类型",
  selectorValue: {
    driver: "compatible 标识",
    "node-type": "节点名称",
    "configuration-schema": "配置规范标识"
  },
  nature: "驱动性质",
  naturePhysical: "物理设备",
  natureLogical: "逻辑服务",
  cardinality: "实例基数",
  cardinalityMultiple: "可多个",
  cardinalitySingleton: "每项目单例",
  definition: "已发布定义",
  reviseClass: "修订类别",
  reviseDocumentation: "文档修订",
  reviseSemantic: "语义修订",
  catalogNotAdopted: "目录有新版本并不等于项目已采用。既有绑定与项目值仍钉在旧修订上。",
  fallbackImpact: "新驱动可能改变节点类型回退匹配，必须由另一位高风险复核人批准。",
  neverLowCreate: "新增主体不能按低风险发布。",
  registerFollowup: "登记到本组织",
  registerFollowupHint: "如需在本组织使用，请单独登记主体。",
  registerFollowupFailed: "目录发布已成功，但组织登记失败。可重试登记，不会回滚目录。",
  registerFollowupRetry: "重试登记",
  registerFollowupSuccess: "组织登记已完成。",
  authorRequired: "当前会话没有目录编写权限。",
  sharedScope: "该主体全部实例共享。新增正式定义不会自动变更组织登记或放置。",
  subjectKind: "主体类型",
  subject: "已发布主体",
  propertyKey: "属性键",
  displayName: "显示名称",
  documentation: "说明",
  valueType: "取值类型",
  valueTypeInteger: "整数",
  valueTypeNumber: "数值",
  valueTypeString: "字符串",
  valueTypeBoolean: "布尔值",
  valueTypeEmpty: "空属性",
  valueTypeU32Array: "整数数组",
  valueTypeStringList: "字符串列表",
  valueTypeBytes: "字节数组",
  valueTypePhandleList: "句柄引用",
  valueTypeMixed: "混合类型",
  minimum: "最小值",
  maximum: "最大值",
  unit: "单位",
  unitNone: "无单位",
  examples: "示例（DTS 或 JSON）",
  examplesPlaceholder: '可粘贴完整属性语句，如 trx_plim = "5017", "6|9|10";，也可填写 DTS 取值或 JSON 示例数组',
  invalidExamples: "示例格式无效，请填写 DTS 属性语句、DTS 取值或 JSON 示例数组。",
  reason: "变更说明",
  saveDraft: "保存草稿",
  preview: "预览发布",
  publish: "发布到目录",
  processing: "正在发布…",
  refreshJob: "刷新处理状态",
  rebase: "重新预览",
  noInternalIds: "不必填写内部编号、发布版本、摘要或仓库地址。",
  requiredApproval:
    "发布需要具备发布权限的人员确认。高风险必须由另一位复核人批准。单人策略未开启时不能自行批准，也不能在本页把风险改成低。",
  highRiskApproval: "高风险：必须由另一位具备高风险复核权限的人员批准。",
  lowRiskApproval: "低风险仍需发布权限确认。单人策略未开启时不能自行批准。",
  added: "新增定义",
  changed: "变更定义",
  addedSubjects: "新增主体",
  risk: "风险",
  impact: "影响",
  approval: "所需审批",
  scope: "共享范围",
  riskLow: "低",
  riskHigh: "高",
  draftSaved: "草稿已保存。修改正文后需重新预览。",
  previewStale: "正文已修改，旧预览已作废，请重新预览。",
  queued: "发布已入队，正在处理。刷新或离开后可恢复。",
  running: "发布正在执行。",
  active: "目录发布已生效。",
  activeSuperseded: "该发布曾经成功，当前目录已有后继版本。",
  needsRebase: "基线已变化，请重新预览并确认新的候选，不能悄悄刷新后再次发布。输入已保留。",
  policyDisabled: "目录发布策略已关闭。输入已保留。",
  frozen: "目录发布已冻结，请等待解冻后再试。输入已保留。",
  keepInput: "输入已保留。",
  confirmPreviewTitle: "确认预览发布候选",
  confirmPreview: "确认预览",
  confirmPublishTitle: "确认发布到目录",
  confirmPublish: "确认发布",
  previewAck: "我已核对本次变更内容",
  publishAck: "我已核对影响并确认发布到共享目录",
  driver: "驱动",
  nodeType: "节点类型",
  configurationSchema: "配置规范"
} as const;

export type PublicationJobStatus = CatalogPublicationJobResponse["item"]["status"];

export function fingerprintPublicationDraft(draft: PublicationDraft): string {
  return JSON.stringify({
    mode: draft.mode,
    subjectId: draft.subjectId,
    subjectKind: draft.subjectKind,
    canonicalKey: (draft.canonicalKey ?? "").trim(),
    selectorValue: (draft.selectorValue ?? "").trim(),
    nature: draft.nature,
    cardinality: draft.cardinality,
    definitionId: draft.definitionId,
    reviseClass: draft.reviseClass,
    propertyKey: draft.propertyKey.trim(),
    displayName: draft.displayName.trim(),
    documentation: draft.documentation.trim(),
    valueType: draft.valueType,
    minimum: draft.minimum.trim(),
    maximum: draft.maximum.trim(),
    unit: draft.unit,
    examples: draft.examples.trim()
  });
}

export function publicationDialogTitle(mode: PublicationMode): string {
  if (mode === "create-subject") {
    return publicationCopy.titleCreateSubject;
  }
  if (mode === "revise-definition") {
    return publicationCopy.titleRevise;
  }
  return publicationCopy.title;
}

export function canSavePublicationDraft(
  actor: CatalogActorKind,
  state: CatalogDomainState,
  permissions?: readonly string[] | null
): boolean {
  return actor === "org-admin" && canExecutePublicationAction(actor, "preview-publication", state, permissions);
}

export function canExecutePublicationAction(
  actor: CatalogActorKind,
  action: Extract<
    CatalogAuthorizedAction,
    "preview-publication" | "publish-publication" | "review-high-risk-publication"
  >,
  state: CatalogDomainState,
  permissions?: readonly string[] | null
): boolean {
  return isCatalogActionEnabled(actor, action, state, permissions);
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseExamples(value: string, valueType: PublicationValueType): Array<number | string> | undefined {
  const parts = value
    .split(/[,\n]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  if (valueType === "string") {
    return parts;
  }
  return parts.map((part) => {
    const parsed = Number(part);
    return Number.isFinite(parsed) ? parsed : part;
  });
}

export function publicationValueTypeLabel(type: PublicationValueType): string {
  switch (type) {
    case "integer":
      return publicationCopy.valueTypeInteger;
    case "number":
      return publicationCopy.valueTypeNumber;
    case "string":
      return publicationCopy.valueTypeString;
    case "boolean":
      return publicationCopy.valueTypeBoolean;
    case "empty":
      return publicationCopy.valueTypeEmpty;
    case "u32-array":
      return publicationCopy.valueTypeU32Array;
    case "string-list":
      return publicationCopy.valueTypeStringList;
    case "bytes":
      return publicationCopy.valueTypeBytes;
    case "phandle-list":
      return publicationCopy.valueTypePhandleList;
    case "mixed":
      return publicationCopy.valueTypeMixed;
  }
}

function valueSchemaOf(draft: PublicationDraft) {
  if (draft.valueType === "boolean") {
    return { type: "boolean" as const };
  }
  if (draft.valueType === "empty") {
    return { type: "null" as const };
  }
  if (draft.valueType === "string" || draft.valueType === "bytes") {
    return { type: "string" as const };
  }
  if (draft.valueType === "string-list") {
    return { type: "array" as const, items: { type: "string" as const } };
  }
  if (draft.valueType === "u32-array") {
    return { type: "array" as const, items: { type: "integer" as const, minimum: 0 } };
  }
  if (draft.valueType === "phandle-list") {
    return { type: "array" as const };
  }
  if (draft.valueType === "mixed") {
    return { description: "mixed" };
  }
  return {
    type: draft.valueType,
    ...(parseOptionalNumber(draft.minimum) !== undefined ? { minimum: parseOptionalNumber(draft.minimum) } : {}),
    ...(parseOptionalNumber(draft.maximum) !== undefined ? { maximum: parseOptionalNumber(draft.maximum) } : {})
  };
}

/** Comments are DTS whitespace; quoted comment markers remain literal string data. */
function stripDtsExampleComments(source: string): string {
  let result = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inString) {
      result += ch;
      if (ch === "\\" && i + 1 < source.length) result += source[++i];
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error(publicationCopy.invalidExamples);
      result += " ";
      i = end + 1;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i + 1 < source.length && source[i + 1] !== "\n" && source[i + 1] !== "\r") i += 1;
      result += " ";
    } else {
      result += ch;
    }
  }
  return result.trim();
}

export function parsePublicationExamples(draft: PublicationDraft) {
  let input = draft.examples.trim();
  if (!input) return undefined;
  if (input.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(input);
      if (Array.isArray(parsed) && !(draft.valueType === "bytes" && parsed.every((value) => typeof value === "number"))) return parsed;
    } catch {
      // A DTS byte literal also starts with '['; the DTS parser validates it below.
    }
  }
  const startsWithDtsValue = /^[<"[/]/u.test(input);
  input = stripDtsExampleComments(input);
  const statement = /^([A-Za-z0-9,._+?#-]+)\s*=\s*([\s\S]*)$/u.exec(input);
  const emptyProperty = /^([A-Za-z0-9,._+?#-]+)\s*;$/u.exec(input);
  if (statement || emptyProperty || startsWithDtsValue) {
    const propertyKey = draft.propertyKey.trim();
    const sourceKey = statement?.[1] ?? emptyProperty?.[1] ?? propertyKey;
    if (sourceKey !== propertyKey) {
      throw new Error(`示例属性名应为「${propertyKey}」，当前为「${sourceKey}」。`);
    }
    const raw = emptyProperty ? "" : (statement?.[2] ?? input).replace(/;\s*$/u, "").trim();
    try {
      if (!emptyProperty && !raw) throw new SyntaxError("Missing DTS property value");
      const value = parseDtsValue(propertyKey, raw).value;
      if (draft.valueType === "bytes" || draft.valueType === "mixed") return [raw];
      switch (value.kind) {
        case "strings": {
          const strings = value.values.map(decodeDtsString);
          return [draft.valueType === "string" && strings.length === 1 ? strings[0] : strings];
        }
        case "cells": {
          const cells = value.groups.flat().map((cell) => {
            if (cell.kind === "phandle") return `&${cell.label}`;
            const number = Number(cell.value);
            if (!Number.isSafeInteger(number)) throw new RangeError("Unsafe JSON integer");
            return number;
          });
          if (value.groups.some((group) => group.length === 0)) throw new SyntaxError("Empty DTS cell group");
          return [(draft.valueType === "integer" || draft.valueType === "number") && cells.length === 1 ? cells[0] : cells];
        }
        case "bytes": return [value.values];
        case "boolean": return [draft.valueType === "empty" ? null : true];
        case "empty": return [null];
        case "mixed": return [raw];
      }
    } catch {
      throw new Error(publicationCopy.invalidExamples);
    }
  }
  if (draft.valueType === "boolean") {
    const tokens = draft.examples
      .split(/[,\n]/u)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const values = tokens
      .map((token) => (token === "true" || token === "1" ? true : token === "false" || token === "0" ? false : null))
      .filter((value): value is boolean => value !== null);
    return values.length > 0 ? values : undefined;
  }
  const scalarType: PublicationValueType =
    draft.valueType === "number"
      ? "number"
      : draft.valueType === "integer" || draft.valueType === "u32-array"
        ? "integer"
        : "string";
  const parsed = parseExamples(draft.examples, scalarType);
  if (!parsed) {
    return undefined;
  }
  if (draft.valueType === "u32-array" || draft.valueType === "string-list" || draft.valueType === "phandle-list") {
    return [parsed];
  }
  return parsed;
}

export function definitionContentOf(draft: PublicationDraft) {
  const examples = parsePublicationExamples(draft);
  const unit = draft.unit.trim();
  const description = draft.description.trim();
  return {
    displayName: draft.displayName.trim(),
    documentation: draft.documentation,
    ...(description ? { description } : {}),
    ...(unit ? { unit } : {}),
    valueSchema: valueSchemaOf(draft),
    ...(examples ? { examples } : {})
  };
}

function definitionRevisionContentOf(draft: PublicationDraft) {
  return {
    ...definitionContentOf(draft),
    ...(!draft.unit.trim() ? { unit: null } : {}),
    ...(!draft.examples.trim() ? { examples: null } : {})
  };
}

export function buildCreateDefinitionChangeSet(
  draft: PublicationDraft
): CatalogCreatePublicationCandidateRequest["changeSet"] {
  return [
    {
      op: "create-definition",
      subjectId: draft.subjectId,
      propertyKey: draft.propertyKey.trim(),
      content: definitionContentOf(draft)
    }
  ];
}

export function buildPublicationChangeSet(
  draft: PublicationDraft
): CatalogCreatePublicationCandidateRequest["changeSet"] {
  if (draft.mode === "create-subject") {
    const selectorKind = draft.subjectKind === "driver" ? "driver-compatible"
      : draft.subjectKind === "node-type" ? "node-type-name" : "configuration-schema-id";
    const selectorValue = draft.selectorValue.trim();
    const canonicalKey =
      draft.canonicalKey.trim() ||
      `${draft.subjectKind}:${selectorValue}`;
    return [
      {
        op: "create-subject",
        kind: draft.subjectKind,
        canonicalKey,
        selector: { kind: selectorKind, value: selectorValue },
        ...(draft.subjectKind === "driver"
          ? { nature: draft.nature || undefined, cardinality: draft.cardinality || undefined }
          : {}),
      }
    ];
  }
  if (draft.mode === "revise-definition") {
    return [
      {
        op: "revise-definition",
        definitionId: draft.definitionId,
        class: draft.reviseClass,
        content: definitionRevisionContentOf(draft)
      }
    ];
  }
  if (draft.mode === "retire-definition" || draft.mode === "restore-definition") {
    return [
      {
        op: draft.mode,
        definitionId: draft.definitionId,
        class: draft.reviseClass,
        ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        content: definitionRevisionContentOf(draft)
      }
    ];
  }
  return buildCreateDefinitionChangeSet(draft);
}

export function publicationPreviewIsStale(savedFingerprint: string | null, draft: PublicationDraft): boolean {
  if (!savedFingerprint) {
    return false;
  }
  return savedFingerprint !== fingerprintPublicationDraft(draft);
}

export function publicationMustRePreview(input: {
  previewStale: boolean;
  jobStatus?: string | null;
  failureReason?: string | null;
}): boolean {
  return input.previewStale || input.jobStatus === "needs-rebase" || input.failureReason === "needs-rebase";
}

export function publicationSuccessKind(
  job: CatalogPublicationJobResponse["item"]
): "active" | "active-superseded" | null {
  if (job.currentness === "active-superseded" && job.effective) {
    return "active-superseded";
  }
  if (job.currentness === "active" && job.effective) {
    return "active";
  }
  if (job.status === "active" && job.effective) {
    return job.isCurrent === false ? "active-superseded" : "active";
  }
  return null;
}

export function publicationJobIsPending(status: PublicationJobStatus): boolean {
  return status === "queued" || status === "running";
}

export function publicationStatusCopy(job: CatalogPublicationJobResponse["item"]): {
  tone: "info" | "success" | "warning" | "danger";
  message: string;
} {
  if (job.maintenanceRewrites?.length) {
    return { tone: "warning", message: "此发布记录的目录内容已因参数彻底删除而重建。原审批记录保留，本次维护不代表重新批准发布。" };
  }
  const success = publicationSuccessKind(job);
  if (success === "active-superseded") {
    return { tone: "success", message: publicationCopy.activeSuperseded };
  }
  if (success === "active") {
    return { tone: "success", message: publicationCopy.active };
  }
  if (job.status === "queued") {
    return { tone: "info", message: publicationCopy.queued };
  }
  if (job.status === "running") {
    return { tone: "info", message: publicationCopy.running };
  }
  if (job.status === "needs-rebase" || job.failure?.reason === "needs-rebase") {
    return { tone: "warning", message: publicationCopy.needsRebase };
  }
  if (job.failure?.reason === "publication-policy-disabled") {
    return { tone: "warning", message: publicationCopy.policyDisabled };
  }
  if (job.failure?.reason === "publication-frozen") {
    return { tone: "warning", message: publicationCopy.frozen };
  }
  if (job.failure?.reason) {
    return {
      tone: "danger",
      message: catalogErrorCopy(job.failure.reason as Parameters<typeof catalogErrorCopy>[0])
    };
  }
  return { tone: "danger", message: "目录发布失败，请稍后重试。" };
}

export function publicationFailureCopy(error: unknown): string {
  const domain = catalogStateFromFailure(error);
  if (domain.kind === "error") {
    return catalogErrorCopy(domain.reason);
  }
  if (domain.kind === "conflict") {
    if (domain.reason === "release-drift") {
      return "目录发布已变化，请刷新证据后重新确认。输入已保留。";
    }
  }
  if (error instanceof WiseEffApiError) {
    const reason = catalogFailureReason(error);
    if (reason !== "unknown") {
      return catalogErrorCopy(reason);
    }
  }
  return "目录发布失败，请稍后重试。输入已保留。";
}

const FIELD_COPY: Record<string, { input: keyof PublicationDraft; message: string }> = {
  propertyKey: { input: "propertyKey", message: "属性键不符合规范，请调整后重试。" },
  "changeSet.propertyKey": { input: "propertyKey", message: "属性键不符合规范，请调整后重试。" },
  displayName: { input: "displayName", message: "显示名称无效。" },
  documentation: { input: "documentation", message: "说明无效。" },
  unit: { input: "unit", message: "所选单位不受支持。" },
  valueSchema: { input: "valueType", message: "取值类型或约束不受支持。" },
  examples: { input: "examples", message: "示例格式无效。" },
  subjectId: { input: "subjectId", message: "请选择已发布主体。" },
  changeSet: { input: "propertyKey", message: "变更内容不被接受，请检查属性键、类型与约束。" }
};

export function publicationFieldError(error: unknown): { input: keyof PublicationDraft; message: string } | null {
  if (!(error instanceof WiseEffApiError)) {
    return null;
  }
  const field = error.details.field;
  if (typeof field !== "string" || !field.trim()) {
    return null;
  }
  return FIELD_COPY[field] ?? null;
}

export function publicationApprovalCopy(riskClass: CatalogPublicationCandidateResponse["item"]["riskClass"], actor?: CatalogActorKind): string {
  if (actor === "org-admin") return "组织管理员可核对当前影响后确认发布。";
  return riskClass === "high" ? publicationCopy.highRiskApproval : publicationCopy.lowRiskApproval;
}

export function createPublicationSubmitGate() {
  let inflight = false;
  return {
    isInFlight() {
      return inflight;
    },
    begin() {
      if (inflight) {
        return false;
      }
      inflight = true;
      return true;
    },
    finish() {
      inflight = false;
    }
  };
}

export type PublicationSubmitGate = ReturnType<typeof createPublicationSubmitGate>;
