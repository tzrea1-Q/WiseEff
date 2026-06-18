import { ChevronDown, UserRound } from "lucide-react";
import { useState } from "react";
import { presentAuditEvent } from "@/domain/audit/presentAuditEvent";
import type { AuditEventView } from "@/domain/audit/types";
import type { RiskLevel } from "@/mockData";
import { cn } from "@/lib/utils";

const severityBadge: Record<RiskLevel, string> = {
  High: "audit-panel-severity-high",
  Medium: "audit-panel-severity-medium",
  Low: "audit-panel-severity-low"
};

const severityLabel: Record<RiskLevel, string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

export type AuditEventDetailPanelProps = {
  event: AuditEventView;
  className?: string;
};

export function AuditEventDetailPanel({ event, className }: AuditEventDetailPanelProps) {
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const presentation = presentAuditEvent(event);

  return (
    <section className={cn("audit-event-detail-panel", className)} aria-label="审计事件详情">
      <header className="audit-event-detail-panel-hero">
        <div className="audit-event-detail-panel-hero-top">
          <span className={cn("audit-panel-severity", severityBadge[event.severity])}>
            {severityLabel[event.severity]}
          </span>
          <span className="audit-panel-kind">{presentation.kindLabel}</span>
          <span className="audit-panel-app">{presentation.appLabel}</span>
        </div>
        <h3 className="audit-event-detail-panel-title">{presentation.headline}</h3>
        <p className="audit-event-detail-panel-summary">{presentation.summary}</p>
      </header>

      <div className="audit-event-detail-panel-grid">
        <article className="audit-event-detail-panel-card">
          <span className="audit-panel-card-label">操作人</span>
          <strong>{presentation.actor.name}</strong>
          <span className="audit-panel-card-meta">{presentation.actor.typeLabel}</span>
        </article>
        <article className="audit-event-detail-panel-card">
          <span className="audit-panel-card-label">发生时间</span>
          <strong>{presentation.timestamp.absolute}</strong>
          <span className="audit-panel-card-meta">{presentation.timestamp.relative}</span>
        </article>
      </div>

      {presentation.statusChange ? (
        <section className="audit-event-detail-panel-section" aria-label="流程状态">
          <h4>流程状态</h4>
          <div className="audit-status-flow">
            <span>{presentation.statusChange.from}</span>
            <span className="audit-status-flow-arrow" aria-hidden="true">→</span>
            <span>{presentation.statusChange.to}</span>
          </div>
        </section>
      ) : null}

      {presentation.parameterChange ? (
        <section className="audit-event-detail-panel-section" aria-label="参数变更">
          <h4>参数变更</h4>
          <div className="audit-parameter-change-card">
            <div className="audit-parameter-change-head">
              <div>
                <strong>{presentation.parameterChange.name}</strong>
                {presentation.parameterChange.module ? (
                  <span className="audit-parameter-change-module">{presentation.parameterChange.module}</span>
                ) : null}
              </div>
              {presentation.parameterChange.risk ? (
                <span className="audit-parameter-change-risk">{presentation.parameterChange.risk}</span>
              ) : null}
            </div>
            <div className="audit-diff-card audit-parameter-diff">
              <div>
                <span className="audit-diff-label">变更前</span>
                <code>{presentation.parameterChange.previousValue}</code>
                {presentation.parameterChange.unit ? (
                  <span className="audit-diff-unit">{presentation.parameterChange.unit}</span>
                ) : null}
              </div>
              <div className="audit-diff-arrow" aria-hidden="true">→</div>
              <div>
                <span className="audit-diff-label">变更后</span>
                <code>{presentation.parameterChange.newValue}</code>
                {presentation.parameterChange.unit ? (
                  <span className="audit-diff-unit">{presentation.parameterChange.unit}</span>
                ) : null}
              </div>
            </div>
            {presentation.parameterChange.reason ? (
              <p className="audit-parameter-change-reason">
                <span>变更原因</span>
                {presentation.parameterChange.reason}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {presentation.participants.length > 0 ? (
        <section className="audit-event-detail-panel-section" aria-label="参与人员">
          <h4>
            <UserRound size={16} aria-hidden="true" />
            参与人员
          </h4>
          <ul className="audit-participant-list">
            {presentation.participants.map((participant, index) => (
              <li key={`${participant.role}-${participant.name}-${index}`}>
                <div className="audit-participant-main">
                  <span className="audit-participant-role">{participant.role}</span>
                  <strong>{participant.name}</strong>
                  {participant.action ? <span className="audit-participant-action">{participant.action}</span> : null}
                </div>
                {participant.note ? <p className="audit-participant-note">{participant.note}</p> : null}
                {participant.time ? <time className="audit-participant-time">{participant.time}</time> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {presentation.notes.length > 0 ? (
        <section className="audit-event-detail-panel-section" aria-label="备注说明">
          <h4>备注说明</h4>
          <ul className="audit-note-list">
            {presentation.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {presentation.technical.length > 0 ? (
        <section className="audit-event-detail-panel-section audit-event-detail-panel-technical">
          <button
            type="button"
            className="audit-technical-toggle"
            aria-expanded={technicalOpen}
            onClick={() => setTechnicalOpen((open) => !open)}
          >
            <span>技术追踪信息</span>
            <ChevronDown className={cn("audit-technical-chevron", technicalOpen && "audit-technical-chevron-open")} size={16} />
          </button>
          {technicalOpen ? (
            <dl className="audit-detail-metadata audit-detail-targets">
              {presentation.technical.map((row) => (
                <div className="audit-detail-row" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
