import { useContext, useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { filterItems } from "@/lib/search";
import { SearchField } from "./common/SearchField";
import { ModalPopupContext } from "./common/ModalPopupContext";
import "./common/select-control.css";
import "./multi-select-dropdown.css";

export type DropdownOption = {
  value: string;
  label: string;
};

export function MultiSelectDropdown({
  label,
  value,
  options,
  onChange,
  compact = false,
  disabled = false,
  searchable = false
}: {
  label: string;
  value: string[];
  options: DropdownOption[];
  onChange: (next: string[]) => void;
  compact?: boolean;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const modalPopup = useContext(ModalPopupContext);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const visibleOptions = filterItems(options, search, {
    fields: [{ name: "label", weight: 1, getValues: (option) => [option.label] }]
  });

  const toggleValue = (nextValue: string) => {
    if (disabled) return;
    if (value.includes(nextValue)) {
      onChange(value.filter((item) => item !== nextValue));
      return;
    }
    onChange([...value, nextValue]);
  };

  return (
    <Popover.Root open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (next) setSearch(""); }}>
      <Popover.Trigger asChild><button
        className={`select-control${compact ? " compact-filter-control" : ""}`}
        data-compact-control={compact ? "filter" : undefined}
        type="button"
        disabled={disabled}
      >
        <span>{label}{value.length > 0 ? ` (${value.length})` : ""}</span>
        <ChevronDown aria-hidden="true" className="select-control__chevron" />
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content
        aria-label={`${label}选项`}
        className={`select-menu multi-select-dropdown__content${modalPopup ? " multi-select-dropdown__content--modal" : ""}`}
        align="start" sideOffset={4}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {searchable ? <SearchField ariaLabel={`搜索${label}`} placeholder={`搜索${label}`} value={search} onValueChange={setSearch}
          disabled={disabled} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} /> : null}
        <div className="multi-select-dropdown__options" role="group" aria-label={label}>
          {visibleOptions.map((option) => (
            <label className="multi-select-dropdown__option" key={option.value}>
              <input
                aria-label={option.label}
                checked={value.includes(option.value)}
                type="checkbox"
                disabled={disabled}
                onChange={() => toggleValue(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {!visibleOptions.length ? <p role="status" className="multi-select-dropdown__empty">{search.trim() ? "没有匹配选项" : "暂无可选项"}</p> : null}
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}
