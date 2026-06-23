import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import type { DebugAdminParameterDraft } from "@/domain/debugging/types";

export type DebugParameterDefinitionDialogProps = {
  draft: DebugAdminParameterDraft;
  isApiMode: boolean;
  canEdit: boolean;
  loading: boolean;
  onDraftChange: (patch: Partial<DebugAdminParameterDraft>) => void;
  onSave: () => void;
  onClose: () => void;
};

export function DebugParameterDefinitionDialog({
  draft,
  isApiMode,
  canEdit,
  loading,
  onDraftChange,
  onSave,
  onClose
}: DebugParameterDefinitionDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fieldsDisabled = isApiMode ? !canEdit || loading : false;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="调试参数定义编辑">
      <div className="submission-dialog param-admin-editor-dialog debug-admin-definition-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">调试参数定义</span>
            <h2>编辑参数</h2>
            <p>维护参数定义、取值范围、风险与启用状态。</p>
          </div>
        </div>

        <div className="param-admin-editor-dialog-body">
          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">标识信息</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">参数名称</span>
                <Input value={draft.name} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ name: event.target.value })} />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">参数 key</span>
                <Input value={draft.key} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ key: event.target.value })} />
              </label>
            </div>
          </div>

          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">值与范围</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">当前值</span>
                <Input
                  value={draft.currentValue}
                  disabled={fieldsDisabled}
                  onChange={(event) => onDraftChange({ currentValue: event.target.value })}
                />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">目标值</span>
                <Input
                  aria-label="调试目标值"
                  value={draft.targetValue}
                  disabled={fieldsDisabled}
                  onChange={(event) => onDraftChange({ targetValue: event.target.value })}
                />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">范围</span>
                <Input value={draft.range} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ range: event.target.value })} />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">单位</span>
                <Input value={draft.unit} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ unit: event.target.value })} />
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
                  onValueChange={(risk) => onDraftChange({ risk })}
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
                    onChange={(event) => onDraftChange({ enabled: event.target.checked })}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dialog-actions">
          <Button type="button" onClick={onSave} disabled={fieldsDisabled}>
            保存
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
