import type { AuditEventDto, AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";
import type { ParameterAdminAction, ParameterAdminRecentAuditEvent } from "./parameterAdminState";

/** Apps that parameter-admin mutations write into (see auditApps + governance/baseline writers). */
const PARAMETER_ADMIN_AUDIT_APPS = ["parameter-management", "parameter-admin", "parameters"] as const;

export function mapAuditDtoToRecentEvent(dto: AuditEventDto): ParameterAdminRecentAuditEvent {
  const reason =
    typeof dto.metadata?.reason === "string"
      ? dto.metadata.reason
      : typeof dto.metadata?.note === "string"
        ? dto.metadata.note
        : "";

  return {
    id: dto.id,
    kind: dto.kind,
    summary: dto.action,
    reason,
    recordedAt: dto.createdAt
  };
}

export type RefreshParameterAdminRecentAuditsDeps = {
  dispatch: (action: ParameterAdminAction) => void;
  listAuditEvents: (params?: ListAuditEventsParams) => Promise<AuditEventListResponse>;
  projectId?: string;
  limit?: number;
};

/**
 * Loads recent audit-center events into parameter-admin state.
 * Fail-closed: on error, clears the projection so UI does not show stale local fiction.
 */
export async function refreshParameterAdminRecentAudits(
  deps: RefreshParameterAdminRecentAuditsDeps
): Promise<void> {
  const { dispatch, listAuditEvents, projectId, limit = 8 } = deps;
  try {
    const response = await listAuditEvents({
      apps: [...PARAMETER_ADMIN_AUDIT_APPS],
      limit,
      ...(projectId ? { projectId } : {})
    });
    dispatch({
      type: "SET_RECENT_AUDIT_EVENTS",
      events: response.items.map(mapAuditDtoToRecentEvent)
    });
  } catch {
    dispatch({ type: "CLEAR_RECENT_AUDIT_EVENTS" });
  }
}
