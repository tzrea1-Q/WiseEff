import { CircleX, Plus, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ParameterModuleDraft, PowerManagementParameterModule, PowerManagementParameterTemplate } from "@/powerManagementConfig";
import { ModuleDefinitionForm, canSubmitModuleDraft } from "./ModuleDefinitionForm";
import { ModuleEditDialog } from "./ModuleEditDialog";

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

function countParametersByModule(parameters: readonly PowerManagementParameterTemplate[], moduleName: string) {
  return parameters.filter((parameter) => parameter.module === moduleName).length;
}

function parametersInModule(parameters: readonly PowerManagementParameterTemplate[], moduleName: string) {
  return parameters
    .filter((parameter) => parameter.module === moduleName)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function moduleMatchesQuery(module: PowerManagementParameterModule, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [module.name, module.description, module.scope].join(" ").toLowerCase();
  return haystack.includes(query);
}

export function ModuleManagementDialog({
  open,
  modules,
  parameters,
  onClose,
  onAddModule,
  onUpdateModule,
  onDeleteModule,
  onEditParameterDefinition
}: {
  open: boolean;
  modules: readonly PowerManagementParameterModule[];
  parameters: readonly PowerManagementParameterTemplate[];
  onClose: () => void;
  onAddModule: (module: ParameterModuleDraft) => void;
  onUpdateModule: (moduleName: string, patch: ParameterModuleDraft) => void;
  onDeleteModule: (moduleName: string) => void;
  onEditParameterDefinition: (parameterId: string) => void;
}) {
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
        parameterCount: countParametersByModule(parameters, module.name),
        parameters: parametersInModule(parameters, module.name)
      }))
      .sort((left, right) => left.module.name.localeCompare(right.module.name));
  }, [modules, moduleQuery, parameters]);

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
            <span className="eyebrow">参数库治理</span>
            <h2 id="module-management-title">模块管理</h2>
            <p>维护模块分类与元信息。修改模块名称会同步更新共享参数库归属；删除仅适用于未被参数引用的模块。</p>
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
                    <th>参数数量</th>
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
                            disabled={row.parameterCount === 0}
                            aria-expanded={expandedModule === row.module.name}
                            onClick={() => toggleExpanded(row.module.name)}
                          >
                            {row.parameterCount}
                          </button>
                        </td>
                        <td>
                          <div className="param-admin-module-row-actions">
                            <button
                              className="button subtle"
                              type="button"
                              disabled={row.parameterCount === 0}
                              aria-expanded={expandedModule === row.module.name}
                              onClick={() => toggleExpanded(row.module.name)}
                            >
                              查看参数
                            </button>
                            <button className="button subtle" type="button" onClick={() => setEditingModuleName(row.module.name)}>
                              修改
                            </button>
                            <button
                              className="button ghost danger"
                              type="button"
                              disabled={row.parameterCount > 0}
                              title={row.parameterCount > 0 ? "仍有参数引用该模块，无法删除" : undefined}
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
                            <div className="param-admin-module-parameters" aria-label={`${row.module.name} 参数列表`}>
                              <div className="param-admin-module-parameters-head">
                                <strong>{row.module.name}</strong>
                                <span>{row.parameterCount} 个参数</span>
                              </div>
                              <ul className="param-admin-module-parameter-list">
                                {row.parameters.map((parameter) => (
                                  <li key={parameter.id}>
                                    <div className="param-admin-module-parameter-meta">
                                      <code>{parameter.name}</code>
                                      {parameter.description ? <span>{parameter.description}</span> : null}
                                    </div>
                                    <button
                                      className="button subtle"
                                      type="button"
                                      onClick={() => onEditParameterDefinition(parameter.id)}
                                    >
                                      修改定义
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
