import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import { dtsValueTypeLabel } from "@/domain/dts/dtsValueTypeLabels";
import {
  propertyIdentity,
  sessionDraftKey,
  type SessionPropertyDraft
} from "./sessionDrafts";
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
  defaultExpandDepth = 2
}: WorkbenchStructureTreeProps) {
  const roots = useMemo(() => buildWorkbenchStructureTree(nodes), [nodes]);
  const { byId } = useMemo(() => workbenchStructureTreeIndex(roots), [roots]);

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

  const renderBranch = (branch: WorkbenchStructureTreeNode[], level: number): ReactNode =>
    branch.map((treeNode) => {
      const hasChildren = treeNode.children.length > 0;
      const expanded = hasChildren && expandedIds.has(treeNode.id);
      const nodeSelected = selectedNodePath === treeNode.id && !selectedPropertyName;
      const showProperties = selectedNodePath === treeNode.id;
      const propertyCount = treeNode.node.properties.length;
      const pathLabel = treeNode.node.nodePath || "/";

      return (
        <li key={treeNode.id} role="none" className="dts-topology-navigator__branch">
          <div
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={nodeSelected}
            aria-label={`节点 ${pathLabel}`}
            tabIndex={-1}
            className={`dts-topology-navigator__item${nodeSelected ? " is-selected" : ""}`}
            onClick={() => onSelectNode(treeNode.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectNode(treeNode.id);
              }
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                className="dts-topology-navigator__disclosure"
                aria-label={expanded ? `折叠 ${treeNode.label}` : `展开 ${treeNode.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
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
          {expanded ? (
            <ul role="group" className="dts-topology-navigator__group">
              {renderBranch(treeNode.children, level + 1)}
            </ul>
          ) : null}
          {showProperties && propertyCount > 0 ? (
            <ul
              role="group"
              className="dts-topology-navigator__group configuration-workbench__structure-property-group"
            >
              {treeNode.node.properties.map((property) => {
                const propertySelected = selectedPropertyName === property.name;
                const identity = propertyIdentity(treeNode.id, property.name);
                const draftKey = sessionDraftKey({
                  fileId,
                  nodePath: treeNode.id,
                  propertyName: property.name
                });
                const hasSessionChange = Boolean(sessionDrafts[draftKey]);
                return (
                  <li key={`${treeNode.id}/${property.name}`} role="none" className="dts-topology-navigator__branch">
                    <div
                      role="treeitem"
                      aria-level={level + 1}
                      aria-selected={propertySelected}
                      aria-label={`属性 ${treeNode.id}/${property.name}`}
                      tabIndex={-1}
                      data-property-identity={identity}
                      data-session-change={hasSessionChange ? "true" : undefined}
                      className={`dts-topology-navigator__item configuration-workbench__structure-property${propertySelected ? " is-selected" : ""}${hasSessionChange ? " has-session-change" : ""}`}
                      onClick={() => onSelectProperty(treeNode.id, property.name)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectProperty(treeNode.id, property.name);
                        }
                      }}
                    >
                      <span className="dts-topology-navigator__disclosure" aria-hidden="true" />
                      <code className="dts-topology-navigator__label">{property.name}</code>
                      <span className="dts-topology-navigator__meta">
                        <span className="dts-topology-navigator__count">
                          {dtsValueTypeLabel(property.valueType)}
                        </span>
                      </span>
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
      <div role="status" aria-label={ariaLabel} className="dts-topology-navigator__empty">
        没有可展示的结构节点。
      </div>
    );
  }

  return (
    <ul role="tree" aria-label={ariaLabel} className="dts-topology-navigator configuration-workbench__structure-navigator">
      {renderBranch(roots, 1)}
    </ul>
  );
}
