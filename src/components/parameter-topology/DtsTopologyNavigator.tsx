import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";

import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import type { TopologyView } from "@/domain/parameter-topology/types";

export type DtsTopologyNavigatorProps = {
  view: TopologyView;
  nodes: DtsWorkbenchTreeNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  ariaLabel?: string;
  /** API workbench keeps the mature browse experience open on first load. */
  expandAllByDefault?: boolean;
};

type TreeIndex = {
  byId: Map<string, DtsWorkbenchTreeNode>;
  rootsWithChildren: string[];
};

function indexTree(nodes: DtsWorkbenchTreeNode[]): TreeIndex {
  const byId = new Map<string, DtsWorkbenchTreeNode>();
  const pending = [...nodes];
  let cursor = 0;
  while (cursor < pending.length) {
    const node = pending[cursor++]!;
    if (byId.has(node.id)) continue;
    byId.set(node.id, node);
    pending.push(...node.children);
  }
  return {
    byId,
    rootsWithChildren: nodes.filter((node) => node.children.length > 0).map((node) => node.id)
  };
}

function nearestVisibleNodeId(
  index: TreeIndex,
  visibleIds: Set<string>,
  nodeId: string | null
): string | null {
  const visited = new Set<string>();
  let current = nodeId ? index.byId.get(nodeId) : undefined;
  while (current && !visited.has(current.id)) {
    if (visibleIds.has(current.id)) return current.id;
    visited.add(current.id);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return null;
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
  ariaLabel,
  expandAllByDefault = false
}: DtsTopologyNavigatorProps) {
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => expandAllByDefault
      ? new Set([...index.byId.values()].filter((node) => node.children.length > 0).map((node) => node.id))
      : new Set(expansionPath(index, selectedNodeId))
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(() => {
    const initialVisibleIds = visibleNodeIds(
      nodes,
      new Set(expansionPath(index, selectedNodeId))
    );
    return selectedNodeId && initialVisibleIds.includes(selectedNodeId)
      ? selectedNodeId
      : initialVisibleIds[0] ?? null;
  });
  const treeRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const previousSelectedNodeId = useRef(selectedNodeId);

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => index.byId.has(id)));
      for (const id of expansionPath(index, selectedNodeId)) next.add(id);
      return next;
    });
  }, [index, selectedNodeId]);

  const visibleIds = useMemo(() => visibleNodeIds(nodes, expandedIds), [expandedIds, nodes]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  const tabbableId = nearestVisibleNodeId(index, visibleIdSet, activeNodeId)
    ?? (selectedNodeId && visibleIdSet.has(selectedNodeId) ? selectedNodeId : null)
    ?? visibleIds[0]
    ?? null;

  useEffect(() => {
    const selectionChanged = previousSelectedNodeId.current !== selectedNodeId;
    previousSelectedNodeId.current = selectedNodeId;
    const treeHasFocus = Boolean(treeRef.current?.contains(document.activeElement));
    setActiveNodeId((current) => {
      if (
        selectionChanged
        && !treeHasFocus
        && selectedNodeId
        && index.byId.has(selectedNodeId)
      ) {
        return selectedNodeId;
      }
      return nearestVisibleNodeId(index, visibleIdSet, current)
        ?? (selectedNodeId && visibleIdSet.has(selectedNodeId) ? selectedNodeId : null)
        ?? visibleIds[0]
        ?? null;
    });
  }, [index, selectedNodeId, visibleIdSet, visibleIds]);

  const setExpanded = (nodeId: string, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  };

  const focusNode = (nodeId: string | null | undefined) => {
    if (!nodeId || !visibleIdSet.has(nodeId)) return;
    setActiveNodeId(nodeId);
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
          <div
            ref={(element) => {
              if (element) itemRefs.current.set(node.id, element);
              else itemRefs.current.delete(node.id);
            }}
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={selectedNodeId === node.id}
            tabIndex={tabbableId === node.id ? 0 : -1}
            className={`dts-topology-navigator__item${selectedNodeId === node.id ? " is-selected" : ""}`}
            onFocus={() => setActiveNodeId(node.id)}
            onClick={() => {
              focusNode(node.id);
              onSelectNode(node.id);
            }}
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
                return;
              }
              const currentIndex = visibleIds.indexOf(node.id);
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusNode(visibleIds[Math.min(currentIndex + 1, visibleIds.length - 1)]);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                focusNode(visibleIds[Math.max(currentIndex - 1, 0)]);
                return;
              }
              if (event.key === "Home") {
                event.preventDefault();
                focusNode(visibleIds[0]);
                return;
              }
              if (event.key === "End") {
                event.preventDefault();
                focusNode(visibleIds.at(-1));
              }
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                className="dts-topology-navigator__disclosure"
                aria-label={expanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setExpanded(node.id, !expanded);
                  focusNode(node.id);
                }}
              >
                {expanded
                  ? <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                  : <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
              </button>
            ) : (
              <span className="dts-topology-navigator__disclosure" aria-hidden="true" />
            )}
            <code className="dts-topology-navigator__label">{node.label}</code>
            <span className="dts-topology-navigator__meta">
              <span className="dts-topology-navigator__count">{node.bindingCount} 个参数</span>
              {node.attentionCount > 0 ? (
                <span className="dts-topology-navigator__attention">
                  <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
                  {node.attentionCount} 个待处理
                </span>
              ) : null}
            </span>
          </div>
          {expanded ? (
            <ul role="group" className="dts-topology-navigator__group">
              {renderNodes(node.children, level + 1, nextAncestry)}
            </ul>
          ) : null}
        </li>
      );
    })
  );

  const resolvedAriaLabel = ariaLabel ?? (view === "source" ? "源 DTS 拓扑" : "生效 DTS 拓扑");
  if (nodes.length === 0) {
    return (
      <div
        role="status"
        aria-label={resolvedAriaLabel}
        className="dts-topology-navigator__empty"
      >
        暂无 DTS 拓扑节点
      </div>
    );
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label={resolvedAriaLabel}
      className="dts-topology-navigator"
    >
      {renderNodes(nodes, 1, new Set())}
    </ul>
  );
}
