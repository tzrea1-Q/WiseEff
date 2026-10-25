import { useCallback, useEffect, useMemo, type Dispatch, type ReactNode } from "react";
import type { AppRuntime } from "@/app/appRuntime";
import type { AppAction } from "@/application/state/appState";
import type { ParameterPageActions } from "@/app/routes";
import { catalogActorForSession } from "@/application/parameter-catalog";
import "./components/parameter-admin-next/parameter-admin.css";
import { CatalogOrganizationSurface } from "@/features/parameter-catalog-governance/CatalogOrganizationSurface";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { isProjectConfigurationWorkbenchPath } from "@/application/project-configuration/workbenchPath";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import {
  buildParameterAdminOrganizationPath,
  buildParameterAdminSpecsPath,
  isParameterAdminOrganizationEntryPath,
  parseParameterAdminOrganizationPath,
  parseParameterAdminSpecsSubView,
  resolveParameterAdminOrganizationRedirect,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import { migrateLegacyRoleId } from "@/domain/users/types";
import {
  projectConfigurationWorkbenchEnabled as defaultConfigurationWorkbenchEnabled,
  type WiseEffRuntimeMode
} from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project, PrototypeState } from "@/domain/prototype/types";
import { OrganizationBulkImportPanel } from "@/components/parameter-admin-next/OrganizationBulkImportPanel";
import { OrganizationModuleGovernancePanel } from "@/components/parameter-admin-next/OrganizationModuleGovernancePanel";
import { OrganizationSpecsArea } from "@/components/parameter-admin-next/OrganizationSpecsArea";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { ParameterAdminOrganizationSubNav } from "@/components/parameter-admin-next/ParameterAdminOrganizationSubNav";
import { ParameterAdminProvider } from "@/components/parameter-admin-next/ParameterAdminProvider";
import { ProjectsOperationsPanel } from "@/components/parameter-admin-next/ProjectsOperationsPanel";
import type { SpecRelatedKnowledgeSource } from "@/components/parameter-topology/ParameterSpecDetail";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";
import { createDtsStructuredClient } from "@/infrastructure/http/dtsStructuredClient";
import { SharedDtsiPage } from "@/features/shared-dtsi/SharedDtsiPage";

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
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
  search: string;
  /** Full location pathname so project-scoped deep links survive reload. */
  pathname?: string;
  runtimeMode?: WiseEffRuntimeMode;
  /** Injected at the port seam for tests; production resolves from runtime mode. */
  parameterTopologyRepository?: ParameterTopologyRepository;
  parameterModuleRegistryRepository?: ParameterModuleRegistryRepository;
  parameterFileRepository?: ParameterFileRepository;
  dtsStructuredRepository?: DtsStructuredRepository;
  configurationWorkbenchEnabled?: boolean;
  projects?: Project[];
  parameters?: ParameterRecord[];
  activeProjectId?: string;
  dispatch?: Dispatch<AppAction>;
  parameterActions?: ParameterPageActions;
  state?: PrototypeState;
  onNewProject?: () => void;
  /** Published knowledge referencing a definition (相关知识); absent without knowledge:view. */
  relatedKnowledge?: SpecRelatedKnowledgeSource;
  definitionRelatedKnowledge?: SpecRelatedKnowledgeSource;
  runtime?: AppRuntime;
  catalogOrganizationId?: string;
  sessionPermissions?: readonly string[] | null;
  sessionRoles?: readonly AuthContextDto["roles"][number][] | null;
  projectMemberships?: AuthContextDto["projectMemberships"];
};

/**
 * Redesigned parameter admin organized by governance scope (ADR-0001).
 * Organization peers (ADR-0015): specs (definition management) and modules.
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
  configurationWorkbenchEnabled = defaultConfigurationWorkbenchEnabled,
  projects = [],
  parameters = [],
  activeProjectId = "",
  dispatch,
  parameterActions,
  state,
  onNewProject,
  relatedKnowledge,
  definitionRelatedKnowledge,
  runtime,
  catalogOrganizationId,
  sessionPermissions,
  projectMemberships,
  sessionRoles
}: ParameterAdminNextPageProps) {
  const topology = useMemo(
    () => parameterTopologyRepository ?? resolveParameterTopologyRepository(runtimeMode),
    [parameterTopologyRepository, runtimeMode]
  );
  const moduleRegistry = useMemo(
    () =>
      parameterModuleRegistryRepository ?? (runtime?.parameterApiClient ? createHttpParameterModuleRegistryRepository(runtime.parameterApiClient) : resolveParameterModuleRegistryRepository(runtimeMode)),
    [parameterModuleRegistryRepository, runtime?.parameterApiClient, runtimeMode]
  );
  const fileRepository = useMemo(
    () => parameterFileRepository ?? runtime?.parameterFileRepository,
    [parameterFileRepository, runtime?.parameterFileRepository]
  );
  const dtsRepository = useMemo(
    () => dtsStructuredRepository ?? (runtime?.parameterApiClient ? createDtsStructuredClient(runtime.parameterApiClient) : undefined),
    [dtsStructuredRepository, runtime?.parameterApiClient]
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
  const handleCatalogAnchorChange = useCallback(
    (href: string, mode: "push" | "replace") => {
      const url = new URL(href, window.location.origin);
      if (parseParameterAdminSpecsSubView(pathname) === "identity-mapping") {
        url.pathname = buildParameterAdminSpecsPath("identity-mapping");
      }
      const current = new URLSearchParams(search);
      for (const queryKey of ["project", "projectId", "review", "organizationId"]) {
        const value = current.get(queryKey);
        if (value !== null) url.searchParams.set(queryKey, value);
      }
      const destination = `${url.pathname}${url.search}`;
      if (mode === "replace") {
        window.history.replaceState(null, "", destination);
      }
      onNavigate(destination);
    },
    [onNavigate, pathname, search]
  );
  const renderCatalogLibrary = (taskContent?: ReactNode) =>
    runtime?.parameterCatalogRepository && runtime.parameterCatalogGovernanceRepository ? (
      <CatalogOrganizationSurface
        taskContent={taskContent}
        catalog={runtime.parameterCatalogRepository}
        governance={runtime.parameterCatalogGovernanceRepository}
        actor={catalogActorForSession({
          roleId: migrateLegacyRoleId(state?.activeRoleId ?? "")
        })}
        sessionPermissions={sessionPermissions}
        sessionRoles={runtimeMode === "api" ? sessionRoles ?? null : sessionRoles}
        search={search}
        onAnchorChange={handleCatalogAnchorChange}
        organizationId={catalogOrganizationId}
        currentPersonId={state?.currentUserId ?? ""}
        onCreateSubject={() => onNavigate("/parameter-admin/modules?createSubject=1&returnTo=definitions")}
        projects={projects}
        moduleRegistry={moduleRegistry}
        relatedKnowledge={definitionRelatedKnowledge}
      />
    ) : taskContent;
  const isConfigurationWorkbenchRoute =
    area === "projects" &&
    isProjectConfigurationWorkbenchPath(pathname);

  useEffect(() => {
    if (area !== "organization") {
      return;
    }
    const raw = normalizeSearch(search);
    if (raw.includes("audit=open")) {
      onNavigate(buildParameterAuditCenterPath(activeProjectId));
      return;
    }
    const legacyRedirect = resolveParameterAdminOrganizationRedirect(pathname, raw);
    if (legacyRedirect) {
      onNavigate(legacyRedirect);
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
      relatedKnowledge={relatedKnowledge}
    >
      <div
        className={
          isConfigurationWorkbenchRoute
            ? "param-admin-shell param-admin-shell--configuration-workbench"
            : "param-admin-shell"
        }
      >
        {!isConfigurationWorkbenchRoute && (runtimeMode !== "api" || sessionPermissions === undefined || sessionPermissions?.includes("admin:access")) ? (
          <div className="param-admin-navigation">
            <ParameterAdminNextScopeNav active={area} onNavigate={onNavigate} />
            {organizationView ? <ParameterAdminOrganizationSubNav active={organizationView} onNavigate={onNavigate} /> : null}
          </div>
        ) : null}
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
              apiClient={runtime?.parameterApiClient}
              parameterCatalogRepository={runtime?.parameterCatalogRepository}
              onNewProject={onNewProject}
              parameterFileRepository={fileRepository}
              dtsStructuredRepository={dtsRepository}
              configurationWorkbenchEnabled={configurationWorkbenchEnabled}
              sessionPermissions={sessionPermissions}
              projectMemberships={projectMemberships}
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
            {organizationView === "sources" ? <SharedDtsiPage key={catalogOrganizationId ?? "home"} apiClient={runtime?.parameterApiClient}
              canCreateSubject={Boolean(sessionPermissions?.includes("catalog:author"))}
              canReviewSource={Boolean(sessionRoles?.some(role=>role.roleId==="platform-admin"&&role.projectId===null))}
              canProposeSource={Boolean(sessionRoles?.some(role=>role.roleId==="admin"&&role.projectId===null) && !sessionRoles?.some(role=>role.roleId==="platform-admin"&&role.projectId===null))}
              canWrite={Boolean(sessionPermissions?.includes("admin:access"))} organizationId={catalogOrganizationId} search={search} onNavigate={onNavigate} /> : null}
            {organizationView === "specs" ? <OrganizationBulkImportPanel
              apiClient={runtime?.parameterApiClient}
              projects={projects}
              parameters={parameters}
              activeProjectId={activeProjectId || projects[0]?.id || ""}
              dispatch={dispatch ?? (() => undefined)}
              onNavigate={onNavigate}
              parameterActions={parameterActions}
              runtimeMode={runtimeMode}
            /> : null}
            {organizationView === "specs" && runtimeMode === "api" ? (
              <OrganizationSpecsArea
                pathname={pathname}
                search={search}
                onNavigate={onNavigate}
                renderCatalogLibrary={renderCatalogLibrary}
              />
            ) : null}
            {organizationView === "specs" && runtimeMode === "mock" ? (
              <>
                {pathname.endsWith("/identity-mapping") ? (
                  <p role="status">Mock 模式不提供旧节点对应任务。请使用 API 模式的规范审核队列。</p>
                ) : null}
                {renderCatalogLibrary()}
              </>
            ) : null}
            {organizationView === "modules" ? (
              <OrganizationModuleGovernancePanel
                currentPersonId={state?.currentUserId ?? ""}
                apiClient={runtime?.parameterApiClient}
                projects={projects}
                pathname={pathname}
                search={search}
                onNavigate={onNavigate}
                catalog={runtime?.parameterCatalogRepository}
                governance={runtime?.parameterCatalogGovernanceRepository}
                organizationId={catalogOrganizationId}
                actor={catalogActorForSession({
                  roleId: runtimeMode === "api"
                    ? sessionRoles?.some((role) => role.roleId === "platform-admin" && role.projectId === null) ? "platform-admin"
                      : sessionRoles?.some((role) => role.roleId === "admin" && role.projectId === null) ? "admin" : ""
                    : migrateLegacyRoleId(state?.activeRoleId ?? "")
                })}
                sessionPermissions={sessionPermissions}
                canonicalEnabled={runtimeMode === "api"}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </ParameterAdminProvider>
  );
}
