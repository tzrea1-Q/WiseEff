import { useEffect, useMemo, useState } from "react";
import { emptyDebugAdminDraft } from "@/debugAdminDraft";
import type { DebugAdminParameterDraft, DebugParameterNodeBinding } from "@/domain/debugging/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";

export type CreateDebugParameterDialogProps = {
  open: boolean;
  isApiMode: boolean;
  canEdit: boolean;
  loading: boolean;
  existingParameters: readonly Pick<DebugAdminParameterDraft, "key">[];
  onCreate: (draft: DebugAdminParameterDraft) => void;
  onClose: () => void;
};

function createDefaultBindings(): DebugParameterNodeBinding[] {
  return [
    { protocol: "hdc", nodePath: "", accessMode: "RO", enabled: false, notes: "" },
    { protocol: "adb", nodePath: "", accessMode: "RO", enabled: false, notes: "" }
  ];
}

function createDraft(index: number): DebugAdminParameterDraft {
  const draft = emptyDebugAdminDraft(index);
  return {
    ...draft,
    bindings: createDefaultBindings()
  };
}

export function CreateDebugParameterDialog({
  open,
  isApiMode,
  canEdit,
  loading,
  existingParameters,
  onCreate,
  onClose
}: CreateDebugParameterDialogProps) {
  const [draft, setDraft] = useState<DebugAdminParameterDraft>(() => createDraft(1));

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
      setDraft(createDraft(existingParameters.length + 1));
    }
  }, [existingParameters.length, open]);

  const duplicatedKey = useMemo(
    () => existingParameters.some((parameter) => parameter.key.trim() === draft.key.trim()),
    [draft.key, existingParameters]
  );
  const fieldsDisabled = isApiMode ? !canEdit || loading : loading;

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="创建调试参数">
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">调试参数定义</span>
            <h2>新增参数</h2>
            <p>输入新参数定义并创建默认 HDC / ADB 空绑定。</p>
          </div>
        </div>

        <div className="param-admin-editor-dialog-body">
          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">标识信息</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">参数名称</span>
                <Input value={draft.name} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">参数 key</span>
                <Input value={draft.key} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} />
              </label>
            </div>
            {duplicatedKey ? <p className="debug-admin-error">该 key 已存在，请使用唯一 key。</p> : null}
          </div>

          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">值与范围</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">当前值</span>
                <Input
                  value={draft.currentValue}
                  disabled={fieldsDisabled}
                  onChange={(event) => setDraft((current) => ({ ...current, currentValue: event.target.value }))}
                />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">目标值</span>
                <Input
                  aria-label="调试目标值"
                  value={draft.targetValue}
                  disabled={fieldsDisabled}
                  onChange={(event) => setDraft((current) => ({ ...current, targetValue: event.target.value }))}
                />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">范围</span>
                <Input value={draft.range} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, range: event.target.value }))} />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">单位</span>
                <Input value={draft.unit} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} />
              </label>
            </div>
          </div>

          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">分类</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">风险</span>
                <DebugAdminSelectControl
                  ariaLabel="风险"
                  value={draft.risk}
                  onValueChange={(risk) => setDraft((current) => ({ ...current, risk }))}
                  disabled={fieldsDisabled}
                  options={[
                    { value: "High", label: "高" },
                    { value: "Medium", label: "中" },
                    { value: "Low", label: "低" }
                  ]}
                />
              </label>
              {isApiMode ? (
                <label className="debug-admin-field">
                  <span className="debug-admin-field-label">启用</span>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    disabled={fieldsDisabled}
                    onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dialog-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" disabled={fieldsDisabled || duplicatedKey} onClick={() => onCreate(draft)}>
            创建
          </Button>
        </div>
      </div>
    </div>
  );
}
