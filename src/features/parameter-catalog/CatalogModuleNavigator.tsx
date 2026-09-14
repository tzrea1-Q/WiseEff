import { useState } from "react";

import type { CatalogNavigatorNode } from "./catalogModuleScope";

export type CatalogModuleNavigatorProps = {
  nodes: readonly CatalogNavigatorNode[];
  selectedModuleId: string | null;
  onSelect: (moduleId: string) => void;
  /** Initial expansion depth; deeper nodes stay collapsed for compactness. */
  defaultExpandDepth?: number;
  ariaLabel?: string;
};

function TreeNode({
  node,
  selectedModuleId,
  onSelect,
  depth,
  defaultExpandDepth
}: {
  node: CatalogNavigatorNode;
  selectedModuleId: string | null;
  onSelect: (moduleId: string) => void;
  depth: number;
  defaultExpandDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
  const selected = node.id === selectedModuleId;
  const hasChildren = node.children.length > 0;

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
        <button
          type="button"
          className="parameter-catalog__tree-select"
          aria-pressed={selected}
          onClick={() => onSelect(node.id)}
        >
          <span className="parameter-catalog__tree-label">{node.displayName}</span>
          <span className="parameter-catalog__module-count">{node.subjectCount}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="parameter-catalog__tree">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedModuleId={selectedModuleId}
              onSelect={onSelect}
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
 * Selecting a node scopes the collection to the node and its whole subtree;
 * clearing the selection returns to the complete organization collection.
 */
export function CatalogModuleNavigator({
  nodes,
  selectedModuleId,
  onSelect,
  defaultExpandDepth = 2,
  ariaLabel = "参数定义模块树"
}: CatalogModuleNavigatorProps) {
  return (
    <nav aria-label={ariaLabel}>
      {nodes.length === 0 ? (
        <p className="parameter-catalog__muted">当前组织还没有模块放置。</p>
      ) : (
      <ul className="parameter-catalog__tree">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            selectedModuleId={selectedModuleId}
            onSelect={onSelect}
            depth={0}
            defaultExpandDepth={defaultExpandDepth}
          />
        ))}
      </ul>
      )}
    </nav>
  );
}
