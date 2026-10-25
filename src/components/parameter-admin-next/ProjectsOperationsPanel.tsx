import { useCallback, useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/application/state/appState";
import { canPerform } from "@/app/permissions";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { resolveAuditQuery } from "@/application/parameters/auditQueryRuntime";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { presentError } from "@/infrastructure/http/presentError";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { ProjectDeletionPreviewDialog } from "@/components/admin/ProjectDeletionPreviewDialog";
import { ProjectConfigurationWorkbench } from "@/components/project-configuration-workbench/ProjectConfigurationWorkbench";
import { ProjectReviewRolesPanel } from "./ProjectReviewRolesPanel";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import { migrateLegacyRoleId } from "@/domain/users/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import { createCanonicalBatchRollbackClient } from "@/infrastructure/http/canonicalBatchRollbackClient";
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
  resolveParamAdminProjectsReturnPath,
  type ParamAdminProjectsSearch
} from "@/hooks/useParamAdminProjectsSearch";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import {
  buildCanonicalConfigurationPath,
  isLegacyProjectOperationView,
  type ParameterAdminNextProjectView
} from "./projectOperationsCutover";

export type { ParameterAdminNextProjectView } from "./projectOperationsCutover";

export function parseParameterAdminNextProjectPath(pathname: string): {
  projectId: string | null;
  view: ParameterAdminNextProjectView | "configuration" | "review-roles" | null;
} {
  const match = pathname.match(
    /^\/parameter-admin\/projects\/([^/]+)(?:\/(files|config-sets|structure|conflicts|configuration|review-roles))?\/?$/
  );
  if (!match) {
    return { projectId: null, view: null };
  }
  const view = (match[2] as ParameterAdminNextProjectView | "configuration" | "review-roles" | undefined) ?? "files";
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
  apiClient?: ApiClient;
  onNewProject?: () => void;
  parameterFileRepository?: ParameterFileRepository;
  parameterCatalogRepository?: ParameterCatalogRepository;
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
  apiClient,
  onNewProject,
  parameterFileRepository,
  parameterCatalogRepository,
  dtsStructuredRepository
}: ProjectsOperationsPanelProps) {
  const { dispatch: adminDispatch, application } = useParameterAdmin();
  const { projectId, view: routeView } = parseParameterAdminNextProjectPath(pathname);
  const configurationRoute = routeView === "configuration";
  const legacyView = isLegacyProjectOperationView(routeView) ? routeView : null;
  const isApiMode = runtimeMode === "api";
  const canAdmin = canPerform(migrateLegacyRoleId(state.activeRoleId), "admin.access");
  const adminClient = useMemo(() => createParameterAdminClient(apiClient), [apiClient]);
  const governanceClient = useMemo(() => createUserGovernanceClient(apiClient), [apiClient]);
  const batchRollbackClient = useMemo(() => isApiMode ? createCanonicalBatchRollbackClient(apiClient) : undefined, [isApiMode, apiClient]);
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits(apiClient);

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
      getTopology: (...args: Parameters<typeof application.getTopology>) => application.getTopology(...args),
      listConfigRevisions: (projectId: string, configSetId: string) =>
        application.listConfigRevisions(projectId, configSetId),
      validateRevision: (projectId: string, revisionId: string) =>
        application.validateRevision(projectId, revisionId),
      listBindings: (projectId: string, revisionId: string) =>
        application.listBindings(projectId, revisionId),
      createBindingDraft: (
        projectId: string,
        bindingId: string,
        input: Parameters<typeof application.createBindingDraft>[2]
      ) => application.createBindingDraft(projectId, bindingId, input)
    }),
    [application]
  );
  const auditQuery = useMemo(() => resolveAuditQuery({ mode: runtimeMode, createHttp: () => createAuditClient(apiClient) }), [runtimeMode, apiClient]);

  const [apiRows, setApiRows] = useState<ParameterAdminProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; archive: boolean } | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [deletionPreviewProjectId, setDeletionPreviewProjectId] = useState<string | null>(null);
  const [deletions, setDeletions] = useState<import("@/domain/parameters/projectDeletionPreview").ProjectDeletionStatus[]>([]);
  const [cleanupError, setCleanupError] = useState("");
  const listSearch = useMemo(() => parseParamAdminProjectsSearch(search), [search]);
  const listReturnPath = resolveParamAdminProjectsReturnPath(search);
  const enterProject = (id: string, nextView: "configuration" | "review-roles") => {
    const listPath = buildParamAdminProjectsPath(listSearch);
    onNavigate(`/parameter-admin/projects/${encodeURIComponent(id)}/${nextView}${listPath === "/parameter-admin/projects" ? "" : `?returnTo=${encodeURIComponent(listPath)}`}`);
  };

  const mockRows = useMemo(() => buildParameterAdminProjectsFromState(state), [state]);
  const rows = isApiMode ? apiRows : mockRows;
  const projectIds = JSON.stringify(state.configDraft.projects.map((project) => project.id));
  const editingProject = rows.find((row) => row.id === editingProjectId) ?? null;
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
      setProjectsLoaded(true);
      if (canAdmin && adminClient.listProjectDeletions) {
        try { setDeletions(await adminClient.listProjectDeletions()); setCleanupError(""); }
        catch (cause) { setCleanupError(presentError(cause, "项目清理记录加载失败，请重试。")); }
      }
    } catch (loadError) {
      setError(presentError(loadError, "项目列表加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, [adminClient, isApiMode, canAdmin]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, projectIds]);

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
      onNavigate(buildParamAdminProjectsPath({ ...listSearch, ...patch, page: patch.page ?? 1 }));
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

  const confirmDelete = async (id: string) => {
    const deleteTarget = rows.find((row) => row.id === id);
    if (!deleteTarget) {
      return;
    }
    if (isApiMode) {
      await adminClient.deleteProject(deleteTarget.id);
      await parameterActions?.refresh();
      await loadProjects();
      await refreshRecentAudits();
      if (projectId === deleteTarget.id) {
        onNavigate("/parameter-admin/projects");
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
    if (projectId === deleteTarget.id) {
      onNavigate("/parameter-admin/projects");
    }
  };

  const archiveProject = async () => {
    if (!archiveTarget || archivePending) return;
    setArchivePending(true);
    setArchiveError("");
    try {
      await adminClient.updateProject(archiveTarget.id, { status: archiveTarget.archive ? "archived" : "initialized" });
      await parameterActions?.refresh();
      await loadProjects();
      await refreshRecentAudits();
      setArchiveTarget(null);
    } catch (failure) {
      setArchiveError(presentError(failure, "更新项目归档状态失败，请重试。"));
    } finally { setArchivePending(false); }
  };

  const configurationOpen = Boolean(projectId && configurationRoute && !legacyView);
  const reviewRolesOpen = Boolean(projectId && routeView === "review-roles");
  const projectsReady = !isApiMode || projectsLoaded;
  const projectMissing = Boolean(projectId) && (configurationOpen || Boolean(legacyView) || reviewRolesOpen) && projectsReady && !error && !selectedProject;

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
        <div className="project-admin-error" role="alert">
          <p>{error}</p>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void loadProjects()}>重试项目列表</Button>
        </div>
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

      {!projectMissing && !configurationOpen && !legacyView && !reviewRolesOpen && !error ? (
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
            onDeleteProject={confirmDelete}
            onPreviewDeletion={isApiMode && canAdmin ? setDeletionPreviewProjectId : undefined}
            onArchiveProject={isApiMode ? (id, archive) => {
              const row = rows.find((item) => item.id === id);
              if (row) { setArchiveError(""); setArchiveTarget({ id, name: row.name, archive }); }
            } : undefined}
            onConfigureReviewRoles={(id) => enterProject(id, "review-roles")}
            onManageFiles={(id) => enterProject(id, "configuration")}
            primaryActionLabel="配置工作台"
            detailDrawer={<ProjectAdminFormDialog
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
            />}
          />
        </>
      ) : null}

      {reviewRolesOpen && !projectMissing && selectedProject && projectId ? (
        <ProjectReviewRolesPanel
          userGovernanceClient={governanceClient}
          projectId={projectId}
          projectName={selectedProject.name}
          onBack={() => onNavigate(listReturnPath)}
          state={state}
        />
      ) : null}

      {configurationOpen && !projectMissing && selectedProject && projectId ? (
        <ProjectConfigurationWorkbench
          apiClient={apiClient}
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
          batchRollbackClient={batchRollbackClient}
          memberRemovalRepository={parameterCatalogRepository}
          apiMode={isApiMode}
          listAuditEvents={(params) => auditQuery.listAuditEvents(params)}
          currentUserId={state.currentUserId}
          canEdit
          canEditCritical
          canAdmin={canAdmin}
          topologyRepository={topologyRepository}
        />
      ) : null}

      {cleanupError ? <div role="alert">{cleanupError}<Button type="button" variant="outline" onClick={() => void loadProjects()}>重试清理记录</Button></div> : null}
      {canAdmin && deletions.length ? <section aria-label="项目清理记录"><h3>项目清理记录</h3>
        <ul>{deletions.map(item => <li key={item.projectId}>{item.projectId} · 数据库已清理 · {item.objects === "complete" ? "对象清理完成" : `对象待清理 ${item.pendingObjects} 个`}
          <Button type="button" variant="outline" onClick={() => setDeletionPreviewProjectId(item.projectId)}>查看清理状态 {item.projectId}</Button>
        </li>)}</ul></section> : null}
      {deletionPreviewProjectId ? <ProjectDeletionPreviewDialog key={deletionPreviewProjectId} projectId={deletionPreviewProjectId}
        loadPreview={adminClient.previewProjectDeletion} purgeProject={adminClient.purgeProject}
        initialStatus={deletions.find(item => item.projectId === deletionPreviewProjectId)} onDeleted={() => {
          void loadProjects();
          void Promise.all([parameterActions?.refresh(), refreshRecentAudits()]).catch(cause => {
            setError(presentError(cause, "项目已清理，工作区数据刷新失败，请重新加载。"));
          });
        }}
        onClose={() => setDeletionPreviewProjectId(null)} /> : null}
      {archiveTarget ? <ConfirmDialog open tone="primary" pending={archivePending} error={archiveError}
        title={`${archiveTarget.archive ? "归档项目" : "恢复项目"}「${archiveTarget.name}」`}
        description={archiveTarget.archive
          ? "归档后从默认清单收起，可在“已归档”筛选中查看或恢复。规范历史保留，归档不会锁定已有读写权限。"
          : "恢复后项目重新出现在默认清单中，继续显示其原有初始化进度。规范历史和现有访问权限保持不变。"}
        confirmLabel={archiveTarget.archive ? "确认归档" : "恢复项目"}
        onConfirm={() => void archiveProject()} onCancel={() => setArchiveTarget(null)} /> : null}
    </section>
  );
}
