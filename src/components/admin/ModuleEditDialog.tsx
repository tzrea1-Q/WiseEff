import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type {
  ModuleImportance,
  ModuleKind,
  ParameterModuleMapping
} from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";

export type ModuleEditSavePatch = ParameterModuleDraft & {
  importance?: ModuleImportance;
  kind?: "business" | "instance" | "logical";
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
  onSave,
  onCancel,
  onRemoveCompatibleMapping,
  onAddCompatibleMapping,
  onAuthorOverlaySchema,
  canAdmin = false
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
  onSave: (patch: ModuleEditSavePatch) => void;
  onCancel: () => void;
  onRemoveCompatibleMapping?: (mappingId: string) => void | Promise<void>;
  onAddCompatibleMapping?: (matchValue: string) => void | Promise<void>;
  onAuthorOverlaySchema?: (compatible: string) => void;
  canAdmin?: boolean;
}) {
  const addFieldId = useId();
  const [draft, setDraft] = useState<ParameterModuleDraft>({
    name: module.name,
    description: module.description ?? "",
    scope: module.scope ?? ""
  });
  const [importance, setImportance] = useState<ModuleImportance>(module.importance ?? "medium");
  const [kind, setKind] = useState<"business" | "instance" | "logical">(
    module.kind === "instance" || module.kind === "logical" ? module.kind : "business"
  );
  const [newCompatible, setNewCompatible] = useState("");

  useEffect(() => {
    setDraft({
      name: module.name,
      description: module.description ?? "",
      scope: module.scope ?? ""
    });
    setImportance(module.importance ?? "medium");
    setKind(module.kind === "instance" || module.kind === "logical" ? module.kind : "business");
    setNewCompatible("");
  }, [module]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canSave = canSubmitModuleDraft(draft, existingNames, module.name);
  const importanceVisible = showImportance && (!showKind || kind === "business");
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

  return (
    <div className="modal-backdrop param-admin-module-edit-backdrop" role="dialog" aria-modal="true" aria-label={`修改模块 ${module.name}`}>
      <div className="submission-dialog param-admin-module-edit-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">模块修改</span>
            <h2>{module.name}</h2>
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

          {showCompatibleRules ? (
            <section className="module-edit-compatible-rules" aria-label="compatible 匹配规则">
              <div className="module-edit-compatible-rules__head">
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
                    const coverageLabel = !coverage?.covered
                      ? PARAMETER_ADMIN_UI.driverRegistryCoverageUncovered
                      : isPromoted
                        ? PARAMETER_ADMIN_UI.driverRegistryCoveragePromoted
                        : isShadowed
                        ? PARAMETER_ADMIN_UI.driverRegistryCoverageShadowed
                        : isOverlay
                          ? PARAMETER_ADMIN_UI.driverRegistryCoverageOverlay
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
                            onClick={() => {
                              const label = `${mapping.matchKind}:${mapping.matchValue}`;
                              if (
                                !window.confirm(
                                  `确定移除规则 ${label}？\n命中该 compatible 的参数将在下次归属解析时重新落点。`
                                )
                              ) {
                                return;
                              }
                              void onRemoveCompatibleMapping(mapping.id);
                            }}
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
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
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
                ...(importanceVisible ? { importance } : {})
              });
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
