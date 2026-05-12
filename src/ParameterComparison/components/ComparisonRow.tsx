import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { calculateDelta, type DeltaDescriptor } from "../utils/deltaCalc";
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
  if (!trimmed) return text;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return text;
  return (<>{text.slice(0, index)}<mark>{text.slice(index, index + trimmed.length)}</mark>{text.slice(index + trimmed.length)}</>);
}

export function ComparisonRow({ row, query, onSync, onIgnore }: ComparisonRowProps) {
  const [expanded, setExpanded] = useState(false);
  const delta = calculateDelta({
    baseValue: row.baseNumeric === null ? null : String(row.baseNumeric),
    targetValue: row.targetNumeric === null ? null : String(row.targetNumeric),
    unit: row.unit
  });

  const toggleExpand = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button.comparison-row--v2__action-primary, button.comparison-row--v2__action-secondary, .param-tooltip")) return;
    setExpanded(!expanded);
  };

  return (
    <>
      <div className={`comparison-row--v2 ${expanded ? "comparison-row--v2--expanded" : ""}`} data-risk-tone={riskTone(row.risk)} data-status={row.status} role="row" onClick={toggleExpand}>
        <span className="comparison-row--v2__color-bar" aria-hidden="true" />
        <div className="comparison-row--v2__key" role="cell">
          <span className="comparison-row--v2__expand-indicator" aria-hidden="true">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          {row.status === "drift" ? <AlertTriangle size={17} data-status-icon="drift" aria-hidden="true" /> : <CheckCircle2 size={17} data-status-icon="synced" aria-hidden="true" />}
          <span className="comparison-row--v2__key-text">
            <ParameterKeyTooltip parameterKey={row.key} module={row.module} description={row.description} risk={row.risk}>
              {highlight(row.key, query)}
            </ParameterKeyTooltip>
            <small>{highlight(row.module, query)}</small>
          </span>
        </div>
        <span className="comparison-row--v2__desc" role="cell">{row.description}</span>
        <span className="comparison-row--v2__value" role="cell">{row.baseValue}</span>
        <span className="comparison-row--v2__value" data-side="target" role="cell">{row.targetValue}<DeltaBadge delta={delta} /></span>
        <div className="comparison-row--v2__actions" role="cell">
          {row.status === "drift" ? (
            <>
              <button className="comparison-row--v2__action-primary" type="button" aria-label={`同步 ${row.key}`} onClick={() => onSync(row.key)}><ArrowRight size={14} aria-hidden="true" />同步</button>
              <button className="comparison-row--v2__action-secondary" type="button" aria-label={`忽略 ${row.key}`} onClick={() => onIgnore(row.key)}><X size={14} aria-hidden="true" />忽略</button>
            </>
          ) : <span className="comparison-row--v2__synced-label">已同步</span>}
        </div>
      </div>
      {expanded ? (
        <div className="comparison-row--v2__diff-panel">
          {row.structuredDiff ? <InlineJsonDiff before={row.structuredDiff.before} after={row.structuredDiff.after} /> : <SimpleValueDiff baseValue={row.baseValue} targetValue={row.targetValue} delta={delta} />}
        </div>
      ) : null}
    </>
  );
}

function SimpleValueDiff({ baseValue, targetValue, delta }: { baseValue: string; targetValue: string; delta: DeltaDescriptor }) {
  const deltaText = delta.kind === "percent" ? `${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(1)}%` : delta.kind === "absolute" ? `${delta.direction === "up" ? "+" : ""}${delta.amount} ${delta.unit}` : null;
  return (
    <div className="simple-diff-container">
      <div className="simple-diff-item simple-diff-before"><span className="simple-diff-label">基准项目</span><span className="simple-diff-value">{baseValue}</span></div>
      <div className="simple-diff-arrow" aria-hidden="true">→</div>
      <div className="simple-diff-item simple-diff-after"><span className="simple-diff-label">对比项目</span><span className="simple-diff-value">{targetValue}</span></div>
      {deltaText ? <span className="simple-diff-delta">{deltaText}</span> : null}
    </div>
  );
}

function InlineJsonDiff({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return (
    <div className="json-diff-container">
      <div className="json-diff-panel json-diff-before">
        <div className="json-diff-panel-header">基准项目</div>
        <pre className="json-diff-code">{"{\n"}{allKeys.map((key) => { const val = before[key]; const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]); const cls = changed ? (key in after ? "diff-line-removed" : "diff-line-deleted") : "diff-line-unchanged"; return <span key={key} className={cls}>{`  "${key}": ${JSON.stringify(val)}`}{"\n"}</span>; })}{"}"}</pre>
      </div>
      <div className="json-diff-panel json-diff-after">
        <div className="json-diff-panel-header">对比项目</div>
        <pre className="json-diff-code">{"{\n"}{allKeys.map((key) => { const val = after[key]; const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]); const cls = changed ? (key in before ? "diff-line-added" : "diff-line-new") : "diff-line-unchanged"; return <span key={key} className={cls}>{`  "${key}": ${JSON.stringify(val)}`}{"\n"}</span>; })}{"}"}</pre>
      </div>
    </div>
  );
}
