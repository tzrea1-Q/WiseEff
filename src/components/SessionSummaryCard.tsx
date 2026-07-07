import { RotateCcw } from "lucide-react";
import { deriveSessionMetrics } from "../debuggingAnalytics";
import type { PrototypeState } from "../mockData";

export function SessionSummaryCard({
  state,
  now,
  onRollbackRequest
}: {
  state: PrototypeState;
  now: Date;
  onRollbackRequest: () => void;
}) {
  const activeDevice = state.devices.find((device) => device.status === "已连接") ?? state.devices[0];
  const metrics = deriveSessionMetrics(state, now);
  const snapshot = state.lastDebugSnapshot;
  const connected = activeDevice.status === "已连接";
  const rollbackEnabled = connected && snapshot !== null;
  const rollbackDisabledReason = !connected
    ? `请先连接 ${activeDevice.name}`
    : !snapshot
      ? "尚无快照，下发成功后自动生成"
      : "";

  return (
    <section className="session-summary-card" aria-label="调试会话摘要">
      <div className="session-summary-primary">
        <span className={connected ? "live-dot" : "idle-dot"} aria-hidden="true" />
        <div>
          <strong>
            {connected ? "在线" : "离线"} · {activeDevice.name}
          </strong>
          <small>{activeDevice.firmware}</small>
        </div>
      </div>
      <div className="session-summary-metrics">
        <div>
          <span>会话时长</span>
          <strong>{metrics.sessionDurationMinutes === null ? "—" : `${metrics.sessionDurationMinutes} 分钟`}</strong>
        </div>
        <div>
          <span>已下发</span>
          <strong>{metrics.pushedCount}</strong>
        </div>
        <div>
          <span>待下发</span>
          <strong>{metrics.pendingCount}</strong>
        </div>
        <div>
          <span>失败</span>
          <strong>{metrics.failedCount}</strong>
        </div>
      </div>
      <div className="session-summary-snapshot">
        {snapshot ? (
          <>
            <span>最近快照</span>
            <strong>{snapshot.id}</strong>
            <small>含 {snapshot.entries.length} 项修改</small>
          </>
        ) : (
          <span>尚无快照 · 下发成功后自动生成</span>
        )}
        <button
          className="button subtle"
          type="button"
          disabled={!rollbackEnabled}
          title={rollbackDisabledReason || undefined}
          onClick={onRollbackRequest}
        >
          <RotateCcw size={16} />
          回滚到上次快照
        </button>
      </div>
    </section>
  );
}
