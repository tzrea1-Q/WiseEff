import { useMemo } from "react";
import type { Project } from "@/domain/prototype/types";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type {
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { ParameterModuleMappingPanel } from "@/components/parameter-topology/ParameterModuleMappingPanel";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import type { ApiClient } from "@/infrastructure/http/apiClient";

/**
 * Organization-scoped module tree + driver mapping, composed over the admin facade.
 */
export function OrganizationModuleGovernancePanel({
  currentPersonId,
  apiClient,
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate,
  catalog,
  governance,
  organizationId,
  actor = "user",
  sessionPermissions,
  canonicalEnabled = false,
  projects = []
}: {
  currentPersonId?: string;
  apiClient?: ApiClient;
  pathname?: string;
  search?: string;
  onNavigate?: (path: string, options?: { replace?: boolean }) => void;
  catalog?: ParameterCatalogRepository | null;
  governance?: ParameterCatalogGovernanceRepository | null;
  organizationId?: string;
  actor?: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  canonicalEnabled?: boolean;
  projects?: readonly Project[];
}) {
  const { application } = useParameterAdmin();
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits(apiClient);
  const canManageTaxonomy = !canonicalEnabled || (actor !== "agent" && Boolean(sessionPermissions?.includes("admin:access")));

  const repository = useMemo((): ParameterModuleRegistryRepository => {
    const base = application.asModuleRegistryRepository();
    return {
      getRegistry: () => base.getRegistry(),
      async createModule(input: CreateParameterModuleInput) {
        const next = await base.createModule(input);
        await refreshRecentAudits();
        return next;
      },
      async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
        const next = await base.updateModule(moduleId, input);
        if (
          input.name !== undefined ||
          input.parentId !== undefined ||
          input.description !== undefined ||
          input.scope !== undefined ||
          input.importance !== undefined
        ) {
          await refreshRecentAudits();
        }
        return next;
      },
      async deleteModule(moduleId: string) {
        const next = await base.deleteModule(moduleId);
        await refreshRecentAudits();
        return next;
      },
      listDriverRegistry: () => base.listDriverRegistry(),
    };
  }, [application, refreshRecentAudits]);

  return (
    <ParameterModuleMappingPanel
      currentPersonId={currentPersonId}
      projects={projects}
      canAdmin={!canonicalEnabled || actor === "org-admin" || actor === "platform-admin"}
      canManageTaxonomy={canManageTaxonomy}
      repository={repository}
      pathname={pathname}
      search={search}
      onNavigate={onNavigate}
      canonicalCatalog={canonicalEnabled ? catalog ?? undefined : undefined}
      canonicalGovernance={canonicalEnabled ? governance ?? undefined : undefined}
      canonicalOrganizationId={canonicalEnabled ? organizationId : undefined}
      canonicalActor={actor}
      canonicalSessionPermissions={sessionPermissions}
      canonicalEnabled={canonicalEnabled}
    />
  );
}
