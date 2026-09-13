import type { CatalogAuthorizedAction, CatalogActorKind } from "@/application/parameter-catalog/authority";
import { isCatalogActionEnabled } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import { catalogStateFromFailure } from "@/application/parameter-catalog/states";
import { catalogErrorCopy } from "@/features/parameter-catalog/copy";
import type {
  CatalogCreatePublicationCandidateRequest,
  CatalogPublicationCandidateResponse,
  CatalogPublicationJobResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";

export const publicationSupportedValueTypes = ["integer", "number", "string"] as const;
export type PublicationValueType = (typeof publicationSupportedValueTypes)[number];

export const publicationSupportedUnits = ["mA", "mV", "ms", "uOhm"] as const;
export type PublicationUnit = (typeof publicationSupportedUnits)[number];

export const publicationModes = ["create-definition", "create-subject", "revise-definition"] as const;
export type PublicationMode = (typeof publicationModes)[number];

export const publicationSubjectKinds = ["driver", "node-type"] as const;
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
  nature: PublicationDriverNature;
  cardinality: PublicationDriverCardinality;
  definitionId: string;
  reviseClass: PublicationReviseClass;
  propertyKey: string;
  displayName: string;
  documentation: string;
  valueType: PublicationValueType;
  minimum: string;
  maximum: string;
  unit: "" | PublicationUnit;
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
  valueType: "integer",
  minimum: "",
  maximum: "",
  unit: "mA",
  examples: "",
  reason: ""
});

export const publicationCopy = {
  entry: "新增定义",
  title: "向已发布主体新增定义",
  titleCreateSubject: "新增主体及首批定义",
  titleRevise: "修订已有定义",
  mode: "变更类型",
  modeCreateDefinition: "新增定义",
  modeCreateSubject: "新增主体",
  modeRevise: "修订定义",
  unpublishedEmpty: "当前没有可新增定义的已发布主体。M1 不提供隐式引导。",
  subjectKindPick: "主体类型",
  selectorValue: "选择器",
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
  registerFollowupHint: "目录发布已成功。组织登记是独立命令，失败不会撤回目录。",
  registerFollowupFailed: "目录发布已成功，但组织登记失败。可重试登记，不会回滚目录。",
  registerFollowupRetry: "重试登记",
  registerFollowupSuccess: "组织登记已完成。",
  authorRequired: "当前会话没有目录编写权限。",
  sharedScope: "该主体全部实例共享。新增正式定义不会自动变更组织登记或放置。",
  subjectKind: "主体类型",
  subjectSelector: "选择器",
  subject: "已发布主体",
  propertyKey: "属性键",
  displayName: "显示名称",
  documentation: "说明",
  valueType: "取值类型",
  minimum: "最小值",
  maximum: "最大值",
  unit: "单位",
  unitNone: "无单位",
  examples: "示例",
  reason: "草稿原因",
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
  previewAck: "我已确认按当前正文冻结预览，不会手填摘要或仓库地址",
  publishAck: "我已确认按当前预览发布，重复点击不会代替后端幂等",
  valueTypeInteger: "整数",
  valueTypeNumber: "数值",
  valueTypeString: "字符串",
  driver: "驱动",
  nodeType: "节点类型"
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

export function definitionContentOf(draft: PublicationDraft) {
  const valueSchema =
    draft.valueType === "string"
      ? { type: "string" as const }
      : {
          type: draft.valueType,
          ...(parseOptionalNumber(draft.minimum) !== undefined
            ? { minimum: parseOptionalNumber(draft.minimum) }
            : {}),
          ...(parseOptionalNumber(draft.maximum) !== undefined
            ? { maximum: parseOptionalNumber(draft.maximum) }
            : {})
        };
  const examples = parseExamples(draft.examples, draft.valueType);
  return {
    displayName: draft.displayName.trim(),
    documentation: draft.documentation.trim(),
    ...(draft.unit ? { unit: draft.unit } : {}),
    valueSchema,
    ...(examples ? { examples } : {})
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
    const selectorKind = draft.subjectKind === "driver" ? "driver-compatible" : "node-type-name";
    const selectorValue = draft.selectorValue.trim();
    const canonicalKey =
      draft.canonicalKey.trim() ||
      `${draft.subjectKind === "driver" ? "driver" : "node-type"}:${selectorValue}`;
    return [
      {
        op: "create-subject-with-definitions",
        kind: draft.subjectKind,
        canonicalKey,
        selector: { kind: selectorKind, value: selectorValue },
        ...(draft.subjectKind === "driver"
          ? { nature: draft.nature, cardinality: draft.cardinality }
          : {}),
        definitions: [
          {
            propertyKey: draft.propertyKey.trim(),
            content: definitionContentOf(draft)
          }
        ]
      }
    ];
  }
  if (draft.mode === "revise-definition") {
    return [
      {
        op: "revise-definition",
        definitionId: draft.definitionId,
        class: draft.reviseClass,
        content: definitionContentOf(draft)
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

export function publicationApprovalCopy(riskClass: CatalogPublicationCandidateResponse["item"]["riskClass"]): string {
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
