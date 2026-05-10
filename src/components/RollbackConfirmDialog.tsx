import { ArrowRight, RotateCcw } from "lucide-react";
import type { DebugParameter, DebugSnapshot } from "../mockData";

const riskLabels: Record<DebugParameter["risk"], string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

export function RollbackConfirmDialog({
  snapshot,
  parameters,
  onCancel,
  onConfirm
}: {
  snapshot: DebugSnapshot;
  parameters: DebugParameter[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const parameterMap = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const entries = snapshot.entries.map((entry) => ({
    entry,
    parameter: parameterMap.get(entry.parameterId)
  }));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rollback-confirm-title">
      <div className="confirm-dialog rollback-confirm-dialog">
        <div className="rollback-confirm-head">
          <RotateCcw size={22} aria-hidden="true" />
          <div>
            <span className="eyebrow">{snapshot.id}</span>
            <h2 id="rollback-confirm-title">确认回滚到上次快照</h2>
            <p>以下 {snapshot.entries.length} 项参数将恢复为下发前的值。目标值保留，不会被清除。</p>
          </div>
        </div>
        <ul className="rollback-confirm-list">
          {entries.map(({ entry, parameter }) => (
            <li key={entry.parameterId}>
              <div className="rollback-confirm-name">
                <strong>{parameter?.name ?? entry.parameterId}</strong>
                {parameter ? <small>{parameter.key}</small> : null}
              </div>
              <div className="rollback-confirm-diff">
                <span className="diff-before mono">{entry.nextValue}{parameter?.unit ?? ""}</span>
                <ArrowRight size={14} aria-hidden="true" />
                <span className="diff-after mono">{entry.previousValue}{parameter?.unit ?? ""}</span>
              </div>
              {parameter ? <RiskBadge risk={parameter.risk} /> : null}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            确认回滚 ({snapshot.entries.length} 项)
          </button>
        </div>
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: DebugParameter["risk"] }) {
  return <span className={`risk-badge ${risk.toLowerCase()}`}>{riskLabels[risk]}</span>;
}
