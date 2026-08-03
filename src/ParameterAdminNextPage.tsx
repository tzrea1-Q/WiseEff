import { useEffect, useMemo, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import {
  buildParameterAdminOrganizationPath,
  isParameterAdminOrganizationEntryPath,
  parseParameterAdminOrganizationPath,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import { migrateLegacyRoleId } from "@/domain/users/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project, PrototypeState } from "@/mockData";
import { OrganizationBulkImportPanel } from "@/components/parameter-admin-next/OrganizationBulkImportPanel";
import { OrganizationIdentityMappingPanel } from "@/components/parameter-admin-next/OrganizationIdentityMappingPanel";
import { OrganizationModuleGovernancePanel } from "@/components/parameter-admin-next/OrganizationModuleGovernancePanel";
import { OrganizationSpecGovernancePanel } from "@/components/parameter-admin-next/OrganizationSpecGovernancePanel";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { ParameterAdminOrganizationSubNav } from "@/components/parameter-admin-next/ParameterAdminOrganizationSubNav";
import { ParameterAdminProvider } from "@/components/parameter-admin-next/ParameterAdminProvider";
import { ProjectsOperationsPanel } from "@/components/parameter-admin-next/ProjectsOperationsPanel";

function buildParameterAuditCenterPath(projectId: string) {
  const params = new URLSearchParams({ app: "parameter" });
  if (projectId) {
    params.set("projectId", projectId);
  }
  return `/audit?${params.toString()}`;
}

function normalizeSearch(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

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
 * Organization sub-routes: specs, spec-review, modules, identity-mapping.
 * Project routes: `/parameter-admin/projects` and deep views.
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
  const parsedOrganizationView =
    area === "organization" ? parseParameterAdminOrganizationPath(pathname) : null;
  const organizationView: ParameterAdminOrganizationView | null =
    area !== "organization"
      ? null
      : parsedOrganizationView ??
        (isParameterAdminOrganizationEntryPath(pathname) ? "specs" : null);
  const isPlatformSuperAdmin = migrateLegacyRoleId(state?.activeRoleId ?? "") === "platform-admin";

  useEffect(() => {
    if (area !== "organization") {
      return;
    }
    const raw = normalizeSearch(search);
    if (raw.includes("audit=open")) {
      onNavigate(buildParameterAuditCenterPath(activeProjectId));
      return;
    }
    if (isParameterAdminOrganizationEntryPath(pathname)) {
      onNavigate(buildParameterAdminOrganizationPath("specs", raw));
    }
  }, [area, search, pathname, activeProjectId, onNavigate]);

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
          state && dispatch ? (
            <ProjectsOperationsPanel
              pathname={pathname}
              search={search}
              onNavigate={onNavigate}
              state={state}
              dispatch={dispatch}
              parameterActions={parameterActions}
              runtimeMode={runtimeMode}
              onNewProject={onNewProject}
              parameterFileRepository={parameterFileRepository}
              dtsStructuredRepository={dtsStructuredRepository}
            />
          ) : (
            <section className="param-admin-main" aria-label="项目运营">
              <p className="project-admin-error" role="alert">
                项目运营需要完整的应用状态。请从主导航进入参数后台。
              </p>
            </section>
          )
        ) : organizationView ? (
          <>
            <ParameterAdminOrganizationSubNav active={organizationView} onNavigate={onNavigate} />
            <OrganizationBulkImportPanel
              projects={projects}
              parameters={parameters}
              activeProjectId={activeProjectId || projects[0]?.id || ""}
              dispatch={dispatch ?? (() => undefined)}
              onNavigate={onNavigate}
              parameterActions={parameterActions}
              runtimeMode={runtimeMode}
            />
            {organizationView === "specs" ? (
              <OrganizationSpecGovernancePanel
                search={search}
                pathname={pathname}
                focus="library"
                isPlatformSuperAdmin={isPlatformSuperAdmin}
              />
            ) : null}
            {organizationView === "spec-review" ? (
              <OrganizationSpecGovernancePanel
                search={search}
                pathname={pathname}
                focus="review"
              />
            ) : null}
            {organizationView === "modules" ? (
              <OrganizationModuleGovernancePanel
                pathname={pathname}
                search={search}
                onNavigate={onNavigate}
              />
            ) : null}
            {organizationView === "identity-mapping" ? <OrganizationIdentityMappingPanel /> : null}
          </>
        ) : null}
      </div>
    </ParameterAdminProvider>
  );
}
