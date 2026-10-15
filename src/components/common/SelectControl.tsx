import type { FocusEventHandler, ReactNode, Ref } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption<Value extends string = string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

type SelectControlProps<Value extends string> = {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SelectOption<Value>>;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  ariaLabelledBy?: string;
  ariaRequired?: boolean;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
  title?: string;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  className?: string;
  placeholder?: string;
  size?: "default" | "sm" | "filter";
  compactControl?: "filter" | "sort" | "pagination";
  disabled?: boolean;
  /** Compatibility for legacy surfaces; shared dialog descendants inherit this automatically. */
  withinModal?: boolean;
};

// Encode every value so an empty option is valid without reserving any business value.
const VALUE_PREFIX = "select-control:";

export function SelectControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  ariaLabelledBy,
  ariaRequired,
  id,
  ref,
  title,
  onFocus,
  onBlur,
  className,
  placeholder,
  size,
  compactControl,
  disabled = false,
  withinModal = false
}: SelectControlProps<Value>) {
  const selectValue = value === "" && !options.some((option) => option.value === "") ? "" : VALUE_PREFIX + value;
  return (
    <Select value={selectValue} onValueChange={(nextValue) => onValueChange(nextValue.slice(VALUE_PREFIX.length) as Value)} disabled={disabled}>
      <SelectTrigger ref={ref} id={id} data-value={value} data-compact-control={compactControl ?? (size === "filter" ? "filter" : undefined)} size={size} title={title} onFocus={onFocus} onBlur={onBlur} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} aria-required={ariaRequired} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className={cn("max-h-64 [&_[data-radix-select-viewport]]:max-h-64", withinModal && "debug-admin-select-content--modal")}
        position="popper"
        sideOffset={4}
      >
        {options.map((option) => (
          <SelectItem key={option.value} data-value={option.value} value={VALUE_PREFIX + option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
