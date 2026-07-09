import { CircleX, Plus, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { FlatModuleNode, ModuleTreeNode } from "@/domain/modules/moduleTree";
import { buildModuleTree } from "@/domain/modules/moduleTree";
import { templateModuleId } from "@/parameterAdminLibrary";
import type { ParameterModuleDraft, PowerManagementParameterTemplate } from "@/powerManagementConfig";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { ModuleDefinitionForm, canSubmitModuleDraft } from "./ModuleDefinitionForm";
import { ModuleEditDialog } from "./ModuleEditDialog";

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

function countParametersByModule(parameters: readonly PowerManagementParameterTemplate[], moduleId: string) {
  return parameters.filter((parameter) => templateModuleId(parameter) === moduleId).length;
}

function parametersInModule(parameters: readonly PowerManagementParameterTemplate[], moduleId: string) {
  return parameters
    .filter((parameter) => templateModuleId(parameter) === moduleId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function moduleMatchesQuery(node: FlatModuleNode, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [node.name, node.description ?? "", node.scope ?? ""].join(" ").toLowerCase();
  return haystack.includes(query);
}

function siblingNames(moduleNodes: readonly FlatModuleNode[], parentId: string | null, excludeId?: string) {
  return moduleNodes
    .filter((node) => (node.parentId ?? null) === parentId && node.id !== excludeId)
    .map((node) => node.name);
}

function filterTreeNodes(tree: readonly ModuleTreeNode[], query: string): ModuleTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...tree];
  }

  const walk = (node: ModuleTreeNode): ModuleTreeNode | null => {
    const children = node.children.map(walk).filter((item): item is ModuleTreeNode => item !== null);
    if (moduleMatchesQuery(node, normalized) || children.length > 0) {
      return { ...node, children };
    }
    return null;
  };

  return tree.map(walk).filter((item): item is ModuleTreeNode => item !== null);
}

function ModuleTreeRows({
  node,
  depth,
  moduleNodes,
  parameters,
  expandedModuleId,
  onToggleExpanded,
  onEdit,
  onDelete,
  onAddChild,
  onMove,
  onEditParameterDefinition
}: {
  node: ModuleTreeNode;
  depth: number;
  moduleNodes: readonly FlatModuleNode[];
  parameters: readonly PowerManagementParameterTemplate[];
  expandedModuleId: string | null;
  onToggleExpanded: (moduleId: string) => void;
  onEdit: (moduleId: string) => void;
  onDelete: (moduleId: string) => void;
  onAddChild: (parentId: string) => void;
  onMove: (moduleId: string) => void;
  onEditParameterDefinition: (parameterId: string) => void;
}) {
  const parameterCount = countParametersByModule(parameters, node.id);
  const moduleParameters = parametersInModule(parameters, node.id);

  return (
    <Fragment key={node.id}>
      <tr>
        <td>
          <div className="param-admin-module-name-cell" style={{ paddingLeft: `${depth * 16}px` }}>
            <span className="param-admin-module-name">{node.name}</span>
            {node.description ? <span className="param-admin-module-desc">{node.description}</span> : null}
          </div>
        </td>
        <td>
          <button
            className="param-admin-module-count-button"
            type="button"
            disabled={parameterCount === 0}
            aria-expanded={expandedModuleId === node.id}
            onClick={() => onToggleExpanded(node.id)}
          >
            {parameterCount}
          </button>
        </td>
        <td>
          <div className="param-admin-module-row-actions">
            <button className="button subtle" type="button" onClick={() => onAddChild(node.id)}>
              添加子模块
            </button>
            <button
              className="button subtle"
              type="button"
              disabled={parameterCount === 0}
              aria-expanded={expandedModuleId === node.id}
              onClick={() => onToggleExpanded(node.id)}
            >
              查看参数
            </button>
            <button className="button subtle" type="button" onClick={() => onEdit(node.id)}>
              修改
            </button>
            <button className="button subtle" type="button" onClick={() => onMove(node.id)}>
              移动
            </button>
            <button
              className="button ghost danger"
              type="button"
              disabled={parameterCount > 0 || node.children.length > 0}
              title={parameterCount > 0 || node.children.length > 0 ? "仍有子模块或参数引用，无法删除" : undefined}
              onClick={() => onDelete(node.id)}
            >
              删除
            </button>
          </div>
        </td>
      </tr>
      {expandedModuleId === node.id ? (
        <tr className="param-admin-module-parameters-row">
          <td colSpan={3}>
            <div className="param-admin-module-parameters" aria-label={`${node.name} 参数列表`}>
              <div className="param-admin-module-parameters-head">
                <strong>{node.name}</strong>
                <span>{parameterCount} 个参数</span>
              </div>
              <ul className="param-admin-module-parameter-list">
                {moduleParameters.map((parameter) => (
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
      {node.children.map((child) => (
        <ModuleTreeRows
          key={child.id}
          depth={depth + 1}
          expandedModuleId={expandedModuleId}
          moduleNodes={moduleNodes}
          node={child}
          parameters={parameters}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onEdit={onEdit}
          onMove={onMove}
          onEditParameterDefinition={onEditParameterDefinition}
          onToggleExpanded={onToggleExpanded}
        />
      ))}
    </Fragment>
  );
}

export function ModuleManagementDialog({
  open,
  moduleNodes,
  parameters,
  onClose,
  onAddModule,
  onUpdateModule,
  onMoveModule,
  onDeleteModule,
  onEditParameterDefinition
}: {
  open: boolean;
  moduleNodes: readonly FlatModuleNode[];
  parameters: readonly PowerManagementParameterTemplate[];
  onClose: () => void;
  onAddModule: (module: ParameterModuleDraft, parentId?: string | null) => void;
  onUpdateModule: (moduleId: string, patch: ParameterModuleDraft) => void;
  onMoveModule?: (moduleId: string, parentId: string | null) => void;
  onDeleteModule: (moduleId: string) => void;
  onEditParameterDefinition: (parameterId: string) => void;
}) {
  const [moduleQuery, setModuleQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<ParameterModuleDraft>(emptyModuleDraft());
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [moveParentId, setMoveParentId] = useState<string>("");
  const [formError, setFormError] = useState("");

  const moduleTree = useMemo(() => buildModuleTree(moduleNodes), [moduleNodes]);
  const filteredTree = useMemo(() => filterTreeNodes(moduleTree, moduleQuery), [moduleQuery, moduleTree]);
  const editingModule = moduleNodes.find((module) => module.id === editingModuleId) ?? null;
  const moveTarget = moduleNodes.find((module) => module.id === moveModuleId) ?? null;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editingModuleId && !moveModuleId) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingModuleId, moveModuleId, onClose, open]);

  useEffect(() => {
    if (open) {
      setModuleQuery("");
      setShowAddForm(false);
      setAddParentId(null);
      setAddDraft(emptyModuleDraft());
      setEditingModuleId(null);
      setExpandedModuleId(null);
      setMoveModuleId(null);
      setMoveParentId("");
      setFormError("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const canCreate = canSubmitModuleDraft(addDraft, siblingNames(moduleNodes, addParentId));

  const handleAddModule = () => {
    if (!canCreate) {
      setFormError("请填写有效的模块名称");
      return;
    }
    onAddModule(
      {
        name: addDraft.name.trim(),
        description: addDraft.description.trim(),
        scope: addDraft.scope.trim()
      },
      addParentId
    );
    setAddDraft(emptyModuleDraft());
    setFormError("");
    setShowAddForm(false);
    setAddParentId(null);
  };

  const startAddChild = (parentId: string) => {
    setAddParentId(parentId);
    setShowAddForm(true);
    setAddDraft(emptyModuleDraft());
    setFormError("");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="模块管理">
      <div className="submission-dialog param-admin-module-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">参数库治理</span>
            <h2 id="module-management-title">模块管理</h2>
            <p>维护多层级模块分类。可添加子模块、移动、重命名；删除仅适用于无子节点且无参数引用的模块。</p>
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
              aria-expanded={showAddForm && addParentId === null}
              onClick={() => {
                setAddParentId(null);
                setShowAddForm((current) => !current);
                setFormError("");
              }}
            >
              <Plus size={16} aria-hidden="true" />
              新增根模块
            </button>
          </div>

          {showAddForm ? (
            <div className="param-admin-module-add param-admin-module-add--inline">
              {addParentId ? (
                <p className="param-admin-module-add-context">
                  在「{moduleNodes.find((node) => node.id === addParentId)?.name ?? addParentId}」下创建子模块
                </p>
              ) : null}
              <ModuleDefinitionForm
                existingNames={siblingNames(moduleNodes, addParentId)}
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
                    setAddParentId(null);
                    setAddDraft(emptyModuleDraft());
                    setFormError("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {moveTarget && onMoveModule ? (
            <div className="param-admin-module-move">
              <p>
                移动模块「{moveTarget.name}」到：
              </p>
              <ModuleTreeSelect
                label="目标父模块"
                mode="single"
                nodes={moduleNodes.filter((node) => node.id !== moveTarget.id && !node.path.startsWith(`${moveTarget.path}/`))}
                placeholder="根级（无父模块）"
                value={moveParentId}
                onChange={(next) => setMoveParentId(typeof next === "string" ? next : next[0] ?? "")}
              />
              <div className="param-admin-module-add-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => {
                    onMoveModule(moveTarget.id, moveParentId || null);
                    setMoveModuleId(null);
                    setMoveParentId("");
                  }}
                >
                  确认移动
                </button>
                <button className="button ghost" type="button" onClick={() => setMoveModuleId(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {formError ? <p className="field-error param-admin-module-error">{formError}</p> : null}

          <div className="param-admin-module-table-wrap" aria-label="模块列表">
            {filteredTree.length === 0 ? (
              <p className="param-admin-module-empty">
                {moduleNodes.length === 0 ? "还没有模块，点击「新增根模块」创建。" : "没有匹配的模块，请调整筛选条件。"}
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
                  {filteredTree.map((node) => (
                    <ModuleTreeRows
                      key={node.id}
                      depth={0}
                      expandedModuleId={expandedModuleId}
                      moduleNodes={moduleNodes}
                      node={node}
                      parameters={parameters}
                      onAddChild={startAddChild}
                      onDelete={onDeleteModule}
                      onEdit={setEditingModuleId}
                      onMove={setMoveModuleId}
                      onEditParameterDefinition={onEditParameterDefinition}
                      onToggleExpanded={(moduleId) => setExpandedModuleId((current) => (current === moduleId ? null : moduleId))}
                    />
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
          existingNames={siblingNames(moduleNodes, editingModule.parentId ?? null, editingModule.id)}
          module={editingModule}
          onCancel={() => setEditingModuleId(null)}
          onSave={(patch) => {
            onUpdateModule(editingModule.id, patch);
            setEditingModuleId(null);
          }}
        />
      ) : null}
    </div>
  );
}
