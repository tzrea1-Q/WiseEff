import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SelectOption<Value extends string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

type DebugAdminSelectControlProps<Value extends string> = {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SelectOption<Value>>;
  ariaLabel?: string;
  disabled?: boolean;
  withinModal?: boolean;
};

export function DebugAdminSelectControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled = false,
  withinModal = false
}: DebugAdminSelectControlProps<Value>) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as Value)} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className={cn(withinModal && "debug-admin-select-content--modal")}
        position="popper"
        sideOffset={4}
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
