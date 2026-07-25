import { useMemo, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/mockData";
import { OrganizationBulkImportPanel } from "@/components/parameter-admin-next/OrganizationBulkImportPanel";
import { OrganizationIdentityMappingPanel } from "@/components/parameter-admin-next/OrganizationIdentityMappingPanel";
import { OrganizationModuleGovernancePanel } from "@/components/parameter-admin-next/OrganizationModuleGovernancePanel";
import { OrganizationSpecGovernancePanel } from "@/components/parameter-admin-next/OrganizationSpecGovernancePanel";
import { ParameterAdminNextProjectStub } from "@/components/parameter-admin-next/ParameterAdminNextProjectStub";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { ParameterAdminProvider } from "@/components/parameter-admin-next/ParameterAdminProvider";

export type ParameterAdminNextPageProps = {
  area: "organization" | "projects";
  onNavigate: (path: string) => void;
  search: string;
  runtimeMode?: WiseEffRuntimeMode;
  /** Injected at the port seam for tests; production resolves from runtime mode. */
  parameterTopologyRepository?: ParameterTopologyRepository;
  parameterModuleRegistryRepository?: ParameterModuleRegistryRepository;
  projects?: Project[];
  parameters?: ParameterRecord[];
  activeProjectId?: string;
  dispatch?: Dispatch<AppAction>;
  parameterActions?: ParameterPageActions;
};

/**
 * Temporary construction surface for the redesigned parameter admin (#190+).
 * Canonical `/parameter-admin` stays on the legacy tree until ticket 09.
 */
export function ParameterAdminNextPage({
  area,
  onNavigate,
  search,
  runtimeMode = "mock",
  parameterTopologyRepository,
  parameterModuleRegistryRepository,
  projects = [],
  parameters = [],
  activeProjectId = "",
  dispatch,
  parameterActions
}: ParameterAdminNextPageProps) {
  const topology = useMemo(
    () => parameterTopologyRepository ?? resolveParameterTopologyRepository(runtimeMode),
    [parameterTopologyRepository, runtimeMode]
  );
  const moduleRegistry = useMemo(
    () =>
      parameterModuleRegistryRepository ?? resolveParameterModuleRegistryRepository(runtimeMode),
    [parameterModuleRegistryRepository, runtimeMode]
  );
  const importActions = useMemo(() => {
    if (!parameterActions) {
      return undefined;
    }
    return {
      createImportPreview: parameterActions.createImportPreview.bind(parameterActions),
      applyImportBatch: parameterActions.applyImportBatch.bind(parameterActions),
      parseDtsImport: parameterActions.parseDtsImport.bind(parameterActions),
      refresh: parameterActions.refresh?.bind(parameterActions)
    };
  }, [parameterActions]);
  const pathname = area === "projects" ? "/parameter-admin-next/projects" : "/parameter-admin-next";

  return (
    <ParameterAdminProvider
      topology={topology}
      moduleRegistry={moduleRegistry}
      importActions={importActions}
    >
      <div className="param-admin-shell">
        <ParameterAdminNextScopeNav active={area} onNavigate={onNavigate} />
        {area === "projects" ? (
          <ParameterAdminNextProjectStub />
        ) : (
          <>
            <OrganizationBulkImportPanel
              projects={projects}
              parameters={parameters}
              activeProjectId={activeProjectId || projects[0]?.id || ""}
              dispatch={dispatch ?? (() => undefined)}
              onNavigate={onNavigate}
              parameterActions={parameterActions}
              runtimeMode={runtimeMode}
            />
            <OrganizationIdentityMappingPanel />
            <OrganizationModuleGovernancePanel />
            <OrganizationSpecGovernancePanel search={search} pathname={pathname} />
          </>
        )}
      </div>
    </ParameterAdminProvider>
  );
}
