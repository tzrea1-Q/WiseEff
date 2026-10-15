import { SelectControl } from "@/components/common/SelectControl";

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
    <SelectControl
      ariaLabel={ariaLabel}
      size="filter"
      disabled={disabled}
      value={value}
      onValueChange={onChange}
      options={options}
    />
  );
}
