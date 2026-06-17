import type { RiskLevel } from "@/mockData";

export type { AuditEvent } from "@/mockData";

export type AuditActorType = "user" | "agent" | "system";

export type AuditEventView = {
  id: string;
  app: string;
  kind: string;
  action: string;
  severity: RiskLevel;
  actor: string;
  actorType: AuditActorType;
  timeLabel: string;
  createdAt?: string;
  traceId?: string;
  targetType?: string | null;
  targetId?: string | null;
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
  actorUserId: string | null;
  actorType: AuditActorType;
  actorName?: string | null;
  app: string;
  kind: string;
  action: string;
  severity: RiskLevel;
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
  projectId?: string;
  app?: string;
  apps?: string[];
  kind?: string;
  severity?: RiskLevel;
  targetType?: string;
  targetId?: string;
  traceId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};
