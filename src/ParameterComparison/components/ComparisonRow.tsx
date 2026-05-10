import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";
import { calculateDelta } from "../utils/deltaCalc";
import type { ComparisonRow as ComparisonRowType } from "../types";
import { DeltaBadge } from "./DeltaBadge";
import { ParameterKeyTooltip } from "./ParameterKeyTooltip";

export type ComparisonRowProps = {
  row: ComparisonRowType;
  query: string;
  onSync: (key: string) => void;
  onIgnore: (key: string) => void;
};

function riskTone(risk: ComparisonRowType["risk"]) {
  return risk.toLowerCase();
}

function highlight(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return text;
  }

  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) {
    return text;
  }

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

export function ComparisonRow({ row, query, onSync, onIgnore }: ComparisonRowProps) {
  const delta = calculateDelta({
    baseValue: row.baseNumeric === null ? null : String(row.baseNumeric),
    targetValue: row.targetNumeric === null ? null : String(row.targetNumeric),
    unit: row.unit
  });

  return (
    <div className="comparison-row--v2" data-risk-tone={riskTone(row.risk)} data-status={row.status} role="row">
      <span className="comparison-row--v2__color-bar" aria-hidden="true" />
      <div className="comparison-row--v2__key" role="cell">
        {row.status === "drift" ? (
          <AlertTriangle size={17} data-status-icon="drift" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={17} data-status-icon="synced" aria-hidden="true" />
        )}
        <span className="comparison-row--v2__key-text">
          <ParameterKeyTooltip parameterKey={row.key} module={row.module} description={row.description} risk={row.risk}>
            {highlight(row.key, query)}
          </ParameterKeyTooltip>
          <small>{highlight(row.module, query)}</small>
        </span>
      </div>
      <span className="comparison-row--v2__value" role="cell">
        {row.baseValue}
      </span>
      <span className="comparison-row--v2__value" data-side="target" role="cell">
        {row.targetValue}
        <DeltaBadge delta={delta} />
      </span>
      <div className="comparison-row--v2__actions" role="cell">
        {row.status === "drift" ? (
          <>
            <button className="comparison-row--v2__action-primary" type="button" aria-label={`同步 ${row.key}`} onClick={() => onSync(row.key)}>
              <ArrowRight size={14} aria-hidden="true" />
              同步
            </button>
            <button className="comparison-row--v2__action-secondary" type="button" aria-label={`忽略 ${row.key}`} onClick={() => onIgnore(row.key)}>
              <X size={14} aria-hidden="true" />
              忽略
            </button>
          </>
        ) : (
          <span className="comparison-row--v2__synced-label">已同步</span>
        )}
      </div>
    </div>
  );
}
