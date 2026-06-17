import { useEffect, useMemo, useState } from "react";
import { AuditWorkspace } from "@/components/admin/AuditWorkspace";
import { isParameterAdminAuditApp } from "@/domain/audit/mapAuditEventView";
import type { AuditQueryState } from "@/hooks/useAuditEvents";
import type { AuditEvent } from "@/mockData";

export type ParameterAuditDialogProps = {
  mockEvents: AuditEvent[];
  projectId?: string;
  isApiMode: boolean;
  onClose: () => void;
  onNavigate?: (path: string) => void;
};

export function ParameterAuditDialog({
  mockEvents,
  projectId,
  isApiMode,
  onClose,
  onNavigate
}: ParameterAuditDialogProps) {
  const [query, setQuery] = useState<AuditQueryState>({
    appGroup: "parameter",
    severity: "all",
    search: "",
    projectId
  });

  useEffect(() => {
    setQuery((current) => ({ ...current, projectId }));
  }, [projectId]);

  const scopedMockEvents = useMemo(
    () => mockEvents.filter((event) => isParameterAdminAuditApp(event.app)),
    [mockEvents]
  );

  return (
    <AuditWorkspace
      mockEvents={scopedMockEvents}
      isApiMode={isApiMode}
      query={query}
      onQueryChange={(patch) => setQuery((current) => ({ ...current, ...patch }))}
      variant="dialog"
      eyebrow="参数管理后台"
      title="审计记录"
      description="查看参数库变更、导入批次、审阅合入与权限调整等操作证据。"
      footerActions={
        <button className="button subtle" type="button" onClick={onClose}>
          关闭
        </button>
      }
      onOpenAuditCenter={
        onNavigate
          ? () => {
              const params = new URLSearchParams();
              params.set("app", "parameter");
              if (projectId) {
                params.set("projectId", projectId);
              }
              onNavigate(`/audit?${params.toString()}`);
              onClose();
            }
          : undefined
      }
    />
  );
}
