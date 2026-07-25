import { useCallback, useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { DeleteProjectDialog } from "@/components/admin/DeleteProjectDialog";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { ProjectParameterFilesPanel } from "@/components/admin/ProjectParameterFilesPanel";
import { DtsSearchPanel } from "@/components/parameters/DtsSearchPanel";
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
import { auditKindLabel } from "@/application/parameters/parameterAdminState";
import { useParameterAdmin } from "./ParameterAdminProvider";

const DEFAULT_SEARCH: ParamAdminProjectsSearch = {
  q: "",
  status: "all",
  sort: "name-asc"
};

export function parseParameterAdminNextProjectPath(pathname: string): {
  projectId: string | null;
  filesView: boolean;
} {
  const match = pathname.match(/^\/parameter-admin-next\/projects\/([^/]+)(?:\/(files))?\/?$/);
  if (!match) {
    return { projectId: null, filesView: false };
  }
  return { projectId: decodeURIComponent(match[1]!), filesView: match[2] === "files" || !match[2] };
}

function parseListSearch(search: string): ParamAdminProjectsSearch {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "all",
    sort: params.get("sort") ?? "name-asc"
  };
}

function buildListSearch(patch: Partial<ParamAdminProjectsSearch>, current: ParamAdminProjectsSearch): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q.trim()) params.set("q", next.q.trim());
  if (next.status !== "all") params.set("status", next.status);
  if (next.sort !== "name-asc") params.set("sort", next.sort);
  return params.toString();
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
};

/**
 * Project-scoped list + parameter files (route-addressable). Replaces the #190 stub.
 * Config sets / baselines / structure browsing land in later tickets.
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
  const { dispatch: adminDispatch, state: adminState } = useParameterAdmin();
  const { projectId, filesView } = parseParameterAdminNextProjectPath(pathname);
  const isApiMode = runtimeMode === "api";
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const latestAudit = adminState.auditHints[0] ?? null;
  const fileRepository = useMemo(
    () => parameterFileRepository ?? resolveParameterFileRepository(runtimeMode),
    [parameterFileRepository, runtimeMode]
  );
  const dtsRepo = useMemo(
    () => dtsStructuredRepository ?? resolveDtsStructuredRepository(runtimeMode),
    [dtsStructuredRepository, runtimeMode]
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

  const updateListSearch = useCallback(
    (patch: Partial<ParamAdminProjectsSearch>) => {
      const query = buildListSearch(patch, listSearch);
      onNavigate(`/parameter-admin-next/projects${query ? `?${query}` : ""}`);
    },
    [listSearch, onNavigate]
  );

  const pushAudit = useCallback(
    (kind: "project-updated" | "project-deleted", summary: string, reason = "") => {
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
          onNavigate("/parameter-admin-next/projects");
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
      onNavigate("/parameter-admin-next/projects");
    }
  };

  if (projectId && filesView) {
    return (
      <section className="param-admin-main" aria-label="项目参数文件">
        <div className="parameters-table-heading">
          <div>
            <button
              type="button"
              className="button subtle"
              onClick={() => onNavigate("/parameter-admin-next/projects")}
            >
              ← 返回项目列表
            </button>
            <h2>参数文件 · {selectedProject?.name ?? projectId}</h2>
            <p>上传文件、浏览不可变版本历史，并触发手动同步。页面可通过 URL 深链与刷新保持。</p>
          </div>
        </div>
        <DtsSearchPanel projectId={projectId} repository={dtsRepo} />
        <ProjectParameterFilesPanel projectId={projectId} repository={fileRepository} />
      </section>
    );
  }

  return (
    <section className="param-admin-main project-admin-layout" aria-label="项目运营">
      <div className="parameters-table-heading">
        <div>
          <h2>项目运营</h2>
          <p>项目清单与参数文件入口。打开某项目后，文件视图可通过 URL 分享与刷新保持。</p>
        </div>
      </div>
      {latestAudit ? (
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
        onManageFiles={(id) => onNavigate(`/parameter-admin-next/projects/${encodeURIComponent(id)}/files`)}
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
