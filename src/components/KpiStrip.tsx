import type { ReactNode } from "react";

export type KpiItem = {
  id: string;
  label: string;
  value: string | number | ReactNode;
  hint?: string;
  interactive?: boolean;
  onClick?: () => void;
  tone?: "neutral" | "warning" | "danger";
};

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <section className="kpi-strip" aria-label="参数管理后台指标">
      {items.map((item) => {
        const content = (
          <>
            <span className="kpi-label">{item.label}</span>
            <span className="kpi-value">{item.value}</span>
            {item.interactive ? <span className="kpi-arrow" aria-hidden="true">↗</span> : null}
          </>
        );

        if (item.interactive) {
          return (
            <button
              className="kpi-item interactive"
              data-tone={item.tone ?? "neutral"}
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.hint}
              aria-label={`${item.label} ${typeof item.value === "string" || typeof item.value === "number" ? item.value : ""}`.trim()}
            >
              {content}
            </button>
          );
        }

        return (
          <div className="kpi-item" data-tone={item.tone ?? "neutral"} key={item.id} title={item.hint}>
            {content}
          </div>
        );
      })}
    </section>
  );
}
