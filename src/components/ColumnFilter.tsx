import { Funnel } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type ColumnFilterProps = {
  label: string;
  groupLabel: string;
  values: string[];
  selectedValues: string[];
  renderLabel?: (value: string) => string;
  onToggle: (value: string) => void;
  onClear: () => void;
  align?: "left" | "right";
};

const MENU_WIDTH = 240;
const MENU_GAP = 7;
const VIEWPORT_MARGIN = 16;

function getMenuPosition(trigger: HTMLButtonElement, align: "left" | "right"): CSSProperties {
  const rect = trigger.getBoundingClientRect();

  if (align === "right") {
    return {
      position: "fixed",
      top: rect.bottom + MENU_GAP,
      right: Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right),
      left: "auto",
      zIndex: 60
    };
  }

  const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN;
  return {
    position: "fixed",
    top: rect.bottom + MENU_GAP,
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    right: "auto",
    zIndex: 60
  };
}

export function ColumnFilter({
  label,
  groupLabel,
  values,
  selectedValues,
  renderLabel,
  onToggle,
  onClear,
  align = "left"
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedCount = selectedValues.length;

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
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
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
          <div className="parameters-column-filter__options">
            {values.length > 0 ? (
              values.map((value) => {
                const optionLabel = renderLabel?.(value) ?? value;
                return (
                  <label key={value}>
                    <input
                      type="checkbox"
                      aria-label={optionLabel}
                      checked={selectedValues.includes(value)}
                      onChange={() => onToggle(value)}
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
