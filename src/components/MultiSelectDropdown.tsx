import { useEffect, useRef, useState } from "react";

export type DropdownOption = {
  value: string;
  label: string;
};

export function MultiSelectDropdown({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string[];
  options: DropdownOption[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
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
        aria-expanded={open}
        aria-haspopup="listbox"
        className="dropdown-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {label}{value.length > 0 ? ` (${value.length})` : ""} ▾
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
