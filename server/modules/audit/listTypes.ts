import type { AuditSeverity } from "./types";

export type ListAuditEventsQuery = {
  organizationId: string | null;
  projectId?: string;
  app?: string;
  apps?: string[];
  kind?: string;
  severity?: AuditSeverity;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  traceId?: string;
  /** Case-insensitive text search over action, kind, target id, and actor name. */
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type AuditEventListItemDto = {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  actorUserId: string | null;
  actorType: "user" | "agent" | "system";
  actorName: string | null;
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

export type ListAuditEventsResult = {
  items: AuditEventListItemDto[];
  nextCursor: string | null;
};
