export const LIBRARY_RISK_FILTER_OPTIONS = [
  { value: "all", label: "全部风险" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
] as const;

export type LibraryRiskFilterValue = (typeof LIBRARY_RISK_FILTER_OPTIONS)[number]["value"];

export type LibraryRiskFilterProps = {
  value: LibraryRiskFilterValue;
  onChange: (value: LibraryRiskFilterValue) => void;
  disabled?: boolean;
};

export function LibraryRiskFilter({ value, onChange, disabled = false }: LibraryRiskFilterProps) {
  return (
    <select
      aria-label="风险等级"
      className="library-sort"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as LibraryRiskFilterValue)}
    >
      {LIBRARY_RISK_FILTER_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
