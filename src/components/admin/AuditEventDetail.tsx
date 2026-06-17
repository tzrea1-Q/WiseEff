import { cn } from "@/lib/utils";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import type { AuditEventView } from "@/domain/audit/types";
import type { RiskLevel } from "@/mockData";

const severityBadge: Record<RiskLevel, string> = {
  High: "bg-destructive/10 text-destructive",
  Medium: "bg-amber-100 text-amber-900",
  Low: "bg-muted text-muted-foreground"
};

const severityLabel: Record<RiskLevel, string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

const actorTypeLabel = {
  user: "用户",
  agent: "Agent",
  system: "系统"
} as const;

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="audit-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DiffCard({ previousValue, newValue }: { previousValue: string; newValue: string }) {
  return (
    <div className="audit-diff-card">
      <div>
        <span className="audit-diff-label">变更前</span>
        <code>{previousValue}</code>
      </div>
      <div className="audit-diff-arrow" aria-hidden="true">
        →
      </div>
      <div>
        <span className="audit-diff-label">变更后</span>
        <code>{newValue}</code>
      </div>
    </div>
  );
}

function renderMetadataDetails(event: AuditEventView) {
  const metadata = event.metadata ?? {};
  const rows: Array<{ label: string; value: string }> = [];

  if (typeof metadata.previousValue === "string" && typeof metadata.newValue === "string") {
    return <DiffCard previousValue={metadata.previousValue} newValue={metadata.newValue} />;
  }

  if (typeof metadata.fromStatus === "string" && typeof metadata.toStatus === "string") {
    rows.push({ label: "状态变更", value: `${metadata.fromStatus} → ${metadata.toStatus}` });
  }

  if (typeof metadata.note === "string" && metadata.note.trim()) {
    rows.push({ label: "备注", value: metadata.note });
  }

  const summary = metadata.summary as { added?: number; updated?: number; skipped?: number } | undefined;
  if (summary && (summary.added !== undefined || summary.updated !== undefined || summary.skipped !== undefined)) {
    rows.push({
      label: "导入摘要",
      value: `新增 ${summary.added ?? 0} · 更新 ${summary.updated ?? 0} · 跳过 ${summary.skipped ?? 0}`
    });
  }

  if (typeof metadata.nodePath === "string") {
    rows.push({ label: "节点路径", value: metadata.nodePath });
  }

  if (typeof metadata.previousValue === "string" && typeof metadata.readbackValue === "string") {
    rows.push({
      label: "写入结果",
      value: `${metadata.previousValue} → ${metadata.readbackValue}${metadata.verified === true ? "（已回读验证）" : ""}`
    });
  }

  if (typeof metadata.snapshotId === "string") {
    rows.push({ label: "快照 ID", value: metadata.snapshotId });
  }

  if (typeof metadata.previousRole === "string" && typeof metadata.newRole === "string") {
    rows.push({ label: "角色变更", value: `${metadata.previousRole} → ${metadata.newRole}` });
  }

  const affectedIds = metadata.affectedIds;
  if (Array.isArray(affectedIds) && affectedIds.length > 0) {
    rows.push({ label: "影响对象", value: affectedIds.join(", ") });
  }

  if (typeof metadata.snapshotName === "string") {
    rows.push({ label: "快照名称", value: metadata.snapshotName });
  }

  if (rows.length === 0) {
    const ignored = new Set(["previousValue", "newValue", "fromStatus", "toStatus", "note", "summary", "affectedIds"]);
    for (const [key, value] of Object.entries(metadata)) {
      if (ignored.has(key) || value === null || value === undefined) {
        continue;
      }
      rows.push({ label: key, value: typeof value === "string" ? value : JSON.stringify(value) });
    }
  }

  if (rows.length === 0) {
    return <p className="audit-detail-empty">暂无结构化详情</p>;
  }

  return (
    <dl className="audit-detail-metadata">
      {rows.map((row) => (
        <MetadataRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
      ))}
    </dl>
  );
}

export type AuditEventDetailProps = {
  event: AuditEventView | null;
  className?: string;
};

export function AuditEventDetail({ event, className }: AuditEventDetailProps) {
  if (!event) {
    return (
      <section className={cn("audit-event-detail audit-event-detail-empty", className)} aria-label="审计事件详情">
        <p>选择一条审计记录查看详情、变更摘要与 trace 信息。</p>
      </section>
    );
  }

  return (
    <section className={cn("audit-event-detail", className)} aria-label="审计事件详情">
      <header className="audit-event-detail-head">
        <div className="audit-event-detail-badges">
          <span className={cn("audit-severity-badge", severityBadge[event.severity])}>{severityLabel[event.severity]}</span>
          <span className="audit-kind-badge">{event.kind}</span>
          <span className="audit-app-badge">{event.app}</span>
        </div>
        <h3>{event.action}</h3>
        <p className="audit-event-detail-meta">
          <span>{event.actor}</span>
          <span>·</span>
          <span>{actorTypeLabel[event.actorType]}</span>
          <span>·</span>
          <time dateTime={event.createdAt}>{formatAuditAbsoluteTime(event.createdAt)}</time>
          <span className="audit-event-detail-relative">（{event.timeLabel}）</span>
        </p>
      </header>

      <div className="audit-event-detail-body">{renderMetadataDetails(event)}</div>

      <dl className="audit-detail-metadata audit-detail-targets">
        {event.targetType ? <MetadataRow label="目标类型" value={event.targetType} /> : null}
        {event.targetId ? <MetadataRow label="目标 ID" value={event.targetId} /> : null}
        {event.parameterId ? <MetadataRow label="参数 ID" value={event.parameterId} /> : null}
        {event.batchId ? <MetadataRow label="批次 ID" value={event.batchId} /> : null}
        {event.userId ? <MetadataRow label="用户 ID" value={event.userId} /> : null}
        {event.traceId ? <MetadataRow label="Trace ID" value={event.traceId} /> : null}
      </dl>
    </section>
  );
}
