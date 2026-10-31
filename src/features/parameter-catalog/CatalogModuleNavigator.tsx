import { useMemo, useState } from "react";
import { Box, ChevronDown, ChevronRight, Cpu, Folder, FolderOpen, Layers } from "lucide-react";
import { SearchField } from "@/components/common/SearchField";

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
  defaultExpandDepth,
  visibleIds,
  query
}: {
  node: CatalogNavigatorNode;
  selectedId: string | null;
  onSelectNode: (node: CatalogNavigatorNode) => void;
  depth: number;
  defaultExpandDepth: number;
  visibleIds: ReadonlySet<string> | null;
  query: string;
}) {
  const selectedDescendant = node.children.some((child) => containsSelection(child, selectedId));
  const selected = node.id === selectedId;
  const [disclosure, setDisclosure] = useState({ selection: selectedId, expanded: depth < defaultExpandDepth || selected || selectedDescendant });
  const [searchDisclosure, setSearchDisclosure] = useState({ matches: visibleIds, expanded: true });
  const expanded = query ? searchDisclosure.matches !== visibleIds || searchDisclosure.expanded
    : disclosure.expanded || (disclosure.selection !== selectedId && (selected || selectedDescendant));
  const hasChildren = node.children.length > 0;
  const selectable = node.kind !== "unregistered-group";
  const Icon = node.kind === "module" ? (expanded ? FolderOpen : Folder)
    : node.kind === "unregistered-group" ? Layers : node.subjectType === "node-type" ? Box : Cpu;

  return (
    <li className="parameter-catalog__tree-node" hidden={visibleIds !== null && !visibleIds.has(node.id)}>
      <div className={`parameter-catalog__tree-row dts-topology-navigator__item${selected ? " is-selected" : ""}`} data-retired={node.retired || undefined}>
        {hasChildren ? (
          <button
            type="button"
            className="parameter-catalog__tree-toggle dts-topology-navigator__disclosure"
            aria-label={`${expanded ? "收起" : "展开"} ${node.displayName}`}
            aria-expanded={expanded}
            onClick={() => query ? setSearchDisclosure({ matches: visibleIds, expanded: !expanded })
              : setDisclosure({ selection: selectedId, expanded: !expanded })}
          >
            {expanded
              ? <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
              : <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
          </button>
        ) : (
          <span className="parameter-catalog__tree-toggle dts-topology-navigator__disclosure" aria-hidden="true" />
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
            title={[node.displayName, node.meta].filter(Boolean).join(" · ")}
            {...(node.kind === "subject"
              ? { "data-catalog-subject-node": "true", "data-catalog-subject-id": node.subjectId }
              : {})}
            onClick={() => onSelectNode(node)}
          >
            <Icon size={15} className="parameter-catalog__tree-icon" aria-hidden="true" />
            <span className="parameter-catalog__tree-content">
              <span className="parameter-catalog__tree-label" title={node.displayName}>{node.displayName}</span>
              {node.kind === "subject" && node.meta ? <span className="parameter-catalog__subject-meta">{node.meta}</span> : null}
            </span>
            {node.kind !== "subject" ? <span className="parameter-catalog__module-count" title={`包含 ${node.subjectCount} 个主体`}>{node.subjectCount}</span> : null}
          </button>
        ) : (
          <span
            className="parameter-catalog__tree-select parameter-catalog__tree-select--group"
            data-catalog-node-kind={node.kind}
          >
            <Icon size={15} className="parameter-catalog__tree-icon" aria-hidden="true" />
            <span className="parameter-catalog__tree-content"><span className="parameter-catalog__tree-label">{node.displayName}</span></span>
            <span className="parameter-catalog__module-count">{node.subjectCount}</span>
          </span>
        )}
      </div>
      {hasChildren && expanded ? (
        <ul className="parameter-catalog__tree dts-topology-navigator__group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelectNode={onSelectNode}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              visibleIds={visibleIds}
              query={query}
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
 * One tree carries the whole navigation: maintained modules are the branches and
 * every subject is a leaf (registered subjects under their module, subjects with
 * no placement yet under one `待登记主体` branch). Selecting a module scopes the
 * collection to the node and its whole subtree, selecting a subject scopes it to
 * that subject, and clearing the selection returns to the complete organization
 * collection.
 */
export function CatalogModuleNavigator({
  nodes,
  selectedId,
  onSelectNode,
  defaultExpandDepth = 0,
  ariaLabel = "参数定义模块树",
  emptyMessage = "当前组织还没有模块放置。"
}: CatalogModuleNavigatorProps) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const visibleIds = useMemo(() => {
    if (!query) return null;
    const matches = new Set<string>();
    const visit = (node: CatalogNavigatorNode, parentMatches = false): boolean => {
      const ownMatch = parentMatches || node.displayName.toLocaleLowerCase().includes(query);
      let childMatch = false;
      for (const child of node.children) childMatch = visit(child, ownMatch) || childMatch;
      if (ownMatch || childMatch) matches.add(node.id);
      return ownMatch || childMatch;
    };
    nodes.forEach((node) => visit(node));
    return matches;
  }, [nodes, query]);
  return (
    <nav aria-label={ariaLabel}>
      <div className="parameter-catalog__navigator-search">
        <SearchField value={search} onValueChange={setSearch} ariaLabel="搜索模块" placeholder="搜索模块或主体" />
      </div>
      {nodes.length === 0 ? (
        <p className="parameter-catalog__muted">{emptyMessage}</p>
      ) : null}
      {nodes.length > 0 && visibleIds?.size === 0 ? <p className="parameter-catalog__muted" role="status">没有匹配的模块或主体。</p> : null}
      <ul className="parameter-catalog__tree">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelectNode={onSelectNode}
            depth={0}
            defaultExpandDepth={defaultExpandDepth}
            visibleIds={visibleIds}
            query={query}
          />
        ))}
      </ul>
    </nav>
  );
}

function containsSelection(node: CatalogNavigatorNode, selectedId: string | null): boolean {
  return node.id === selectedId || node.children.some((child) => containsSelection(child, selectedId));
}
