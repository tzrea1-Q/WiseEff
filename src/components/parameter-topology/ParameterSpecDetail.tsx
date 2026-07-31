import type { ParameterSpecCutoverSummary } from "@/domain/parameter-topology/types";
import type { ParameterSpecLibraryRow } from "./ParameterSpecLibrary";
import { formatSpecAttributionLabel } from "./ParameterSpecLibrary";
import { formatParameterSpecLifecycle } from "@/application/parameters/parameterAdminUiCopy";

export type SpecUsageEntry = {
  projectCode: string;
  instanceName: string | null;
};

export type SpecSchemaHistoryEntry = {
  version: number;
  source: string;
  note?: string;
};

export type ParameterSpecDetailView = ParameterSpecLibraryRow & {
  displayName?: string | null;
  description?: string | null;
  documentation?: string | null;
  units?: string | null;
  constraints?: Record<string, unknown> | null;
  schemaNamespace?: string | null;
  sourceKind?: string | null;
  specificationKey?: string | null;
  compatiblePatterns?: string[] | null;
  schemaDefault?: unknown;
  policyTarget?: unknown;
  usage?: SpecUsageEntry[];
  schemaHistory?: SpecSchemaHistoryEntry[];
  cutover?: ParameterSpecCutoverSummary;
};

/** Editable slice of a spec detail (maps to activate / update payloads). */
export type SpecEditorDraft = {
  displayName: string;
  description: string;
  documentation: string;
  units: string;
  constraintsText: string;
  valueShapeText: string;
  exampleValueText: string;
  policyTargetText: string;
  reason: string;
};

export type SpecEditorSavePayload = {
  specId: string;
  mode: "activate" | "update";
  valueShape: Record<string, unknown>;
  constraints: Record<string, unknown>;
  documentation: string;
  displayName: string;
  description: string;
  units: string | null;
  exampleValue: unknown;
  policyTarget: unknown;
  reason: string;
};

function formatValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createSpecEditorDraft(detail: ParameterSpecDetailView): SpecEditorDraft {
  return {
    displayName: detail.displayName?.trim() || detail.propertyKey,
    description: detail.description ?? "",
    documentation: detail.documentation ?? "",
    units: detail.units ?? "",
    constraintsText: formatValue(detail.constraints) || "{}",
    valueShapeText: formatValue(detail.valueShape) || formatValue({ kind: detail.valueType || "unknown" }) || "{}",
    exampleValueText: formatValue(detail.exampleValue),
    policyTargetText: formatValue(detail.policyTarget),
    reason: ""
  };
}

function parseJsonField(raw: string, label: string): { value: unknown; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") {
    return { value: null, error: null };
  }
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch {
    // Allow plain strings for example/policy without forcing JSON.
    if (label === "示例值" || label === "策略目标") {
      return { value: trimmed, error: null };
    }
    return { value: null, error: `${label} 不是合法 JSON` };
  }
}

function parseObjectField(raw: string, label: string): { value: Record<string, unknown>; error: string | null } {
  const parsed = parseJsonField(raw, label);
  if (parsed.error) return { value: {}, error: parsed.error };
  if (parsed.value == null) return { value: {}, error: null };
  if (typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { value: {}, error: `${label} 必须是 JSON 对象` };
  }
  return { value: parsed.value as Record<string, unknown>, error: null };
}

export function buildSpecEditorSavePayload(
  detail: ParameterSpecDetailView,
  draft: SpecEditorDraft
): { payload: SpecEditorSavePayload | null; error: string | null } {
  const isOrgDraft = detail.reviewState === "draft" && detail.organizationId != null;

  const shape = parseObjectField(draft.valueShapeText, "值形状 valueShape");
  if (shape.error) return { payload: null, error: shape.error };
  if (!shape.value.kind) {
    return { payload: null, error: "值形状 valueShape 必须包含 kind 字段。" };
  }

  const constraints = parseObjectField(draft.constraintsText, "约束 constraints");
  if (constraints.error) return { payload: null, error: constraints.error };

  const example = parseJsonField(draft.exampleValueText, "示例值");
  if (example.error) return { payload: null, error: example.error };
  const policy = parseJsonField(draft.policyTargetText, "策略目标");
  if (policy.error) return { payload: null, error: policy.error };

  if (!draft.documentation.trim()) {
    return { payload: null, error: "参数说明不能为空。" };
  }
  if (!draft.reason.trim()) {
    return { payload: null, error: "请填写修改原因。" };
  }

  return {
    payload: {
      specId: detail.id,
      mode: isOrgDraft ? "activate" : "update",
      valueShape: shape.value,
      constraints: constraints.value,
      documentation: draft.documentation.trim(),
      displayName: draft.displayName.trim() || detail.propertyKey,
      description: draft.description.trim(),
      units: draft.units.trim() || null,
      exampleValue: example.value,
      policyTarget: policy.value,
      reason: draft.reason.trim()
    },
    error: null
  };
}

function ReadOnlyField({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const display = value.trim() ? value : "—";
  return (
    <label>
      {label}
      <input aria-label={label} className={mono ? "mono" : undefined} value={display} readOnly aria-readonly="true" />
    </label>
  );
}

function EditableField({
  label,
  value,
  onChange,
  hint,
  multiline = false,
  mono = false,
  rows = 3,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  mono?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label>
      <span className="def-field-label-row">
        {label}
        {hint ? <span className="label-hint">{hint}</span> : null}
      </span>
      {multiline ? (
        <textarea
          aria-label={label}
          className={mono ? "parameter-admin-code-editor" : undefined}
          value={value}
          rows={rows}
          placeholder={placeholder}
          wrap={mono ? "off" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          className={mono ? "mono" : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export type ParameterSpecDetailProps = {
  detail: ParameterSpecDetailView;
  draft: SpecEditorDraft;
  onDraftChange: (patch: Partial<SpecEditorDraft>) => void;
  /** When false, mutable fields stay read-only (platform-global specs). */
  editable: boolean;
};

/**
 * Spec detail body using legacy `shared-definition-panel` / `def-group` chrome.
 * Identity fields are locked; governance fields are editable when `editable`.
 */
export function ParameterSpecDetail({ detail, draft, onDraftChange, editable }: ParameterSpecDetailProps) {
  const moduleText = formatSpecAttributionLabel(detail);
  const usageText =
    detail.usage && detail.usage.length > 0
      ? detail.usage
          .map((entry) =>
            entry.instanceName ? `${entry.projectCode} · ${entry.instanceName}` : entry.projectCode
          )
          .join("\n")
      : detail.usageCount > 0
        ? `项目参数约 ${detail.usageCount} 处（明细暂未加载）`
        : "暂无项目参数";
  const historyText =
    detail.schemaHistory && detail.schemaHistory.length > 0
      ? detail.schemaHistory
          .map((entry) => `v${entry.version} · ${entry.source}${entry.note ? ` — ${entry.note}` : ""}`)
          .join("\n")
      : "暂无版本历史";
  const isDraft = detail.reviewState === "draft" && detail.organizationId != null;

  return (
    <section className="shared-definition-panel" aria-label="参数定义详情">
      <div className="panel-header">
        <strong>参数定义详情</strong>
        <span>{editable ? (isDraft ? "草稿可编辑 · 保存时激活" : "可编辑") : "只读"}</span>
      </div>
      <form className="param-def-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="def-group">
          <legend>DTS 身份</legend>
          <div className="def-group-fields">
            <ReadOnlyField label="属性键" value={detail.propertyKey} mono />
            {editable ? (
              <EditableField
                label="展示名"
                value={draft.displayName}
                onChange={(displayName) => onDraftChange({ displayName })}
              />
            ) : (
              <ReadOnlyField label="展示名" value={detail.displayName ?? ""} />
            )}
            <ReadOnlyField label="所属模块" value={moduleText} />
            <ReadOnlyField label="审核状态" value={formatParameterSpecLifecycle(detail.reviewState)} />
          </div>
        </fieldset>

        <fieldset className="def-group">
          <legend>取值与约束</legend>
          <div className="def-group-fields">
            <ReadOnlyField label="值类型" value={detail.valueType} />
            {editable ? (
              <EditableField label="单位" value={draft.units} onChange={(units) => onDraftChange({ units })} />
            ) : (
              <ReadOnlyField label="单位" value={detail.units ?? ""} />
            )}
            {editable ? (
              <EditableField
                label="值形状 valueShape"
                value={draft.valueShapeText}
                onChange={(valueShapeText) => onDraftChange({ valueShapeText })}
                multiline
                mono
                rows={6}
                hint={isDraft ? "ⓘ 激活前可修订" : "ⓘ 保存时一并更新"}
              />
            ) : (
              <label>
                值形状 valueShape
                <textarea
                  aria-label="值形状 valueShape"
                  className="parameter-admin-code-editor"
                  value={draft.valueShapeText || "—"}
                  rows={6}
                  readOnly
                  aria-readonly="true"
                  wrap="off"
                />
              </label>
            )}
            {editable ? (
              <EditableField
                label="约束 constraints"
                value={draft.constraintsText}
                onChange={(constraintsText) => onDraftChange({ constraintsText })}
                multiline
                mono
                rows={5}
              />
            ) : (
              <label>
                约束 constraints
                <textarea
                  aria-label="约束 constraints"
                  className="parameter-admin-code-editor"
                  value={draft.constraintsText || "—"}
                  rows={5}
                  readOnly
                  aria-readonly="true"
                  wrap="off"
                />
              </label>
            )}
            <ReadOnlyField label="Schema 默认值" value={formatValue(detail.schemaDefault)} mono />
            {editable ? (
              <EditableField
                label="示例值"
                value={draft.exampleValueText}
                onChange={(exampleValueText) => onDraftChange({ exampleValueText })}
                hint="ⓘ 仅作示例，不参与校验或初始化"
                multiline
                mono
                rows={3}
              />
            ) : (
              <ReadOnlyField label="示例值" value={draft.exampleValueText} mono />
            )}
            {editable ? (
              <EditableField
                label="策略目标"
                value={draft.policyTargetText}
                onChange={(policyTargetText) => onDraftChange({ policyTargetText })}
                multiline
                mono
                rows={3}
              />
            ) : (
              <ReadOnlyField label="策略目标" value={draft.policyTargetText} mono />
            )}
            <ReadOnlyField label="业务分类" value={detail.businessCategory ?? ""} />
          </div>
        </fieldset>

        <fieldset className="def-group">
          <legend>描述信息</legend>
          <div className="def-group-fields def-group-fields--stack">
            {editable ? (
              <>
                <EditableField
                  label="展示描述"
                  value={draft.description}
                  onChange={(description) => onDraftChange({ description })}
                  multiline
                  rows={2}
                />
                <EditableField
                  label="参数说明"
                  value={draft.documentation}
                  onChange={(documentation) => onDraftChange({ documentation })}
                  multiline
                  rows={3}
                  placeholder="描述参数含义、取值范围与使用注意"
                />
                <EditableField
                  label="修改原因"
                  value={draft.reason}
                  onChange={(reason) => onDraftChange({ reason })}
                  multiline
                  rows={2}
                  placeholder={isDraft ? "说明激活依据" : "说明本次修改原因"}
                  hint="ⓘ 写入治理审计"
                />
              </>
            ) : (
              <>
                <ReadOnlyField label="展示描述" value={detail.description ?? ""} />
                <ReadOnlyField label="参数说明" value={detail.documentation ?? ""} />
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="def-group">
          <legend>使用与历史</legend>
          <div className="def-group-fields def-group-fields--stack">
            <label>
              使用情况
              <textarea aria-label="使用情况" value={usageText} rows={3} readOnly aria-readonly="true" />
            </label>
            <label>
              Schema 历史
              <textarea aria-label="Schema 历史" value={historyText} rows={3} readOnly aria-readonly="true" />
            </label>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
