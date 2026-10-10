import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ModuleImportance,
  ModuleKind
} from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import {
  formatDriverNatureLabel,
  formatInstanceCardinalityLabel,
} from "@/application/parameters/driverRegistrationLabels";
import type {
  DriverNature,
  InstanceCardinality,
} from "@/application/ports/ParameterModuleRegistryRepository";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";
import { ModalDialog } from "@/components/common/ModalDialog";

export type ModuleEditSavePatch = ParameterModuleDraft & {
  importance?: ModuleImportance;
};

type EditableModule = {
  name: string;
  description?: string;
  scope?: string;
  importance?: ModuleImportance;
  kind?: ModuleKind;
};

export function ModuleEditDialog({
  module,
  existingNames,
  showImportance = false,
  busy = false,
  error = null,
  onSave,
  onCancel,
  canAdmin = false,
  driverNature = null,
  instanceCardinality = null,
  onManageCanonicalPlacement,
  historicalCompatibles = [],
}: {
  module: EditableModule;
  existingNames: readonly string[];
  showImportance?: boolean;
  busy?: boolean;
  /** Save failure — the dialog stays open and shows it in place. */
  error?: string | null;
  onSave: (patch: ModuleEditSavePatch) => void;
  onCancel: () => void;
  canAdmin?: boolean;
  driverNature?: DriverNature | null;
  instanceCardinality?: InstanceCardinality | null;
  onManageCanonicalPlacement?: () => void;
  historicalCompatibles?: readonly string[];
}) {
  const [draft, setDraft] = useState<ParameterModuleDraft>({
    name: module.name,
    description: module.description ?? "",
    scope: module.scope ?? ""
  });
  const [importance, setImportance] = useState<ModuleImportance>(module.importance ?? "medium");
  const moduleDetailsReadOnly = module.kind === "driver-group" || module.kind === "node-type";
  const showCanonicalPlacementEntry =
    moduleDetailsReadOnly &&
    canAdmin && onManageCanonicalPlacement !== undefined;

  useEffect(() => {
    setDraft({
      name: module.name,
      description: module.description ?? "",
      scope: module.scope ?? ""
    });
    setImportance(module.importance ?? "medium");
  }, [module]);

  const canSubmit = canSubmitModuleDraft(draft, existingNames, module.name);
  const importanceVisible = showImportance && !moduleDetailsReadOnly;
  const isDirty =
    draft.name.trim() !== module.name ||
    draft.description.trim() !== (module.description ?? "").trim() ||
    draft.scope.trim() !== (module.scope ?? "").trim() ||
    (importanceVisible && importance !== (module.importance ?? "medium"));
  const canSave = !moduleDetailsReadOnly && canSubmit && isDirty;

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
              {moduleDetailsReadOnly
                ? "历史模块名称与详情仅供溯源；规范主体登记与归属由规范面板管理。"
                : showImportance
                    ? "更新模块名称、重要性、描述与适用范围。"
                    : "更新模块名称、描述与适用范围。修改名称会同步更新共享参数库中的模块归属。"}
            </p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          {historicalCompatibles.length > 0 ? (
            <section className="module-edit-section" aria-label="历史 compatible 溯源">
              <h3>历史 compatible 溯源</h3>
              <p className="muted">历史驱动注册表记录，仅供读取，不代表当前规范主体身份或匹配规则。</p>
              <ul>{historicalCompatibles.map((compatible) => (
                <li key={compatible}><code>{compatible}</code></li>
              ))}</ul>
            </section>
          ) : null}
          {module.kind === "driver-group" &&
          (driverNature != null || instanceCardinality != null) ? (
            <section
              className="module-edit-section module-edit-driver-properties"
              aria-label="驱动属性"
            >
              <div className="module-edit-section__head">
                <h3>驱动属性</h3>
                <p className="muted">
                  历史驱动登记属性仅供溯源，不代表当前规范主体登记或归属。
                </p>
              </div>
              <div className="organization-driver-schema-dialog__field-grid">
                <label>
                  驱动性质
                  {(
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
                  {(
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

          {showCanonicalPlacementEntry ? (
            <section className="module-edit-section" aria-label="规范主体放置">
              <div className="module-edit-section__head">
                <h3>规范主体放置</h3>
                <p className="muted">规范主体登记与模块归属请在页面上方的规范主体面板中管理。</p>
              </div>
              <button
                type="button"
                className="button subtle"
                onClick={onManageCanonicalPlacement}
              >
                管理规范主体与归属
              </button>
            </section>
          ) : null}

          <section className="module-edit-section module-edit-basic-info" aria-label="基础信息">
            <div className="module-edit-section__head">
              <h3>基础信息</h3>
              <p className="muted">{moduleDetailsReadOnly
                ? "历史展示信息仅供读取，不会修改历史模块或当前规范主体归属。"
                : "维护模块在管理端展示的名称、描述和适用范围。"}</p>
            </div>
            <ModuleDefinitionForm
              currentName={module.name}
              existingNames={existingNames}
              module={draft}
              readOnly={moduleDetailsReadOnly}
              showImportance={importanceVisible}
              importance={importance}
              onImportanceChange={setImportance}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
          </section>

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
            {!moduleDetailsReadOnly && isDirty ? (
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

                    ...(importanceVisible ? { importance } : {}),

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

    </>
  );
}
