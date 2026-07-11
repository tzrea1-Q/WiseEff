import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { FlatModuleNode, ModuleTreeNode } from "@/domain/modules/moduleTree";
import { ModuleManagementRowActions } from "./ModuleManagementRowActions";

export type ModuleManagementTreeRowsProps<TItem> = {
  node: ModuleTreeNode;
  depth: number;
  moduleNodes: readonly FlatModuleNode[];
  expandedTreeIds: ReadonlySet<string>;
  expandedDetailId: string | null;
  viewItemsLabel: string;
  detailListLabel: (moduleName: string) => string;
  detailCountLabel: (count: number) => string;
  editItemLabel: string;
  deleteDisabledReason: string;
  getItemCount: (moduleId: string) => number;
  getItems: (moduleId: string) => readonly TItem[];
  onToggleTree: (moduleId: string) => void;
  onToggleDetail: (moduleId: string) => void;
  onAddChild: (moduleId: string) => void;
  onEdit: (moduleId: string) => void;
  onMove: (moduleId: string) => void;
  onDelete: (moduleId: string) => void;
  onEditItem: (itemId: string) => void;
  renderItemMeta: (item: TItem) => ReactNode;
  getItemId: (item: TItem) => string;
};

export function ModuleManagementTreeRows<TItem>({
  node,
  depth,
  moduleNodes,
  expandedTreeIds,
  expandedDetailId,
  viewItemsLabel,
  detailListLabel,
  detailCountLabel,
  editItemLabel,
  deleteDisabledReason,
  getItemCount,
  getItems,
  onToggleTree,
  onToggleDetail,
  onAddChild,
  onEdit,
  onMove,
  onDelete,
  onEditItem,
  renderItemMeta,
  getItemId
}: ModuleManagementTreeRowsProps<TItem>) {
  const hasChildren = node.children.length > 0;
  const isTreeExpanded = expandedTreeIds.has(node.id);
  const itemCount = getItemCount(node.id);
  const items = getItems(node.id);

  return (
    <Fragment key={node.id}>
      <tr className={depth > 0 ? "param-admin-module-row is-child" : "param-admin-module-row"}>
        <td>
          <div className="param-admin-module-name-cell" style={{ paddingLeft: depth > 0 ? `${depth * 24}px` : undefined }}>
            <div className="param-admin-module-name-row">
              {hasChildren ? (
                <button
                  aria-expanded={isTreeExpanded}
                  aria-label={isTreeExpanded ? "折叠子模块" : "展开子模块"}
                  className="param-admin-module-tree-toggle"
                  type="button"
                  onClick={() => onToggleTree(node.id)}
                >
                  {isTreeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : (
                <span aria-hidden="true" className="param-admin-module-tree-toggle param-admin-module-tree-toggle--spacer" />
              )}
              <div className="param-admin-module-name-stack">
                <div className="param-admin-module-name-line">
                  <span className={depth > 0 ? "param-admin-module-name is-child-name" : "param-admin-module-name"}>{node.name}</span>
                  {hasChildren ? <span className="param-admin-module-child-count">{node.children.length} 个子模块</span> : null}
                </div>
                {node.description ? <span className="param-admin-module-desc">{node.description}</span> : null}
              </div>
            </div>
          </div>
        </td>
        <td>
          <button
            className="param-admin-module-count-button"
            type="button"
            disabled={itemCount === 0}
            aria-expanded={expandedDetailId === node.id}
            onClick={() => onToggleDetail(node.id)}
          >
            {itemCount}
          </button>
        </td>
        <td>
          <ModuleManagementRowActions
            canDelete={itemCount === 0 && node.children.length === 0}
            deleteDisabledReason={deleteDisabledReason}
            itemCount={itemCount}
            moduleName={node.name}
            viewItemsLabel={viewItemsLabel}
            onAddChild={() => onAddChild(node.id)}
            onDelete={() => onDelete(node.id)}
            onEdit={() => onEdit(node.id)}
            onMove={() => onMove(node.id)}
            onViewItems={() => onToggleDetail(node.id)}
          />
        </td>
      </tr>
      {expandedDetailId === node.id ? (
        <tr className="param-admin-module-parameters-row">
          <td colSpan={3}>
            <div className="param-admin-module-parameters" aria-label={detailListLabel(node.name)}>
              <div className="param-admin-module-parameters-head">
                <strong>{node.name}</strong>
                <span>{detailCountLabel(itemCount)}</span>
              </div>
              <ul className="param-admin-module-parameter-list">
                {items.map((item) => (
                  <li key={getItemId(item)}>
                    {renderItemMeta(item)}
                    <button className="button subtle" type="button" onClick={() => onEditItem(getItemId(item))}>
                      {editItemLabel}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      ) : null}
      {isTreeExpanded
        ? node.children.map((child) => (
            <ModuleManagementTreeRows
              key={child.id}
              depth={depth + 1}
              deleteDisabledReason={deleteDisabledReason}
              detailCountLabel={detailCountLabel}
              detailListLabel={detailListLabel}
              editItemLabel={editItemLabel}
              expandedDetailId={expandedDetailId}
              expandedTreeIds={expandedTreeIds}
              getItemCount={getItemCount}
              getItemId={getItemId}
              getItems={getItems}
              moduleNodes={moduleNodes}
              node={child}
              renderItemMeta={renderItemMeta}
              viewItemsLabel={viewItemsLabel}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onEdit={onEdit}
              onEditItem={onEditItem}
              onMove={onMove}
              onToggleDetail={onToggleDetail}
              onToggleTree={onToggleTree}
            />
          ))
        : null}
    </Fragment>
  );
}
