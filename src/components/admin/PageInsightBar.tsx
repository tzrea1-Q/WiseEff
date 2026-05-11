import { AlertCircle, Info, Lightbulb, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageInsightAction = {
  label: string;
  onClick: () => void;
  tone?: "primary" | "subtle";
};

export type PageInsightBarProps = {
  severity: "info" | "warn" | "error";
  icon?: ReactNode;
  headline: string;
  description?: string;
  actions: PageInsightAction[];
  onDismiss?: () => void;
  className?: string;
};

const SEVERITY_STYLES = {
  info: {
    bg: "border-primary/20 bg-primary/5",
    text: "text-foreground",
    icon: Lightbulb,
    iconColor: "text-primary"
  },
  warn: {
    bg: "border-amber-200 bg-amber-50",
    text: "text-amber-950",
    icon: Info,
    iconColor: "text-amber-700"
  },
  error: {
    bg: "border-destructive/30 bg-destructive/5",
    text: "text-foreground",
    icon: AlertCircle,
    iconColor: "text-destructive"
  }
} as const;

export function PageInsightBar({
  severity,
  icon,
  headline,
  description,
  actions,
  onDismiss,
  className
}: PageInsightBarProps) {
  const styles = SEVERITY_STYLES[severity];
  const DefaultIcon = styles.icon;
  const role = severity === "error" ? "alert" : "status";

  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-lg border p-3.5", styles.bg, styles.text, className)}>
      <div className={cn("mt-0.5 shrink-0", styles.iconColor)}>{icon ?? <DefaultIcon className="size-5" />}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{headline}</p>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        {actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actions.map((action, index) => (
              <button
                key={`${action.label}-${index}`}
                type="button"
                onClick={action.onClick}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                  action.tone === "primary"
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-foreground/80 hover:bg-background hover:text-foreground"
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
