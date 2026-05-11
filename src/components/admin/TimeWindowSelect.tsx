import { cn } from "@/lib/utils";

export type TimeWindow = "today" | "7d" | "30d";

export type TimeWindowOption = {
  value: TimeWindow;
  label: string;
};

export type TimeWindowSelectProps = {
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
  options?: TimeWindowOption[];
  className?: string;
};

const DEFAULT_OPTIONS: TimeWindowOption[] = [
  { value: "today", label: "今日" },
  { value: "7d", label: "7 日" },
  { value: "30d", label: "30 日" }
];

export function TimeWindowSelect({ value, onChange, options = DEFAULT_OPTIONS, className }: TimeWindowSelectProps) {
  return (
    <div
      role="group"
      aria-label="时间窗口"
      className={cn("inline-flex items-center rounded-lg border border-border bg-background p-0.5", className)}
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) {
                onChange(option.value);
              }
            }}
            className={cn(
              "h-7 rounded-md px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
