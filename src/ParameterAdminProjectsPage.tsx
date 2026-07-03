import { useCallback, useEffect, useMemo, useState } from "react";
import type { PageProps } from "@/app/routes";
import { ParameterAdminSubNav } from "@/components/admin/ParameterAdminSubNav";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { ProjectAdminTable } from "@/components/admin/ProjectAdminTable";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { useParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import {
  buildParameterAdminProjectsFromState,
  isEditableProjectStatus,
  mapProjectAdminSummaryDto,
  summarizeParameterAdminProjects,
  type EditableProjectStatus,
  type ParameterAdminProjectRow
} from "@/parameterAdminProjects";

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
  const { search, updateSearch } = useParamAdminProjectsSearch();
  const [apiRows, setApiRows] = useState<ParameterAdminProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState("");

  const mockRows = useMemo(() => buildParameterAdminProjectsFromState(state), [state]);
  const rows = isApiMode ? apiRows : mockRows;
  const summary = useMemo(() => summarizeParameterAdminProjects(rows), [rows]);
  const editingProject = rows.find((row) => row.id === editingProjectId) ?? null;

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

  return (
    <div className="param-admin-shell project-admin-shell">
      <ParameterAdminSubNav active="projects" onNavigate={onNavigate} />
      <KpiStrip items={kpiItems} />
      {error ? (
        <p className="project-admin-error" role="alert">
          {error}
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
    </div>
  );
}
