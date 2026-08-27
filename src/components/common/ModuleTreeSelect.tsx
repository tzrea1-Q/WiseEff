import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import { TreeFilterOptions } from "./TreeFilterOptions";

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
  /** Render the menu at document level so ancestor overflow cannot clip it. */
  portalMenu?: boolean;
  /** When set, only these node ids can be chosen (ancestors remain visible for tree context). */
  selectableIds?: ReadonlySet<string>;
  /** Enable path-aware search for multi-select module filters. */
  searchable?: boolean;
  /** Hide a sole structural root while preserving subtree selection semantics. */
  hideSingleRoot?: boolean;
  /** Number of visible tree levels expanded when the menu first opens. */
  initialExpandedDepth?: number;
  /** Add an explicit root-level target for single-select ownership changes. */
  includeRootOption?: boolean;
  /** Accessible and visible label for the explicit root-level target. */
  rootOptionLabel?: string;
};

type MenuPosition = {
  top: number;
  left: number;
};

export function ModuleTreeSelect({
  mode,
  label,
  labelledBy,
  nodes,
  value,
  onChange,
  placeholder,
  disabled = false,
  portalMenu = false,
  selectableIds,
  searchable = mode === "multi-filter",
  hideSingleRoot = mode === "multi-filter",
  initialExpandedDepth = 1,
  includeRootOption = false,
  rootOptionLabel = placeholder ?? "根级（无父模块）"
}: ModuleTreeSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const treeNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        label: node.name,
        parentId: node.parentId,
        path: modulePathSegments(node, nodes),
        sortOrder: node.sortOrder
      })),
    [nodes]
  );
  const selectedIds = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);
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

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    const menuWidth = Math.min(400, Math.max(260, window.innerWidth - gutter * 2));
    const menuHeight = 288;
    const left = Math.min(
      Math.max(gutter, rect.left),
      Math.max(gutter, window.innerWidth - menuWidth - gutter)
    );
    const top =
      rect.bottom + 4 + menuHeight <= window.innerHeight - gutter
        ? rect.bottom + 4
        : Math.max(gutter, rect.top - menuHeight - 4);
    setMenuPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!open || !portalMenu) {
      return;
    }
    updateMenuPosition();
  }, [open, portalMenu]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleReposition = () => updateMenuPosition();
    const handleScroll = () => {
      if (portalMenu) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);
    if (portalMenu) {
      window.addEventListener("resize", handleReposition);
      window.addEventListener("scroll", handleScroll, true);
    }
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
      if (portalMenu) {
        window.removeEventListener("resize", handleReposition);
        window.removeEventListener("scroll", handleScroll, true);
      }
    };
  }, [open, portalMenu]);

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

  const handleSelect = (id: string) => {
    if (mode === "single") {
      onChange(id);
      setOpen(false);
    }
  };

  const handleToggleOpen = () => {
    setOpen((current) => !current);
  };

  const menuContent = open ? (
    <div
      ref={menuRef}
      className={`dropdown-menu module-tree-menu${portalMenu ? " module-tree-menu--portal" : ""}`}
      role="tree"
      tabIndex={-1}
      aria-label={`${label}树形选项`}
      style={portalMenu && menuPosition ? { top: menuPosition.top, left: menuPosition.left } : undefined}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {mode === "single" && includeRootOption ? (
        <div
          aria-level={1}
          aria-selected={!selectedId}
          className={`module-tree-root-option-row${!selectedId ? " is-selected" : ""}`}
          role="treeitem"
        >
          <button className="module-tree-root-option" type="button" onClick={() => handleSelect("")}>
            <span className="module-tree-root-option-label">{rootOptionLabel}</span>
          </button>
        </div>
      ) : null}
      <TreeFilterOptions
        ariaLabel={`${label}树形选项`}
        classNamePrefix="module-tree"
        emptyMessage={placeholder ?? "暂无模块"}
        mode={mode === "multi-filter" ? "multi" : "single"}
        nodes={treeNodes}
        selectableIds={selectableIds}
        selectedIds={selectedIds}
        showPaths={mode === "single"}
        searchable={searchable}
        hideSingleRoot={hideSingleRoot}
        initialExpandedDepth={initialExpandedDepth}
        treeRole={false}
        focusOnOpen="tree"
        onChange={(next: string | string[]) => {
          if (mode === "single" && typeof next === "string") {
            handleSelect(next);
          } else if (mode === "multi-filter" && Array.isArray(next)) {
            onChange(next);
          }
        }}
      />
    </div>
  ) : null;

  return (
    <div className="dropdown-root module-tree-select" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="tree"
        aria-labelledby={labelledBy}
        className="dropdown-trigger module-tree-trigger"
        disabled={disabled}
        title={disabled ? "暂无可用模块。" : undefined}
        type="button"
        onClick={handleToggleOpen}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="module-tree-trigger-content">
          <span className="module-tree-trigger-label">{triggerLabel}</span>
        </span>
        <span aria-hidden="true" className="module-tree-trigger-caret">
          ▾
        </span>
      </button>
      {portalMenu && menuPosition ? createPortal(menuContent, document.body) : menuContent}
    </div>
  );
}
