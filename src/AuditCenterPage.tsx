import type { PageProps } from "@/app/routes";
import { AuditWorkspace } from "@/components/admin/AuditWorkspace";
import { useAuditSearch } from "@/hooks/useAuditSearch";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export function AuditCenterPage({ state, onNavigate, search, runtimeMode }: PageProps) {
  const isApiMode = (runtimeMode ?? wiseEffRuntimeMode) === "api";
  const { queryState, updateQuery } = useAuditSearch(search, onNavigate);

  return (
    <AuditWorkspace
      key={queryState.organizationId ?? "home"}
      mockEvents={state.auditEvents}
      isApiMode={isApiMode}
      query={queryState}
      onQueryChange={updateQuery}
      projects={state.configDraft.projects.map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code
      }))}
    />
  );
}
