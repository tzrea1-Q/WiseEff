import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DebugConnectionProtocol, DebugParameterAccessMode, ParameterReloadBinding } from "@/domain/debugging/types";
import { getBindingNodePathValidationError } from "@/domain/debugging/bindingNodePath";
import type { ParameterReloadTargetDto } from "@/infrastructure/http/debuggingDtos";

export type ReloadBindingDraft = {
  parameterDefinitionId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  notes: string;
};

export type ReloadBindingEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  binding?: ParameterReloadBinding | null;
  candidates: readonly ParameterReloadTargetDto[];
  candidatesLoading: boolean;
  loading: boolean;
  canEdit: boolean;
  onSave: (draft: ReloadBindingDraft) => void;
  onClose: () => void;
};

function emptyDraft(): ReloadBindingDraft {
  return {
    parameterDefinitionId: "",
    protocol: "hdc",
    nodePath: "",
    accessMode: "RW",
    enabled: true,
    notes: ""
  };
}

function draftFromBinding(binding: ParameterReloadBinding): ReloadBindingDraft {
  return {
    parameterDefinitionId: binding.parameterDefinitionId,
    protocol: binding.protocol,
    nodePath: binding.nodePath,
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes ?? ""
  };
}

export function ReloadBindingEditorDialog({
  open,
  mode,
  binding,
  candidates,
  candidatesLoading,
  loading,
  canEdit,
  onSave,
  onClose
}: ReloadBindingEditorDialogProps) {
  const [draft, setDraft] = useState<ReloadBindingDraft>(() => emptyDraft());

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      setDraft(mode === "edit" && binding ? draftFromBinding(binding) : emptyDraft());
    }
  }, [binding, mode, open]);

  const parameterOptions = useMemo(
    () =>
      candidates.map((candidate) => ({
        value: candidate.parameterDefinitionId,
        label: `${candidate.name} (${candidate.module})`
      })),
    [candidates]
  );

  if (!open) {
    return null;
  }

  const fieldsDisabled = !canEdit || loading;
  const pathError = getBindingNodePathValidationError(draft.nodePath);
  const canSubmit =
    draft.parameterDefinitionId.trim().length > 0 && !pathError && !fieldsDisabled;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={mode === "create" ? "创建参数重载绑定" : "编辑参数重载绑定"}>
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">参数重载绑定</span>
            <h2>{mode === "create" ? "创建绑定" : "编辑绑定"}</h2>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} disabled={loading} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="debug-admin-form-section">
          <div className="debug-admin-form-fields">
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">参数定义</span>
              <DebugAdminSelectControl
                ariaLabel="参数定义"
                value={draft.parameterDefinitionId}
                disabled={fieldsDisabled || candidatesLoading || mode === "edit"}
                onValueChange={(parameterDefinitionId) => setDraft((current) => ({ ...current, parameterDefinitionId }))}
                options={[{ value: "", label: candidatesLoading ? "加载参数列表…" : "选择参数", disabled: true }, ...parameterOptions]}
              />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">协议</span>
              <DebugAdminSelectControl
                ariaLabel="协议"
                value={draft.protocol}
                disabled={fieldsDisabled || mode === "edit"}
                onValueChange={(protocol) => setDraft((current) => ({ ...current, protocol: protocol as DebugConnectionProtocol }))}
                options={[
                  { value: "hdc", label: "HDC" },
                  { value: "adb", label: "ADB" }
                ]}
              />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">节点路径</span>
              <Input
                aria-invalid={pathError ? "true" : "false"}
                value={draft.nodePath}
                disabled={fieldsDisabled}
                onChange={(event) => setDraft((current) => ({ ...current, nodePath: event.target.value }))}
              />
              {pathError ? <span className="field-error">{pathError}</span> : null}
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">访问模式</span>
              <DebugAdminSelectControl
                ariaLabel="访问模式"
                value={draft.accessMode}
                disabled={fieldsDisabled}
                onValueChange={(accessMode) => setDraft((current) => ({ ...current, accessMode: accessMode as DebugParameterAccessMode }))}
                options={[
                  { value: "RO", label: "只读" },
                  { value: "WO", label: "只写" },
                  { value: "RW", label: "读写" }
                ]}
              />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">备注</span>
              <Input value={draft.notes} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">启用</span>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={fieldsDisabled}
                onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
            </label>
          </div>
        </div>

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button disabled={!canSubmit} onClick={() => onSave(draft)}>
            {loading ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
