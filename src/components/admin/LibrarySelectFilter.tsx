export type LibrarySelectOption<T extends string = string> = {
  value: T;
  label: string;
};

export type LibrarySelectFilterProps<T extends string = string> = {
  ariaLabel: string;
  value: T;
  options: readonly LibrarySelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function LibrarySelectFilter<T extends string = string>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false
}: LibrarySelectFilterProps<T>) {
  return (
    <select
      aria-label={ariaLabel}
      className="library-sort"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
