import { ChevronRight, Link2, RotateCw, Send, Terminal } from "lucide-react";
import { useState } from "react";
import { getDebugValueFormatLabel } from "@/debugValueKind";
import type { DebugValueFormat } from "@/debugValueKind";
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
  valuePreview?: string;
  valueDigest?: string;
  valueFormat?: DebugValueFormat;
};

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

function eventIcon(action: NodeOperationEvent["action"]) {
  if (action === "detect") return <Link2 size={16} />;
  if (action === "read") return <Terminal size={16} />;
  if (action === "write-readback") return <RotateCw size={16} />;
  return <Send size={16} />;
}

function summarizeOutput(event: NodeOperationEvent) {
  const preview = event.valuePreview?.trim();
  if (preview) {
    const formatLabel = event.valueFormat
      ? getDebugValueFormatLabel({ valueKind: "complex", valueFormat: event.valueFormat })
      : "";
    const digest = event.valueDigest ? ` · ${event.valueDigest.slice(0, 12)}…` : "";
    return `${preview}${formatLabel ? ` · ${formatLabel}` : ""}${digest}`;
  }

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
                <div className="operation-history-text">
                  {event.parameterName} · {event.accessMode} · {event.status}
                  <small>{event.parameterKey} · 返回码 {event.returncode ?? "—"} · {summarizeOutput(event)}</small>
                  <details className="node-operation-detail">
                    <summary>查看完整结果</summary>
                    <dl>
                      <div><dt>操作时间</dt><dd><time dateTime={event.at}>{formatTime(event.at)}</time></dd></div>
                      <div><dt>返回码</dt><dd>{event.returncode ?? "未返回"}</dd></div>
                      {event.nodePath ? <div><dt>节点路径</dt><dd><code>{event.nodePath}</code></dd></div> : null}
                      {event.valueDigest ? <div><dt>值摘要</dt><dd><code>{event.valueDigest}</code></dd></div> : null}
                    </dl>
                    <strong>标准输出</strong>
                    <pre aria-label="标准输出">{event.stdout || "无输出"}</pre>
                    <strong>错误输出</strong>
                    <pre aria-label="错误输出">{event.stderr || "无输出"}</pre>
                  </details>
                </div>
                <time className="operation-history-time" dateTime={event.at}>{formatTime(event.at)}</time>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
