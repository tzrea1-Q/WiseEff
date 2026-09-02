import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type {
  ModuleImportance,
  ModuleKind,
  ParameterModule,
  ParameterModuleMapping
} from "@/domain/parameter-topology/moduleRegistry";
import type {
  DriverPlacementReplayCounts,
  OrganizationDriverSchema,
  OrganizationDriverSchemaDeprecationImpact
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import {
  formatDriverNatureLabel,
  formatInstanceCardinalityLabel,
} from "@/application/parameters/driverRegistrationLabels";
import type {
  DriverNature,
  InstanceCardinality,
} from "@/application/ports/ParameterModuleRegistryRepository";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { toBusinessFlatNodes } from "@/components/parameter-topology/moduleAttributionTreeUtils";

export type ModuleEditSavePatch = ParameterModuleDraft & {
  importance?: ModuleImportance;
  kind?: "business" | "node-type";
  driverNature?: DriverNature;
  instanceCardinality?: InstanceCardinality;
};

type EditableModule = {
  name: string;
  description?: string;
  scope?: string;
  importance?: ModuleImportance;
  kind?: ModuleKind;
};

export type ModuleEditCompatibleMapping = Pick<
  ParameterModuleMapping,
  "id" | "matchKind" | "matchValue"
>;

export type ModuleEditCompatibleCoverage = {
  compatible: string;
  covered: boolean;
  pattern?: string;
  source?: string;
  driverId?: string;
  scope?: "platform" | "organization";
  shadowedBy?: Array<{
    pattern: string;
    driverId: string;
    source: string;
    scope: "platform" | "organization";
  }>;
  promoted?: boolean;
};

export function ModuleEditDialog({
  module,
  existingNames,
  showImportance = false,
  showKind = false,
  compatibleMappings,
  compatibleCoverages,
  busy = false,
  error = null,
  onSave,
  onCancel,
  onRemoveCompatibleMapping,
  onAddCompatibleMapping,
  onAuthorOverlaySchema,
  overlaySchemas,
  onPreviewOverlayDeprecation,
  onDeprecateOverlaySchema,
  canAdmin = false,
  driverNature = null,
  instanceCardinality = null,
  modules = [],
  defaultBusinessCategoryId = null,
  onUpdateDefaultBusinessCategory,
  onReplayPlacement,
}: {
  module: EditableModule;
  existingNames: readonly string[];
  showImportance?: boolean;
  showKind?: boolean;
  /** Driver-group compatible levers shown as editable attributes (ADR-0005). */
  compatibleMappings?: readonly ModuleEditCompatibleMapping[];
  /** Optional parse-coverage detail per compatible (from driver registry). */
  compatibleCoverages?: readonly ModuleEditCompatibleCoverage[];
  busy?: boolean;
  /** Save failure — the dialog stays open and shows it in place. */
  error?: string | null;
  onSave: (patch: ModuleEditSavePatch) => void;
  onCancel: () => void;
  onRemoveCompatibleMapping?: (mappingId: string) => void | Promise<void>;
  onAddCompatibleMapping?: (matchValue: string) => void | Promise<void>;
  onAuthorOverlaySchema?: (compatible: string) => void;
  overlaySchemas?: readonly OrganizationDriverSchema[];
  onPreviewOverlayDeprecation?: (
    schemaId: string
  ) => Promise<OrganizationDriverSchemaDeprecationImpact>;
  onDeprecateOverlaySchema?: (
    schemaId: string,
    input: { confirmCoverageLoss?: boolean }
  ) => void | Promise<void>;
  canAdmin?: boolean;
  driverNature?: DriverNature | null;
  instanceCardinality?: InstanceCardinality | null;
  /** Full module tree for business-category picker (driver-group Admin). */
  modules?: readonly ParameterModule[];
  defaultBusinessCategoryId?: string | null;
  onUpdateDefaultBusinessCategory?: (defaultBusinessCategoryId: string) => void | Promise<void>;
  onReplayPlacement?: () => void | Promise<DriverPlacementReplayCounts>;
}) {
  const addFieldId = useId();
  const defaultCategoryLabelId = useId();
  const [draft, setDraft] = useState<ParameterModuleDraft>({
    name: module.name,
    description: module.description ?? "",
    scope: module.scope ?? ""
  });
  const [importance, setImportance] = useState<ModuleImportance>(module.importance ?? "medium");
  const [kind, setKind] = useState<"business" | "node-type">(
    module.kind === "node-type" ? module.kind : "business"
  );
  const [newCompatible, setNewCompatible] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState(defaultBusinessCategoryId ?? "");
  const [replayMessage, setReplayMessage] = useState<string | null>(null);
  const [natureDraft, setNatureDraft] = useState<DriverNature | null>(driverNature);
  const [cardinalityDraft, setCardinalityDraft] = useState<InstanceCardinality | null>(
    instanceCardinality
  );
  const [deprecatingSchema, setDeprecatingSchema] = useState<OrganizationDriverSchema | null>(
    null
  );
  const [removingMapping, setRemovingMapping] = useState<ModuleEditCompatibleMapping | null>(null);
  const [deprecationImpact, setDeprecationImpact] =
    useState<OrganizationDriverSchemaDeprecationImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [coverageLossConfirmed, setCoverageLossConfirmed] = useState(false);

  const businessNodes = useMemo(() => toBusinessFlatNodes(modules), [modules]);
  const businessSelectableIds = useMemo(
    () => new Set(businessNodes.map((node) => node.id)),
    [businessNodes]
  );
  const showPlacementControls =
    module.kind === "driver-group" &&
    canAdmin &&
    (onUpdateDefaultBusinessCategory !== undefined || onReplayPlacement !== undefined);

  useEffect(() => {
    setDraft({
      name: module.name,
      description: module.description ?? "",
      scope: module.scope ?? ""
    });
    setImportance(module.importance ?? "medium");
    setKind(module.kind === "node-type" ? module.kind : "business");
    setNewCompatible("");
    setDefaultCategoryId(defaultBusinessCategoryId ?? "");
    setReplayMessage(null);
  }, [module, defaultBusinessCategoryId]);

  useEffect(() => {
    setNatureDraft(driverNature);
    setCardinalityDraft(instanceCardinality);
  }, [driverNature, instanceCardinality]);

  const canSubmit = canSubmitModuleDraft(draft, existingNames, module.name);
  const importanceVisible = showImportance && (!showKind || kind === "business");
  const isDirty =
    draft.name.trim() !== module.name ||
    draft.description.trim() !== (module.description ?? "").trim() ||
    draft.scope.trim() !== (module.scope ?? "").trim() ||
    (importanceVisible && importance !== (module.importance ?? "medium")) ||
    (showKind && kind !== (module.kind === "node-type" ? "node-type" : "business")) ||
    (canAdmin && natureDraft != null && natureDraft !== driverNature) ||
    (canAdmin && cardinalityDraft != null && cardinalityDraft !== instanceCardinality);
  const canSave = canSubmit && isDirty;
  const showCompatibleRules =
    module.kind === "driver-group" &&
    (compatibleMappings !== undefined || onAddCompatibleMapping !== undefined);
  const trimmedCompatible = newCompatible.trim();
  const canAddCompatible =
    Boolean(onAddCompatibleMapping) && trimmedCompatible.length > 0 && !busy;
  const coverageByCompatible = useMemo(() => {
    const map = new Map<string, ModuleEditCompatibleCoverage>();
    for (const row of compatibleCoverages ?? []) {
      map.set(row.compatible, row);
    }
    return map;
  }, [compatibleCoverages]);

  const openDeprecationPreview = async (schema: OrganizationDriverSchema) => {
    if (!onPreviewOverlayDeprecation) return;
    setImpactError(null);
    setCoverageLossConfirmed(false);
    try {
      const impact = await onPreviewOverlayDeprecation(schema.id);
      setDeprecatingSchema(schema);
      setDeprecationImpact(impact);
    } catch (error) {
      setImpactError(error instanceof Error ? error.message : "无法加载废弃影响预览。");
    }
  };

  const closeDeprecationPreview = () => {
    setDeprecatingSchema(null);
    setDeprecationImpact(null);
    setImpactError(null);
    setCoverageLossConfirmed(false);
  };

  return (
    <>
      <ModalDialog
        open
        onDismiss={onCancel}
        className="submission-dialog param-admin-module-edit-dialog"
        backdropClassName="param-admin-modal-backdrop"
      >
        {({ titleId }) => (
          <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">模块修改</span>
            <h2 id={titleId}>{module.name}</h2>
            <p>
              {showCompatibleRules
                ? "更新驱动组名称、描述与适用范围，并维护它认领的 compatible 匹配规则。"
                : showKind
                  ? "更新模块类型、名称、描述与适用范围。改类型会把自动发现的模块收养为人工维护。"
                  : showImportance
                    ? "更新模块名称、重要性、描述与适用范围。修改名称会同步更新共享参数库中的模块归属。"
                    : "更新模块名称、描述与适用范围。修改名称会同步更新共享参数库中的模块归属。"}
            </p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          {module.kind === "driver-group" &&
          (driverNature != null || instanceCardinality != null) ? (
            <section
              className="module-edit-section module-edit-driver-properties"
              aria-label="驱动属性"
            >
              <div className="module-edit-section__head">
                <h3>驱动属性</h3>
                <p className="muted">
                  描述设备或服务本体，与分类树中的节点类型（node-type）不是同一概念。
                </p>
              </div>
              <div className="organization-driver-schema-dialog__field-grid">
                <label>
                  驱动性质
                  {canAdmin ? (
                    <select
                      aria-label="驱动性质"
                      value={natureDraft ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setNatureDraft(event.target.value as DriverNature)
                      }
                    >
                      <option value="physical-device">
                        {formatDriverNatureLabel("physical-device")}
                      </option>
                      <option value="logical-service">
                        {formatDriverNatureLabel("logical-service")}
                      </option>
                    </select>
                  ) : (
                    <input
                      aria-label="驱动性质"
                      value={formatDriverNatureLabel(driverNature)}
                      readOnly
                      aria-readonly="true"
                    />
                  )}
                </label>
                <label>
                  实例基数
                  {canAdmin ? (
                    <select
                      aria-label="实例基数"
                      value={cardinalityDraft ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setCardinalityDraft(event.target.value as InstanceCardinality)
                      }
                    >
                      <option value="multiple">
                        {formatInstanceCardinalityLabel("multiple")}
                      </option>
                      <option value="singleton-per-project">
                        {formatInstanceCardinalityLabel("singleton-per-project")}
                      </option>
                    </select>
                  ) : (
                    <input
                      aria-label="实例基数"
                      value={formatInstanceCardinalityLabel(instanceCardinality)}
                      readOnly
                      aria-readonly="true"
                    />
                  )}
                </label>
              </div>
            </section>
          ) : null}

          {showPlacementControls ? (
            <section
              className="module-edit-section module-edit-placement-controls"
              aria-label="业务归属"
            >
              <div className="module-edit-section__head">
                <h3>业务归属</h3>
                <p className="muted">{PARAMETER_ADMIN_UI.driverRegistryDefaultBusinessCategoryHint}</p>
              </div>
              {onUpdateDefaultBusinessCategory ? (
                <div className="module-edit-placement-controls__field">
                  <span className="module-edit-field-label" id={defaultCategoryLabelId}>
                    {PARAMETER_ADMIN_UI.driverRegistryDefaultBusinessCategory}
                  </span>
                  <ModuleTreeSelect
                    mode="single"
                    label={PARAMETER_ADMIN_UI.driverRegistryDefaultBusinessCategory}
                    labelledBy={defaultCategoryLabelId}
                    nodes={businessNodes}
                    selectableIds={businessSelectableIds}
                    value={defaultCategoryId}
                    disabled={busy}
                    onChange={(next) => {
                      const nextId = typeof next === "string" ? next : next[0] ?? "";
                      setDefaultCategoryId(nextId);
                      if (nextId) {
                        void onUpdateDefaultBusinessCategory(nextId);
                      }
                    }}
                  />
                </div>
              ) : null}
              {onReplayPlacement ? (
                <div className="module-edit-placement-controls__replay">
                  <button
                    type="button"
                    className="button subtle"
                    disabled={busy}
                    aria-label={PARAMETER_ADMIN_UI.driverRegistryReplayPlacement}
                    onClick={() => {
                      void (async () => {
                        setReplayMessage(null);
                        const counts = await onReplayPlacement();
                        if (!counts) return;
                        setReplayMessage(
                          `${PARAMETER_ADMIN_UI.driverRegistryReplayPlacementDone}：移动 ${counts.moved}，跳过 curated ${counts.skippedCurated}，缺默认 ${counts.skippedMissingDefault}`
                        );
                      })();
                    }}
                  >
                    {PARAMETER_ADMIN_UI.driverRegistryReplayPlacement}
                  </button>
                  <p className="muted">{PARAMETER_ADMIN_UI.driverRegistryReplayPlacementHint}</p>
                </div>
              ) : null}
              {replayMessage ? <p role="status">{replayMessage}</p> : null}
            </section>
          ) : null}

          <section className="module-edit-section module-edit-basic-info" aria-label="基础信息">
            <div className="module-edit-section__head">
              <h3>基础信息</h3>
              <p className="muted">维护模块在管理端展示的名称、描述和适用范围。</p>
            </div>
            <ModuleDefinitionForm
              currentName={module.name}
              existingNames={existingNames}
              module={draft}
              showImportance={importanceVisible}
              importance={importance}
              onImportanceChange={setImportance}
              showKind={showKind}
              kind={kind}
              onKindChange={setKind}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
          </section>

          {showCompatibleRules ? (
            <section
              className="module-edit-section module-edit-compatible-rules"
              aria-label="compatible 匹配规则"
            >
              <div className="module-edit-section__head module-edit-compatible-rules__head">
                <h3>compatible 匹配规则</h3>
                <p className="muted">
                  节点的 compatible 命中下列任一值时，会归属到本驱动组。新增规则会立即生效；移除后相关参数需重新解析归属。
                </p>
              </div>

              {(compatibleMappings?.length ?? 0) > 0 ? (
                <ul className="module-edit-compatible-rules__list">
                  {compatibleMappings!.map((mapping) => {
                    const coverage = coverageByCompatible.get(mapping.matchValue);
                    const showPattern =
                      Boolean(coverage?.pattern) &&
                      coverage?.pattern !== mapping.matchValue;
                    const isShadowed =
                      Boolean(coverage?.covered) &&
                      !coverage?.promoted &&
                      Boolean(coverage?.shadowedBy && coverage.shadowedBy.length > 0);
                    const isPromoted = Boolean(coverage?.covered && coverage.promoted);
                    const isOverlay = coverage?.covered && coverage.scope === "organization";
                    const isPlatform =
                      coverage?.covered && coverage.scope === "platform" && !isPromoted && !isShadowed;
                    const coverageLabel = !coverage?.covered
                      ? PARAMETER_ADMIN_UI.driverRegistryCoverageUncovered
                      : isPromoted
                        ? PARAMETER_ADMIN_UI.driverRegistryCoveragePromoted
                        : isShadowed
                        ? PARAMETER_ADMIN_UI.driverRegistryCoverageShadowed
                        : isOverlay
                          ? PARAMETER_ADMIN_UI.driverRegistryCoverageOverlay
                          : isPlatform
                            ? PARAMETER_ADMIN_UI.driverRegistryCoveragePlatform
                            : PARAMETER_ADMIN_UI.driverRegistryCoverageCovered;
                    return (
                      <li key={mapping.id}>
                        <div className="module-edit-compatible-rules__rule">
                          <code>
                            {mapping.matchKind}:{mapping.matchValue}
                          </code>
                          {coverage ? (
                            <span
                              className={`module-edit-compatible-rules__coverage${
                                coverage.covered ? "" : " is-uncovered"
                              }`}
                            >
                              {coverageLabel}
                              {showPattern ? ` · ${coverage.pattern}` : ""}
                            </span>
                          ) : null}
                        </div>
                        <div className="module-edit-compatible-rules__actions">
                          {!coverage?.covered && canAdmin && onAuthorOverlaySchema ? (
                            <button
                              type="button"
                              className="button subtle"
                              disabled={busy}
                              onClick={() => onAuthorOverlaySchema(mapping.matchValue)}
                            >
                              {PARAMETER_ADMIN_UI.authorOverlaySchema}
                            </button>
                          ) : null}
                          {onRemoveCompatibleMapping ? (
                          <button
                            type="button"
                            className="button ghost"
                            disabled={busy}
                            aria-label={`移除规则 ${mapping.matchKind}:${mapping.matchValue}`}
                            onClick={() => setRemovingMapping(mapping)}
                          >
                            移除
                          </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted module-edit-compatible-rules__empty">尚未挂接 compatible 规则。</p>
              )}

              {onAddCompatibleMapping ? (
                <div className="module-edit-compatible-rules__add">
                  <label htmlFor={addFieldId}>新增 compatible</label>
                  <div className="module-edit-compatible-rules__add-row">
                    <input
                      id={addFieldId}
                      aria-label="新增 compatible"
                      value={newCompatible}
                      disabled={busy}
                      placeholder="例如 huawei,bypass_bst_hl7603"
                      onChange={(event) => setNewCompatible(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || !canAddCompatible) return;
                        event.preventDefault();
                        void onAddCompatibleMapping(trimmedCompatible);
                        setNewCompatible("");
                      }}
                    />
                    <button
                      type="button"
                      className="button subtle"
                      disabled={!canAddCompatible}
                      onClick={() => {
                        void onAddCompatibleMapping(trimmedCompatible);
                        setNewCompatible("");
                      }}
                    >
                      添加
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {module.kind === "driver-group" && (overlaySchemas?.length ?? 0) > 0 ? (
            <section
              className="module-edit-section module-edit-overlay-schemas"
              aria-label={PARAMETER_ADMIN_UI.organizationDriverSchemaOverlays}
            >
              <div className="module-edit-overlay-schemas__head">
                <h3>{PARAMETER_ADMIN_UI.organizationDriverSchemaOverlays}</h3>
                <p className="muted">与本驱动组 compatible 匹配的组织级解析配置。</p>
              </div>
              <ul className="module-edit-overlay-schemas__list">
                {overlaySchemas!.map((schema) => {
                  const superseded = schema.lifecycle === "superseded";
                  return (
                    <li key={schema.id} className="module-edit-overlay-schemas__row">
                      <div>
                        <strong>{schema.displayName}</strong>
                        <p className="muted">
                          <code>{schema.compatible}</code> ·{" "}
                          <span>
                            {superseded
                              ? "已提升至平台层"
                              : schema.lifecycle === "active"
                                ? "已启用"
                                : "已废弃"}
                          </span>
                        </p>
                        {superseded ? (
                          <p className="muted">
                            <span>
                              {`后继来源：平台层解析 ${schema.supersededBySchemaId ?? "—"}`}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      {canAdmin &&
                      schema.lifecycle === "active" &&
                      onPreviewOverlayDeprecation &&
                      onDeprecateOverlaySchema ? (
                        <button
                          type="button"
                          className="button ghost"
                          disabled={busy}
                          aria-label={`${PARAMETER_ADMIN_UI.organizationDriverSchemaDeprecate} ${schema.displayName}`}
                          onClick={() => void openDeprecationPreview(schema)}
                        >
                          {PARAMETER_ADMIN_UI.organizationDriverSchemaDeprecate}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {impactError ? <p className="form-error" role="alert">{impactError}</p> : null}
            </section>
          ) : null}
        </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="button subtle" type="button" onClick={onCancel} disabled={busy}>
              取消
            </button>
            {isDirty ? (
              <button
                className="button primary"
                type="button"
                disabled={!canSave || busy}
                onClick={() => {
                  if (!canSave) {
                    return;
                  }
                  onSave({
                    name: draft.name.trim(),
                    description: draft.description.trim(),
                    scope: draft.scope.trim(),
                    ...(showKind ? { kind } : {}),
                    ...(importanceVisible ? { importance } : {}),
                    ...(canAdmin && natureDraft != null ? { driverNature: natureDraft } : {}),
                    ...(canAdmin && cardinalityDraft != null
                      ? { instanceCardinality: cardinalityDraft }
                      : {})
                  });
                }}
              >
                保存
              </button>
            ) : (
              <button className="button primary" type="button" onClick={onCancel} disabled={busy}>
                完成
              </button>
            )}
          </div>
          </>
        )}
      </ModalDialog>
      <ConfirmDialog
        open={removingMapping !== null}
        title="移除 compatible 规则"
        description={
          removingMapping ? (
            <>
              <p>确定移除规则 {`${removingMapping.matchKind}:${removingMapping.matchValue}`}？</p>
              <p>命中该 compatible 的参数将在下次归属解析时重新落点。</p>
            </>
          ) : null
        }
        confirmLabel="移除"
        tone="danger"
        pending={busy}
        onConfirm={() => {
          if (removingMapping) {
            void onRemoveCompatibleMapping?.(removingMapping.id);
          }
          setRemovingMapping(null);
        }}
        onCancel={() => setRemovingMapping(null)}
      />
      {deprecatingSchema && deprecationImpact ? (
        <ModalDialog
          open
          onDismiss={closeDeprecationPreview}
          className="submission-dialog param-admin-editor-dialog"
          backdropClassName="param-admin-modal-backdrop"
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head">
              <div>
                <span className="eyebrow">组织级解析 · 停用</span>
                <h2 id={titleId}>{deprecatingSchema.displayName}</h2>
              </div>
            </div>
            <div className="form-stack">
              <p>{deprecationImpact.coverageLoss ? "解析覆盖将丢失" : "解析覆盖由后继来源继续提供"}</p>
              <p>定义 {deprecationImpact.definitionCount} 项</p>
              <p>项目 {deprecationImpact.projectCount} 个</p>
              {deprecationImpact.successorSource ? (
                <p>
                  后继来源：
                  {deprecationImpact.successorSource.scope === "platform"
                    ? `平台层解析 ${deprecationImpact.successorSource.displayName}`
                    : `${deprecationImpact.successorSource.source} ${deprecationImpact.successorSource.pattern}`}
                </p>
              ) : (
                <p className="form-error">无后继解析来源；这是高风险操作。</p>
              )}
              {deprecationImpact.coverageLoss ? (
                <label>
                  <input
                    type="checkbox"
                    checked={coverageLossConfirmed}
                    onChange={(event) => setCoverageLossConfirmed(event.target.checked)}
                  />
                  我确认该 compatible 将失去解析覆盖
                </label>
              ) : null}
            </div>
            <div className="dialog-actions">
              <button type="button" className="button subtle" onClick={closeDeprecationPreview}>
                取消
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || (deprecationImpact.coverageLoss && !coverageLossConfirmed)}
                onClick={() => {
                  void onDeprecateOverlaySchema?.(deprecatingSchema.id, {
                    confirmCoverageLoss: deprecationImpact.coverageLoss
                  });
                  closeDeprecationPreview();
                }}
              >
                确认{PARAMETER_ADMIN_UI.organizationDriverSchemaDeprecate}
              </button>
            </div>
            </>
          )}
        </ModalDialog>
      ) : null}
    </>
  );
}
