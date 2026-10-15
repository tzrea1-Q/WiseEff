import type { RiskLevel } from "@/domain/prototype/types";

export type { AuditEvent } from "@/domain/prototype/types";

export type AuditActorType = "user" | "agent" | "system";
export type AuditSeverity = RiskLevel | "info";
export const AUDIT_SEVERITIES: AuditSeverity[] = ["High", "Medium", "Low", "info"];

export function getAuditSeverityLabel(value: unknown) {
  switch (value) {
    case "High": return "高";
    case "Medium": return "中";
    case "Low": return "低";
    case "info": return "信息";
    default: return value == null ? "未记录" : "未知";
  }
}

export type AuditValueState = "present" | "deleted";
export type AuditEvidence = {
  previousValue?: unknown;
  newValue?: unknown;
  previousValueState?: AuditValueState;
  newValueState?: AuditValueState;
  sourceLabel?: string;
};

export type AuditEventView = {
  id: string;
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  actor: string;
  actorType: AuditActorType;
  timeLabel: string;
  createdAt?: string;
  traceId?: string;
  targetType?: string | null;
  targetId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  targetName?: string | null;
  evidence?: AuditEvidence;
  parameterId?: string;
  batchId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  viaAgent?: boolean;
};

export type AuditEventDto = {
  id: string;
  organizationId: string;
  projectId: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  targetName?: string | null;
  evidence?: AuditEvidence;
  actorUserId: string | null;
  actorType: AuditActorType;
  actorName?: string | null;
  app: string;
  kind: string;
  action: string;
  severity: AuditSeverity;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  traceId: string;
  createdAt: string;
};

export type AuditEventListResponse = {
  items: AuditEventDto[];
  nextCursor: string | null;
};

export type ListAuditEventsParams = {
  eventId?: string;
  projectId?: string;
  app?: string;
  apps?: string[];
  kind?: string;
  severity?: AuditSeverity;
  severities?: AuditSeverity[];
  targetType?: string;
  targetId?: string;
  traceId?: string;
  /** Server-side case-insensitive search over action, kind, target id, and actor name. */
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};
