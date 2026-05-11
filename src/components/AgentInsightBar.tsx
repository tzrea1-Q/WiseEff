import { useEffect, useState } from "react";

export type InsightAction = {
  id: string;
  label: string;
  onClick: () => void;
};

export type Insight = {
  id: string;
  tone: "neutral" | "warning" | "danger";
  headline: string;
  meta?: string;
  actions: InsightAction[];
};

export function AgentInsightBar({
  items,
  persistKey,
  dismissedIds,
  onDismiss
}: {
  items: Insight[];
  persistKey?: string;
  dismissedIds?: string[];
  onDismiss?: (id: string) => void;
}) {
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(() => {
    if (!persistKey) {
      return new Set();
    }

    try {
      const raw = sessionStorage.getItem(persistKey);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!persistKey) {
      return;
    }
    sessionStorage.setItem(persistKey, JSON.stringify(Array.from(sessionDismissed)));
  }, [persistKey, sessionDismissed]);

  const effectiveItems = items.filter((item) => !sessionDismissed.has(item.id) && !(dismissedIds ?? []).includes(item.id));

  if (effectiveItems.length === 0) {
    return null;
  }

  return (
    <section className="insight-bar" role="status" aria-live="polite">
      {effectiveItems.map((insight) => (
        <div className="insight-item" data-tone={insight.tone} key={insight.id}>
          <div className="insight-content">
            <strong>{insight.headline}</strong>
            {insight.meta ? <span className="insight-meta">{insight.meta}</span> : null}
          </div>
          <div className="insight-actions">
            {insight.actions.map((action) => (
              <button className="button subtle" key={action.id} type="button" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
            <button
              aria-label="今天先不看"
              className="insight-dismiss"
              type="button"
              onClick={() => {
                setSessionDismissed((previous) => new Set(previous).add(insight.id));
                onDismiss?.(insight.id);
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
