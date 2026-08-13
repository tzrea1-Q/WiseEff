import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";

/**
 * Read-side audit listing for Activity and similar projections.
 * Frontend audit writes go through backend routes, not a frontend port.
 */
export interface AuditQuery {
  listAuditEvents(params?: ListAuditEventsParams): Promise<AuditEventListResponse>;
}
