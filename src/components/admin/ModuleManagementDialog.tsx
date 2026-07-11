import { CircleX, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import { buildModuleTree } from "@/domain/modules/moduleTree";
import { templateModuleId } from "@/parameterAdminLibrary";
import type { ParameterModuleDraft, PowerManagementParameterTemplate } from "@/powerManagementConfig";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { ModuleCreateDialog } from "./ModuleCreateDialog";
import { ModuleEditDialog } from "./ModuleEditDialog";
import { ModuleManagementTreeRows } from "./ModuleManagementTreeRows";
import {
  buildDefaultExpandedTreeIds,
  collectExpandedIdsForFilteredTree,
  filterTreeNodes,
  siblingNames
} from "./moduleManagementTreeUtils";

function countParametersByModule(
  parameters: readonly PowerManagementParameterTemplate[],
  moduleId: string,
  moduleNodes: readonly FlatModuleNode[]
) {
  return parameters.filter((parameter) => templateModuleId(parameter, moduleNodes) === moduleId).length;
}

function parametersInModule(
  parameters: readonly PowerManagementParameterTemplate[],
  moduleId: string,
  moduleNodes: readonly FlatModuleNode[]
) {
  return parameters
    .filter((parameter) => templateModuleId(parameter, moduleNodes) === moduleId)
    .sort((left, right) => left.name.localeCompare(right.name));
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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(() => new Set());
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [moveParentId, setMoveParentId] = useState<string>("");

  const moduleTree = useMemo(() => buildModuleTree(moduleNodes), [moduleNodes]);
  const filteredTree = useMemo(() => filterTreeNodes(moduleTree, moduleQuery), [moduleQuery, moduleTree]);
  const editingModule = moduleNodes.find((module) => module.id === editingModuleId) ?? null;
  const moveTarget = moduleNodes.find((module) => module.id === moveModuleId) ?? null;
  const createParentName = addParentId ? moduleNodes.find((node) => node.id === addParentId)?.name ?? addParentId : null;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editingModuleId && !moveModuleId && !showCreateDialog) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingModuleId, moveModuleId, onClose, open, showCreateDialog]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setModuleQuery("");
    setShowCreateDialog(false);
    setAddParentId(null);
    setEditingModuleId(null);
    setExpandedDetailId(null);
    setMoveModuleId(null);
    setMoveParentId("");
    setExpandedTreeIds(buildDefaultExpandedTreeIds(moduleTree));
  }, [open, moduleTree]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const defaults = buildDefaultExpandedTreeIds(moduleTree);
    if (!moduleQuery.trim()) {
      setExpandedTreeIds(defaults);
      return;
    }
    const searchExpanded = collectExpandedIdsForFilteredTree(filteredTree);
    setExpandedTreeIds(new Set([...defaults, ...searchExpanded]));
  }, [filteredTree, moduleQuery, moduleTree, open]);

  const getItemCount = useCallback(
    (moduleId: string) => countParametersByModule(parameters, moduleId, moduleNodes),
    [moduleNodes, parameters]
  );

  const getItems = useCallback(
    (moduleId: string) => parametersInModule(parameters, moduleId, moduleNodes),
    [moduleNodes, parameters]
  );

  const toggleTree = useCallback((moduleId: string) => {
    setExpandedTreeIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }, []);

  if (!open) {
    return null;
  }

  const startAddRoot = () => {
    setAddParentId(null);
    setShowCreateDialog(true);
  };

  const startAddChild = (parentId: string) => {
    setAddParentId(parentId);
    setShowCreateDialog(true);
  };

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setAddParentId(null);
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
            <button className="button subtle" type="button" onClick={startAddRoot}>
              <Plus size={16} aria-hidden="true" />
              新增根模块
            </button>
          </div>

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
                    <ModuleManagementTreeRows
                      key={node.id}
                      depth={0}
                      deleteDisabledReason="仍有子模块或参数引用，无法删除"
                      detailCountLabel={(count) => `${count} 个参数`}
                      detailListLabel={(moduleName) => `${moduleName} 参数列表`}
                      editItemLabel="修改定义"
                      expandedDetailId={expandedDetailId}
                      expandedTreeIds={expandedTreeIds}
                      getItemCount={getItemCount}
                      getItemId={(parameter) => parameter.id}
                      getItems={getItems}
                      moduleNodes={moduleNodes}
                      node={node}
                      renderItemMeta={(parameter) => (
                        <div className="param-admin-module-parameter-meta">
                          <code>{parameter.name}</code>
                          {parameter.description ? <span>{parameter.description}</span> : null}
                        </div>
                      )}
                      viewItemsLabel="查看参数"
                      onAddChild={startAddChild}
                      onDelete={onDeleteModule}
                      onEdit={setEditingModuleId}
                      onEditItem={onEditParameterDefinition}
                      onMove={setMoveModuleId}
                      onToggleDetail={(moduleId) => setExpandedDetailId((current) => (current === moduleId ? null : moduleId))}
                      onToggleTree={toggleTree}
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

      {showCreateDialog ? (
        <ModuleCreateDialog
          existingNames={siblingNames(moduleNodes, addParentId)}
          parentName={createParentName}
          onCancel={closeCreateDialog}
          onCreate={(draft) => {
            onAddModule(draft, addParentId);
            closeCreateDialog();
          }}
        />
      ) : null}

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
