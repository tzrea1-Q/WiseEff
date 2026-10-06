import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { debugNodeModuleId } from "@/debugAdminModules";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { ParameterRepository, ProjectSummary } from "@/application/ports/ParameterRepository";

export type DebugNodeDraft = {
  name: string;
  description: string;
  detailedDescription: string;
  writeFormatExample: string;
  writeFormatHint: string;
  module: string;
  moduleId?: string;
  enabled: boolean;
  canonicalBinding?: DebugNodeRegistryEntry["canonicalBinding"];
};

export type DebugNodeEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  node?: DebugNodeRegistryEntry | null;
  moduleNodes: readonly FlatModuleNode[];
  loading: boolean;
  canEdit: boolean;
  parameterRepository?: Pick<ParameterRepository, "listProjects" | "listParameters">;
  onSave: (draft: DebugNodeDraft) => void;
  onClose: () => void;
};

function emptyDraft(moduleNodes: readonly FlatModuleNode[]): DebugNodeDraft {
  const defaultNode = moduleNodes[0];
  return {
    name: "",
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: defaultNode?.name ?? "",
    moduleId: defaultNode?.id,
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
    moduleId: debugNodeModuleId(node),
    enabled: node.enabled,
    canonicalBinding: node.canonicalBinding
  };
}

export function DebugNodeEditorDialog({
  open,
  mode,
  node,
  moduleNodes,
  loading,
  canEdit,
  parameterRepository,
  onSave,
  onClose
}: DebugNodeEditorDialogProps) {
  const [draft, setDraft] = useState<DebugNodeDraft>(() => emptyDraft(moduleNodes));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [parameters, setParameters] = useState<Awaited<ReturnType<ParameterRepository["listParameters"]>>>([]);
  const [associationLoading, setAssociationLoading] = useState(false);
  const [associationError, setAssociationError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(mode === "edit" && node ? draftFromNode(node) : emptyDraft(moduleNodes));
      setProjectId(mode === "edit" ? node?.canonicalBinding?.projectId ?? "" : "");
    }
  }, [mode, moduleNodes, node, open]);

  useEffect(() => {
    if (!open || !parameterRepository) return;
    let cancelled = false;
    setAssociationLoading(true);
    setAssociationError("");
    setProjects([]);
    setParameters([]);
    Promise.all([
      parameterRepository.listProjects(),
      projectId ? parameterRepository.listParameters({ projectId }) : Promise.resolve([])
    ]).then(([loadedProjects, loadedParameters]) => {
      if (cancelled) return;
      setProjects(loadedProjects);
      setParameters(loadedParameters.filter((item) => item.projectId === projectId && item.bindingId && item.effectiveRevisionId && item.currentValueId));
    }).catch(() => {
      if (!cancelled) setAssociationError("无法加载可关联的项目参数，请重新选择项目重试。");
    }).finally(() => {
      if (!cancelled) setAssociationLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, parameterRepository, projectId]);

  const fieldsDisabled = !canEdit || loading;
  const selectedModuleId = draft.moduleId ?? "";
  const canSubmit = draft.name.trim().length > 0 && selectedModuleId.length > 0 && !fieldsDisabled &&
    (!projectId || draft.canonicalBinding?.projectId === projectId);

  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      className="submission-dialog param-admin-editor-dialog debug-admin-definition-dialog"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">节点注册表</span>
            <h2 id={titleId}>{mode === "create" ? "创建节点" : "编辑节点"}</h2>
            <p>维护节点名称、简述与详细描述；协议路径请在「路径绑定」中配置。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} disabled={loading} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <div className="debug-admin-form-section">
            <div className="debug-admin-form-fields">
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">名称</span>
              <Input value={draft.name} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="debug-admin-field">
              <span className="debug-admin-field-label" id="debug-node-module-label">
                模块
              </span>
              <ModuleTreeSelect
                label="选择模块"
                labelledBy="debug-node-module-label"
                mode="single"
                nodes={moduleNodes}
                value={selectedModuleId}
                disabled={fieldsDisabled || moduleNodes.length === 0}
                placeholder={moduleNodes.length === 0 ? "请先在模块管理中创建模块" : "请选择模块"}
                onChange={(moduleId) => {
                  const next = typeof moduleId === "string" ? moduleId : moduleId[0];
                  const treeNode = moduleNodes.find((item) => item.id === next);
                  if (treeNode) {
                    setDraft((current) => ({ ...current, moduleId: treeNode.id, module: treeNode.name }));
                  }
                }}
              />
            </div>
            {parameterRepository ? (
              <div className="debug-admin-field debug-admin-field--stack debug-admin-field--full">
                <label className="debug-admin-field">
                  <span className="debug-admin-field-label">关联项目</span>
                  <select aria-label="关联项目" aria-describedby="debug-node-association-help" value={projectId} disabled={fieldsDisabled || associationLoading} onChange={(event) => {
                    setProjectId(event.target.value);
                    setParameters([]);
                    setDraft((current) => ({ ...current, canonicalBinding: null }));
                  }}>
                    <option value="">不关联项目参数</option>
                    {projectId && !projects.some((project) => project.id === projectId) ? <option value={projectId}>当前关联项目</option> : null}
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                {projectId ? (
                  <label className="debug-admin-field">
                    <span className="debug-admin-field-label">关联参数</span>
                    <select aria-label="关联参数" aria-describedby="debug-node-association-help" value={draft.canonicalBinding?.bindingId ?? ""} disabled={fieldsDisabled || associationLoading} onChange={(event) => {
                      const selected = parameters.find((item) => item.bindingId === event.target.value);
                      setDraft((current) => ({ ...current, canonicalBinding: selected ? {
                        projectId: selected.projectId,
                        bindingId: selected.bindingId!,
                        expectedEffectiveRevisionId: selected.effectiveRevisionId!,
                        expectedCurrentValueId: selected.currentValueId!
                      } : null }));
                    }}>
                      <option value="">请选择项目参数</option>
                      {draft.canonicalBinding && !parameters.some((item) => item.bindingId === draft.canonicalBinding?.bindingId) ? <option value={draft.canonicalBinding.bindingId}>当前关联参数</option> : null}
                      {parameters.map((item) => <option key={item.bindingId} value={item.bindingId}>{item.name} · {item.sourceNodePath || item.module}</option>)}
                    </select>
                  </label>
                ) : null}
                <p id="debug-node-association-help">
                  {associationLoading ? "正在加载项目参数…" : associationError || (projectId && parameters.length === 0 ? "该项目暂无可关联参数；可保留当前关联，或选择不关联项目参数。" : "可选：关联项目参数后按其当前版本校验；独立节点可不关联。")}
                </p>
              </div>
            ) : null}
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
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="button primary" disabled={!canSubmit} type="button" onClick={() => onSave(draft)}>
            {loading ? "保存中…" : "保存"}
          </button>
        </div>
        </>
      )}
    </ModalDialog>
  );
}
