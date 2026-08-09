import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";

/**
 * Read-side audit listing for Activity and similar projections.
 * Distinct from write-only {@link AuditSink}.
 */
export interface AuditQuery {
  listAuditEvents(params?: ListAuditEventsParams): Promise<AuditEventListResponse>;
}
