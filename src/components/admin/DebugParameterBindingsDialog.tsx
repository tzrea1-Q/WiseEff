import { useEffect, useState } from "react";
import { bindingForProtocol } from "@/debugAdminDraft";
import type { DebugConnectionProtocol, DebugParameterNodeBinding } from "@/domain/debugging/types";
import { getBindingNodePathValidationError } from "@/domain/debugging/bindingNodePath";
import { shouldShowFieldError } from "@/components/common/fieldValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";

const BINDING_PROTOCOLS: DebugConnectionProtocol[] = ["hdc", "adb"];

export type DebugParameterBindingsDialogProps = {
  parameterName: string;
  draft: DebugParameterNodeBinding[];
  parameterId: string;
  isApiMode: boolean;
  canEdit: boolean;
  loading: boolean;
  onBindingChange: (protocol: DebugConnectionProtocol, patch: Partial<DebugParameterNodeBinding>) => void;
  onSave: () => void;
  onSaveBinding: (protocol: DebugConnectionProtocol) => void;
  onArchiveBinding: (protocol: DebugConnectionProtocol) => void;
  onClose: () => void;
};

export function DebugParameterBindingsDialog({
  parameterName,
  draft,
  parameterId,
  isApiMode,
  canEdit,
  loading,
  onBindingChange,
  onSave,
  onSaveBinding,
  onArchiveBinding,
  onClose
}: DebugParameterBindingsDialogProps) {
  const [touchedPaths, setTouchedPaths] = useState<Partial<Record<DebugConnectionProtocol, boolean>>>({});

  useEffect(() => {
    setTouchedPaths({});
  }, [parameterId, parameterName]);

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
  const canRunProtocolActions = Boolean(parameterId) && isApiMode;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${parameterName} 路径绑定`}>
      <div className="submission-dialog submission-dialog--wide param-admin-editor-dialog debug-admin-bindings-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">协议节点绑定</span>
            <h2>{parameterName}</h2>
            <p>配置 HDC / ADB 节点路径、访问模式与启用状态。</p>
          </div>
        </div>

        <div className="param-admin-editor-dialog-body">
          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">协议节点绑定</h3>
            <div className="debug-admin-binding-grid">
              {BINDING_PROTOCOLS.map((protocol) => {
                const binding = bindingForProtocol(draft, protocol);
                const label = protocol.toUpperCase();
                const pathError = getBindingNodePathValidationError(binding.nodePath);
                const visiblePathError = shouldShowFieldError(pathError, { touched: touchedPaths[protocol] });
                return (
                  <div className="debug-admin-binding-panel" key={protocol}>
                    <h4>{label}</h4>
                    <div className="debug-admin-field">
                      <span className="debug-admin-field-label">{label} 节点路径</span>
                      <Input
                        aria-invalid={visiblePathError ? "true" : "false"}
                        aria-label={`${label} 节点路径`}
                        value={binding.nodePath}
                        disabled={fieldsDisabled}
                        onBlur={() => setTouchedPaths((current) => ({ ...current, [protocol]: true }))}
                        onChange={(event) => onBindingChange(protocol, { nodePath: event.target.value })}
                      />
                      {visiblePathError ? <span className="field-error">{pathError}</span> : null}
                    </div>
                    <div className="debug-admin-field">
                      <span className="debug-admin-field-label">{label} 访问模式</span>
                      <DebugAdminSelectControl
                        ariaLabel={`${label} 访问模式`}
                        value={binding.accessMode}
                        onValueChange={(accessMode) => onBindingChange(protocol, { accessMode })}
                        disabled={fieldsDisabled}
                        options={[
                          { value: "RO", label: "RO · 只读" },
                          { value: "WO", label: "WO · 只写" },
                          { value: "RW", label: "RW · 读写" }
                        ]}
                      />
                    </div>
                    <div className="debug-admin-field">
                      <span className="debug-admin-field-label">启用</span>
                      <input
                        type="checkbox"
                        checked={binding.enabled}
                        disabled={fieldsDisabled}
                        onChange={(event) => onBindingChange(protocol, { enabled: event.target.checked })}
                      />
                    </div>
                    <div className="debug-admin-field">
                      <span className="debug-admin-field-label">备注</span>
                      <Input
                        value={binding.notes ?? ""}
                        disabled={fieldsDisabled}
                        onChange={(event) => onBindingChange(protocol, { notes: event.target.value })}
                      />
                    </div>
                    {canRunProtocolActions ? (
                      <div className="debug-admin-binding-actions">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={fieldsDisabled || Boolean(pathError)}
                          onClick={() => onSaveBinding(protocol)}
                        >
                          保存 {label} binding
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={fieldsDisabled || !binding.enabled}
                          onClick={() => onArchiveBinding(protocol)}
                        >
                          归档 {label} binding
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
