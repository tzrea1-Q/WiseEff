import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildModuleSelectOptions } from "@/debugAdminModules";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";

export type DebugNodeDraft = {
  name: string;
  description: string;
  detailedDescription: string;
  writeFormatExample: string;
  writeFormatHint: string;
  module: string;
  enabled: boolean;
};

export type DebugNodeEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  node?: DebugNodeRegistryEntry | null;
  modules: readonly string[];
  loading: boolean;
  canEdit: boolean;
  onSave: (draft: DebugNodeDraft) => void;
  onClose: () => void;
};

function emptyDraft(): DebugNodeDraft {
  return {
    name: "",
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "",
    enabled: true
  };
}

function draftFromNode(node: DebugNodeRegistryEntry): DebugNodeDraft {
  return {
    name: node.name,
    description: node.description,
    detailedDescription: node.detailedDescription,
    writeFormatExample: node.writeFormatExample,
    writeFormatHint: node.writeFormatHint,
    module: node.module,
    enabled: node.enabled
  };
}

export function DebugNodeEditorDialog({
  open,
  mode,
  node,
  modules,
  loading,
  canEdit,
  onSave,
  onClose
}: DebugNodeEditorDialogProps) {
  const [draft, setDraft] = useState<DebugNodeDraft>(() => emptyDraft());

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
      setDraft(mode === "edit" && node ? draftFromNode(node) : emptyDraft());
    }
  }, [mode, node, open]);

  if (!open) {
    return null;
  }

  const fieldsDisabled = !canEdit || loading;
  const moduleOptions = buildModuleSelectOptions(modules, draft.module);
  const canSubmit = draft.name.trim().length > 0 && draft.module.trim().length > 0 && !fieldsDisabled;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={mode === "create" ? "创建调试节点" : "编辑调试节点"}>
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">节点注册表</span>
            <h2>{mode === "create" ? "创建节点" : "编辑节点"}</h2>
            <p>维护节点名称、简述与详细描述；协议路径请在「路径绑定」中配置。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} disabled={loading} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="debug-admin-form-section">
          <div className="debug-admin-form-fields">
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">名称</span>
              <Input value={draft.name} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">模块</span>
              <select
                aria-label="模块"
                value={draft.module}
                disabled={fieldsDisabled || moduleOptions.length === 0}
                onChange={(event) => setDraft((current) => ({ ...current, module: event.target.value }))}
              >
                <option value="" disabled>
                  {moduleOptions.length === 0 ? "请先在模块管理中创建模块" : "请选择模块"}
                </option>
                {moduleOptions.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>
                    {moduleName}
                  </option>
                ))}
              </select>
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">简述</span>
              <Input
                aria-label="简述"
                value={draft.description}
                disabled={fieldsDisabled}
                placeholder="用于目录列表展示的简短说明"
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label className="debug-admin-field debug-admin-field--stack debug-admin-field--full">
              <span className="debug-admin-field-label">详细描述</span>
              <Textarea
                aria-label="详细描述"
                value={draft.detailedDescription}
                disabled={fieldsDisabled}
                placeholder="补充节点用途、读写约束与注意事项"
                rows={2}
                onChange={(event) => setDraft((current) => ({ ...current, detailedDescription: event.target.value }))}
              />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">写入格式示例</span>
              <Input
                aria-label="写入格式示例"
                value={draft.writeFormatExample}
                disabled={fieldsDisabled}
                placeholder="例如 3100"
                onChange={(event) => setDraft((current) => ({ ...current, writeFormatExample: event.target.value }))}
              />
            </label>
            <label className="debug-admin-field debug-admin-field--stack debug-admin-field--full">
              <span className="debug-admin-field-label">写入格式说明</span>
              <Textarea
                aria-label="写入格式说明"
                value={draft.writeFormatHint}
                disabled={fieldsDisabled}
                placeholder="留空时使用默认说明：例如输入示例值，系统会通过 HDC/ADB 写入当前节点"
                rows={2}
                onChange={(event) => setDraft((current) => ({ ...current, writeFormatHint: event.target.value }))}
              />
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
