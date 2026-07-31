import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildExpandedTreeIdsForDropdown,
  modulePathSegments
} from "@/components/admin/moduleManagementTreeUtils";
import {
  buildModuleTree,
  collectSubtreeModuleIds,
  type FlatModuleNode,
  type ModuleTreeNode
} from "@/domain/modules/moduleTree";

export type ModuleTreeSelectMode = "single" | "multi-filter";

type ModuleTreeSelectProps = {
  mode: ModuleTreeSelectMode;
  label: string;
  labelledBy?: string;
  nodes: readonly FlatModuleNode[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When set, only these node ids can be chosen (ancestors remain visible for tree context). */
  selectableIds?: ReadonlySet<string>;
};

function treeHasBranches(nodes: readonly ModuleTreeNode[]): boolean {
  return nodes.some((node) => node.children.length > 0 || treeHasBranches(node.children));
}

function TreeOption({
  node,
  depth,
  mode,
  expanded,
  selectedIds,
  selectableIds,
  showExpandColumn,
  onToggleExpand,
  onSelect
}: {
  node: ModuleTreeNode;
  depth: number;
  mode: ModuleTreeSelectMode;
  expanded: Set<string>;
  selectedIds: Set<string>;
  selectableIds?: ReadonlySet<string>;
  showExpandColumn: boolean;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const isSelectable = selectableIds == null || selectableIds.has(node.id);

  return (
    <div className="module-tree-option" data-depth={depth}>
      <div
        className={[
          "module-tree-option-row",
          depth > 0 ? "is-child" : "",
          isSelected ? "is-selected" : "",
          !isSelectable ? "is-structural" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: depth > 0 ? `${8 + depth * 20}px` : undefined }}
      >
        {showExpandColumn ? (
          hasChildren ? (
            <button
              aria-label={isExpanded ? "折叠" : "展开"}
              className="module-tree-expand"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand(node.id);
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="module-tree-expand module-tree-expand--spacer" aria-hidden="true" />
          )
        ) : null}
        {mode === "multi-filter" ? (
          <label className={`module-tree-label${!isSelectable ? " is-disabled" : ""}`}>
            <input
              aria-label={node.name}
              checked={isSelected}
              disabled={!isSelectable}
              type="checkbox"
              onChange={() => {
                if (!isSelectable) return;
                onSelect(node.id);
              }}
            />
            <span className="module-tree-label-stack">
              <span className="module-tree-label-text" title={node.name}>
                {node.name}
              </span>
            </span>
          </label>
        ) : isSelectable ? (
          <button
            aria-current={isSelected ? "true" : undefined}
            aria-pressed={isSelected}
            className={`module-tree-label module-tree-label--single${isSelected ? " is-selected" : ""}`}
            title={node.name}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(node.id);
            }}
          >
            <span className={depth > 0 ? "module-tree-label-text is-child-name" : "module-tree-label-text"}>{node.name}</span>
          </button>
        ) : (
          <span className="module-tree-label module-tree-label--structural" title={node.name}>
            <span className={depth > 0 ? "module-tree-label-text is-child-name" : "module-tree-label-text"}>{node.name}</span>
          </span>
        )}
      </div>
      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <TreeOption
              key={child.id}
              depth={depth + 1}
              expanded={expanded}
              mode={mode}
              node={child}
              selectedIds={selectedIds}
              selectableIds={selectableIds}
              showExpandColumn={showExpandColumn}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

export function ModuleTreeSelect({
  mode,
  label,
  labelledBy,
  nodes,
  value,
  onChange,
  placeholder,
  disabled = false,
  selectableIds
}: ModuleTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildModuleTree(nodes), [nodes]);
  const showExpandColumn = useMemo(() => treeHasBranches(tree), [tree]);
  const selectedIds = useMemo(() => new Set(Array.isArray(value) ? value : value ? [value] : []), [value]);
  const selectedId = typeof value === "string" ? value : undefined;

  const selectedNode = useMemo(
    () => (selectedId ? nodes.find((node) => node.id === selectedId) : undefined),
    [nodes, selectedId]
  );
  const selectedPath = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    const segments = modulePathSegments(selectedNode, nodes);
    return segments.join(" / ");
  }, [nodes, selectedNode]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const triggerLabel = useMemo(() => {
    if (mode === "single") {
      if (selectedNode) {
        return selectedPath ?? selectedNode.name;
      }
      return placeholder ?? label;
    }
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0 ? `${label} (${count})` : label;
  }, [label, mode, placeholder, selectedNode, selectedPath, value]);

  const toggleExpand = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = (id: string) => {
    if (selectableIds && !selectableIds.has(id)) {
      return;
    }
    if (mode === "single") {
      onChange(id);
      setOpen(false);
      return;
    }

    const current = Array.isArray(value) ? value : [];
    const subtreeIds = collectSubtreeModuleIds(nodes, [id]);
    const selecting = !current.includes(id);
    if (selecting) {
      const nextIds =
        selectableIds == null
          ? Array.from(subtreeIds)
          : Array.from(subtreeIds).filter((item) => selectableIds.has(item));
      onChange(Array.from(new Set([...current, ...nextIds])));
      return;
    }
    onChange(current.filter((item) => !subtreeIds.has(item)));
  };

  const handleToggleOpen = () => {
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setExpanded(buildExpandedTreeIdsForDropdown(tree, nodes, selectedId));
      }
      return nextOpen;
    });
  };

  return (
    <div className="dropdown-root module-tree-select" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="tree"
        aria-labelledby={labelledBy}
        className="dropdown-trigger module-tree-trigger"
        disabled={disabled}
        type="button"
        onClick={handleToggleOpen}
      >
        <span className="module-tree-trigger-content">
          <span className="module-tree-trigger-label">{triggerLabel}</span>
        </span>
        <span aria-hidden="true" className="module-tree-trigger-caret">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="dropdown-menu module-tree-menu"
          role="tree"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {tree.length === 0 ? <div className="module-tree-empty">{placeholder ?? "暂无模块"}</div> : null}
          {tree.map((node) => (
            <TreeOption
              key={node.id}
              depth={0}
              expanded={expanded}
              mode={mode}
              node={node}
              selectedIds={selectedIds}
              selectableIds={selectableIds}
              showExpandColumn={showExpandColumn}
              onToggleExpand={toggleExpand}
              onSelect={handleSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
