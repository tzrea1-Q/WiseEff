import { useCallback, useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import { canPerform } from "@/app/permissions";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { ConfigSetBaselinePanel } from "@/components/admin/ConfigSetBaselinePanel";
import { DeleteProjectDialog } from "@/components/admin/DeleteProjectDialog";
import { ParameterFileConflictPanel } from "@/components/admin/ParameterFileConflictPanel";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  ProjectOperationsDialog,
  type ParameterAdminNextProjectView,
  type ProjectOperationsViewMeta
} from "@/components/admin/ProjectOperationsDialog";
import { ProjectParameterFilesPanel } from "@/components/admin/ProjectParameterFilesPanel";
import { DtsSearchPanel } from "@/components/parameters/DtsSearchPanel";
import { DtsStructureBrowserPanel } from "@/components/parameters/DtsStructureBrowserPanel";
import { ProjectConfigurationWorkbench } from "@/components/project-configuration-workbench/ProjectConfigurationWorkbench";
import { migrateLegacyRoleId } from "@/domain/users/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import type { PrototypeState } from "@/mockData";
import {
  buildParameterAdminProjectsFromState,
  isEditableProjectStatus,
  mapProjectAdminSummaryDto,
  type EditableProjectStatus,
  type ParameterAdminProjectRow
} from "@/parameterAdminProjects";
import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import {
  formatCsvQueryParam,
  parseCsvQueryParam
} from "@/application/parameters/parameterAdminUrl";
import { auditKindLabel } from "@/application/parameters/parameterAdminState";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";

export type { ParameterAdminNextProjectView } from "@/components/admin/ProjectOperationsDialog";

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

function formatAuditTime(recordedAt: string): string {
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) {
    return recordedAt;
  }
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function parseListSearch(search: string): ParamAdminProjectsSearch {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    q: params.get("q") ?? "",
    statuses: parseCsvQueryParam(params.get("status")),
    sort: params.get("sort") ?? "name-asc"
  };
}

function buildListSearch(patch: Partial<ParamAdminProjectsSearch>, current: ParamAdminProjectsSearch): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q.trim()) params.set("q", next.q.trim());
  const status = formatCsvQueryParam(next.statuses);
  if (status) params.set("status", status);
  if (next.sort !== "name-asc") params.set("sort", next.sort);
  return params.toString();
}

const PROJECT_VIEW_META: Record<ParameterAdminNextProjectView, ProjectOperationsViewMeta> = {
  files: {
    label: "参数文件",
    subtitle: "维护参数文件与版本，并在已解析的文件中检索节点。树形浏览请用「结构浏览」。",
    regionLabel: "项目参数文件"
  },
  "config-sets": {
    label: "配置集 / 基线",
    subtitle: "调整配置集成员，并完成基线对比、回滚与发布。",
    regionLabel: "项目配置集与基线"
  },
  structure: {
    label: "结构浏览",
    subtitle: "浏览项目源 DTS 结构树，查看并编辑节点属性。",
    regionLabel: "项目源结构"
  },
  conflicts: {
    label: "冲突裁决",
    subtitle: "裁决参数文件值与界面草稿之间的冲突。",
    regionLabel: "项目文件冲突"
  }
};

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
  configurationWorkbenchEnabled?: boolean;
};

/**
 * Project list and the deep-linked project operations dialog (files, config sets,
 * structure, conflicts). Routes own the address; the dialog owns the presentation over
 * the list. Leaving with unsubmitted structure drafts asks for confirmation first.
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
  dtsStructuredRepository,
  configurationWorkbenchEnabled = false
}: ProjectsOperationsPanelProps) {
  const { dispatch: adminDispatch, state: adminState, application } = useParameterAdmin();
  const { projectId, view: routeView } = parseParameterAdminNextProjectPath(pathname);
  const configurationRoute = routeView === "configuration";
  const configurationOpen = configurationRoute && configurationWorkbenchEnabled;
  const view = routeView === "configuration" ? null : routeView;
  const isApiMode = runtimeMode === "api";
  const canAdmin = canPerform(migrateLegacyRoleId(state.activeRoleId), "admin.access");
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const latestAudit = adminState.recentAuditEvents[0] ?? null;
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits();

  const recordMockAudit = useCallback(
    (input: { kind: string; summary: string; reason?: string }) => {
      adminDispatch({
        type: "PREPEND_RECENT_AUDIT_EVENT",
        event: {
          id: `mock-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: input.kind,
          summary: input.summary,
          reason: input.reason ?? "",
          recordedAt: new Date().toISOString()
        }
      });
    },
    [adminDispatch]
  );

  useEffect(() => {
    if (!isApiMode) {
      return;
    }
    void refreshRecentAudits(projectId ?? undefined);
  }, [isApiMode, projectId, refreshRecentAudits]);

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

  const [apiRows, setApiRows] = useState<ParameterAdminProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [availableFiles, setAvailableFiles] = useState<
    Array<{ id: string; fileName: string; format?: string; currentVersionId?: string }>
  >([]);
  const [projectFilesReady, setProjectFilesReady] = useState(false);
  const [structureDirty, setStructureDirty] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  /** A search hit the user asked to open in the structure browser. */
  const [structureFocus, setStructureFocus] = useState<{
    nodePath: string;
    propertyName?: string;
    token: number;
  } | null>(null);
  /**
   * Views the user has opened for the current project. Keeping them mounted is what
   * makes per-view state survive switching; resetting on project change stops one
   * project's drafts from being shown under another.
   */
  const [visitedViews, setVisitedViews] = useState<ParameterAdminNextProjectView[]>([]);
  const listSearch = useMemo(() => parseListSearch(search), [search]);

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
      setError(loadError instanceof Error ? loadError.message : "项目列表加载失败。");
    } finally {
      setLoading(false);
      setProjectsLoaded(true);
    }
  }, [adminClient, isApiMode]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (configurationRoute && !configurationWorkbenchEnabled && projectId) {
      onNavigate(`/parameter-admin/projects/${encodeURIComponent(projectId)}/files`);
    }
  }, [configurationRoute, configurationWorkbenchEnabled, onNavigate, projectId]);

  useEffect(() => {
    adminDispatch({ type: "SET_SELECTED_PROJECT", projectId: projectId });
  }, [adminDispatch, projectId]);

  useEffect(() => {
    setVisitedViews([]);
    setStructureDirty(false);
    setStructureFocus(null);
  }, [projectId]);

  useEffect(() => {
    if (!view) {
      return;
    }
    setVisitedViews((current) => (current.includes(view) ? current : [...current, view]));
  }, [view]);

  useEffect(() => {
    if (!projectId || (view !== "config-sets" && view !== "structure")) {
      setAvailableFiles([]);
      setProjectFilesReady(false);
      return;
    }
    let cancelled = false;
    setProjectFilesReady(false);
    void (async () => {
      try {
        const items = await fileRepository.listFiles(projectId);
        if (!cancelled) {
          setAvailableFiles(
            items.map((item) => ({
              id: item.id,
              fileName: item.fileName,
              format: item.format,
              currentVersionId: item.currentVersionId
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setAvailableFiles([]);
        }
      } finally {
        if (!cancelled) {
          setProjectFilesReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileRepository, projectId, view]);

  const structureFile =
    availableFiles.find((file) => file.format === "dts" && file.currentVersionId) ?? null;

  const updateListSearch = useCallback(
    (patch: Partial<ParamAdminProjectsSearch>) => {
      const query = buildListSearch(patch, listSearch);
      onNavigate(`/parameter-admin/projects${query ? `?${query}` : ""}`);
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
        setFormError(submitError instanceof Error ? submitError.message : "更新项目失败。");
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
    recordMockAudit({
      kind: "project-updated",
      summary: `已更新项目 ${input.name}`
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
        setDeleteError(submitError instanceof Error ? submitError.message : "删除项目失败。");
      } finally {
        setDeletePending(false);
      }
      return;
    }
    dispatch({ type: "DELETE_PARAMETER_ADMIN_PROJECT", projectId: deleteTarget.id });
    recordMockAudit({
      kind: "project-deleted",
      summary: `已删除项目 ${deleteTarget.name}`
    });
    setDeleteTargetId(null);
    if (projectId === deleteTarget.id) {
      onNavigate("/parameter-admin/projects");
    }
  };

  const projectBase = projectId
    ? `/parameter-admin/projects/${encodeURIComponent(projectId)}`
    : "/parameter-admin/projects";
  const operationsOpen = Boolean(projectId && view);
  const viewMeta = view ? PROJECT_VIEW_META[view] : null;
  // Never title the page with a raw project id; POD-C7 treats that as a missing state.
  const projectName = selectedProject?.name ?? "项目详情";
  /**
   * Only mock rows are available synchronously; in API mode the list has to come back
   * before an unknown id can be called unknown.
   */
  const projectsReady = !isApiMode || projectsLoaded;
  const projectMissing = (operationsOpen || configurationOpen) && projectsReady && !selectedProject;

  const closeOperations = useCallback(() => {
    if (structureDirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    onNavigate("/parameter-admin/projects");
  }, [onNavigate, structureDirty]);

  const dismissAudit = useCallback(() => {
    adminDispatch({ type: "CLEAR_RECENT_AUDIT_EVENTS" });
  }, [adminDispatch]);

  const auditNotice = latestAudit ? (
    <div
      className="project-operations-audit"
      role="status"
      aria-label="治理审计"
      data-audit-kind={latestAudit.kind}
    >
      <p>治理审计已记录：{latestAudit.summary || auditKindLabel(latestAudit.kind)}</p>
      <div className="project-operations-audit__meta">
        <time dateTime={latestAudit.recordedAt}>{formatAuditTime(latestAudit.recordedAt)}</time>
        <button
          type="button"
          className="button subtle project-operations-audit__dismiss"
          onClick={dismissAudit}
        >
          知道了
        </button>
      </div>
    </div>
  ) : null;

  const handleOpenConflictCountChange = useCallback(
    (count: number) => {
      adminDispatch({ type: "SET_QUEUE_COUNTS", counts: { fileConflicts: count } });
    },
    [adminDispatch]
  );

  const handleSelectSearchHit = useCallback(
    (hit: { nodePath: string; propertyName?: string }) => {
      setStructureFocus((current) => ({
        nodePath: hit.nodePath,
        ...(hit.propertyName ? { propertyName: hit.propertyName } : {}),
        token: (current?.token ?? 0) + 1
      }));
      onNavigate(`${projectBase}/structure`);
    },
    [onNavigate, projectBase]
  );

  const handleConflictResolved = useCallback(
    (input: { conflictId: string; resolution: "file" | "ui"; parameterName: string; reason: string }) => {
      if (isApiMode) {
        void refreshRecentAudits(projectId ?? undefined);
        return;
      }
      recordMockAudit({
        kind: "file-conflict-resolved",
        summary: `已裁决冲突 ${input.parameterName}`,
        reason: input.reason
      });
    },
    [isApiMode, projectId, recordMockAudit, refreshRecentAudits]
  );

  const handleBaselineAudit = useCallback(
    (event: { kind: string; summary: string }) => {
      if (isApiMode) {
        void refreshRecentAudits(projectId ?? undefined);
        return;
      }
      recordMockAudit({ kind: event.kind, summary: event.summary });
    },
    [isApiMode, projectId, recordMockAudit, refreshRecentAudits]
  );

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

      {!projectMissing && !configurationOpen ? (
        <>
          {!operationsOpen ? auditNotice : null}
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
              onNavigate(
                `/parameter-admin/projects/${encodeURIComponent(id)}/${
                  configurationWorkbenchEnabled ? "configuration" : "files"
                }`
              )
            }
            primaryActionLabel={configurationWorkbenchEnabled ? "配置工作台" : "管理文件"}
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
          canEdit
          canEditCritical
          canAdmin={canAdmin}
        />
      ) : null}

      {operationsOpen && !projectMissing && projectId && view && viewMeta ? (
        <ProjectOperationsDialog
          open
          projectId={projectId}
          projectName={projectName}
          view={view}
          viewMeta={viewMeta}
          viewMetaByView={PROJECT_VIEW_META}
          projectBase={projectBase}
          onNavigate={onNavigate}
          onClose={closeOperations}
          auditNotice={auditNotice}
        >
          {/*
            Views stay mounted once visited so filters, drafts and selections survive
            switching between them. Only the active one is in the accessibility tree.
          */}
          {visitedViews.map((item) => (
            <div
              key={item}
              role="region"
              aria-label={PROJECT_VIEW_META[item].regionLabel}
              hidden={item !== view}
              className="project-operations-view-slot"
            >
              {item === "files" ? (
                <>
                  <ProjectParameterFilesPanel projectId={projectId} repository={fileRepository} />
                  <div className="param-admin-panel">
                    <DtsSearchPanel
                      projectId={projectId}
                      repository={dtsRepo}
                      onSelectHit={handleSelectSearchHit}
                    />
                  </div>
                </>
              ) : null}
              {item === "config-sets" ? (
                <ConfigSetBaselinePanel
                  projectId={projectId}
                  repository={dtsRepo}
                  canAdmin={canAdmin}
                  availableFiles={availableFiles}
                  {...(adminState.selectedConfigRevisionId
                    ? { revisionId: adminState.selectedConfigRevisionId }
                    : {})}
                  validateRevision={(pid, revision) => application.validateRevision(pid, revision)}
                  onAudit={handleBaselineAudit}
                />
              ) : null}
              {item === "structure" ? (
                !projectFilesReady ? (
                  <p className="form-hint" role="status">
                    正在加载项目文件…
                  </p>
                ) : structureFile ? (
                  <DtsStructureBrowserPanel
                    projectId={projectId}
                    repository={dtsRepo}
                    fileId={structureFile.id}
                    versionId={structureFile.currentVersionId}
                    fileName={structureFile.fileName}
                    canEdit
                    canEditCritical
                    onDirtyChange={setStructureDirty}
                    {...(structureFocus ? { focusRequest: structureFocus } : {})}
                  />
                ) : (
                  <p className="form-hint" role="status">
                    当前项目没有可浏览的结构化 DTS 文件。请先在「参数文件」中上传带当前版本的 DTS。
                  </p>
                )
              ) : null}
              {item === "conflicts" ? (
                <ParameterFileConflictPanel
                  open
                  variant="embedded"
                  projectId={projectId}
                  repository={fileRepository}
                  onClose={() => onNavigate(`${projectBase}/files`)}
                  onOpenConflictCountChange={handleOpenConflictCountChange}
                  onResolved={handleConflictResolved}
                />
              ) : null}
            </div>
          ))}
        </ProjectOperationsDialog>
      ) : null}

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="离开项目"
        description={
          <p>
            结构浏览里还有未提交的属性修改。离开该项目会丢弃这些改动，需要重新编辑。
          </p>
        }
        confirmLabel="丢弃并离开"
        cancelLabel="留在本页"
        tone="danger"
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          setStructureDirty(false);
          onNavigate("/parameter-admin/projects");
        }}
      />

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
