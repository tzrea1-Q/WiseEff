import { useCallback } from "react";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { refreshParameterAdminRecentAudits } from "@/application/parameters/refreshParameterAdminRecentAudits";
import { useParameterAdmin } from "./ParameterAdminProvider";

/**
 * Refetches parameter-admin recent audit projection from the audit center.
 * Mock runtime has no audit API; skip the fetch so demos do not log a refused
 * connection to the default API base URL.
 */
export function useRefreshParameterAdminRecentAudits() {
  const { dispatch } = useParameterAdmin();

  return useCallback(
    async (projectId?: string) => {
      if (wiseEffRuntimeMode !== "api") {
        return;
      }
      await refreshParameterAdminRecentAudits({
        dispatch,
        listAuditEvents: (params) => createAuditClient().listAuditEvents(params),
        projectId
      });
    },
    [dispatch]
  );
}
