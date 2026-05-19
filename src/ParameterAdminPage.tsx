import { FileText, History, Info, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppAction, ParameterEditorDraft, ParameterValueDraft } from "./App";
import type { PageProps } from "./app/routes";
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";
import { CreateParameterDialog } from "./components/CreateParameterDialog";
import { DeleteParameterDialog } from "./components/DeleteParameterDialog";
import { DirtyIndicator } from "./components/DirtyIndicator";
import { ExportDiffDialog, type ExportDiff } from "./components/ExportDiffDialog";
import { ExportMenu } from "./components/ExportMenu";
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { ParameterDefinitionForm } from "./components/ParameterDefinitionForm";
import { ParameterLibraryList } from "./components/ParameterLibraryList";
import { ProjectValueMatrix } from "./components/ProjectValueMatrix";
import { UndoableToast } from "./components/UndoableToast";
import { useTopBarActions } from "./components/layout";
import { useBeforeUnload } from "./hooks/useBeforeUnload";
import { useParamAdminSearch, type ParamAdminSearch } from "./hooks/useParamAdminSearch";
import { getCoverage, selectDirtyCount } from "./parameterAdminAnalytics";
import { serializePowerManagementConfig, type PowerManagementParameterTemplate } from "./powerManagementConfig";

export function ParameterAdminPage({ state, dispatch, onNavigate, search: rawSearch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.parameterLibrary[0]?.id ?? "");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExportMode, setPendingExportMode] = useState<"download" | "copy" | "preview" | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState("导出后可手动替换 src/config/power-management.json。");
  const [saving, setSaving] = useState(false);
  const urlSearch = useParamAdminSearch();
  const search = rawSearch ? parseParamAdminSearch(rawSearch) : urlSearch.search;
  const updateSearch = urlSearch.updateSearch;
  const selectedParameter =
    state.configDraft.parameterLibrary.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.parameterLibrary[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);
  const library = state.configDraft.parameterLibrary;
  const projects = state.configDraft.projects;
  const dirtyCount = selectDirtyCount(state);
  const exportDiff = useMemo(() => computeExportDiff(state.lastExportedSnapshot, library), [library, state.lastExportedSnapshot]);
  const highRiskCount = library.filter((parameter) => parameter.risk === "High").length;
  const orphanCount = library.filter((parameter) => getCoverage(parameter, projects) === "orphan").length;
  const highRiskOrphans = library.filter((parameter) => parameter.risk === "High" && getCoverage(parameter, projects) === "orphan");
  const todayChanges = state.auditEvents.filter((event) => isWithinHours(event.time, 24)).length;
  const lastImport = state.auditEvents.find((event) => event.kind === "batch-import");
  const insights: Insight[] =
    highRiskOrphans.length > 0
      ? [
          {
            id: "high-risk-orphans",
            tone: "warning",
            headline: `参数库里有 ${highRiskOrphans.length} 个高风险闲置参数，建议复核`,
            meta: `闲置合计 ${orphanCount} · 其中高风险 ${highRiskOrphans.length}`,
            actions: [
              { id: "view-orphans", label: "查看闲置参数", onClick: () => updateSearch({ coverage: "orphan" }) },
              {
                id: "draft-cleanup",
                label: "生成清理建议",
                onClick: () =>
                  dispatch({
                    type: "AGENT_ACTION_EXECUTED",
                    actionId: "draft-cleanup",
                    metadata: { orphanIds: highRiskOrphans.map((parameter) => parameter.id) }
                  })
              }
            ]
          }
        ]
      : [];

  useBeforeUnload(dirtyCount > 0, "有未导出的参数变更，确定离开吗？");

  const triggerExport = (mode: "download" | "copy") => {
    const timestamp = new Date().toISOString();
    const snapshotName = `power-management-${timestamp.replace(/[:.]/g, "").slice(0, 15)}.json`;
    if (mode === "download") {
      const blob = new Blob([configJson], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = snapshotName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } else {
      void navigator.clipboard?.writeText(configJson);
    }
    dispatch({ type: "MARK_EXPORTED", snapshotName, timestamp });
  };

  const openExportFlow = (mode: "download" | "copy" | "preview") => {
    if (mode === "preview" || dirtyCount > 0) {
      setPendingExportMode(mode);
      setExportDialogOpen(true);
      return;
    }
    triggerExport(mode);
  };

  const closeExportDialog = () => {
    setExportDialogOpen(false);
    setPendingExportMode(null);
  };

  const confirmExportDialog = () => {
    const mode = pendingExportMode;
    closeExportDialog();
    if (mode === "download" || mode === "copy") {
      triggerExport(mode);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/power-management-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: configJson
      });
      if (!response.ok) {
        throw new Error("保存失败");
      }
      setSyncMessage("已写入 src/config/power-management.json，刷新项目后会读取最新配置。");
    } catch {
      setSyncMessage("写入失败：当前环境不支持本地保存时，请导出 JSON 后手动替换。");
    } finally {
      setSaving(false);
    }
  };

  const kpiItems: KpiItem[] = [
    { id: "shared", label: "共享参数", value: library.length },
    {
      id: "high",
      label: "高风险",
      value: highRiskCount,
      interactive: highRiskCount > 0,
      tone: "warning",
      onClick: () => updateSearch({ risk: "high" })
    },
    {
      id: "today",
      label: "今日变更",
      value: todayChanges,
      interactive: todayChanges > 0,
      onClick: () => updateSearch({ audit: "open" })
    },
    {
      id: "orphan",
      label: "闲置参数",
      value: orphanCount,
      interactive: orphanCount > 0,
      tone: "warning",
      onClick: () => updateSearch({ coverage: "orphan" })
    },
    {
      id: "last-import",
      label: "最近导入",
      value: lastImport ? formatRelativeTime(lastImport.time) : "—",
      interactive: Boolean(lastImport),
      onClick: () => updateSearch({ audit: "open" })
    }
  ];

  useEffect(() => {
    if (!state.configDraft.parameterLibrary.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.parameterLibrary[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.parameterLibrary]);

  const updateMetadata = (patch: Partial<ParameterEditorDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: state.configDraft.projects[0]?.id ?? state.activeProjectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateValue = (projectId: string, patch: Partial<ParameterValueDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_VALUE",
      projectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateRecommendedValue = (recommendedValue: string) => {
    if (!selectedParameter) {
      return;
    }
    state.configDraft.projects.forEach((project) => {
      dispatch({
        type: "UPDATE_PROJECT_PARAMETER_VALUE",
        projectId: project.id,
        parameterId: selectedParameter.id,
        patch: { recommendedValue }
      });
    });
  };

  const deleteTarget = library.find((parameter) => parameter.id === deleteTargetId);
  const deleteTargetProjects = deleteTarget
    ? projects.filter((project) => deleteTarget.values?.[project.id]?.currentValue?.trim()).map((project) => project.code)
    : [];

  const confirmDelete = () => {
    if (!deleteTargetId) {
      return;
    }

    dispatch({ type: "DELETE_PROJECT_PARAMETER", parameterId: deleteTargetId });
    setSelectedParameterId(library.find((parameter) => parameter.id !== deleteTargetId)?.id ?? "");
    setDeleteTargetId(null);
  };
  useTopBarActions(
    <>
      <DirtyIndicator count={dirtyCount} onInspect={() => openExportFlow("preview")} />
      <button className="button primary" type="button" onClick={() => console.info("m2: open import wizard")}>
        <Upload size={16} />
        批量参数导入
      </button>
      <button className="button subtle" type="button" onClick={saveConfig} disabled={saving} title={syncMessage}>
        <FileText size={16} />
        {saving ? "保存中" : "保存到 JSON 文件"}
      </button>
      <ExportMenu
        onCopy={() => openExportFlow("copy")}
        onDownload={() => openExportFlow("download")}
        onViewDiff={() => openExportFlow("preview")}
      />
      <button className="button subtle" type="button" data-route="/user-permissions" onClick={() => onNavigate("/user-permissions")}>
        <ShieldCheck size={16} />
        权限
      </button>
      <button
        className="button ghost"
        type="button"
        aria-pressed={search.audit === "open"}
        onClick={() => updateSearch({ audit: search.audit === "open" ? undefined : "open" })}
      >
        <History size={16} />
        审计
      </button>
    </>,
    [dirtyCount, onNavigate, saving, search.audit, syncMessage]
  );

  return (
    <div className="param-admin-shell" data-audit={search.audit === "open" ? "open" : "closed"}>
      <KpiStrip items={kpiItems} />
      <AgentInsightBar
        dismissedIds={state.insightDismissedIds}
        items={insights}
        persistKey="parameter-admin-insights"
        onDismiss={(insightId) => dispatch({ type: "DISMISS_INSIGHT", insightId })}
      />
      <main className="param-admin-grid">
        <div className="library-column">
          <ParameterLibraryList
            parameters={state.configDraft.parameterLibrary}
            projects={state.configDraft.projects}
            search={search}
            selectedId={selectedParameter?.id}
            onSelect={setSelectedParameterId}
            onUpdateSearch={updateSearch}
          />
          <div className="library-admin-actions">
            <div className="config-list-actions">
              <button
                className="button subtle"
                type="button"
                onClick={() => setCreateDialogOpen(true)}
              >
                新增参数
              </button>
              <button
                className="button danger"
                type="button"
                disabled={!selectedParameter || state.configDraft.parameterLibrary.length <= 1}
                aria-label={selectedParameter ? `删除 ${selectedParameter.name}` : "删除参数"}
                onClick={() => {
                  if (!selectedParameter) {
                    return;
                  }
                  setDeleteTargetId(selectedParameter.id);
                }}
              >
                删除参数
              </button>
            </div>
          </div>
        </div>

        <section className="detail-column config-editor-panel project-config-editor">
          {library.length === 0 ? (
            <div className="detail-empty">
              <Info size={22} aria-hidden="true" />
              <p>还没有任何参数。从下方开始</p>
              <div className="detail-empty-actions">
                <button className="button primary" type="button" onClick={() => dispatch({ type: "ADD_PROJECT_PARAMETER" })}>
                  新增参数
                </button>
                <button className="button subtle" type="button" onClick={() => console.info("m2: import")}>
                  批量导入
                </button>
              </div>
            </div>
          ) : selectedParameter ? (
            <>
              <ParameterDefinitionForm
                allParameters={state.configDraft.parameterLibrary}
                parameter={selectedParameter}
                projects={state.configDraft.projects}
                onMetadataChange={updateMetadata}
                onRecommendedValueChange={updateRecommendedValue}
              />

              <ProjectValueMatrix parameter={selectedParameter} projects={state.configDraft.projects} onValueChange={updateValue} />
            </>
          ) : (
            <EmptyState text="请选择一个项目参数。" />
          )}
        </section>

        <aside className="audit-column" hidden={search.audit !== "open"} aria-label="审计抽屉">
          <div className="audit-drawer-placeholder">
            <PanelHeader title="审计抽屉" meta="m2 完整视图" />
            <p>审计事件筛选、批次展开和反向跳转将在下一阶段接入。</p>
          </div>
        </aside>
      </main>
      <ExportDiffDialog diff={exportDiff} open={exportDialogOpen} onCancel={closeExportDialog} onConfirm={confirmExportDialog} />
      <DeleteParameterDialog
        open={Boolean(deleteTarget)}
        parameterName={deleteTarget?.name ?? ""}
        usedByProjects={deleteTargetProjects}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={confirmDelete}
      />
      <CreateParameterDialog
        open={createDialogOpen}
        existingModules={library.map((p) => p.module)}
        existingNames={library.map((p) => p.name)}
        onCancel={() => setCreateDialogOpen(false)}
        onConfirm={(draft) => {
          dispatch({ type: "ADD_PROJECT_PARAMETER_FROM_DRAFT", draft });
          setSelectedParameterId(`new-power-parameter-${library.length + 1}`);
          setCreateDialogOpen(false);
        }}
      />
      {state._undoStack ? (
        <UndoableToast
          message={state._undoStack.message}
          timeout={Math.max(0, new Date(state._undoStack.expiresAt).getTime() - Date.now())}
          onExpire={() => dispatch({ type: "CLEAR_UNDO" })}
          onUndo={() => dispatch({ type: "UNDO_LAST_DESTRUCTIVE" })}
        />
      ) : null}
    </div>
  );
}

function computeExportDiff(lastExportedSnapshot: string, library: readonly PowerManagementParameterTemplate[]): ExportDiff {
  let lastLibrary: PowerManagementParameterTemplate[] = [];
  try {
    const parsed = JSON.parse(lastExportedSnapshot) as { parameterLibrary?: PowerManagementParameterTemplate[] };
    lastLibrary = Array.isArray(parsed.parameterLibrary) ? parsed.parameterLibrary : [];
  } catch {
    lastLibrary = [];
  }

  const currentById = new Map(library.map((parameter) => [parameter.id, parameter]));
  const lastById = new Map(lastLibrary.map((parameter) => [parameter.id, parameter]));
  const affectedParameters: ExportDiff["affectedParameters"] = [];

  for (const id of new Set([...currentById.keys(), ...lastById.keys()])) {
    const current = currentById.get(id);
    const last = lastById.get(id);
    if (current && !last) {
      affectedParameters.push({ name: current.name, kind: "added" });
    } else if (!current && last) {
      affectedParameters.push({ name: last.name, kind: "deleted" });
    } else if (current && last && JSON.stringify(current) !== JSON.stringify(last)) {
      affectedParameters.push({ name: current.name, kind: "updated" });
    }
  }

  return {
    added: affectedParameters.filter((parameter) => parameter.kind === "added").length,
    updated: affectedParameters.filter((parameter) => parameter.kind === "updated").length,
    deleted: affectedParameters.filter((parameter) => parameter.kind === "deleted").length,
    affectedParameters
  };
}

function parseParamAdminSearch(raw: string): ParamAdminSearch {
  const params = new URLSearchParams(raw);
  const risk = params.get("risk");
  const coverage = params.get("coverage");
  const modules = params.get("module");

  return {
    q: params.get("q") ?? "",
    risk: risk === "high" || risk === "medium" || risk === "low" ? risk : ("all" as const),
    modules: modules ? modules.split(",").filter(Boolean) : [],
    coverage: coverage === "full" || coverage === "partial" || coverage === "orphan" ? coverage : ("all" as const),
    sort: params.get("sort") ?? "updatedAt-desc",
    id: params.get("id") ?? undefined,
    audit: params.get("audit") === "open" ? ("open" as const) : undefined,
    import: undefined,
    permissions: undefined
  };
}

function isWithinHours(iso: string, hours: number) {
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= hours * 3600 * 1000;
}

function formatRelativeTime(iso: string) {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  const diffMs = Math.max(Date.now() - parsed, 0);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Info size={20} />
      {text}
    </div>
  );
}

export type ParameterAdminDispatch = React.Dispatch<AppAction>;
