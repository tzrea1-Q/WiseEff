import type { ReactNode } from "react";

export type HeaderFilterConfig<TData> = {
  label: string;
  groupLabel?: string;
  values?: string[];
  selectedValues?: string[];
  getValue: (row: TData) => string;
  renderLabel?: (value: string) => string;
  onToggle?: (value: string) => void;
  onClear?: () => void;
  align?: "left" | "right";
};

export type HeaderFilterState = Record<string, string[]>;

export function isHeaderFilterConfig<TData>(value: ReactNode | HeaderFilterConfig<TData> | undefined): value is HeaderFilterConfig<TData> {
  return Boolean(value && typeof value === "object" && "getValue" in value);
}

export function toggleFilterValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function uniqueFilterValues<TData>(rows: readonly TData[], getValue: (row: TData) => string) {
  return Array.from(
    new Set(
      rows
        .map((row) => getValue(row).trim())
        .filter(Boolean)
    )
  );
}

export function rowMatchesHeaderFilters<TData>(
  row: TData,
  filters: HeaderFilterState,
  configs: Array<{ key: string; selectedValues?: string[]; getValue: (row: TData) => string }>
) {
  return configs.every((config) => {
    const selectedValues = filters[config.key] ?? config.selectedValues ?? [];
    return selectedValues.length === 0 || selectedValues.includes(config.getValue(row));
  });
}
