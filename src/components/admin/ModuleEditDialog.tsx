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
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";

export type ModuleEditSavePatch = ParameterModuleDraft & {
  importance?: ModuleImportance;
  compatibles?: string[];
  driverNature?: DriverNature;
  instanceCardinality?: InstanceCardinality;
  nodeTypeName?: string;
};

type EditableModule = {
  name: string;
  description?: string;
  scope?: string;
  importance?: ModuleImportance;
  effectiveImportance?: ModuleImportance;
  kind?: ModuleKind;
  compatibles?: readonly string[];
  driverNature?: DriverNature | null;
  instanceCardinality?: InstanceCardinality | null;
  nodeTypeName?: string | null;
};

const EMPTY_COMPATIBLES: readonly string[] = [];

export function ModuleEditDialog({
  module,
  existingNames,
  showImportance = false,
  busy = false,
  error = null,
  description,
  className = "",
  onSave,
  onCancel,
  canAdmin = false,
  driverNature = null,
  instanceCardinality = null,
  onManageCanonicalPlacement,
  historicalCompatibles = EMPTY_COMPATIBLES,
  readOnly = false,
}: {
  module: EditableModule;
  existingNames: readonly string[];
  showImportance?: boolean;
  busy?: boolean;
  /** Save failure — the dialog stays open and shows it in place. */
  error?: string | null;
  /** Context-specific help for consumers outside parameter management. */
  description?: string;
  className?: string;
  onSave: (patch: ModuleEditSavePatch) => void;
  onCancel: () => void;
  canAdmin?: boolean;
  driverNature?: DriverNature | null;
  instanceCardinality?: InstanceCardinality | null;
  onManageCanonicalPlacement?: () => void;
  historicalCompatibles?: readonly string[];
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<ParameterModuleDraft>({
    name: module.name,
    description: module.description ?? "",
    scope: module.scope ?? ""
  });
  const initialImportance = module.effectiveImportance ?? module.importance ?? "medium";
  const [importance, setImportance] = useState<ModuleImportance>(initialImportance);
  const initialCompatibles = module.compatibles ?? historicalCompatibles;
  const initialCompatibleText = initialCompatibles.join("\n");
  const initialNature = module.driverNature ?? driverNature ?? "physical-device";
  const initialCardinality = module.instanceCardinality ?? instanceCardinality ?? "multiple";
  const initialNodeTypeName = module.nodeTypeName ?? "";
  const [compatibleText, setCompatibleText] = useState(initialCompatibleText);
  const [nature, setNature] = useState<DriverNature>(initialNature);
  const [cardinality, setCardinality] = useState<InstanceCardinality>(initialCardinality);
  const [nodeTypeName, setNodeTypeName] = useState(initialNodeTypeName);
  const compatibles = [...new Set(compatibleText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  const compatiblesChanged = JSON.stringify(compatibles) !== JSON.stringify(initialCompatibles);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const moduleDetailsReadOnly = readOnly;
  const showCanonicalPlacementEntry =
    canAdmin && onManageCanonicalPlacement !== undefined;

  useEffect(() => {
    setDraft({
      name: module.name,
      description: module.description ?? "",
      scope: module.scope ?? ""
    });
    setImportance(initialImportance);
    setCompatibleText(initialCompatibleText);
    setNature(initialNature);
    setCardinality(initialCardinality);
    setNodeTypeName(initialNodeTypeName);
  }, [module.name, module.description, module.scope, initialImportance, initialCompatibleText,
    initialNature, initialCardinality, initialNodeTypeName]);

  const canSubmit = canSubmitModuleDraft(draft, existingNames, module.name);
  const importanceVisible = showImportance;
  const isDirty =
    draft.name.trim() !== module.name ||
    draft.description.trim() !== (module.description ?? "").trim() ||
    draft.scope.trim() !== (module.scope ?? "").trim() ||
    (importanceVisible && importance !== initialImportance) ||
    (module.kind === "driver-group" && (compatiblesChanged || nature !== initialNature || cardinality !== initialCardinality)) ||
    (module.kind === "node-type" && nodeTypeName.trim() !== initialNodeTypeName);
  const canSave = !moduleDetailsReadOnly && canSubmit && isDirty;
  const requestClose = () => {
    if (busy) return;
    if (isDirty && !moduleDetailsReadOnly) setConfirmDiscard(true);
    else onCancel();
  };

  return (
    <>
      <ModalDialog
        open={!confirmDiscard}
        onDismiss={busy ? undefined : requestClose}
        className={`submission-dialog param-admin-module-edit-dialog ${className}`}
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{moduleDetailsReadOnly ? "模块详情 · 只读" : "模块修改"}</span>
            <h2 id={titleId}>{module.name}</h2>
            <p id={descriptionId}>
              {moduleDetailsReadOnly
                ? "查看模块的名称、描述与适用范围。当前会话为只读。"
                : description ?? (showImportance
                    ? "更新模块名称、重要性、描述与适用范围。"
                    : "更新模块名称、描述与适用范围。修改名称会同步更新共享参数库中的模块归属。")}
            </p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={requestClose} disabled={busy} aria-label="关闭">
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
          {module.kind === "driver-group" ? (
            <section
              className="module-edit-section module-edit-driver-properties"
              aria-label="驱动属性"
            >
              <div className="module-edit-section__head">
                <h3>驱动属性</h3>
                <p className="muted">
                  当前组织内生效的驱动识别与实例规则。
                </p>
              </div>
              <div className="organization-driver-schema-dialog__field-grid">
                <label>
                  驱动性质
                  <SelectControl ariaLabel="驱动性质" value={nature} disabled={moduleDetailsReadOnly || busy}
                    onValueChange={setNature} options={["physical-device", "logical-service"].map((value) => ({
                      value: value as DriverNature, label: formatDriverNatureLabel(value as DriverNature)
                    }))} />
                </label>
                <label>
                  实例基数
                  <SelectControl ariaLabel="实例基数" value={cardinality} disabled={moduleDetailsReadOnly || busy}
                    onValueChange={setCardinality} options={["multiple", "singleton-per-project"].map((value) => ({
                      value: value as InstanceCardinality, label: formatInstanceCardinalityLabel(value as InstanceCardinality)
                    }))} />
                </label>
              </div>
              <div className="param-module-def-form"><label>compatible 匹配规则
                <textarea aria-label="compatible 匹配规则" rows={3} value={compatibleText} readOnly={moduleDetailsReadOnly || busy}
                  onChange={(event) => setCompatibleText(event.target.value)} placeholder="每行一条，例如 vendor,device" />
              </label></div>
              <p className="muted">每行一条完整 compatible；保存后替换此模块在当前组织内的识别规则。</p>
            </section>
          ) : null}

          {module.kind === "node-type" ? <section className="module-edit-section" aria-label="节点识别规则">
            <h3>节点识别规则</h3>
            <div className="param-module-def-form"><label>节点类型名<input aria-label="节点类型名" value={nodeTypeName} readOnly={moduleDetailsReadOnly || busy}
              onChange={(event) => setNodeTypeName(event.target.value)} placeholder="例如 charger，不含 @ 地址" /></label></div>
          </section> : null}

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
                ? "模块展示信息仅供读取，不会修改模块或当前规范主体归属。"
                : "维护模块在管理端展示的名称、描述和适用范围。"}</p>
            </div>
            <ModuleDefinitionForm
              currentName={module.name}
              existingNames={existingNames}
              module={draft}
              readOnly={moduleDetailsReadOnly || busy}
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
            <button className="button subtle" type="button" onClick={requestClose} disabled={busy}>
              取消
            </button>
            {!moduleDetailsReadOnly && isDirty ? (
              <button
                className="button primary"
                type="button"
                disabled={!canSave || busy}
                onClick={() => {
                  if (!canSave || busy) {
                    return;
                  }
                  onSave({
                    name: draft.name.trim(),
                    description: draft.description.trim(),
                    scope: draft.scope.trim(),

                    ...(importanceVisible && importance !== initialImportance ? { importance } : {}),
                    ...(module.kind === "driver-group" && compatiblesChanged ? { compatibles } : {}),
                    ...(module.kind === "driver-group" && nature !== initialNature ? { driverNature: nature } : {}),
                    ...(module.kind === "driver-group" && cardinality !== initialCardinality ? { instanceCardinality: cardinality } : {}),
                    ...(module.kind === "node-type" && nodeTypeName.trim() !== initialNodeTypeName ? { nodeTypeName: nodeTypeName.trim() } : {}),

                  });
                }}
              >
                {busy ? "保存中…" : "保存"}
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
      <ConfirmDialog open={confirmDiscard} title="放弃模块修改？"
        description="未保存的修改将丢失。可以继续编辑，或放弃修改并返回。"
        confirmLabel="放弃修改" cancelLabel="继续编辑"
        onCancel={() => setConfirmDiscard(false)} onConfirm={onCancel} />
    </>
  );
}
