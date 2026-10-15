import { CircleX, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import { buildModuleTree } from "@/domain/modules/moduleTree";
import { countDebugNodesByModuleId, debugNodesInModuleId } from "@/debugAdminModules";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SearchField } from "@/components/common/SearchField";
import { DebugModuleMoveDialog } from "./DebugModuleMoveDialog";
import { ModuleCreateDialog } from "./ModuleCreateDialog";
import { ModuleEditDialog } from "./ModuleEditDialog";
import { ModuleManagementTreeRows } from "./ModuleManagementTreeRows";
import "./debug-module-management.css";
import {
  buildDefaultExpandedTreeIds,
  collectExpandedIdsForFilteredTree,
  filterTreeNodes,
  siblingNames
} from "./moduleManagementTreeUtils";

export type DebugModuleManagementDialogProps = {
  open: boolean;
  moduleNodes: readonly FlatModuleNode[];
  nodes: readonly DebugNodeRegistryEntry[];
  canEdit: boolean;
  onClose: () => void;
  onAddModule: (module: ParameterModuleDraft, parentId?: string | null) => void | Promise<void>;
  onUpdateModule: (moduleId: string, patch: ParameterModuleDraft) => void | Promise<void>;
  onMoveModule?: (moduleId: string, parentId: string | null) => void | Promise<void>;
  onDeleteModule: (moduleId: string) => void | Promise<void>;
  onEditNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
};

export function DebugModuleManagementDialog({
  open,
  moduleNodes,
  nodes,
  canEdit,
  onClose,
  onAddModule,
  onUpdateModule,
  onMoveModule,
  onDeleteModule,
  onEditNode,
  onDeleteNode
}: DebugModuleManagementDialogProps) {
  const [moduleQuery, setModuleQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(() => new Set());
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const returnFocusModuleId = useRef<string | null>(null);
  const childOpen = showCreateDialog || Boolean(editingModuleId || moveModuleId);

  const moduleTree = useMemo(() => buildModuleTree(moduleNodes), [moduleNodes]);
  const filteredTree = useMemo(() => filterTreeNodes(moduleTree, moduleQuery), [moduleQuery, moduleTree]);
  const editingModule = moduleNodes.find((module) => module.id === editingModuleId) ?? null;
  const moveTarget = moduleNodes.find((module) => module.id === moveModuleId) ?? null;
  const createParentName = addParentId ? moduleNodes.find((node) => node.id === addParentId)?.name ?? addParentId : null;

  useEffect(() => {
    const justOpened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!justOpened) {
      return;
    }
    setModuleQuery("");
    setShowCreateDialog(false);
    setAddParentId(null);
    setEditingModuleId(null);
    setExpandedDetailId(null);
    setMoveModuleId(null);
    setMutationError(null);
    setExpandedTreeIds(buildDefaultExpandedTreeIds(moduleTree));
  }, [open, moduleTree]);

  useEffect(() => {
    if (!open || childOpen || returnFocusModuleId.current === null) return;
    const frame = requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>(".debug-module-management-dialog [data-module-id]"))
        .find((element) => element.dataset.moduleId === returnFocusModuleId.current);
      const target = row?.querySelector<HTMLButtonElement>('[role="group"] button')
        ?? document.querySelector<HTMLButtonElement>(".debug-module-management-dialog .param-admin-module-toolbar button");
      target?.focus();
      returnFocusModuleId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, childOpen]);

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
    (moduleId: string) => countDebugNodesByModuleId(nodes, moduleId, moduleNodes),
    [moduleNodes, nodes]
  );

  const getItems = useCallback(
    (moduleId: string) => debugNodesInModuleId(nodes, moduleId, moduleNodes),
    [moduleNodes, nodes]
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
    returnFocusModuleId.current = "";
    setMutationError(null);
    setAddParentId(null);
    setShowCreateDialog(true);
  };

  const startAddChild = (parentId: string) => {
    returnFocusModuleId.current = parentId;
    setMutationError(null);
    setAddParentId(parentId);
    setShowCreateDialog(true);
  };

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setAddParentId(null);
    setMutationError(null);
  };

  const saveModule = async (save: () => void | Promise<void>, close: () => void) => {
    if (mutationBusy) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await save();
      close();
    } catch {
      setMutationError("保存模块失败，请重试。已填写的内容会保留。");
    } finally {
      setMutationBusy(false);
    }
  };

  return (
    <>
    <ModalDialog
      open={open && !childOpen}
      onDismiss={onClose}
      className="submission-dialog param-admin-module-dialog debug-module-management-dialog"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">节点目录治理</span>
            <h2 id={titleId}>模块管理</h2>
            <p id={descriptionId}>按模块整理节点，点击数量查看节点。新增、编辑与移动均在当前工作区内完成。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-dialog-body">
          <div className="param-admin-module-toolbar">
            <SearchField
              className="param-admin-module-search"
              value={moduleQuery}
              onValueChange={setModuleQuery}
              placeholder="搜索名称、描述或范围"
              ariaLabel="搜索模块"
            />
            <button className="button primary" type="button" disabled={!canEdit} onClick={startAddRoot}>
              <Plus size={16} aria-hidden="true" />
              新增根模块
            </button>
          </div>

          <HorizontalDragScroll className="param-admin-module-table-wrap" aria-label="模块列表">
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
                    <th>节点数量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTree.map((node) => (
                    <ModuleManagementTreeRows
                      key={node.id}
                      depth={0}
                      canEdit={canEdit}
                      withinModal
                      deleteDisabledReason="仍有子模块或节点引用，无法删除"
                      detailCountLabel={(count) => `${count} 个节点`}
                      detailListLabel={(moduleName) => `${moduleName} 节点列表`}
                      deleteItemLabel="删除节点"
                      deleteItemDisabledReason={canEdit ? undefined : "缺少 debugging:admin 权限"}
                      editItemLabel="编辑节点"
                      expandedDetailId={expandedDetailId}
                      expandedTreeIds={expandedTreeIds}
                      getItemCount={getItemCount}
                      getItemId={(entry) => entry.id}
                      getItems={getItems}
                      moduleNodes={moduleNodes}
                      node={node}
                      renderItemMeta={(entry) => (
                        <div className="param-admin-module-parameter-meta">
                          <strong>{entry.name}</strong>
                          {entry.description ? <span>{entry.description}</span> : null}
                        </div>
                      )}
                      viewItemsLabel="查看节点"
                      onAddChild={startAddChild}
                      onDelete={onDeleteModule}
                      onDeleteItem={onDeleteNode}
                      onEdit={(moduleId) => {
                        returnFocusModuleId.current = moduleId;
                        setMutationError(null);
                        setEditingModuleId(moduleId);
                      }}
                      onEditItem={onEditNode}
                      onMove={(moduleId) => {
                        returnFocusModuleId.current = moduleId;
                        setMoveModuleId(moduleId);
                      }}
                      onToggleDetail={(moduleId) => setExpandedDetailId((current) => (current === moduleId ? null : moduleId))}
                      onToggleTree={toggleTree}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </HorizontalDragScroll>
        </div>

        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>
            完成
          </button>
        </div>
        </>
      )}
    </ModalDialog>

    {showCreateDialog ? (
      <ModuleCreateDialog
        className="debug-module-editor-dialog"
        eyebrow="节点模块创建"
        existingNames={siblingNames(moduleNodes, addParentId)}
        parentName={createParentName}
        busy={mutationBusy}
        error={mutationError}
        onCancel={closeCreateDialog}
        onCreate={(draft) => {
          void saveModule(() => onAddModule(draft, addParentId), closeCreateDialog);
        }}
      />
    ) : null}

    {editingModule ? (
      <ModuleEditDialog
        className="debug-module-editor-dialog"
        existingNames={siblingNames(moduleNodes, editingModule.parentId ?? null, editingModule.id)}
        module={editingModule}
        description="更新节点模块的名称、描述与适用范围。名称修改后，节点的模块归属会同步显示。"
        busy={mutationBusy}
        error={mutationError}
        onCancel={() => { setEditingModuleId(null); setMutationError(null); }}
        onSave={(patch) => {
          void saveModule(() => onUpdateModule(editingModule.id, patch), () => setEditingModuleId(null));
        }}
      />
    ) : null}

    {moveTarget && onMoveModule ? (
      <DebugModuleMoveDialog
        module={moveTarget}
        modules={moduleNodes}
        onCancel={() => setMoveModuleId(null)}
        onConfirm={(parentId) => onMoveModule(moveTarget.id, parentId)}
      />
    ) : null}
    </>
  );
}
