import { AlertTriangle, Info, Lightbulb, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

export type InsightAction = {
  id: string;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
};

export type Insight = {
  id: string;
  tone: "neutral" | "warning" | "danger";
  headline: string;
  meta?: string;
  actions: InsightAction[];
};

function resolveActionVariant(action: InsightAction, index: number, total: number): "primary" | "secondary" {
  if (action.variant) {
    return action.variant;
  }
  if (total === 1) {
    return "primary";
  }
  return index === total - 1 ? "primary" : "secondary";
}

function InsightToneIcon({ tone }: { tone: Insight["tone"] }) {
  if (tone === "danger") {
    return <AlertTriangle aria-hidden="true" size={18} />;
  }
  if (tone === "warning") {
    return <Lightbulb aria-hidden="true" size={18} />;
  }
  return <Info aria-hidden="true" size={18} />;
}

export function AgentInsightBar({
  items,
  persistKey,
  dismissedIds,
  onDismiss,
  eyebrow = "Agent 建议"
}: {
  items: Insight[];
  persistKey?: string;
  dismissedIds?: string[];
  onDismiss?: (id: string) => void;
  eyebrow?: string;
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
          <div className="insight-item__icon" aria-hidden="true">
            <InsightToneIcon tone={insight.tone} />
          </div>
          <div className="insight-content">
            <span className="insight-eyebrow">{eyebrow}</span>
            <strong>{insight.headline}</strong>
            {insight.meta ? <span className="insight-meta">{insight.meta}</span> : null}
          </div>
          <div className="insight-actions">
            {insight.actions.map((action, index) => {
              const variant = resolveActionVariant(action, index, insight.actions.length);
              const isPrimaryAsk = variant === "primary" && /小泽|xiaoze/i.test(action.label);
              return (
                <button
                  className={`insight-action insight-action--${variant}`}
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                >
                  {isPrimaryAsk ? <Sparkles aria-hidden="true" size={14} /> : null}
                  {action.label}
                </button>
              );
            })}
            <button
              aria-label="今天先不看"
              className="insight-action insight-action--ghost insight-dismiss"
              type="button"
              onClick={() => {
                setSessionDismissed((previous) => new Set(previous).add(insight.id));
                onDismiss?.(insight.id);
              }}
            >
              <X aria-hidden="true" size={14} />
              <span>今天先不看</span>
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
