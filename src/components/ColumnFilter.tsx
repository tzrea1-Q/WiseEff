import { Funnel } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { TreeFilterOptions } from "@/components/common/TreeFilterOptions";
import { canonicalizeTreeFilterSelection, type TreeFilterNode } from "@/domain/tree-filter/treeFilter";

/**
 * Standard table-header multi-select filter (quiet funnel + checkbox menu).
 * UX contract: `docs/design-docs/ux-table-column-filter.md`
 * (zh: `docs/zh-CN/design-docs/ux-table-column-filter.md`).
 */
type ColumnFilterCommonProps = {
  label: string;
  groupLabel: string;
  onClear: () => void;
  align?: "left" | "right";
};

export type ColumnFilterFlatProps = ColumnFilterCommonProps & {
  mode?: "flat";
  values: string[];
  selectedValues: string[];
  renderLabel?: (value: string) => string;
  onToggle: (value: string) => void;
};

export type ColumnFilterTreeProps = ColumnFilterCommonProps & {
  mode: "tree";
  treeNodes: readonly TreeFilterNode[];
  selectedTreeIds: readonly string[];
  onTreeChange: (next: string[]) => void;
  treeSearchable?: boolean;
  treeShowPaths?: boolean;
  /** Hide a structural root when the current option tree has exactly one root. */
  treeHideSingleRoot?: boolean;
  /** Initial visible expansion depth; -1 keeps every branch collapsed. */
  treeInitialExpandedDepth?: number;
};

export type ColumnFilterProps = ColumnFilterFlatProps | ColumnFilterTreeProps;

const MENU_WIDTH = 240;
const MENU_GAP = 7;
const VIEWPORT_MARGIN = 16;
const MENU_HEIGHT_ESTIMATE = 320;

function getMenuPosition(trigger: HTMLButtonElement, align: "left" | "right"): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const below = rect.bottom + MENU_GAP;
  const top =
    below + MENU_HEIGHT_ESTIMATE <= window.innerHeight - VIEWPORT_MARGIN
      ? below
      : Math.max(VIEWPORT_MARGIN, rect.top - MENU_GAP - MENU_HEIGHT_ESTIMATE);

  if (align === "right") {
    return {
      position: "fixed",
      top,
      right: Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right),
      left: "auto",
      zIndex: "var(--z-dropdown)"
    };
  }

  const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN;
  return {
    position: "fixed",
    top,
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    right: "auto",
    zIndex: "var(--z-dropdown)"
  };
}

export function ColumnFilter(props: ColumnFilterProps) {
  const { label, groupLabel, onClear, align = "left" } = props;
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isTreeMode = props.mode === "tree";
  const selectedCount = isTreeMode
    ? canonicalizeTreeFilterSelection(props.treeNodes, props.selectedTreeIds).length
    : props.selectedValues.length;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuStyle(null);
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current) {
        return;
      }
      setMenuStyle(getMenuPosition(triggerRef.current, align));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", closeOnOutsideClick);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`parameters-column-filter parameters-column-filter--${align}`} ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-label={`筛选${label}`}
        className={`parameters-column-filter__trigger${selectedCount > 0 ? " active" : ""}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Funnel size={13} aria-hidden="true" />
        {selectedCount > 0 ? <span>{selectedCount}</span> : null}
      </button>
      {open ? (
        <div
          className="parameters-column-filter__menu parameters-column-filter__menu--fixed"
          role="group"
          aria-label={groupLabel}
          style={menuStyle ?? undefined}
        >
          <div className="parameters-column-filter__menu-head">
            <strong>{label}</strong>
            <button type="button" onClick={onClear} disabled={selectedCount === 0}>
              清除
            </button>
          </div>
          <div className={`parameters-column-filter__options${isTreeMode ? " parameters-column-filter__options--tree" : ""}`}>
            {isTreeMode ? (
              <TreeFilterOptions
                ariaLabel={groupLabel}
                classNamePrefix="parameters-column-filter"
                mode="multi"
                nodes={props.treeNodes}
                searchable={props.treeSearchable}
                selectedIds={props.selectedTreeIds}
                showPaths={props.treeShowPaths ?? false}
                hideSingleRoot={props.treeHideSingleRoot ?? true}
                initialExpandedDepth={props.treeInitialExpandedDepth ?? -1}
                onChange={props.onTreeChange}
                focusOnOpen={props.treeSearchable ? "search" : "tree"}
              />
            ) : props.values.length > 0 ? (
              props.values.map((value) => {
                const optionLabel = props.renderLabel?.(value) ?? value;
                return (
                  <label key={value}>
                    <input
                      type="checkbox"
                      aria-label={optionLabel}
                      checked={props.selectedValues.includes(value)}
                      onChange={() => props.onToggle(value)}
                    />
                    <span>{optionLabel}</span>
                  </label>
                );
              })
            ) : (
              <span className="parameters-column-filter__empty">暂无选项</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
