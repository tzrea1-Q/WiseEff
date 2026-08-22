import { useCallback, useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/application/state/appState";
import { canPerform } from "@/app/permissions";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { resolveAuditQuery } from "@/application/parameters/auditQueryRuntime";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { presentError } from "@/infrastructure/http/presentError";
import { DeleteProjectDialog } from "@/components/admin/DeleteProjectDialog";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { ProjectConfigurationWorkbench } from "@/components/project-configuration-workbench/ProjectConfigurationWorkbench";
import { migrateLegacyRoleId } from "@/domain/users/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import type { PrototypeState } from "@/domain/prototype/types";
import {
  buildParameterAdminProjectsFromState,
  isEditableProjectStatus,
  mapProjectAdminSummaryDto,
  type EditableProjectStatus,
  type ParameterAdminProjectRow
} from "@/parameterAdminProjects";
import {
  buildParamAdminProjectsPath,
  parseParamAdminProjectsSearch,
  type ParamAdminProjectsSearch
} from "@/hooks/useParamAdminProjectsSearch";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import {
  buildCanonicalConfigurationPath,
  isLegacyProjectOperationView,
  type ParameterAdminNextProjectView
} from "./projectOperationsCutover";

export type { ParameterAdminNextProjectView } from "./projectOperationsCutover";

export function parseParameterAdminNextProjectPath(pathname: string): {
  projectId: string | null;
  view: ParameterAdminNextProjectView | "configuration" | null;
} {
  const match = pathname.match(
    /^\/parameter-admin\/projects\/([^/]+)(?:\/(files|config-sets|structure|conflicts|configuration))?\/?$/
  );
  if (!match) {
    return { projectId: null, view: null };
  }
  const view = (match[2] as ParameterAdminNextProjectView | "configuration" | undefined) ?? "files";
  return { projectId: decodeURIComponent(match[1]!), view };
}

export type ProjectsOperationsPanelProps = {
  pathname: string;
  search: string;
  onNavigate: (path: string) => void;
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  parameterActions?: ParameterPageActions;
  runtimeMode?: WiseEffRuntimeMode;
  onNewProject?: () => void;
  parameterFileRepository?: ParameterFileRepository;
  dtsStructuredRepository?: DtsStructuredRepository;
  /** @deprecated Flag retired; workbench is always on. Prop kept for call-site compat. */
  configurationWorkbenchEnabled?: boolean;
};

/**
 * Project list and the canonical configuration workbench. Legacy four-view deep links
 * redirect to equivalent workbench contexts for one compatibility release (#240).
 */
export function ProjectsOperationsPanel({
  pathname,
  search,
  onNavigate,
  state,
  dispatch,
  parameterActions,
  runtimeMode = "mock",
  onNewProject,
  parameterFileRepository,
  dtsStructuredRepository
}: ProjectsOperationsPanelProps) {
  const { dispatch: adminDispatch, application } = useParameterAdmin();
  const { projectId, view: routeView } = parseParameterAdminNextProjectPath(pathname);
  const configurationRoute = routeView === "configuration";
  const legacyView = isLegacyProjectOperationView(routeView) ? routeView : null;
  const isApiMode = runtimeMode === "api";
  const canAdmin = canPerform(migrateLegacyRoleId(state.activeRoleId), "admin.access");
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits();

  const fileRepository = useMemo(
    () =>
      parameterFileRepository ??
      application.asParameterFileRepository() ??
      resolveParameterFileRepository(runtimeMode),
    [application, parameterFileRepository, runtimeMode]
  );
  const dtsRepo = useMemo(
    () =>
      dtsStructuredRepository ??
      application.asDtsStructuredRepository() ??
      resolveDtsStructuredRepository(runtimeMode),
    [application, dtsStructuredRepository, runtimeMode]
  );
  const topologyRepository = useMemo(
    () => ({
      listConfigRevisions: (projectId: string, configSetId: string) =>
        application.listConfigRevisions(projectId, configSetId),
      validateRevision: (projectId: string, revisionId: string) =>
        application.validateRevision(projectId, revisionId)
    }),
    [application]
  );
  const auditQuery = useMemo(() => resolveAuditQuery(runtimeMode), [runtimeMode]);

  const [apiRows, setApiRows] = useState<ParameterAdminProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const listSearch = useMemo(() => parseParamAdminProjectsSearch(search), [search]);

  const mockRows = useMemo(() => buildParameterAdminProjectsFromState(state), [state]);
  const rows = isApiMode ? apiRows : mockRows;
  const editingProject = rows.find((row) => row.id === editingProjectId) ?? null;
  const deleteTarget = rows.find((row) => row.id === deleteTargetId) ?? null;
  const selectedProject = projectId ? rows.find((row) => row.id === projectId) ?? null : null;

  const loadProjects = useCallback(async () => {
    if (!isApiMode) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const items = await adminClient.listProjects();
      setApiRows(items.map(mapProjectAdminSummaryDto));
    } catch (loadError) {
      setError(presentError(loadError, "项目列表加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
      setProjectsLoaded(true);
    }
  }, [adminClient, isApiMode]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!projectId || !legacyView) {
      return;
    }
    onNavigate(buildCanonicalConfigurationPath(projectId, legacyView, search));
  }, [legacyView, onNavigate, projectId, search]);

  useEffect(() => {
    adminDispatch({ type: "SET_SELECTED_PROJECT", projectId: projectId });
  }, [adminDispatch, projectId]);

  const updateListSearch = useCallback(
    (patch: Partial<ParamAdminProjectsSearch>) => {
      onNavigate(buildParamAdminProjectsPath({ ...listSearch, ...patch }));
    },
    [listSearch, onNavigate]
  );

  const submitForm = async (input: { name: string; code: string; status?: string }) => {
    if (!editingProject) {
      return;
    }
    if (isApiMode) {
      setFormPending(true);
      setFormError("");
      try {
        await adminClient.updateProject(editingProject.id, input);
        await parameterActions?.refresh();
        await loadProjects();
        await refreshRecentAudits();
        setEditingProjectId(null);
      } catch (submitError) {
        setFormError(presentError(submitError, "更新项目失败，请稍后重试。"));
      } finally {
        setFormPending(false);
      }
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT",
      projectId: editingProject.id,
      patch: {
        name: input.name,
        code: input.code,
        ...(isEditableProjectStatus(input.status ?? "")
          ? { status: input.status as EditableProjectStatus }
          : {})
      }
    });
    adminDispatch({
      type: "PREPEND_RECENT_AUDIT_EVENT",
      event: {
        id: `mock-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "project-updated",
        summary: `已更新项目 ${input.name}`,
        reason: "",
        recordedAt: new Date().toISOString()
      }
    });
    setEditingProjectId(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    if (isApiMode) {
      setDeletePending(true);
      setDeleteError("");
      try {
        await adminClient.deleteProject(deleteTarget.id);
        await parameterActions?.refresh();
        await loadProjects();
        await refreshRecentAudits();
        setDeleteTargetId(null);
        if (projectId === deleteTarget.id) {
          onNavigate("/parameter-admin/projects");
        }
      } catch (submitError) {
        setDeleteError(presentError(submitError, "删除项目失败，请稍后重试。"));
      } finally {
        setDeletePending(false);
      }
      return;
    }
    dispatch({ type: "DELETE_PARAMETER_ADMIN_PROJECT", projectId: deleteTarget.id });
    adminDispatch({
      type: "PREPEND_RECENT_AUDIT_EVENT",
      event: {
        id: `mock-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "project-deleted",
        summary: `已删除项目 ${deleteTarget.name}`,
        reason: "",
        recordedAt: new Date().toISOString()
      }
    });
    setDeleteTargetId(null);
    if (projectId === deleteTarget.id) {
      onNavigate("/parameter-admin/projects");
    }
  };

  const configurationOpen = Boolean(projectId && configurationRoute && !legacyView);
  const projectsReady = !isApiMode || projectsLoaded;
  const projectMissing = Boolean(projectId) && (configurationOpen || Boolean(legacyView)) && projectsReady && !selectedProject;

  return (
    <section
      className={
        configurationOpen
          ? "param-admin-main project-admin-layout project-admin-layout--configuration-workbench"
          : "param-admin-main project-admin-layout"
      }
      aria-label="项目运营"
    >
      {error ? (
        <p className="project-admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {deleteError ? (
        <p className="project-admin-error" role="alert">
          {deleteError}
        </p>
      ) : null}

      {projectMissing ? (
        <section className="project-operations-not-found param-admin-panel" aria-label="项目不存在">
          <h2>找不到这个项目</h2>
          <p>
            项目 <code>{projectId}</code> 不存在，或者已经被删除。也可能是链接里的项目编号被改过。
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => onNavigate("/parameter-admin/projects")}
          >
            返回项目清单
          </button>
        </section>
      ) : null}

      {!projectMissing && !configurationOpen && !legacyView ? (
        <>
          {loading && isApiMode ? <p className="project-admin-loading">项目列表加载中…</p> : null}
          <ProjectAdminTable
            rows={rows}
            search={listSearch}
            onUpdateSearch={updateListSearch}
            onCreateProject={() => onNewProject?.()}
            onEditProject={(id) => {
              setFormError("");
              setEditingProjectId(id);
            }}
            onDeleteProject={(id) => {
              setDeleteError("");
              setDeleteTargetId(id);
            }}
            onManageFiles={(id) =>
              onNavigate(`/parameter-admin/projects/${encodeURIComponent(id)}/configuration`)
            }
            primaryActionLabel="配置工作台"
          />
        </>
      ) : null}

      {configurationOpen && !projectMissing && selectedProject && projectId ? (
        <ProjectConfigurationWorkbench
          project={{
            id: selectedProject.id,
            name: selectedProject.name,
            code: selectedProject.code,
            statusLabel: selectedProject.statusLabel
          }}
          search={search}
          onNavigate={onNavigate}
          dtsRepository={dtsRepo}
          fileRepository={fileRepository}
          listAuditEvents={(params) => auditQuery.listAuditEvents(params)}
          currentUserId={state.currentUserId}
          canEdit
          canEditCritical
          canAdmin={canAdmin}
          topologyRepository={topologyRepository}
        />
      ) : null}

      <ProjectAdminFormDialog
        open={editingProjectId !== null}
        mode="edit"
        initialName={editingProject?.name}
        initialCode={editingProject?.code}
        initialProjectId={editingProject?.id}
        initialStatus={editingProject?.status}
        loading={formPending}
        error={formError}
        onClose={() => {
          if (!formPending) {
            setEditingProjectId(null);
            setFormError("");
          }
        }}
        onSubmit={submitForm}
      />

      <DeleteProjectDialog
        loading={deletePending}
        open={deleteTarget !== null}
        projectCode={deleteTarget?.code ?? ""}
        projectName={deleteTarget?.name ?? ""}
        parameterCount={deleteTarget?.parameterCount ?? 0}
        moduleCount={deleteTarget?.moduleCount ?? 0}
        onCancel={() => {
          if (!deletePending) {
            setDeleteTargetId(null);
            setDeleteError("");
          }
        }}
        onConfirm={() => {
          void confirmDelete();
        }}
      />
    </section>
  );
}
