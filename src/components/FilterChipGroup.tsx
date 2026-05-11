export type ChipOption = {
  value: string;
  label: string;
};

export function FilterChipGroup({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: string;
  options: ChipOption[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="filter-chips" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            aria-pressed={active}
            className={active ? "chip chip-active" : "chip"}
            key={option.value}
            type="button"
            onClick={() => onChange(active && option.value !== "all" ? "all" : option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
