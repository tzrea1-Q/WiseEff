import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildTreeFilterTree,
  canonicalizeTreeFilterSelection,
  collectTreeFilterAncestors,
  collectTreeFilterExpandedIds,
  collectTreeFilterExpandedIdsForSearch,
  flattenTreeFilterTree,
  filterTreeFilterTree,
  getTreeFilterSelectionState,
  toggleTreeFilterSelection,
  treeFilterNodePath,
  type TreeFilterNode,
  type TreeFilterSelectionState,
  type TreeFilterTreeNode
} from "@/domain/tree-filter/treeFilter";

type SharedTreeFilterOptionsProps = {
  nodes: readonly TreeFilterNode[];
  selectedIds: readonly string[];
  selectableIds?: ReadonlySet<string>;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  classNamePrefix?: string;
  ariaLabel?: string;
  showPaths?: boolean;
  /** When false, the caller supplies the surrounding role=tree container. */
  treeRole?: boolean;
  /** Focus the search field or the first visible tree item when the menu opens. */
  focusOnOpen?: "tree" | "search";
};

export type TreeFilterOptionsProps =
  | (SharedTreeFilterOptionsProps & {
      mode: "multi";
      onChange: (next: string[]) => void;
    })
  | (SharedTreeFilterOptionsProps & {
      mode: "single";
      onChange: (next: string) => void;
    });

function stateClass(state: TreeFilterSelectionState): string {
  return state === "checked" ? "is-selected" : state === "mixed" ? "is-mixed" : "";
}

function ariaChecked(state: TreeFilterSelectionState): boolean | "mixed" {
  return state === "mixed" ? "mixed" : state === "checked";
}

function accessibleTreeFilterLabel(
  node: TreeFilterNode,
  allNodes: readonly TreeFilterNode[],
  showPaths: boolean
): string {
  const hasDuplicateLabel = allNodes.some((candidate) => candidate.id !== node.id && candidate.label === node.label);
  const path = treeFilterNodePath(node);
  return showPaths && hasDuplicateLabel && path !== node.label
    ? `${node.label}，路径：${path}`
    : node.label;
}

function flattenVisibleTree(
  tree: readonly TreeFilterTreeNode[],
  expandedIds: ReadonlySet<string>
): TreeFilterTreeNode[] {
  const result: TreeFilterTreeNode[] = [];
  const visit = (items: readonly TreeFilterTreeNode[]) => {
    for (const item of items) {
      result.push(item);
      if (item.children.length > 0 && expandedIds.has(item.id)) {
        visit(item.children);
      }
    }
  };
  visit(tree);
  return result;
}

function TreeFilterOption({
  node,
  depth,
  mode,
  allNodes,
  expandedIds,
  selectedIds,
  selectableIds,
  classNamePrefix,
  showPaths,
  onToggleExpand,
  onChange,
  activeId,
  visibleIds,
  parentById,
  focusNode,
  onFocusNode,
  rowRef
}: {
  node: TreeFilterTreeNode;
  depth: number;
  mode: "multi" | "single";
  allNodes: readonly TreeFilterNode[];
  expandedIds: ReadonlySet<string>;
  selectedIds: readonly string[];
  selectableIds?: ReadonlySet<string>;
  classNamePrefix: string;
  showPaths: boolean;
  onToggleExpand: (id: string) => void;
  onChange: (id: string) => void;
  activeId: string | null;
  visibleIds: readonly string[];
  parentById: ReadonlyMap<string, string | null>;
  focusNode: (id: string) => void;
  onFocusNode: (id: string) => void;
  rowRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelectable = !node.disabled && (selectableIds == null || selectableIds.has(node.id));
  const selection =
    mode === "multi"
      ? getTreeFilterSelectionState(allNodes, node, selectedIds, selectableIds)
      : selectedIds.includes(node.id)
        ? "checked"
        : "unchecked";
  const path = treeFilterNodePath(node);
  const accessibleLabel = accessibleTreeFilterLabel(node, allNodes, showPaths);
  const rowClassName = [
    `${classNamePrefix}-option-row`,
    "tree-filter-option-row",
    depth > 0 ? "is-child" : "",
    stateClass(selection),
    !isSelectable ? "is-structural" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`${classNamePrefix}-option tree-filter-option`} role="none">
      <div
        ref={(element) => rowRef(node.id, element)}
        className={rowClassName}
        role="treeitem"
        aria-label={accessibleLabel !== node.label ? accessibleLabel : undefined}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={mode === "single" ? selection === "checked" : undefined}
        aria-checked={mode === "multi" ? ariaChecked(selection) : undefined}
        tabIndex={activeId === node.id ? 0 : -1}
        style={{ paddingLeft: depth > 0 ? `${8 + depth * 20}px` : undefined }}
        onFocus={() => onFocusNode(node.id)}
        onKeyDown={(event) => {
          const currentIndex = visibleIds.indexOf(node.id);
          const focusSibling = (index: number) => {
            const target = visibleIds[index];
            if (target) {
              event.preventDefault();
              focusNode(target);
            }
          };

          if (event.key === "ArrowDown") {
            focusSibling(Math.min(visibleIds.length - 1, currentIndex + 1));
          } else if (event.key === "ArrowUp") {
            focusSibling(Math.max(0, currentIndex - 1));
          } else if (event.key === "Home") {
            focusSibling(0);
          } else if (event.key === "End") {
            focusSibling(visibleIds.length - 1);
          } else if (event.key === "ArrowRight" && hasChildren && !isExpanded) {
            event.preventDefault();
            onToggleExpand(node.id);
          } else if (event.key === "ArrowRight" && hasChildren && isExpanded) {
            const firstChild = visibleIds.find((id) => parentById.get(id) === node.id);
            if (firstChild) {
              event.preventDefault();
              focusNode(firstChild);
            }
          } else if (event.key === "ArrowLeft" && hasChildren && isExpanded) {
            event.preventDefault();
            onToggleExpand(node.id);
          } else if (event.key === "ArrowLeft") {
            const parentId = parentById.get(node.id);
            if (parentId) {
              event.preventDefault();
              focusNode(parentId);
            }
          } else if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (!node.disabled && (selectableIds == null || selectableIds.has(node.id))) {
              onChange(node.id);
            }
          }
        }}
      >
        {hasChildren ? (
          <button
            aria-label={isExpanded ? "折叠" : "展开"}
            className={`${classNamePrefix}-expand tree-filter-option-expand`}
            tabIndex={-1}
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        ) : (
          <span className={`${classNamePrefix}-expand ${classNamePrefix}-expand--spacer tree-filter-option-expand`} aria-hidden="true" />
        )}
        {mode === "multi" ? (
          <label className={`${classNamePrefix}-label tree-filter-option-label${!isSelectable ? " is-disabled" : ""}`}>
            <input
              aria-label={accessibleLabel}
              aria-checked={ariaChecked(selection)}
              checked={selection === "checked"}
              disabled={!isSelectable}
              tabIndex={-1}
              type="checkbox"
              ref={(input) => {
                if (input) input.indeterminate = selection === "mixed";
              }}
              onChange={() => {
                if (isSelectable) onChange(node.id);
              }}
            />
            <span aria-hidden="true" className={`${classNamePrefix}-label-stack tree-filter-option-label-stack`}>
              <span className={`${classNamePrefix}-label-text tree-filter-option-label-text`} title={node.label}>
                {node.label}
              </span>
              {showPaths && path !== node.label ? (
                <small className={`${classNamePrefix}-path tree-filter-option-path`} title={path}>
                  {path}
                </small>
              ) : null}
            </span>
            {node.count !== undefined ? (
              <small aria-hidden="true" className={`${classNamePrefix}-count tree-filter-option-count`}>{node.count}</small>
            ) : null}
          </label>
        ) : isSelectable ? (
          <button
            aria-current={selection === "checked" ? "true" : undefined}
            aria-label={accessibleLabel}
            aria-pressed={selection === "checked"}
            className={`${classNamePrefix}-label ${classNamePrefix}-label--single tree-filter-option-label--single${selection === "checked" ? " is-selected" : ""}`}
            tabIndex={-1}
            title={node.label}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(node.id);
            }}
          >
            <span aria-hidden="true" className={`${classNamePrefix}-label-text tree-filter-option-label-text`}>
              {node.label}
            </span>
            {node.count !== undefined ? (
              <small aria-hidden="true" className={`${classNamePrefix}-count tree-filter-option-count`}>
                {node.count}
              </small>
            ) : null}
          </button>
        ) : (
          <span className={`${classNamePrefix}-label ${classNamePrefix}-label--structural tree-filter-option-label--structural`} title={node.label}>
            <span className={`${classNamePrefix}-label-text tree-filter-option-label-text`}>{node.label}</span>
          </span>
        )}
      </div>
      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <TreeFilterOption
              key={child.id}
              allNodes={allNodes}
              classNamePrefix={classNamePrefix}
              depth={depth + 1}
              expandedIds={expandedIds}
              mode={mode}
              node={child}
              selectableIds={selectableIds}
              selectedIds={selectedIds}
              showPaths={showPaths}
              onChange={onChange}
              onToggleExpand={onToggleExpand}
              activeId={activeId}
              visibleIds={visibleIds}
              parentById={parentById}
              focusNode={focusNode}
              onFocusNode={onFocusNode}
              rowRef={rowRef}
            />
          ))
        : null}
    </div>
  );
}

export function TreeFilterOptions({
  nodes,
  selectedIds,
  selectableIds,
  searchable = false,
  searchPlaceholder = "搜索模块",
  emptyMessage = "暂无选项",
  classNamePrefix = "tree-filter",
  ariaLabel = "树形筛选",
  showPaths = false,
  treeRole = true,
  focusOnOpen,
  mode,
  onChange
}: TreeFilterOptionsProps) {
  const tree = useMemo(() => buildTreeFilterTree(nodes), [nodes]);
  const canonicalSelectedIds = useMemo(
    () => canonicalizeTreeFilterSelection(nodes, selectedIds),
    [nodes, selectedIds]
  );
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => collectTreeFilterExpandedIds(tree));
  const filteredTree = useMemo(() => filterTreeFilterTree(tree, query), [query, tree]);
  const effectiveExpandedIds = query.trim()
    ? collectTreeFilterExpandedIdsForSearch(filteredTree)
    : expandedIds;
  const visibleTree = useMemo(
    () => flattenVisibleTree(filteredTree, effectiveExpandedIds),
    [effectiveExpandedIds, filteredTree]
  );
  const visibleIds = useMemo(() => visibleTree.map((node) => node.id), [visibleTree]);
  const parentById = useMemo(
    () => new Map<string, string | null>(flattenTreeFilterTree(tree).map((node) => [node.id, node.parentId])),
    [tree]
  );
  const [activeId, setActiveId] = useState<string | null>(visibleIds[0] ?? null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialVisibleIdRef = useRef<string | null>(visibleIds[0] ?? null);
  const effectiveActiveId = activeId && visibleIds.includes(activeId) ? activeId : visibleIds[0] ?? null;

  useEffect(() => {
    const selectedAncestors = new Set<string>();
    for (const selectedId of canonicalSelectedIds) {
      for (const ancestorId of collectTreeFilterAncestors(nodes, selectedId)) {
        selectedAncestors.add(ancestorId);
      }
    }
    if (selectedAncestors.size === 0) return;
    setExpandedIds((current) => new Set([...current, ...selectedAncestors]));
  }, [canonicalSelectedIds, nodes]);

  const focusNode = useCallback((id: string) => {
    setActiveId(id);
    optionRefs.current.get(id)?.focus();
  }, []);

  useEffect(() => {
    if (!focusOnOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusOnOpen === "search") {
        searchInputRef.current?.focus();
        return;
      }
      const firstId = initialVisibleIdRef.current;
      if (firstId) focusNode(firstId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnOpen, focusNode]);

  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleChange = (id: string) => {
    if (mode === "single") {
      onChange(id);
      return;
    }
    onChange(toggleTreeFilterSelection(nodes, canonicalSelectedIds, id, selectableIds));
  };

  return (
    <div className={`${classNamePrefix}-tree-options tree-filter-options`}>
      {searchable ? (
        <label className={`${classNamePrefix}-tree-search tree-filter-search`}>
          <span className="sr-only">{searchPlaceholder}</span>
          <input
            ref={searchInputRef}
            type="search"
            aria-label={searchPlaceholder}
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const firstId = visibleIds[0];
                if (firstId) focusNode(firstId);
              }
            }}
          />
        </label>
      ) : null}
      <div
        className={`${classNamePrefix}-tree-list tree-filter-list`}
        role={treeRole ? "tree" : undefined}
        aria-label={treeRole ? ariaLabel : undefined}
        aria-multiselectable={treeRole && mode === "multi" ? true : undefined}
      >
        {filteredTree.length > 0 ? (
          filteredTree.map((node) => (
            <TreeFilterOption
              key={node.id}
              allNodes={nodes}
              classNamePrefix={classNamePrefix}
              depth={0}
              expandedIds={effectiveExpandedIds}
              mode={mode}
              node={node}
              selectableIds={selectableIds}
              selectedIds={canonicalSelectedIds}
              showPaths={showPaths}
              onChange={handleChange}
              onToggleExpand={toggleExpand}
              activeId={effectiveActiveId}
              visibleIds={visibleIds}
              parentById={parentById}
              focusNode={focusNode}
              onFocusNode={setActiveId}
              rowRef={(id, element) => {
                if (element) optionRefs.current.set(id, element);
                else optionRefs.current.delete(id);
              }}
            />
          ))
        ) : (
          <div className={`${classNamePrefix}-tree-empty tree-filter-empty`}>{emptyMessage}</div>
        )}
      </div>
    </div>
  );
}
