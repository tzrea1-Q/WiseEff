import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import "./common/select-control.css";

export type DropdownOption = {
  value: string;
  label: string;
};

export function MultiSelectDropdown({
  label,
  value,
  options,
  onChange,
  compact = false
}: {
  label: string;
  value: string[];
  options: DropdownOption[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [open]);

  const toggleValue = (nextValue: string) => {
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }
    onChange([...value, nextValue]);
  };

  return (
    <div className="dropdown-root" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`dropdown-trigger select-control${compact ? " compact-filter-control" : ""}`}
        data-compact-control={compact ? "filter" : undefined}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}{value.length > 0 ? ` (${value.length})` : ""}</span>
        <ChevronDown aria-hidden="true" className="select-control__chevron" />
      </button>
      {open ? (
        <div className="dropdown-menu" role="listbox" aria-multiselectable="true">
          {options.map((option) => (
            <label className="dropdown-item" key={option.value}>
              <input
                aria-label={option.label}
                checked={value.includes(option.value)}
                type="checkbox"
                onChange={() => toggleValue(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
