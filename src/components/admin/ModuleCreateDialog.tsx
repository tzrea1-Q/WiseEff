import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { ModuleImportance, ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import {
  allowedCreateKindsForParent,
  isValidCreateParent,
  MODULE_KIND_LABEL,
  parentFlatNodesForCreateKind,
  siblingModuleNames,
  type CreateModuleKind
} from "@/components/parameter-topology/moduleAttributionTreeUtils";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";

export type ModuleCreateSaveDraft = ParameterModuleDraft & {
  importance?: ModuleImportance;
  kind?: CreateModuleKind;
  parentId?: string | null;
  compatibles?: string[];
  sourceKey?: string | null;
};

const CREATE_KIND_LABEL: Record<CreateModuleKind, string> = {
  business: MODULE_KIND_LABEL.business,
  "driver-group": MODULE_KIND_LABEL["driver-group"],
  "node-type": MODULE_KIND_LABEL["node-type"]
};

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

function defaultKindForParent(parentKind: ParameterModule["kind"] | null | undefined): CreateModuleKind {
  const allowed = allowedCreateKindsForParent(parentKind);
  return allowed[0] ?? "business";
}

export function ModuleCreateDialog({
  parentName,
  existingNames,
  eyebrow = "模块创建",
  showImportance = false,
  initialImportance = "medium",
  allowKindSelect = false,
  modules = [],
  initialParentId = null,
  busy = false,
  error = null,
  onCreate,
  onCancel
}: {
  parentName?: string | null;
  existingNames: readonly string[];
  eyebrow?: string;
  showImportance?: boolean;
  initialImportance?: ModuleImportance;
  /** Attribution-tree create: kind picker, parent filter, compatibles / sourceKey. */
  allowKindSelect?: boolean;
  modules?: readonly ParameterModule[];
  initialParentId?: string | null;
  busy?: boolean;
  /** Create failure — the dialog stays open and shows it in place. */
  error?: string | null;
  onCreate: (draft: ModuleCreateSaveDraft) => void;
  onCancel: () => void;
}) {
  const initialParent = initialParentId
    ? (modules.find((module) => module.id === initialParentId) ?? null)
    : null;
  const [draft, setDraft] = useState<ParameterModuleDraft>(emptyModuleDraft);
  const [importance, setImportance] = useState<ModuleImportance>(initialImportance);
  const [kind, setKind] = useState<CreateModuleKind>(() =>
    allowKindSelect ? defaultKindForParent(initialParent?.kind ?? null) : "business"
  );
  const [parentId, setParentId] = useState<string | null>(initialParentId ?? null);
  const [compatiblesText, setCompatiblesText] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const parentFieldId = useId();

  const parentNodes = useMemo(
    () => (allowKindSelect ? parentFlatNodesForCreateKind(modules, kind) : []),
    [allowKindSelect, modules, kind]
  );
  const allowedKinds = useMemo(() => {
    if (!allowKindSelect) return ["business"] as CreateModuleKind[];
    // When opened from a specific parent row, constrain kinds to that parent.
    if (initialParentId !== undefined && initialParentId !== null) {
      return allowedCreateKindsForParent(initialParent?.kind ?? null);
    }
    if (initialParentId === null && !initialParent) {
      // Root "新建模块" — all kinds, parent chosen in dialog.
      return ["business", "driver-group", "node-type"] as CreateModuleKind[];
    }
    return allowedCreateKindsForParent(initialParent?.kind ?? null);
  }, [allowKindSelect, initialParent, initialParentId]);

  const resolvedExistingNames = allowKindSelect
    ? siblingModuleNames(modules, parentId)
    : existingNames;

  const selectedParentName = allowKindSelect
    ? parentId === null
      ? null
      : (modules.find((module) => module.id === parentId)?.name ?? null)
    : (parentName ?? null);
  const isChildModule = Boolean(selectedParentName);
  const dialogLabel = allowKindSelect
    ? "新建模块"
    : isChildModule
      ? `在 ${selectedParentName} 下创建子模块`
      : "新增根模块";
  const title = allowKindSelect
    ? "新建模块"
    : isChildModule
      ? `在「${selectedParentName}」下创建子模块`
      : "新增根模块";
  const description = allowKindSelect
    ? "选择类型与父级，创建空的业务分类、驱动组或节点类型；驱动组须填写至少一条 exact compatible。"
    : isChildModule
      ? showImportance
        ? "填写子模块名称、重要性、描述与适用范围。创建后会出现在所选父模块下。"
        : "填写子模块名称、描述与适用范围。创建后会出现在所选父模块下。"
      : showImportance
        ? "填写根模块名称、重要性、描述与适用范围。创建后会出现在模块列表顶层。"
        : "填写根模块名称、描述与适用范围。创建后会出现在模块列表顶层。";
  const parentPlaceholder =
    kind === "business"
      ? "根级（无父模块）"
      : kind === "node-type"
        ? "选择驱动组"
        : "选择业务分类";

  useEffect(() => {
    setDraft(emptyModuleDraft());
    setImportance(initialImportance);
    setCompatiblesText("");
    setSourceKey("");
    const nextKind = allowKindSelect ? defaultKindForParent(initialParent?.kind ?? null) : "business";
    setKind(nextKind);
    setParentId(initialParentId ?? null);
  }, [parentName, initialImportance, allowKindSelect, initialParentId, initialParent?.kind]);

  useEffect(() => {
    if (!allowKindSelect) return;
    if (!allowedKinds.includes(kind)) {
      setKind(allowedKinds[0] ?? "business");
    }
  }, [allowKindSelect, allowedKinds, kind]);

  useEffect(() => {
    if (!allowKindSelect) return;
    if (isValidCreateParent(modules, kind, parentId)) return;
    if (kind === "business") {
      setParentId(null);
      return;
    }
    const fallback = parentNodes.find((node) => isValidCreateParent(modules, kind, node.id));
    setParentId(fallback?.id ?? null);
  }, [allowKindSelect, modules, kind, parentId, parentNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const compatibles = compatiblesText
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const needsCompatibles = allowKindSelect && kind === "driver-group";
  const parentMissing = allowKindSelect && !isValidCreateParent(modules, kind, parentId);
  const showImportanceField = allowKindSelect ? kind === "business" : showImportance;
  const canCreate =
    canSubmitModuleDraft(draft, resolvedExistingNames) &&
    (!needsCompatibles || compatibles.length > 0) &&
    !parentMissing &&
    (!allowKindSelect || allowedKinds.includes(kind));

  const handleParentChange = (next: string | string[]) => {
    const nextId = typeof next === "string" ? next : "";
    if (!nextId) {
      if (kind === "business") setParentId(null);
      return;
    }
    if (!isValidCreateParent(modules, kind, nextId)) return;
    setParentId(nextId);
  };
  return (
    <div className="modal-backdrop param-admin-module-edit-backdrop" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      <div className="submission-dialog param-admin-module-edit-dialog module-create-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          <ModuleDefinitionForm
            existingNames={resolvedExistingNames}
            module={draft}
            showImportance={showImportanceField}
            importance={importance}
            onImportanceChange={setImportance}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            leading={
              allowKindSelect ? (
                <>
                  <label>
                    模块类型
                    <select
                      aria-label="模块类型"
                      value={kind}
                      onChange={(event) => setKind(event.target.value as CreateModuleKind)}
                    >
                      {allowedKinds.map((value) => (
                        <option key={value} value={value}>
                          {CREATE_KIND_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="module-create-dialog__parent-field">
                    <span className="module-create-dialog__parent-label" id={parentFieldId}>
                      父级
                    </span>
                    <ModuleTreeSelect
                      mode="single"
                      label="父级模块"
                      labelledBy={parentFieldId}
                      nodes={parentNodes}
                      value={parentId ?? ""}
                      onChange={handleParentChange}
                      placeholder={parentPlaceholder}
                    />
                  </div>
                </>
              ) : null
            }
            trailing={
              <>
                {needsCompatibles ? (
                  <label>
                    Exact compatible（每行一条，至少一条）
                    <textarea
                      aria-label="Exact compatible"
                      rows={3}
                      placeholder={"huawei,bypass_bst_hl7603\nhuawei,hl7603"}
                      value={compatiblesText}
                      onChange={(event) => setCompatiblesText(event.target.value)}
                    />
                  </label>
                ) : null}
                {allowKindSelect && kind === "node-type" ? (
                  <label>
                    sourceKey（可选）
                    <input
                      aria-label="sourceKey"
                      placeholder="节点路径或稳定键，便于日后 ingest 命中"
                      value={sourceKey}
                      onChange={(event) => setSourceKey(event.target.value)}
                    />
                  </label>
                ) : null}
              </>
            }
          />
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="button subtle" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canCreate || busy}
            onClick={() => {
              if (!canCreate || busy) {
                return;
              }
              onCreate({
                name: draft.name.trim(),
                description: draft.description.trim(),
                scope: draft.scope.trim(),
                ...(showImportanceField ? { importance } : {}),
                ...(allowKindSelect
                  ? {
                      kind,
                      parentId,
                      ...(needsCompatibles ? { compatibles } : {}),
                      ...(kind === "node-type"
                        ? { sourceKey: sourceKey.trim() || null }
                        : {})
                    }
                  : {})
              });
            }}
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
