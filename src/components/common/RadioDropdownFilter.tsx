import { useEffect, useMemo, useRef, useState } from "react";

export type RadioDropdownOption<T extends string = string> = {
  value: T;
  label: string;
};

export type RadioDropdownFilterProps<T extends string = string> = {
  label: string;
  value: T;
  options: readonly RadioDropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  allValue?: T;
};

export function RadioDropdownFilter<T extends string = string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  allValue
}: RadioDropdownFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const resolvedAllValue = allValue ?? (options[0]?.value as T | undefined);
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label,
    [options, value]
  );

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

  const triggerLabel =
    resolvedAllValue !== undefined && value === resolvedAllValue
      ? `${label} ▾`
      : `${label} · ${selectedLabel ?? value} ▾`;

  return (
    <div className="dropdown-root" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="dropdown-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div className="dropdown-menu" role="listbox">
          {options.map((option) => (
            <label className="dropdown-item" key={option.value}>
              <input
                aria-label={option.label}
                checked={value === option.value}
                name={`${label}-filter`}
                type="radio"
                onChange={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
