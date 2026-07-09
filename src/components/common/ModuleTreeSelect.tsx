import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  nodes: readonly FlatModuleNode[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

function TreeOption({
  node,
  depth,
  mode,
  expanded,
  selectedIds,
  onToggleExpand,
  onSelect
}: {
  node: ModuleTreeNode;
  depth: number;
  mode: ModuleTreeSelectMode;
  expanded: Set<string>;
  selectedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedIds.has(node.id);

  return (
    <div className="module-tree-option" data-depth={depth}>
      <div className="module-tree-option-row" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        {hasChildren ? (
          <button
            aria-label={isExpanded ? "折叠" : "展开"}
            className="module-tree-expand"
            type="button"
            onClick={() => onToggleExpand(node.id)}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="module-tree-expand module-tree-expand--spacer" aria-hidden="true" />
        )}
        {mode === "multi-filter" ? (
          <label className="module-tree-label">
            <input
              aria-label={node.name}
              checked={isSelected}
              type="checkbox"
              onChange={() => onSelect(node.id)}
            />
            <span>{node.name}</span>
          </label>
        ) : (
          <button
            aria-pressed={isSelected}
            className={`module-tree-label module-tree-label--single${isSelected ? " is-selected" : ""}`}
            type="button"
            onClick={() => onSelect(node.id)}
          >
            {node.name}
          </button>
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
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

export function ModuleTreeSelect({ mode, label, nodes, value, onChange, placeholder, disabled = false }: ModuleTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildModuleTree(nodes), [nodes]);
  const flat = nodes;
  const selectedIds = useMemo(() => new Set(Array.isArray(value) ? value : value ? [value] : []), [value]);

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
      const selected = flat.find((node) => node.id === value);
      return selected?.name ?? placeholder ?? label;
    }
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0 ? `${label} (${count})` : label;
  }, [flat, label, mode, placeholder, value]);

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
    if (mode === "single") {
      onChange(id);
      setOpen(false);
      return;
    }

    const current = Array.isArray(value) ? value : [];
    const subtreeIds = collectSubtreeModuleIds(flat, [id]);
    const selecting = !current.includes(id);
    if (selecting) {
      onChange(Array.from(new Set([...current, ...subtreeIds])));
      return;
    }
    onChange(current.filter((item) => !subtreeIds.has(item)));
  };

  return (
    <div className="dropdown-root module-tree-select" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="tree"
        className="dropdown-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {triggerLabel} ▾
      </button>
      {open ? (
        <div className="dropdown-menu module-tree-menu" role="tree">
          {tree.length === 0 ? <div className="module-tree-empty">{placeholder ?? "暂无模块"}</div> : null}
          {tree.map((node) => (
            <TreeOption
              key={node.id}
              depth={0}
              expanded={expanded}
              mode={mode}
              node={node}
              selectedIds={selectedIds}
              onToggleExpand={toggleExpand}
              onSelect={handleSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
