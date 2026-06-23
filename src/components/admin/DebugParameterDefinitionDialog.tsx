import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import type { DebugAdminParameterDraft } from "@/domain/debugging/types";
import {
  DEBUG_NORMALIZATION_MODE_EXACT,
  DEBUG_NORMALIZATION_MODE_JSON_CANONICAL,
  DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED,
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_DTS,
  DEBUG_VALUE_FORMAT_JSON,
  DEBUG_VALUE_FORMAT_KV_LIST,
  DEBUG_VALUE_FORMAT_LINE_LIST,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_COMPLEX,
  DEBUG_VALUE_KIND_SCALAR,
  debugValueEditorRows,
  isComplexDebugParameter,
  validateDebugJsonValue,
  type DebugNormalizationMode,
  type DebugValueFormat,
  type DebugValueKind
} from "@/debugValueKind";

export type DebugParameterDefinitionDialogProps = {
  draft: DebugAdminParameterDraft;
  isApiMode: boolean;
  canEdit: boolean;
  loading: boolean;
  onDraftChange: (patch: Partial<DebugAdminParameterDraft>) => void;
  onSave: () => void;
  onClose: () => void;
};

function applyValueKindChange(valueKind: DebugValueKind): Partial<DebugAdminParameterDraft> {
  if (valueKind === DEBUG_VALUE_KIND_SCALAR) {
    return {
      valueKind,
      valueFormat: DEBUG_VALUE_FORMAT_RAW,
      normalizationMode: DEBUG_NORMALIZATION_MODE_TRIM
    };
  }

  return { valueKind };
}

function applyValueFormatChange(valueFormat: DebugValueFormat): Partial<DebugAdminParameterDraft> {
  if (valueFormat === DEBUG_VALUE_FORMAT_JSON) {
    return { valueFormat };
  }

  return {
    valueFormat,
    normalizationMode:
      valueFormat === DEBUG_VALUE_FORMAT_RAW ? DEBUG_NORMALIZATION_MODE_EXACT : DEBUG_NORMALIZATION_MODE_TRIM
  };
}

function applyNormalizationModeChange(normalizationMode: DebugNormalizationMode): Partial<DebugAdminParameterDraft> {
  if (normalizationMode === DEBUG_NORMALIZATION_MODE_JSON_CANONICAL) {
    return {
      normalizationMode,
      valueFormat: DEBUG_VALUE_FORMAT_JSON
    };
  }

  return { normalizationMode };
}

function validateDraftValues(draft: DebugAdminParameterDraft): string | null {
  if (draft.valueFormat !== DEBUG_VALUE_FORMAT_JSON) {
    return null;
  }

  return (
    validateDebugJsonValue(draft.currentValue) ??
    validateDebugJsonValue(draft.targetValue)
  );
}

export function DebugParameterDefinitionDialog({
  draft,
  isApiMode,
  canEdit,
  loading,
  onDraftChange,
  onSave,
  onClose
}: DebugParameterDefinitionDialogProps) {
  const [validationError, setValidationError] = useState("");

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
  const isComplex = isComplexDebugParameter(draft);
  const currentRows = debugValueEditorRows(draft.currentValue, isComplex ? 8 : 6);
  const targetRows = debugValueEditorRows(draft.targetValue, isComplex ? 8 : 6);

  const handleSave = () => {
    const error = validateDraftValues(draft);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError("");
    onSave();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="调试参数定义编辑">
      <div
        className={[
          "submission-dialog",
          "param-admin-editor-dialog",
          "debug-admin-definition-dialog",
          isComplex ? "debug-admin-definition-dialog--complex" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">调试参数定义</span>
            <h2>编辑参数</h2>
            <p>维护参数定义、取值范围、值格式、风险与启用状态。</p>
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
            <h3 className="debug-admin-form-group-title">值类型与格式</h3>
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">值类型</span>
                <DebugAdminSelectControl
                  ariaLabel="值类型"
                  value={draft.valueKind ?? DEBUG_VALUE_KIND_SCALAR}
                  onValueChange={(valueKind) => {
                    setValidationError("");
                    onDraftChange(applyValueKindChange(valueKind as DebugValueKind));
                  }}
                  disabled={fieldsDisabled}
                  options={[
                    { value: DEBUG_VALUE_KIND_SCALAR, label: "标量" },
                    { value: DEBUG_VALUE_KIND_COMPLEX, label: "复杂配置" }
                  ]}
                />
              </label>
              {isComplex ? (
                <>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">值格式</span>
                    <DebugAdminSelectControl
                      ariaLabel="值格式"
                      value={draft.valueFormat ?? DEBUG_VALUE_FORMAT_RAW}
                      onValueChange={(valueFormat) => {
                        setValidationError("");
                        onDraftChange(applyValueFormatChange(valueFormat as DebugValueFormat));
                      }}
                      disabled={fieldsDisabled}
                      options={[
                        { value: DEBUG_VALUE_FORMAT_RAW, label: "原始文本" },
                        { value: DEBUG_VALUE_FORMAT_JSON, label: "JSON" },
                        { value: DEBUG_VALUE_FORMAT_DTS, label: "DTS" },
                        { value: DEBUG_VALUE_FORMAT_LINE_LIST, label: "行列表" },
                        { value: DEBUG_VALUE_FORMAT_KV_LIST, label: "KV 列表" }
                      ]}
                    />
                  </label>
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">规范化模式</span>
                    <DebugAdminSelectControl
                      ariaLabel="规范化模式"
                      value={draft.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM}
                      onValueChange={(normalizationMode) => {
                        setValidationError("");
                        onDraftChange(applyNormalizationModeChange(normalizationMode as DebugNormalizationMode));
                      }}
                      disabled={fieldsDisabled}
                      options={[
                        { value: DEBUG_NORMALIZATION_MODE_EXACT, label: "精确匹配" },
                        { value: DEBUG_NORMALIZATION_MODE_TRIM, label: "去除首尾空白" },
                        { value: DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED, label: "统一换行符" },
                        { value: DEBUG_NORMALIZATION_MODE_JSON_CANONICAL, label: "JSON 规范化" }
                      ]}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>

          <div className="debug-admin-form-section">
            <h3 className="debug-admin-form-group-title">值与范围</h3>
            {isComplex ? (
              <div className="debug-admin-complex-value-grid">
                <label className="debug-admin-field debug-admin-field--stack">
                  <span className="debug-admin-field-label">当前值</span>
                  <textarea
                    aria-label="当前值"
                    className="parameter-admin-code-editor"
                    value={draft.currentValue}
                    rows={currentRows}
                    wrap="off"
                    disabled={fieldsDisabled}
                    onChange={(event) => {
                      setValidationError("");
                      onDraftChange({ currentValue: event.target.value });
                    }}
                  />
                </label>
                <label className="debug-admin-field debug-admin-field--stack">
                  <span className="debug-admin-field-label">目标值</span>
                  <textarea
                    aria-label="调试目标值"
                    className="parameter-admin-code-editor"
                    value={draft.targetValue}
                    rows={targetRows}
                    wrap="off"
                    disabled={fieldsDisabled}
                    onChange={(event) => {
                      setValidationError("");
                      onDraftChange({ targetValue: event.target.value });
                    }}
                  />
                </label>
              </div>
            ) : (
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
              </div>
            )}
            <div className="debug-admin-form-fields">
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">范围</span>
                <Input value={draft.range} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ range: event.target.value })} />
              </label>
              <label className="debug-admin-field">
                <span className="debug-admin-field-label">单位</span>
                <Input value={draft.unit} disabled={fieldsDisabled} onChange={(event) => onDraftChange({ unit: event.target.value })} />
              </label>
            </div>
            {validationError ? <p className="debug-admin-error">{validationError}</p> : null}
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
          <Button type="button" onClick={handleSave} disabled={fieldsDisabled}>
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
