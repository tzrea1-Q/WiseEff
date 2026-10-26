import { useState } from "react";
import { SearchField } from "./SearchField";
import { SelectControl } from "./SelectControl";

/** Search keeps the current selection even when its label is filtered out. */
export function SearchableSelectControl({ id, ariaLabel, value, options, disabled, onValueChange }: {
  id: string; ariaLabel: string; value: string; options: Array<{ value: string; label: string }>;
  disabled?: boolean; onValueChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filtered = options.filter((option) => !option.value || option.label.toLocaleLowerCase().includes(query));
  const selected = options.find((option) => option.value === value);
  return <div className="space-y-2">
    <SearchField ariaLabel={`搜索${ariaLabel}`} placeholder={`搜索${ariaLabel}`} value={search} onValueChange={setSearch} disabled={disabled} />
    <SelectControl id={id} ariaLabel={ariaLabel} value={value} disabled={disabled} onValueChange={onValueChange}
      options={[...(selected && !filtered.includes(selected) ? [{ ...selected, hidden: true }] : []), ...filtered]} />
    {query && !filtered.some((option) => option.value) ? <p role="status">没有匹配项。</p> : null}
  </div>;
}
