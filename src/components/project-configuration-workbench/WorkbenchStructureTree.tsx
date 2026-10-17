import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import { dtsValueTypeLabel } from "@/domain/dts/dtsValueTypeLabels";
import {
  propertyIdentity,
  sessionDraftKey,
  type SessionPropertyDraft
} from "@/application/project-configuration/sessionDrafts";
import {
  buildWorkbenchStructureTree,
  workbenchExpansionPath,
  workbenchIdsToExpandUpToDepth,
  workbenchStructureTreeIndex,
  type WorkbenchStructureTreeNode
} from "./workbenchStructureTreeModel";

export type WorkbenchStructureTreeProps = {
  nodes: DtsStructuralNode[];
  fileId: string;
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  sessionDrafts: Record<string, SessionPropertyDraft>;
  onSelectNode: (nodePath: string) => void;
  onSelectProperty: (nodePath: string, propertyName: string) => void;
  ariaLabel: string;
  /** Expand so levels 1..defaultExpandDepth are visible. Default 2. */
  defaultExpandDepth?: number;
  showValues?: boolean;
};

export function WorkbenchStructureTree({
  nodes,
  fileId,
  selectedNodePath,
  selectedPropertyName,
  sessionDrafts,
  onSelectNode,
  onSelectProperty,
  ariaLabel,
  defaultExpandDepth = 2,
  showValues = false
}: WorkbenchStructureTreeProps) {
  const roots = useMemo(() => buildWorkbenchStructureTree(nodes), [nodes]);
  const { byId } = useMemo(() => workbenchStructureTreeIndex(roots), [roots]);
  const treeRef = useRef<HTMLUListElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = workbenchIdsToExpandUpToDepth(roots, defaultExpandDepth);
    for (const id of workbenchExpansionPath(byId, selectedNodePath)) initial.add(id);
    return initial;
  });

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => byId.has(id)));
      for (const id of workbenchIdsToExpandUpToDepth(roots, defaultExpandDepth)) next.add(id);
      for (const id of workbenchExpansionPath(byId, selectedNodePath)) next.add(id);
      return next;
    });
  }, [byId, defaultExpandDepth, roots, selectedNodePath]);

  const setExpanded = (nodeId: string, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  };

  const visibleItems: Array<{ key: string; nodePath: string; propertyName?: string; parentKey: string | null }> = [];
  const collectVisible = (branch: WorkbenchStructureTreeNode[]) => {
    for (const item of branch) {
      const key = `node:${item.id}`;
      visibleItems.push({ key, nodePath: item.id, parentKey: item.parentId ? `node:${item.parentId}` : null });
      if (!expandedIds.has(item.id)) continue;
      collectVisible(item.children);
      for (const property of item.node.properties) {
        visibleItems.push({ key: `property:${propertyIdentity(item.id, property.name)}`, nodePath: item.id,
          propertyName: property.name, parentKey: key });
      }
    }
  };
  collectVisible(roots);
  const selectedKey = selectedPropertyName && selectedNodePath
    ? `property:${propertyIdentity(selectedNodePath, selectedPropertyName)}` : `node:${selectedNodePath}`;
  const tabStopKey = [focusedKey, selectedKey, visibleItems[0]?.key]
    .find((key) => visibleItems.some((item) => item.key === key));

  const focusItem = (key: string | undefined) => {
    if (!key) return;
    setFocusedKey(key);
    Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-tree-key]") ?? [])
      .find((item) => item.dataset.treeKey === key)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest("button") && (event.key === "Enter" || event.key === " ")) return;
    const key = event.target.closest<HTMLElement>("[data-tree-key]")?.dataset.treeKey;
    const index = visibleItems.findIndex((item) => item.key === key);
    const item = visibleItems[index];
    if (!item || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const node = byId.get(item.nodePath)!;
    switch (event.key) {
      case "ArrowDown": focusItem(visibleItems[Math.min(index + 1, visibleItems.length - 1)]?.key); break;
      case "ArrowUp": focusItem(visibleItems[Math.max(index - 1, 0)]?.key); break;
      case "Home": focusItem(visibleItems[0]?.key); break;
      case "End": focusItem(visibleItems.at(-1)?.key); break;
      case "ArrowRight":
        if (item.propertyName || !(node.children.length || node.node.properties.length)) break;
        if (!expandedIds.has(node.id)) setExpanded(node.id, true);
        else focusItem(visibleItems[index + 1]?.key);
        break;
      case "ArrowLeft":
        if (!item.propertyName && expandedIds.has(node.id)) setExpanded(node.id, false);
        else focusItem(item.parentKey ?? undefined);
        break;
      default:
        if (item.propertyName) onSelectProperty(item.nodePath, item.propertyName);
        else onSelectNode(item.nodePath);
    }
  };

  const renderBranch = (branch: WorkbenchStructureTreeNode[], level: number): ReactNode =>
    branch.map((treeNode) => {
      const hasChildren = treeNode.children.length > 0;
      const propertyCount = treeNode.node.properties.length;
      const canExpand = hasChildren || propertyCount > 0;
      const expanded = canExpand && expandedIds.has(treeNode.id);
      const nodeSelected = selectedNodePath === treeNode.id && !selectedPropertyName;
      const showProperties = expanded && propertyCount > 0;
      const pathLabel = treeNode.node.nodePath || "/";

      return (
        <li key={treeNode.id} role="none" className="dts-topology-navigator__branch">
          <div
            role="treeitem"
            aria-level={level}
            aria-expanded={canExpand ? expanded : undefined}
            aria-selected={nodeSelected}
            aria-label={`节点 ${pathLabel}`}
            tabIndex={tabStopKey === `node:${treeNode.id}` ? 0 : -1}
            data-tree-key={`node:${treeNode.id}`}
            onFocus={() => setFocusedKey(`node:${treeNode.id}`)}
            onKeyDown={handleKeyDown}
            className={`dts-topology-navigator__item${nodeSelected ? " is-selected" : ""}`}
            onClick={(event) => {
              event.currentTarget.focus();
              onSelectNode(treeNode.id);
            }}
          >
            {canExpand ? (
              <button
                type="button"
                tabIndex={-1}
                className="dts-topology-navigator__disclosure"
                aria-label={expanded ? `折叠 ${treeNode.label}` : `展开 ${treeNode.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  focusItem(`node:${treeNode.id}`);
                  setExpanded(treeNode.id, !expanded);
                }}
              >
                {expanded ? (
                  <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="dts-topology-navigator__disclosure" aria-hidden="true" />
            )}
            <code className="dts-topology-navigator__label" title={pathLabel}>
              {treeNode.label}
            </code>
            <span className="dts-topology-navigator__meta">
              {propertyCount > 0 ? (
                <span className="dts-topology-navigator__count">{propertyCount} 个属性</span>
              ) : hasChildren ? (
                <span className="dts-topology-navigator__count">{treeNode.children.length} 个子节点</span>
              ) : null}
            </span>
          </div>
          {expanded && hasChildren ? (
            <ul role="group" className="dts-topology-navigator__group">
              {renderBranch(treeNode.children, level + 1)}
            </ul>
          ) : null}
          {showProperties ? (
            <ul
              role="group"
              className="dts-topology-navigator__group configuration-workbench__structure-property-group"
            >
              {treeNode.node.properties.map((property) => {
                const propertySelected = selectedNodePath === treeNode.id && selectedPropertyName === property.name;
                const identity = propertyIdentity(treeNode.id, property.name);
                const draftKey = sessionDraftKey({
                  fileId,
                  nodePath: treeNode.id,
                  propertyName: property.name
                });
                const draft = sessionDrafts[draftKey] ?? sessionDrafts[identity];
                const hasSessionChange = Boolean(draft);
                const value = draft?.present === false ? "已移除" : property.valueType === "bool"
                  ? "已设置" : draft?.rawText ?? property.rawText;
                return (
                  <li key={`${treeNode.id}/${property.name}`} role="none" className="dts-topology-navigator__branch">
                    <div
                      role="treeitem"
                      aria-level={level + 1}
                      aria-selected={propertySelected}
                      aria-label={`属性 ${treeNode.id}/${property.name}`}
                      tabIndex={tabStopKey === `property:${identity}` ? 0 : -1}
                      data-tree-key={`property:${identity}`}
                      onFocus={() => setFocusedKey(`property:${identity}`)}
                      onKeyDown={handleKeyDown}
                      data-property-identity={identity}
                      data-session-change={hasSessionChange ? "true" : undefined}
                      className={`dts-topology-navigator__item configuration-workbench__structure-property${propertySelected ? " is-selected" : ""}${hasSessionChange ? " has-session-change" : ""}`}
                      onClick={(event) => {
                        event.currentTarget.focus();
                        onSelectProperty(treeNode.id, property.name);
                      }}
                    >
                      <span className="dts-topology-navigator__disclosure" aria-hidden="true" />
                      <code className="dts-topology-navigator__label">{property.name}</code>
                      {showValues ? <code className="configuration-workbench__structure-value" title={value}>{value}</code> : null}
                      {!showValues ? <span className="dts-topology-navigator__meta">
                        <span className="dts-topology-navigator__count">
                          {dtsValueTypeLabel(property.valueType)}
                        </span>
                      </span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </li>
      );
    });

  if (roots.length === 0) {
    return (
      <div role="group" aria-label={ariaLabel} className="dts-topology-navigator__empty">
        <div role="treeitem" aria-disabled="true" aria-selected="false" aria-live="polite">
          没有可展示的结构节点。
        </div>
      </div>
    );
  }

  return (
    // role="group", not "tree": this subtree always renders nested inside the
    // member tree (WorkbenchSourceTree), and a tree may not own another tree.
    <ul role="group" aria-label={ariaLabel} ref={treeRef}
      className="dts-topology-navigator configuration-workbench__structure-navigator">
      {renderBranch(roots, 1)}
    </ul>
  );
}
