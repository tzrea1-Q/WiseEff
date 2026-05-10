import { ChevronRight, Link2, RotateCcw, Send, Undo2 } from "lucide-react";
import { useState } from "react";
import type { DebugEvent } from "../mockData";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function describeEvent(event: DebugEvent, deviceName: string) {
  switch (event.kind) {
    case "connect":
      return { icon: <Link2 size={16} />, text: `已连接 ${deviceName}` };
    case "disconnect":
      return { icon: <Link2 size={16} />, text: `${deviceName} 已断开` };
    case "push":
      return {
        icon: <Send size={16} />,
        text: `下发 ${event.parameterIds.length} 项 · 快照 ${event.snapshotId}${event.risk === "High" ? " · 含高风险" : ""}`
      };
    case "rollback":
      return {
        icon: <RotateCcw size={16} />,
        text: `回滚到 ${event.snapshotId} · ${event.parameterIds.length} 项已恢复`
      };
    case "rollback-undo":
      return { icon: <Undo2 size={16} />, text: `撤销 ${event.snapshotId} 的下发` };
  }
}

export function OperationHistoryPanel({
  events,
  deviceName
}: {
  events: DebugEvent[];
  deviceName: string;
}) {
  const [open, setOpen] = useState(false);
  const ordered = [...events].reverse();

  return (
    <section className="operation-history-panel" aria-label="调试操作记录">
      <button
        className="operation-history-head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight size={16} className={open ? "chevron open" : "chevron"} aria-hidden="true" />
        <strong>调试操作记录 · {events.length} 条</strong>
      </button>
      {open ? (
        ordered.length === 0 ? (
          <div className="operation-history-empty">
            本次会话还没有调试记录。连接设备后会自动记录下发和回滚。
          </div>
        ) : (
          <ul className="operation-history-list" aria-label="调试事件列表">
            {ordered.map((event, index) => {
              const { icon, text } = describeEvent(event, deviceName);
              return (
                <li key={`${event.at}-${index}`}>
                  <span className="operation-history-icon">{icon}</span>
                  <span className="operation-history-text">{text}</span>
                  <small className="operation-history-time">{formatTime(event.at)}</small>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
