import { presentError } from "@/infrastructure/http/presentError";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParameterSpecCutoverSummary } from "@/domain/parameter-topology/types";
import { formatParameterSpecLifecycle } from "@/application/parameters/parameterAdminUiCopy";
import type { ParameterSpecLibraryRow } from "./ParameterSpecLibrary";
import { formatSpecAttributionLabel } from "./ParameterSpecLibrary";
import { FieldInfoTip } from "./FieldInfoTip";
import { SPEC_EDITOR_FIELD_HELP } from "./specEditorFieldHelp";
import { ValueShapeFields } from "./ValueShapeFields";
import {
  parseOptionalJson,
  shapeStateFromValue,
  valueFromShapeState,
} from "./valueShapeEditor";

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
  valueShape: Record<string, unknown>;
  exampleValueText: string;
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

function seedValueShape(detail: ParameterSpecDetailView): Record<string, unknown> {
  if (detail.valueShape && typeof detail.valueShape === "object" && !Array.isArray(detail.valueShape)) {
    return valueFromShapeState(shapeStateFromValue(detail.valueShape), "edit");
  }
  return { kind: detail.valueType || "unknown" };
}

export function createSpecEditorDraft(detail: ParameterSpecDetailView): SpecEditorDraft {
  return {
    displayName: detail.displayName?.trim() || detail.propertyKey,
    description: detail.description ?? "",
    documentation: detail.documentation ?? "",
    units: detail.units ?? "",
    constraintsText: formatValue(detail.constraints) || "{}",
    valueShape: seedValueShape(detail),
    exampleValueText: formatValue(detail.exampleValue),
  };
}

/** True when the editor draft differs from the loaded detail baseline. */
export function isSpecEditorDraftDirty(
  detail: ParameterSpecDetailView,
  draft: SpecEditorDraft,
): boolean {
  return JSON.stringify(draft) !== JSON.stringify(createSpecEditorDraft(detail));
}

function parseObjectField(raw: string, label: string): { value: Record<string, unknown>; error: string | null } {
  const parsed = parseOptionalJson(raw, label);
  if (!parsed.ok) return { value: {}, error: parsed.error };
  if (parsed.value === undefined || parsed.value === null) return { value: {}, error: null };
  if (typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { value: {}, error: `${label} 必须是 JSON 对象` };
  }
  return { value: parsed.value as Record<string, unknown>, error: null };
}

function parseExampleField(raw: string): { value: unknown; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") {
    return { value: null, error: null };
  }
  const asJson = parseOptionalJson(trimmed, "示例值");
  if (asJson.ok) return { value: asJson.value ?? null, error: null };
  // Plain DTS fragments are allowed for examples (and drive cell-layout inference).
  return { value: trimmed, error: null };
}

export function buildSpecEditorSavePayload(
  detail: ParameterSpecDetailView,
  draft: SpecEditorDraft,
  reason: string,
): { payload: SpecEditorSavePayload | null; error: string | null } {
  const isOrgDraft = detail.reviewState === "draft" && detail.organizationId != null;

  if (!draft.valueShape.kind) {
    return { payload: null, error: "值形状 valueShape 必须包含 kind 字段。" };
  }

  const constraints = parseObjectField(draft.constraintsText, "约束 constraints");
  if (constraints.error) return { payload: null, error: constraints.error };

  const example = parseExampleField(draft.exampleValueText);
  if (example.error) return { payload: null, error: example.error };

  if (!draft.documentation.trim()) {
    return { payload: null, error: "参数说明不能为空。" };
  }
  if (!reason.trim()) {
    return { payload: null, error: isOrgDraft ? "请填写激活原因。" : "请填写修改原因。" };
  }

  return {
    payload: {
      specId: detail.id,
      mode: isOrgDraft ? "activate" : "update",
      valueShape: draft.valueShape,
      constraints: constraints.value,
      documentation: draft.documentation.trim(),
      displayName: draft.displayName.trim() || detail.propertyKey,
      description: draft.description.trim(),
      units: draft.units.trim() || null,
      exampleValue: example.value,
      reason: reason.trim(),
    },
    error: null,
  };
}

function ReadOnlyField({
  label,
  value,
  mono = false,
  className,
  description,
  badge,
  multiline = false,
  rows = 3,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
  description?: string;
  badge?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const display = value.trim() ? value : "—";
  return (
    <label className={className}>
      <span className="def-field-label-row">
        {label}
        {description ? <FieldInfoTip label={label} description={description} /> : null}
        {badge ? (
          <span className="label-hint" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      {multiline ? (
        <textarea
          aria-label={label}
          className={mono ? "parameter-admin-code-editor" : undefined}
          value={display}
          rows={rows}
          readOnly
          aria-readonly="true"
          wrap={mono ? "off" : undefined}
        />
      ) : (
        <input
          aria-label={label}
          className={mono ? "mono" : undefined}
          value={display}
          readOnly
          aria-readonly="true"
        />
      )}
    </label>
  );
}

function EditableField({
  label,
  value,
  onChange,
  description,
  multiline = false,
  mono = false,
  rows = 3,
  placeholder,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  multiline?: boolean;
  mono?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="def-field-label-row">
        {label}
        {description ? <FieldInfoTip label={label} description={description} /> : null}
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

/** Published knowledge entry referencing this definition (相关知识). */
export type SpecRelatedKnowledgeItem = {
  entryId: string;
  title: string;
  excerpt: string;
  updatedAt: string;
};

/**
 * Injected only when the caller holds `knowledge:view`; the section is hidden
 * otherwise. The list is published-only server-side (drafts never appear).
 */
export type SpecRelatedKnowledgeSource = {
  load: (specId: string) => Promise<SpecRelatedKnowledgeItem[]>;
  onOpenEntry: (entryId: string) => void;
};

export type ParameterSpecDetailProps = {
  detail: ParameterSpecDetailView;
  draft: SpecEditorDraft;
  onDraftChange: (patch: Partial<SpecEditorDraft>) => void;
  /** When false, mutable fields stay read-only (platform-global specs). */
  editable: boolean;
  /** Secondary identity correction (ADR-0017); omit to keep identity locked. */
  onCorrectAttribution?: () => void;
  onCorrectPropertyKey?: () => void;
  identityCorrectionDisabledReason?: string | null;
  relatedKnowledge?: SpecRelatedKnowledgeSource;
};

function SpecRelatedKnowledgeSection({
  specId,
  source,
}: {
  specId: string;
  source: SpecRelatedKnowledgeSource;
}) {
  const [items, setItems] = useState<SpecRelatedKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    source
      .load(specId)
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(presentError(loadError, "相关知识加载失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, specId]);

  return (
    <fieldset className="def-group" data-testid="spec-related-knowledge">
      <legend>相关知识</legend>
      <div className="def-group-fields def-group-fields--stack">
        {loading ? (
          <p className="muted small">正在加载相关知识…</p>
        ) : error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="muted small">暂无引用该定义的已发布知识条目。</p>
        ) : (
          <ul className="param-admin-related-knowledge-list">
            {items.map((item) => (
              <li key={item.entryId}>
                <button
                  type="button"
                  className="param-admin-related-knowledge-item"
                  onClick={() => source.onOpenEntry(item.entryId)}
                >
                  <span className="param-admin-related-knowledge-item__title">{item.title}</span>
                  {item.excerpt ? (
                    <span className="param-admin-related-knowledge-item__excerpt">{item.excerpt}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">仅显示已发布条目；草稿与已归档不出现。</p>
      </div>
    </fieldset>
  );
}

function IdentityReadonlyControl({
  label,
  value,
  mono = false,
  badge,
  description,
  onCorrect,
  correctLabel,
  correctTitle,
  correctDisabled = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: string;
  description?: string;
  onCorrect?: () => void;
  correctLabel?: string;
  correctTitle?: string;
  correctDisabled?: boolean;
}) {
  const showCorrect = typeof onCorrect === "function" && correctLabel;
  const input = (
    <input
      aria-label={label}
      className={mono ? "mono" : undefined}
      value={value}
      readOnly
      aria-readonly="true"
    />
  );
  return (
    <label className="param-admin-readonly-field">
      <span className="def-field-label-row">
        {label}
        {description ? <FieldInfoTip label={label} description={description} /> : null}
        {badge ? (
          <span className="label-hint" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      {showCorrect ? (
        <div className="param-admin-identity-control">
          {input}
          <button
            type="button"
            className="param-admin-identity-edit"
            aria-label={correctLabel}
            title={correctTitle ?? correctLabel}
            disabled={correctDisabled}
            onClick={onCorrect}
          >
            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : (
        input
      )}
    </label>
  );
}

/**
 * Spec detail body using legacy `shared-definition-panel` / `def-group` chrome.
 * Declared attribution subject and property key are corrected via secondary actions (ADR-0017);
 * observed 所属模块 stays read-only (ADR-0010).
 */
export function ParameterSpecDetail({
  detail,
  draft,
  onDraftChange,
  editable,
  onCorrectAttribution,
  onCorrectPropertyKey,
  identityCorrectionDisabledReason = null,
  relatedKnowledge,
}: ParameterSpecDetailProps) {
  const moduleText = formatSpecAttributionLabel(detail);
  const declaredSubject =
    detail.driverModule?.trim() ||
    detail.attributionSubjectId?.trim() ||
    "—";
  const hasObservedModules = detail.attributionModules.length > 0;
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
  const canCorrectIdentity = editable && detail.reviewState !== "deprecated";
  const identityCorrectable =
    typeof onCorrectAttribution === "function" || typeof onCorrectPropertyKey === "function";

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
            <IdentityReadonlyControl
              label="属性键"
              value={detail.propertyKey}
              mono
              badge="只读"
              description={SPEC_EDITOR_FIELD_HELP.propertyKey}
              onCorrect={
                canCorrectIdentity && typeof onCorrectPropertyKey === "function"
                  ? onCorrectPropertyKey
                  : undefined
              }
              correctLabel="修正属性键"
              correctTitle={
                identityCorrectionDisabledReason ??
                "仅零引用定义可改；会同步重写派生键。"
              }
              correctDisabled={Boolean(identityCorrectionDisabledReason)}
            />
            <IdentityReadonlyControl
              label="归属主体"
              value={declaredSubject}
              badge="声明"
              description={SPEC_EDITOR_FIELD_HELP.attributionSubject}
              onCorrect={
                canCorrectIdentity && typeof onCorrectAttribution === "function"
                  ? onCorrectAttribution
                  : undefined
              }
              correctLabel="修正归属"
              correctTitle="选错主体时在此纠正；不改树结构。"
            />
            {editable ? (
              <EditableField
                label="展示名"
                value={draft.displayName}
                onChange={(displayName) => onDraftChange({ displayName })}
                description={SPEC_EDITOR_FIELD_HELP.displayName}
              />
            ) : (
              <ReadOnlyField
                label="展示名"
                value={detail.displayName ?? ""}
                description={SPEC_EDITOR_FIELD_HELP.displayName}
              />
            )}
            <label className="param-admin-readonly-field">
              <span className="def-field-label-row">
                所属模块
                <FieldInfoTip
                  label="所属模块"
                  description={SPEC_EDITOR_FIELD_HELP.attributionModule}
                />
                <span className="label-hint" aria-hidden="true">
                  {hasObservedModules ? "实测" : "只读"}
                </span>
              </span>
              <input
                aria-label="所属模块"
                value={moduleText.trim() ? moduleText : "—"}
                readOnly
                aria-readonly="true"
              />
            </label>
            <ReadOnlyField
              label="审核状态"
              value={formatParameterSpecLifecycle(detail.reviewState)}
              description={SPEC_EDITOR_FIELD_HELP.reviewState}
            />
            {identityCorrectable && !canCorrectIdentity ? (
              <p className="muted small">废弃定义不能就地修正身份；请先恢复或另建。</p>
            ) : null}
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
                  description={SPEC_EDITOR_FIELD_HELP.description}
                  multiline
                  rows={2}
                />
                <EditableField
                  label="参数说明"
                  value={draft.documentation}
                  onChange={(documentation) => onDraftChange({ documentation })}
                  description={SPEC_EDITOR_FIELD_HELP.documentation}
                  multiline
                  rows={3}
                  placeholder="描述参数含义、取值范围与使用注意"
                />
              </>
            ) : (
              <>
                <ReadOnlyField
                  label="展示描述"
                  value={detail.description ?? ""}
                  description={SPEC_EDITOR_FIELD_HELP.description}
                  multiline
                  rows={2}
                />
                <ReadOnlyField
                  label="参数说明"
                  value={detail.documentation ?? ""}
                  description={SPEC_EDITOR_FIELD_HELP.documentation}
                  multiline
                  rows={3}
                />
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="def-group">
          <legend>取值与约束</legend>
          <div className="def-group-fields">
            {editable ? (
              <EditableField
                label="示例值"
                value={draft.exampleValueText}
                onChange={(exampleValueText) => onDraftChange({ exampleValueText })}
                description={SPEC_EDITOR_FIELD_HELP.exampleValue}
                className="param-admin-example-value-field"
                multiline
                mono
                rows={3}
              />
            ) : (
              <ReadOnlyField
                label="示例值"
                value={draft.exampleValueText}
                description={SPEC_EDITOR_FIELD_HELP.exampleValue}
                mono
                className="param-admin-example-value-field"
                multiline
                rows={3}
              />
            )}
            {editable ? (
              <ValueShapeFields
                value={draft.valueShape}
                onChange={(valueShape) => onDraftChange({ valueShape })}
                mode="edit"
                fieldClassName="param-admin-value-shape-field"
                exampleValueText={draft.exampleValueText}
                propertyKey={detail.propertyKey}
                units={{
                  value: draft.units,
                  onChange: (next) => onDraftChange({ units: next }),
                }}
                descriptions={{
                  valueShape: SPEC_EDITOR_FIELD_HELP.valueShape,
                  bits: SPEC_EDITOR_FIELD_HELP.bits,
                  cellsPerGroup: SPEC_EDITOR_FIELD_HELP.cellsPerGroup,
                  bytesLength: SPEC_EDITOR_FIELD_HELP.bytesLength,
                  units: SPEC_EDITOR_FIELD_HELP.units,
                }}
              />
            ) : (
              <>
                <ReadOnlyField
                  label="值形状 valueShape"
                  value={formatValue(draft.valueShape)}
                  description={SPEC_EDITOR_FIELD_HELP.valueShape}
                  mono
                  multiline
                  rows={4}
                />
                <ReadOnlyField
                  label="单位"
                  value={detail.units ?? ""}
                  description={SPEC_EDITOR_FIELD_HELP.units}
                />
              </>
            )}
            {editable ? (
              <EditableField
                label="约束 constraints"
                value={draft.constraintsText}
                onChange={(constraintsText) => onDraftChange({ constraintsText })}
                description={SPEC_EDITOR_FIELD_HELP.constraints}
                multiline
                mono
                rows={5}
              />
            ) : (
              <ReadOnlyField
                label="约束 constraints"
                value={draft.constraintsText}
                description={SPEC_EDITOR_FIELD_HELP.constraints}
                multiline
                mono
                rows={5}
              />
            )}
            {formatValue(detail.schemaDefault) ? (
              <ReadOnlyField
                label="Schema 默认值"
                value={formatValue(detail.schemaDefault)}
                description={SPEC_EDITOR_FIELD_HELP.schemaDefault}
                mono
              />
            ) : null}
          </div>
        </fieldset>

        <fieldset className="def-group">
          <legend>使用与历史</legend>
          <div className="def-group-fields def-group-fields--stack">
            <ReadOnlyField
              label="使用情况"
              value={usageText}
              description={SPEC_EDITOR_FIELD_HELP.usage}
              multiline
              rows={3}
            />
            <ReadOnlyField
              label="Schema 历史"
              value={historyText}
              description={SPEC_EDITOR_FIELD_HELP.schemaHistory}
              multiline
              rows={3}
            />
          </div>
        </fieldset>

        {relatedKnowledge ? (
          <SpecRelatedKnowledgeSection specId={detail.id} source={relatedKnowledge} />
        ) : null}
      </form>
    </section>
  );
}
