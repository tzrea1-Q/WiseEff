import { useEffect, useImperativeHandle, useRef, type FocusEventHandler, type ReactNode, type Ref } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  disabled = false
}: SelectControlProps<Value>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreAfterLoading = useRef(false);
  useImperativeHandle(ref, () => triggerRef.current!, []);
  useEffect(() => {
    if (disabled || !restoreAfterLoading.current) return;
    restoreAfterLoading.current = false;
    // Radix cannot focus a trigger disabled by the selection's async work.
    // Restore only when focus is still unclaimed; another input/dialog owns it otherwise.
    if (document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true });
  }, [disabled]);
  const selectValue = value === "" && !options.some((option) => option.value === "") ? "" : VALUE_PREFIX + value;
  return (
    <Select value={selectValue} onValueChange={(nextValue) => onValueChange(nextValue.slice(VALUE_PREFIX.length) as Value)} disabled={disabled}>
      <SelectTrigger ref={triggerRef} id={id} data-value={value} data-compact-control={compactControl ?? (size === "filter" ? "filter" : undefined)} size={size} title={title} onFocus={onFocus} onBlur={onBlur} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} aria-required={ariaRequired} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className="max-h-64 [&_[data-radix-select-viewport]]:max-h-64"
        position="popper"
        sideOffset={4}
        onCloseAutoFocus={() => { restoreAfterLoading.current = triggerRef.current?.disabled ?? false; }}
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
