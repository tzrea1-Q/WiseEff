import { ChevronRight, Link2, RotateCw, Send, Terminal } from "lucide-react";
import { useState } from "react";
import type { NodeAccessMode } from "../powerManagementConfig";

export type NodeOperationEvent = {
  id: string;
  at: string;
  parameterName: string;
  parameterKey: string;
  accessMode: NodeAccessMode;
  action: "detect" | "read" | "write" | "write-readback";
  status: string;
  returncode?: number;
  stdout?: string;
  stderr?: string;
  nodePath?: string;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function eventIcon(action: NodeOperationEvent["action"]) {
  if (action === "detect") return <Link2 size={16} />;
  if (action === "read") return <Terminal size={16} />;
  if (action === "write-readback") return <RotateCw size={16} />;
  return <Send size={16} />;
}

function summarizeOutput(event: NodeOperationEvent) {
  const stderr = event.stderr?.trim();
  const stdout = event.stdout?.trim();
  if (stderr) return stderr.slice(0, 120);
  if (stdout) return stdout.slice(0, 120);
  return "无输出";
}

export function NodeOperationHistoryPanel({ events }: { events: NodeOperationEvent[] }) {
  const [open, setOpen] = useState(false);
  const ordered = [...events].reverse();

  return (
    <section className="operation-history-panel node-operation-history-panel" aria-label="节点操作记录">
      <button
        className="operation-history-head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight size={16} className={open ? "chevron open" : "chevron"} aria-hidden="true" />
        <strong>节点操作记录 · {events.length} 条</strong>
      </button>
      {open ? (
        ordered.length === 0 ? (
          <div className="operation-history-empty">本次会话还没有节点操作记录。</div>
        ) : (
          <ul className="operation-history-list" aria-label="节点操作事件列表">
            {ordered.map((event) => (
              <li key={event.id}>
                <span className="operation-history-icon">{eventIcon(event.action)}</span>
                <span className="operation-history-text">
                  {event.parameterName} · {event.accessMode} · {event.status}
                  <small>{event.parameterKey} · 返回码 {event.returncode ?? "—"} · {summarizeOutput(event)}</small>
                </span>
                <small className="operation-history-time">{formatTime(event.at)}</small>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
