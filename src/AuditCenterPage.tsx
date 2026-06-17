import type { PageProps } from "@/app/routes";
import { AuditWorkspace } from "@/components/admin/AuditWorkspace";
import { useAuditSearch } from "@/hooks/useAuditSearch";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export function AuditCenterPage({ state, onNavigate, search, runtimeMode }: PageProps) {
  const isApiMode = (runtimeMode ?? wiseEffRuntimeMode) === "api";
  const { queryState, updateQuery } = useAuditSearch(search, onNavigate);

  return (
    <AuditWorkspace
      mockEvents={state.auditEvents}
      isApiMode={isApiMode}
      query={queryState}
      onQueryChange={updateQuery}
      projects={state.configDraft.projects.map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code
      }))}
      variant="page"
      eyebrow="组织治理"
      title="审计中心"
      description="跨模块检索操作证据，支持按项目、模块、严重度与 trace 调查高风险变更。"
    />
  );
}
