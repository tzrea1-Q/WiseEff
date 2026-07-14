import { useCallback, useEffect, useMemo, useState } from "react";
import { canPerform } from "@/app/permissions";
import type { PageProps } from "@/app/routes";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { ConfigSetBaselinePanel } from "@/components/admin/ConfigSetBaselinePanel";
import { ParameterAdminSubNav } from "@/components/admin/ParameterAdminSubNav";
import { DeleteProjectDialog } from "@/components/admin/DeleteProjectDialog";
import { ProjectParameterFilesPanel } from "@/components/admin/ProjectParameterFilesPanel";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { DtsSearchPanel } from "@/components/parameters/DtsSearchPanel";
import { DtsStructureBrowserPanel } from "@/components/parameters/DtsStructureBrowserPanel";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { roleHasPermission } from "@/domain/users/types";
import { useParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import { createParameterFileClient } from "@/infrastructure/http/parameterFileClient";
import {
  buildParameterAdminProjectsFromState,
  isEditableProjectStatus,
  mapProjectAdminSummaryDto,
  summarizeParameterAdminProjects,
  type EditableProjectStatus,
  type ParameterAdminProjectRow
} from "@/parameterAdminProjects";

type ManageFilesTab = "files" | "config-sets" | "structure";

type AvailableParameterFile = { id: string; fileName: string };

export function ParameterAdminProjectsPage({
  state,
  dispatch,
  onNavigate,
  onNewProject,
  parameterActions,
  runtimeMode = "mock"
}: PageProps & { onNewProject?: () => void }) {
  const isApiMode = runtimeMode === "api";
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const parameterFileClient = useMemo(() => createParameterFileClient(), []);
  const dtsRepo = useMemo(() => resolveDtsStructuredRepository(runtimeMode), [runtimeMode]);
  const canAdmin = canPerform(state.activeRoleId, "admin.access");
  const canEditCritical = roleHasPermission(state.activeRoleId, "parameter:edit-critical");
  const { search, updateSearch } = useParamAdminProjectsSearch();
  const [apiRows, setApiRows] = useState<ParameterAdminProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [manageFilesProjectId, setManageFilesProjectId] = useState<string | null>(null);
  const [manageFilesTab, setManageFilesTab] = useState<ManageFilesTab>("files");
  const [availableFiles, setAvailableFiles] = useState<AvailableParameterFile[]>([]);
  const [formPending, setFormPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const mockRows = useMemo(() => buildParameterAdminProjectsFromState(state), [state]);
  const rows = isApiMode ? apiRows : mockRows;
  const summary = useMemo(() => summarizeParameterAdminProjects(rows), [rows]);
  const editingProject = rows.find((row) => row.id === editingProjectId) ?? null;
  const deleteTarget = rows.find((row) => row.id === deleteTargetId) ?? null;
  const manageFilesTarget = rows.find((row) => row.id === manageFilesProjectId) ?? null;

  const loadProjects = async () => {
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
  };

  useEffect(() => {
    void loadProjects();
  }, [isApiMode]);

  useEffect(() => {
    if (!manageFilesProjectId) {
      setAvailableFiles([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const items = await parameterFileClient.listFiles(manageFilesProjectId);
        if (!cancelled) {
          setAvailableFiles(items.map((item) => ({ id: item.id, fileName: item.fileName })));
        }
      } catch {
        if (!cancelled) {
          setAvailableFiles([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [manageFilesProjectId, parameterFileClient]);

  const kpiItems: KpiItem[] = [
    { id: "total", label: "项目总数", value: summary.total },
    {
      id: "initialized",
      label: "在研",
      value: summary.initialized,
      interactive: summary.initialized > 0,
      onClick: () => updateSearch({ status: "initialized" })
    },
    {
      id: "pending",
      label: "待审阅",
      value: summary.pendingReview,
      interactive: summary.pendingReview > 0,
      tone: summary.pendingReview > 0 ? "warning" : undefined,
      onClick: () => updateSearch({ status: "initialization_pending_review" })
    },
    { id: "modules", label: "模块合计", value: summary.moduleTotal }
  ];

  const openCreate = useCallback(() => {
    onNewProject?.();
  }, [onNewProject]);

  const openEdit = useCallback((projectId: string) => {
    setFormError("");
    setEditingProjectId(projectId);
  }, []);

  const openDelete = useCallback((projectId: string) => {
    if (!rows.some((row) => row.id === projectId)) {
      return;
    }
    setDeleteError("");
    setDeleteTargetId(projectId);
  }, [rows]);

  const openManageFiles = useCallback((projectId: string) => {
    if (!rows.some((row) => row.id === projectId)) {
      return;
    }
    setManageFilesTab("files");
    setManageFilesProjectId(projectId);
  }, [rows]);

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
        ...(isEditableProjectStatus(input.status ?? "") ? { status: input.status as EditableProjectStatus } : {})
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
        setDeleteTargetId(null);
      } catch (submitError) {
        setDeleteError(submitError instanceof Error ? submitError.message : "删除项目失败。");
      } finally {
        setDeletePending(false);
      }
      return;
    }

    dispatch({ type: "DELETE_PARAMETER_ADMIN_PROJECT", projectId: deleteTarget.id });
    setDeleteTargetId(null);
  };

  return (
    <div className="param-admin-shell project-admin-shell">
      <ParameterAdminSubNav active="projects" onNavigate={onNavigate} />
      <KpiStrip items={kpiItems} />
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
      <main className="param-admin-main project-admin-layout">
        <ProjectAdminTable
          rows={rows}
          search={search}
          onUpdateSearch={updateSearch}
          onCreateProject={openCreate}
          onEditProject={openEdit}
          onDeleteProject={openDelete}
          onManageFiles={openManageFiles}
        />
      </main>

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

      {manageFilesTarget ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-parameter-files-title"
          onClick={() => setManageFilesProjectId(null)}
        >
          <div className="submission-dialog project-parameter-files-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="submission-dialog-head">
              <div>
                <span className="eyebrow">项目文件</span>
                <h2 id="project-parameter-files-title">管理文件 · {manageFilesTarget.name}</h2>
                <p>在「参数文件」「配置集 / 基线」与「结构浏览」标签中维护该项目的文件、发布单元与结构化预览。</p>
              </div>
              <button type="button" className="button subtle" onClick={() => setManageFilesProjectId(null)}>
                关闭
              </button>
            </div>
            <div className="project-parameter-files-tabs" role="tablist" aria-label="项目详情标签">
              <button
                type="button"
                role="tab"
                aria-selected={manageFilesTab === "files"}
                className={`project-parameter-files-tab${manageFilesTab === "files" ? " is-active" : ""}`}
                onClick={() => setManageFilesTab("files")}
              >
                参数文件
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={manageFilesTab === "config-sets"}
                className={`project-parameter-files-tab${manageFilesTab === "config-sets" ? " is-active" : ""}`}
                onClick={() => setManageFilesTab("config-sets")}
              >
                配置集 / 基线
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={manageFilesTab === "structure"}
                className={`project-parameter-files-tab${manageFilesTab === "structure" ? " is-active" : ""}`}
                onClick={() => setManageFilesTab("structure")}
              >
                结构浏览
              </button>
            </div>
            <div className="project-parameter-files-dialog-body">
              {manageFilesTab === "files" ? (
                <>
                  <DtsSearchPanel projectId={manageFilesTarget.id} repository={dtsRepo} />
                  <ProjectParameterFilesPanel projectId={manageFilesTarget.id} runtimeMode={runtimeMode} />
                </>
              ) : null}
              {manageFilesTab === "config-sets" ? (
                <ConfigSetBaselinePanel
                  projectId={manageFilesTarget.id}
                  repository={dtsRepo}
                  canAdmin={canAdmin}
                  availableFiles={availableFiles}
                />
              ) : null}
              {manageFilesTab === "structure" ? (
                <DtsStructureBrowserPanel
                  projectId={manageFilesTarget.id}
                  repository={dtsRepo}
                  canEditCritical={canEditCritical}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
