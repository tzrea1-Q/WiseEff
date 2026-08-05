import { useCallback } from "react";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import { refreshParameterAdminRecentAudits } from "@/application/parameters/refreshParameterAdminRecentAudits";
import { useParameterAdmin } from "./ParameterAdminProvider";

/**
 * Refetches parameter-admin recent audit projection from the audit center.
 */
export function useRefreshParameterAdminRecentAudits() {
  const { dispatch } = useParameterAdmin();

  return useCallback(
    async (projectId?: string) => {
      await refreshParameterAdminRecentAudits({
        dispatch,
        listAuditEvents: (params) => createAuditClient().listAuditEvents(params),
        projectId
      });
    },
    [dispatch]
  );
}
