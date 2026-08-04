import { useCallback, useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
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
import {
  ProjectOperationsDialog,
  type ParameterAdminNextProjectView,
  type ProjectOperationsDialogViewMeta
} from "@/components/admin/ProjectOperationsDialog";
import { ProjectParameterFilesPanel } from "@/components/admin/ProjectParameterFilesPanel";
import { DtsSearchPanel } from "@/components/parameters/DtsSearchPanel";
import { DtsStructureBrowserPanel } from "@/components/parameters/DtsStructureBrowserPanel";
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
import {
  auditKindLabel,
  type ParameterAdminAuditHint
} from "@/application/parameters/parameterAdminState";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type { ParameterAdminNextProjectView } from "@/components/admin/ProjectOperationsDialog";

export function parseParameterAdminNextProjectPath(pathname: string): {
  projectId: string | null;
  view: ParameterAdminNextProjectView | null;
} {
  const match = pathname.match(
    /^\/parameter-admin\/projects\/([^/]+)(?:\/(files|config-sets|structure|conflicts))?\/?$/
  );
  if (!match) {
    return { projectId: null, view: null };
  }
  const view = (match[2] as ParameterAdminNextProjectView | undefined) ?? "files";
  return { projectId: decodeURIComponent(match[1]!), view };
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

const PROJECT_VIEW_META: Record<ParameterAdminNextProjectView, ProjectOperationsDialogViewMeta> = {
  files: {
    label: "参数文件",
    titlePrefix: "参数文件",
    subtitle:
      "先维护参数文件与版本，再按需做结构化检索。树形浏览请用「结构浏览」；本页检索跨已解析文件快速定位节点。",
    regionLabel: "项目参数文件"
  },
  "config-sets": {
    label: "配置集 / 基线",
    titlePrefix: "配置集 / 基线",
    subtitle: "调整配置集成员、校验修订门禁，并完成基线对比 / 回滚 / 发布。页面可通过 URL 深链与刷新保持。",
    regionLabel: "项目配置集与基线"
  },
  structure: {
    label: "结构浏览",
    titlePrefix: "结构浏览",
    subtitle: "浏览项目源 DTS 结构树。页面可通过 URL 深链与刷新保持。",
    regionLabel: "项目源结构"
  },
  conflicts: {
    label: "冲突裁决",
    titlePrefix: "冲突裁决",
    subtitle: "裁决文件值与界面草稿冲突。页面可通过 URL 深链与刷新保持。",
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
};

/**
 * Project list plus deep-linkable project operations (files, config sets, structure,
 * conflicts) presented as a modal over the list so the URL remains shareable.
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
  const { dispatch: adminDispatch, state: adminState, application } = useParameterAdmin();
  const { projectId, view } = parseParameterAdminNextProjectPath(pathname);
  const isApiMode = runtimeMode === "api";
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const latestAudit = adminState.auditHints[0] ?? null;
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
    }
  }, [adminClient, isApiMode]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    adminDispatch({ type: "SET_SELECTED_PROJECT", projectId: projectId });
  }, [adminDispatch, projectId]);

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

  const pushAudit = useCallback(
    (kind: ParameterAdminAuditHint["kind"], summary: string, reason = "") => {
      adminDispatch({
        type: "PUSH_AUDIT_HINT",
        hint: {
          kind,
          summary,
          reason,
          recordedAt: new Date().toISOString()
        }
      });
    },
    [adminDispatch]
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
        pushAudit("project-updated", `已更新项目「${input.name}」`);
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
    pushAudit("project-updated", `已更新项目「${input.name}」`);
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
        pushAudit("project-deleted", `已删除项目「${deleteTarget.name}」`);
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
    pushAudit("project-deleted", `已删除项目「${deleteTarget.name}」`);
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
  const projectName = selectedProject?.name ?? projectId ?? "";

  const closeOperations = useCallback(() => {
    onNavigate("/parameter-admin/projects");
  }, [onNavigate]);

  const handleOpenConflictCountChange = useCallback(
    (count: number) => {
      adminDispatch({ type: "SET_QUEUE_COUNTS", counts: { fileConflicts: count } });
    },
    [adminDispatch]
  );

  const handleConflictResolved = useCallback(
    ({ parameterName, resolution }: { parameterName: string; resolution: "file" | "ui" }) => {
      pushAudit(
        "file-conflict-resolved",
        `已裁决「${parameterName}」为${resolution === "file" ? "文件值" : "界面值"}`
      );
    },
    [pushAudit]
  );

  return (
    <section className="param-admin-main project-admin-layout" aria-label="项目运营">
      {!operationsOpen && latestAudit ? (
        <p className="form-hint" role="status" aria-label="治理审计">
          治理审计已记录：{auditKindLabel(latestAudit.kind)} — {latestAudit.summary}
          <span className="sr-only"> {latestAudit.kind}</span>
        </p>
      ) : null}
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
          onNavigate(`/parameter-admin/projects/${encodeURIComponent(id)}/files`)
        }
      />

      {operationsOpen && projectId && view && viewMeta ? (
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
          latestAuditHint={
            latestAudit ? (
              <p className="form-hint project-parameter-files-dialog-audit" role="status" aria-label="治理审计">
                治理审计已记录：{auditKindLabel(latestAudit.kind)} — {latestAudit.summary}
                <span className="sr-only"> {latestAudit.kind}</span>
              </p>
            ) : null
          }
        >
          {view === "files" ? (
            <>
              <ProjectParameterFilesPanel projectId={projectId} repository={fileRepository} />
              <div className="param-admin-panel">
                <DtsSearchPanel projectId={projectId} repository={dtsRepo} />
              </div>
            </>
          ) : null}
          {view === "config-sets" ? (
            <ConfigSetBaselinePanel
              projectId={projectId}
              repository={dtsRepo}
              canAdmin
              availableFiles={availableFiles}
              revisionId={adminState.selectedConfigRevisionId ?? "revision-teaching-1"}
              validateRevision={(pid, revision) => application.validateRevision(pid, revision)}
              onAudit={(event) => pushAudit(event.kind, event.summary)}
            />
          ) : null}
          {view === "structure" ? (
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
                canEdit
                canEditCritical
              />
            ) : (
              <p className="form-hint" role="status">
                当前项目没有可浏览的结构化 DTS 文件。请先在「参数文件」中上传带当前版本的 DTS。
              </p>
            )
          ) : null}
          {view === "conflicts" ? (
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
        </ProjectOperationsDialog>
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
