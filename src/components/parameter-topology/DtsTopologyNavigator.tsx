import { useEffect, useMemo, useRef, useState } from "react";

import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import type { TopologyView } from "@/domain/parameter-topology/types";

export type DtsTopologyNavigatorProps = {
  view: TopologyView;
  nodes: DtsWorkbenchTreeNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  ariaLabel?: string;
};

type TreeIndex = {
  byId: Map<string, DtsWorkbenchTreeNode>;
  rootsWithChildren: string[];
};

function indexTree(nodes: DtsWorkbenchTreeNode[]): TreeIndex {
  const byId = new Map<string, DtsWorkbenchTreeNode>();
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (byId.has(node.id)) continue;
    byId.set(node.id, node);
    pending.push(...node.children);
  }
  return {
    byId,
    rootsWithChildren: nodes.filter((node) => node.children.length > 0).map((node) => node.id)
  };
}

function expansionPath(index: TreeIndex, selectedNodeId: string | null): string[] {
  const expanded = [...index.rootsWithChildren];
  const seen = new Set<string>();
  let current = selectedNodeId ? index.byId.get(selectedNodeId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.children.length > 0) expanded.push(current.id);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return expanded;
}

function visibleNodeIds(
  nodes: DtsWorkbenchTreeNode[],
  expandedIds: Set<string>
): string[] {
  const visible: string[] = [];
  const pending = [...nodes].reverse();
  const seen = new Set<string>();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    visible.push(node.id);
    if (expandedIds.has(node.id)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index]!);
      }
    }
  }
  return visible;
}

export function DtsTopologyNavigator({
  view,
  nodes,
  selectedNodeId,
  onSelectNode,
  ariaLabel
}: DtsTopologyNavigatorProps) {
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(expansionPath(index, selectedNodeId))
  );
  const itemRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => index.byId.has(id)));
      for (const id of expansionPath(index, selectedNodeId)) next.add(id);
      return next;
    });
  }, [index, selectedNodeId]);

  const visibleIds = visibleNodeIds(nodes, expandedIds);
  const tabbableId = selectedNodeId && visibleIds.includes(selectedNodeId)
    ? selectedNodeId
    : visibleIds[0] ?? null;

  const setExpanded = (nodeId: string, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  };

  const focusNode = (nodeId: string | null | undefined) => {
    if (!nodeId) return;
    itemRefs.current.get(nodeId)?.focus();
  };

  const renderNodes = (
    branch: DtsWorkbenchTreeNode[],
    level: number,
    ancestry: Set<string>
  ) => (
    branch.map((node) => {
      if (ancestry.has(node.id)) return null;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && expandedIds.has(node.id);
      const nextAncestry = new Set(ancestry).add(node.id);
      return (
        <li key={node.id} role="none" className="dts-topology-navigator__branch">
          <button
            ref={(element) => {
              if (element) itemRefs.current.set(node.id, element);
              else itemRefs.current.delete(node.id);
            }}
            type="button"
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={selectedNodeId === node.id}
            tabIndex={tabbableId === node.id ? 0 : -1}
            className={`dts-topology-navigator__item${selectedNodeId === node.id ? " is-selected" : ""}`}
            onClick={() => onSelectNode(node.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectNode(node.id);
                return;
              }
              if (event.key === "ArrowRight" && hasChildren) {
                event.preventDefault();
                if (!expanded) setExpanded(node.id, true);
                else focusNode(node.children[0]?.id);
                return;
              }
              if (event.key === "ArrowLeft") {
                if (expanded) {
                  event.preventDefault();
                  setExpanded(node.id, false);
                } else if (node.parentId) {
                  event.preventDefault();
                  focusNode(node.parentId);
                }
              }
            }}
          >
            <span className="dts-topology-navigator__disclosure" aria-hidden="true">
              {hasChildren ? (expanded ? "▾" : "▸") : ""}
            </span>
            <code className="dts-topology-navigator__label">{node.label}</code>
            <span className="dts-topology-navigator__count">{node.bindingCount} 个参数</span>
            {node.attentionCount > 0 ? (
              <span className="dts-topology-navigator__attention">
                {node.attentionCount} 个待处理
              </span>
            ) : null}
          </button>
          {expanded ? (
            <ul role="group" className="dts-topology-navigator__group">
              {renderNodes(node.children, level + 1, nextAncestry)}
            </ul>
          ) : null}
        </li>
      );
    })
  );

  return (
    <ul
      role="tree"
      aria-label={ariaLabel ?? (view === "source" ? "源 DTS 拓扑" : "生效 DTS 拓扑")}
      className="dts-topology-navigator"
    >
      {renderNodes(nodes, 1, new Set())}
    </ul>
  );
}
