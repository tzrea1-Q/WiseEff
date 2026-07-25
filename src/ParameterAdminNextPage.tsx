import { useMemo, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project, PrototypeState } from "@/mockData";
import { OrganizationBulkImportPanel } from "@/components/parameter-admin-next/OrganizationBulkImportPanel";
import { OrganizationIdentityMappingPanel } from "@/components/parameter-admin-next/OrganizationIdentityMappingPanel";
import { OrganizationModuleGovernancePanel } from "@/components/parameter-admin-next/OrganizationModuleGovernancePanel";
import { OrganizationSpecGovernancePanel } from "@/components/parameter-admin-next/OrganizationSpecGovernancePanel";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { ParameterAdminProvider } from "@/components/parameter-admin-next/ParameterAdminProvider";
import { ProjectsOperationsPanel } from "@/components/parameter-admin-next/ProjectsOperationsPanel";

export type ParameterAdminNextPageProps = {
  area: "organization" | "projects";
  onNavigate: (path: string) => void;
  search: string;
  /** Full location pathname so project-scoped deep links survive reload. */
  pathname?: string;
  runtimeMode?: WiseEffRuntimeMode;
  /** Injected at the port seam for tests; production resolves from runtime mode. */
  parameterTopologyRepository?: ParameterTopologyRepository;
  parameterModuleRegistryRepository?: ParameterModuleRegistryRepository;
  parameterFileRepository?: ParameterFileRepository;
  dtsStructuredRepository?: DtsStructuredRepository;
  projects?: Project[];
  parameters?: ParameterRecord[];
  activeProjectId?: string;
  dispatch?: Dispatch<AppAction>;
  parameterActions?: ParameterPageActions;
  state?: PrototypeState;
  onNewProject?: () => void;
};

/**
 * Redesigned parameter admin organized by governance scope (ADR-0001).
 * Canonical routes: `/parameter-admin` (organization) and `/parameter-admin/projects` (project operations).
 */
export function ParameterAdminNextPage({
  area,
  onNavigate,
  search,
  pathname: pathnameProp,
  runtimeMode = "mock",
  parameterTopologyRepository,
  parameterModuleRegistryRepository,
  parameterFileRepository,
  dtsStructuredRepository,
  projects = [],
  parameters = [],
  activeProjectId = "",
  dispatch,
  parameterActions,
  state,
  onNewProject
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
  const fileRepository = useMemo(
    () => parameterFileRepository,
    [parameterFileRepository]
  );
  const dtsRepository = useMemo(
    () => dtsStructuredRepository,
    [dtsStructuredRepository]
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
  const pathname =
    pathnameProp ??
    (area === "projects" ? "/parameter-admin/projects" : "/parameter-admin");

  return (
    <ParameterAdminProvider
      topology={topology}
      moduleRegistry={moduleRegistry}
      importActions={importActions}
      dtsStructured={dtsRepository}
      parameterFiles={fileRepository}
    >
      <div className="param-admin-shell">
        <ParameterAdminNextScopeNav active={area} onNavigate={onNavigate} />
        {area === "projects" ? (
          <ProjectsOperationsPanel
            pathname={pathname}
            search={search}
            onNavigate={onNavigate}
            state={state ?? ({ configDraft: { projects }, parameters, activeProjectId, activeRoleId: "admin" } as PrototypeState)}
            dispatch={dispatch ?? (() => undefined)}
            parameterActions={parameterActions}
            runtimeMode={runtimeMode}
            onNewProject={onNewProject}
            parameterFileRepository={parameterFileRepository}
            dtsStructuredRepository={dtsStructuredRepository}
          />
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
