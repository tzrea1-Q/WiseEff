import { Lightbulb, X } from "lucide-react";
import type { ParameterWorkbenchInsightSnapshot } from "../parameterWorkbenchInsights";

export function ParameterInsightBar({
  snapshot,
  collapsed,
  onExpand,
  onViewHighRisk,
  onAddToDraft,
  canAddToDraft = true,
  addToDraftDisabledReason,
  onDismiss
}: {
  snapshot: ParameterWorkbenchInsightSnapshot;
  collapsed: boolean;
  onExpand: () => void;
  onViewHighRisk: () => void;
  onAddToDraft: () => void;
  canAddToDraft?: boolean;
  addToDraftDisabledReason?: string;
  onDismiss: () => void;
}) {
  if (snapshot.driftedCount === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <button className="parameter-insight-collapsed" type="button" onClick={onExpand} aria-label={`展开 ${snapshot.driftedCount} 项 Agent 洞察`}>
        <Lightbulb size={15} aria-hidden="true" />
        <span>{snapshot.driftedCount} 项 Agent 洞察</span>
      </button>
    );
  }

  const strongest = snapshot.topParameters[0];

  return (
    <section className="parameter-insight-bar" role="status" aria-label="Agent 参数洞察">
      <Lightbulb className="parameter-insight-icon" size={20} aria-hidden="true" />
      <div className="parameter-insight-copy">
        <strong>
          Agent 发现 {snapshot.driftedCount} 个参数偏离推荐值
          <span>（高风险 {snapshot.highRiskCount} · 中风险 {snapshot.mediumRiskCount}）</span>
        </strong>
        {strongest ? (
          <p>
            最显著：<code>{strongest.name}</code> {strongest.currentValue}{strongest.unit} → {strongest.recommendedValue}{strongest.unit} · 偏差 {strongest.driftLabel}
          </p>
        ) : null}
        <div className="parameter-insight-actions">
          <button className="button subtle" type="button" onClick={onViewHighRisk}>
            查看高风险
          </button>
          {canAddToDraft ? (
            <button className="button primary" type="button" onClick={onAddToDraft}>
              一键加入草稿
            </button>
          ) : addToDraftDisabledReason ? (
            <span className="permission-inline-reason">{addToDraftDisabledReason}</span>
          ) : null}
          <button className="link-button" type="button" onClick={onDismiss}>
            今天先不看
          </button>
        </div>
      </div>
      <button className="icon-button" type="button" aria-label="关闭洞察" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
