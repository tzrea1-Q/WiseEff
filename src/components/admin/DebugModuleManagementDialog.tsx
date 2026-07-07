import { CircleX, Plus, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import { countDebugNodesByModule, debugNodesInModule } from "@/debugAdminModules";
import type { ParameterModuleDraft, PowerManagementParameterModule } from "@/powerManagementConfig";
import { ModuleDefinitionForm, canSubmitModuleDraft } from "./ModuleDefinitionForm";
import { ModuleEditDialog } from "./ModuleEditDialog";

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

function moduleMatchesQuery(module: PowerManagementParameterModule, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [module.name, module.description, module.scope].join(" ").toLowerCase();
  return haystack.includes(query);
}

export type DebugModuleManagementDialogProps = {
  open: boolean;
  modules: readonly PowerManagementParameterModule[];
  nodes: readonly DebugNodeRegistryEntry[];
  onClose: () => void;
  onAddModule: (module: ParameterModuleDraft) => void;
  onUpdateModule: (moduleName: string, patch: ParameterModuleDraft) => void;
  onDeleteModule: (moduleName: string) => void;
  onEditNode: (nodeId: string) => void;
};

export function DebugModuleManagementDialog({
  open,
  modules,
  nodes,
  onClose,
  onAddModule,
  onUpdateModule,
  onDeleteModule,
  onEditNode
}: DebugModuleManagementDialogProps) {
  const [moduleQuery, setModuleQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<ParameterModuleDraft>(emptyModuleDraft());
  const [editingModuleName, setEditingModuleName] = useState<string | null>(null);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  const moduleNames = useMemo(() => modules.map((module) => module.name), [modules]);
  const editingModule = modules.find((module) => module.name === editingModuleName) ?? null;

  const moduleRows = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase();
    return modules
      .filter((module) => moduleMatchesQuery(module, query))
      .map((module) => ({
        module,
        nodeCount: countDebugNodesByModule(nodes, module.name),
        nodes: debugNodesInModule(nodes, module.name)
      }))
      .sort((left, right) => left.module.name.localeCompare(right.module.name, "zh-CN"));
  }, [modules, moduleQuery, nodes]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editingModuleName) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingModuleName, onClose, open]);

  useEffect(() => {
    if (open) {
      setModuleQuery("");
      setShowAddForm(false);
      setAddDraft(emptyModuleDraft());
      setEditingModuleName(null);
      setExpandedModule(null);
      setFormError("");
    }
  }, [open]);

  useEffect(() => {
    if (expandedModule && !moduleRows.some((row) => row.module.name === expandedModule)) {
      setExpandedModule(null);
    }
  }, [expandedModule, moduleRows]);

  if (!open) {
    return null;
  }

  const canCreate = canSubmitModuleDraft(addDraft, moduleNames);

  const handleAddModule = () => {
    if (!canCreate) {
      setFormError("请填写有效的模块名称");
      return;
    }
    onAddModule({
      name: addDraft.name.trim(),
      description: addDraft.description.trim(),
      scope: addDraft.scope.trim()
    });
    setAddDraft(emptyModuleDraft());
    setFormError("");
    setShowAddForm(false);
  };

  const toggleExpanded = (moduleName: string) => {
    setExpandedModule((current) => (current === moduleName ? null : moduleName));
    setFormError("");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="模块管理">
      <div className="submission-dialog param-admin-module-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">节点目录治理</span>
            <h2 id="debug-module-management-title">模块管理</h2>
            <p>维护调试节点模块分类与元信息。修改模块名称会同步更新节点目录归属；删除仅适用于未被节点引用的模块。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-dialog-body">
          <div className="param-admin-module-toolbar">
            <label className="param-admin-module-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索模块"
                type="search"
                placeholder="搜索名称、描述或范围"
                value={moduleQuery}
                onChange={(event) => setModuleQuery(event.target.value)}
              />
            </label>
            <button
              className="button subtle"
              type="button"
              aria-expanded={showAddForm}
              onClick={() => {
                setShowAddForm((current) => !current);
                setFormError("");
              }}
            >
              <Plus size={16} aria-hidden="true" />
              新增模块
            </button>
          </div>

          {showAddForm ? (
            <div className="param-admin-module-add param-admin-module-add--inline">
              <ModuleDefinitionForm
                existingNames={moduleNames}
                module={addDraft}
                onChange={(patch) => {
                  setAddDraft((current) => ({ ...current, ...patch }));
                  if (formError) {
                    setFormError("");
                  }
                }}
              />
              <div className="param-admin-module-add-actions">
                <button className="button primary" type="button" disabled={!canCreate} onClick={handleAddModule}>
                  创建
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setAddDraft(emptyModuleDraft());
                    setFormError("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {formError ? <p className="field-error param-admin-module-error">{formError}</p> : null}

          <div className="param-admin-module-table-wrap" aria-label="模块列表">
            {moduleRows.length === 0 ? (
              <p className="param-admin-module-empty">
                {modules.length === 0 ? "还没有模块，点击「新增模块」创建。" : "没有匹配的模块，请调整筛选条件。"}
              </p>
            ) : (
              <table className="param-admin-module-table">
                <colgroup>
                  <col className="param-admin-module-col-name" />
                  <col className="param-admin-module-col-count" />
                  <col className="param-admin-module-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>模块名称</th>
                    <th>节点数量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {moduleRows.map((row) => (
                    <Fragment key={row.module.name}>
                      <tr>
                        <td>
                          <div className="param-admin-module-name-cell">
                            <span className="param-admin-module-name">{row.module.name}</span>
                            {row.module.description ? <span className="param-admin-module-desc">{row.module.description}</span> : null}
                          </div>
                        </td>
                        <td>
                          <button
                            className="param-admin-module-count-button"
                            type="button"
                            disabled={row.nodeCount === 0}
                            aria-expanded={expandedModule === row.module.name}
                            onClick={() => toggleExpanded(row.module.name)}
                          >
                            {row.nodeCount}
                          </button>
                        </td>
                        <td>
                          <div className="param-admin-module-row-actions">
                            <button
                              className="button subtle"
                              type="button"
                              disabled={row.nodeCount === 0}
                              aria-expanded={expandedModule === row.module.name}
                              onClick={() => toggleExpanded(row.module.name)}
                            >
                              查看节点
                            </button>
                            <button className="button subtle" type="button" onClick={() => setEditingModuleName(row.module.name)}>
                              修改
                            </button>
                            <button
                              className="button ghost danger"
                              type="button"
                              disabled={row.nodeCount > 0}
                              title={row.nodeCount > 0 ? "仍有节点引用该模块，无法删除" : undefined}
                              onClick={() => onDeleteModule(row.module.name)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedModule === row.module.name ? (
                        <tr className="param-admin-module-parameters-row">
                          <td colSpan={3}>
                            <div className="param-admin-module-parameters" aria-label={`${row.module.name} 节点列表`}>
                              <ul className="param-admin-module-parameter-list">
                                {row.nodes.map((node) => (
                                  <li key={node.id}>
                                    <div className="param-admin-module-parameter-meta">
                                      <code>{node.name}</code>
                                      {node.description ? <span className="param-admin-module-parameter-summary">{node.description}</span> : null}
                                      {node.detailedDescription ? (
                                        <span className="param-admin-module-parameter-detail">{node.detailedDescription}</span>
                                      ) : null}
                                    </div>
                                    <button className="button subtle" type="button" onClick={() => onEditNode(node.id)}>
                                      编辑节点
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </div>

      {editingModule ? (
        <ModuleEditDialog
          existingNames={moduleNames}
          module={editingModule}
          onCancel={() => setEditingModuleName(null)}
          onSave={(patch) => {
            onUpdateModule(editingModule.name, patch);
            if (expandedModule === editingModule.name && patch.name !== editingModule.name) {
              setExpandedModule(patch.name);
            }
            setEditingModuleName(null);
          }}
        />
      ) : null}
    </div>
  );
}
