import type { AuditSeverity } from "./types";
import type { HistoricalAttribution } from "../../../src/domain/identity/historicalAttribution";

export type AuditReadSeverity = AuditSeverity | "info";
export type AuditValueState = "present" | "deleted";

export type ListAuditEventsQuery = {
  organizationId: string | null;
  /** Server-authorized only; never parsed from the client's query parameters. */
  includePlatformWorkflowPublication?: boolean;
  eventId?: string;
  projectId?: string;
  app?: string;
  apps?: string[];
  kind?: string;
  severity?: AuditReadSeverity;
  severities?: AuditReadSeverity[];
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  traceId?: string;
  /** Case-insensitive search including localized action/kind and readable context. */
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
  projectName?: string;
  projectCode?: string;
  targetName?: string;
  /** Immutable, event-linked value history; never the current binding value. */
  evidence?: {
    previousValue?: unknown;
    newValue?: unknown;
    previousValueState?: AuditValueState;
    newValueState?: AuditValueState;
    sourceLabel?: string;
  };
  actorUserId: string | null;
  actorType: "user" | "agent" | "system" | "integration";
  actorName: string | null;
  historicalAttribution?: HistoricalAttribution;
  app: string;
  kind: string;
  action: string;
  severity: AuditReadSeverity;
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
