import { useState } from "react";

import type { CatalogNavigatorNode } from "./catalogModuleScope";

export type CatalogModuleNavigatorProps = {
  nodes: readonly CatalogNavigatorNode[];
  /** Selected module id, or `subject:<subjectId>` for a subject leaf. */
  selectedId: string | null;
  onSelectNode: (node: CatalogNavigatorNode) => void;
  /** Initial expansion depth; deeper nodes stay collapsed for compactness. */
  defaultExpandDepth?: number;
  ariaLabel?: string;
  emptyMessage?: string;
};

function TreeNode({
  node,
  selectedId,
  onSelectNode,
  depth,
  defaultExpandDepth
}: {
  node: CatalogNavigatorNode;
  selectedId: string | null;
  onSelectNode: (node: CatalogNavigatorNode) => void;
  depth: number;
  defaultExpandDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
  const selected = node.id === selectedId;
  const hasChildren = node.children.length > 0;
  const selectable = node.kind !== "unregistered-group";

  return (
    <li className="parameter-catalog__tree-node">
      <div className="parameter-catalog__tree-row">
        {hasChildren ? (
          <button
            type="button"
            className="parameter-catalog__tree-toggle"
            aria-label={`${expanded ? "收起" : "展开"} ${node.displayName}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="parameter-catalog__tree-toggle" aria-hidden="true" />
        )}
        {selectable ? (
          <button
            type="button"
            className="parameter-catalog__tree-select"
            aria-pressed={selected}
            aria-label={
              node.kind === "subject" ? `选择主体 ${node.displayName}` : undefined
            }
            data-catalog-node-kind={node.kind}
            {...(node.kind === "subject"
              ? { "data-catalog-subject-node": "true", "data-catalog-subject-id": node.subjectId }
              : {})}
            onClick={() => onSelectNode(node)}
          >
            <span className="parameter-catalog__tree-label">{node.displayName}</span>
            {node.kind === "subject" && node.meta ? (
              <span className="parameter-catalog__subject-meta">{node.meta}</span>
            ) : (
              <span className="parameter-catalog__module-count">{node.subjectCount}</span>
            )}
          </button>
        ) : (
          <span
            className="parameter-catalog__tree-select parameter-catalog__tree-select--group"
            data-catalog-node-kind={node.kind}
          >
            <span className="parameter-catalog__tree-label">{node.displayName}</span>
            <span className="parameter-catalog__module-count">{node.subjectCount}</span>
          </span>
        )}
      </div>
      {hasChildren && expanded ? (
        <ul className="parameter-catalog__tree">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelectNode={onSelectNode}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Organization module navigator for the restored definition workspace.
 *
 * One tree carries the whole navigation: module placements are the branches and
 * every subject is a leaf (registered subjects under their module, subjects with
 * no placement yet under one `未登记主体` branch). Selecting a module scopes the
 * collection to the node and its whole subtree, selecting a subject scopes it to
 * that subject, and clearing the selection returns to the complete organization
 * collection.
 */
export function CatalogModuleNavigator({
  nodes,
  selectedId,
  onSelectNode,
  defaultExpandDepth = 2,
  ariaLabel = "参数定义模块树",
  emptyMessage = "当前组织还没有模块放置。"
}: CatalogModuleNavigatorProps) {
  return (
    <nav aria-label={ariaLabel}>
      {nodes.length === 0 ? (
        <p className="parameter-catalog__muted">{emptyMessage}</p>
      ) : null}
      <ul className="parameter-catalog__tree">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelectNode={onSelectNode}
            depth={0}
            defaultExpandDepth={defaultExpandDepth}
          />
        ))}
      </ul>
    </nav>
  );
}
