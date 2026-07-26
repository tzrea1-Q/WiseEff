import { auditKindLabel } from "@/application/parameters/parameterAdminState";
import { useParameterAdmin } from "./ParameterAdminProvider";

/** Surfaces the latest governance audit hint for organization sub-views. */
export function ParameterAdminAuditBanner() {
  const { state } = useParameterAdmin();
  const latestAudit = state.auditHints[0] ?? null;
  if (!latestAudit) {
    return null;
  }

  return (
    <p className="form-hint" role="status" aria-label="治理审计">
      治理审计已记录：{auditKindLabel(latestAudit.kind)} — {latestAudit.summary}
      {latestAudit.reason ? `（${latestAudit.reason}）` : ""}
      <span className="sr-only"> {latestAudit.kind}</span>
    </p>
  );
}
