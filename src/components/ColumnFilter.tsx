import { Funnel } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedCount = selectedValues.length;

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
        <div className="parameters-column-filter__menu" role="group" aria-label={groupLabel}>
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
