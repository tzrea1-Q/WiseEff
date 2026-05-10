import { RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AppAction } from "./App";
import { DisconnectedBanner } from "./components/DisconnectedBanner";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import type { DebugParameter, PrototypeState } from "./mockData";

const riskLabels: Record<"High" | "Medium" | "Low", string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

type DebuggingPageProps = {
  state: PrototypeState;
  dispatch: (action: AppAction) => void;
};

export function DebuggingPage({ state, dispatch }: DebuggingPageProps) {
  const [nowTick, setNowTick] = useState(() => new Date());
  const activeDevice = state.devices.find((device) => device.projectId === state.activeProjectId) ?? state.devices[0];
  const debugParameters = state.debugParameters;
  const pendingParameters = debugParameters.filter((parameter) => parameter.status === "待下发");
  const connected = activeDevice.status === "已连接";

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const updateTargetValue = (parameter: DebugParameter, targetValue: string) => {
    dispatch({
      type: "UPDATE_DEBUG_PARAMETER",
      parameterId: parameter.id,
      patch: {
        targetValue,
        status: targetValue === parameter.currentValue ? "已同步" : "待下发"
      }
    });
  };

  const pushPendingValues = () => {
    if (pendingParameters.length === 0) {
      return;
    }

    dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingParameters.map((parameter) => parameter.id) });
  };

  return (
    <div className="workbench-page debugging-page">
      <header className="page-header">
        <div>
          <h1>参数调试平台</h1>
          <p>连接调试样机后执行实时充电参数调节，所有下发动作都保留确认和回滚准备。</p>
        </div>
        <div className="page-actions">
          <div className="device-pill">
            <span className={connected ? "live-dot" : "idle-dot"} />
            {connected ? `已连接：${activeDevice.name}` : `未连接：${activeDevice.name}`}
            <button className="link-button" type="button" onClick={() => dispatch({ type: "CONNECT_DEVICE", deviceId: activeDevice.id })}>
              连接
            </button>
          </div>
        </div>
      </header>

      <div className="workbench-one-col">
        <DisconnectedBanner
          device={activeDevice}
          onConnect={() => dispatch({ type: "CONNECT_DEVICE", deviceId: activeDevice.id })}
        />
        <SessionSummaryCard
          state={state}
          now={nowTick}
          onRollbackRequest={() => {
            console.debug("rollback requested - dialog coming in Task 6");
          }}
        />
        <section className="debug-table">
          <PanelHeader title="实时可调参数" meta={connected ? "设备在线" : "需要连接"} />
          <DataTable
            headers={["参数名称", "当前值", "目标设定值", "范围", "风险", "状态"]}
            rows={debugParameters}
            renderRow={(parameter) => (
              <tr key={parameter.id}>
                <td>
                  <strong>{parameter.name}</strong>
                  <small>{parameter.key}</small>
                </td>
                <td className="mono">{parameter.currentValue}</td>
                <td>
                  <input
                    aria-label={`${parameter.key} 目标设定值`}
                    value={parameter.targetValue}
                    onChange={(event) => updateTargetValue(parameter, event.target.value)}
                  />
                </td>
                <td>{parameter.range} {parameter.unit}</td>
                <td><RiskBadge risk={parameter.risk} /></td>
                <td><Badge tone={parameter.status === "待下发" ? "secondary" : "neutral"}>{parameter.status}</Badge></td>
              </tr>
            )}
          />
          <div className="table-actionbar">
            <span>{pendingParameters.length} 项参数等待应用</span>
            <div>
              <button className="button subtle" type="button">
                <RotateCcw size={16} />
                一键回滚充电策略
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!connected || pendingParameters.length === 0}
                onClick={pushPendingValues}
              >
                <Send size={16} />
                下发调试值
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function DataTable<T>({ headers, rows, renderRow }: { headers: string[]; rows: T[]; renderRow: (row: T) => ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
      {rows.length === 0 ? <EmptyState text="当前筛选条件下没有数据。" /> : null}
    </div>
  );
}

function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <span className={`risk-badge ${risk.toLowerCase()}`}>{riskLabels[risk]}</span>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tertiary" | "secondary" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      {text}
    </div>
  );
}
