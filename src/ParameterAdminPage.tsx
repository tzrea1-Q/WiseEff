import { Info, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listParameterModuleNames } from "./powerManagementConfig";
import { buildParameterLibraryFromRecords, buildParameterModulesFromRecords } from "./parameterAdminLibrary";
import type { AppAction, ParameterEditorDraft, ParameterValueDraft } from "./App";
import type { PageProps } from "./app/routes";
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";
import { CreateParameterDialog } from "./components/CreateParameterDialog";
import { DeleteParameterDialog } from "./components/DeleteParameterDialog";
import { ParameterAdminSubNav } from "./components/admin/ParameterAdminSubNav";
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { ModuleManagementDialog } from "./components/admin/ModuleManagementDialog";
import { ParameterDefinitionDialog } from "./components/admin/ParameterDefinitionDialog";
import { ParameterLibraryTable } from "./components/admin/ParameterLibraryTable";
import { ParameterValuesDialog } from "./components/admin/ParameterValuesDialog";
import { ParameterImportWizard } from "./components/ParameterImportWizard/ParameterImportWizard";
import { UndoableToast } from "./components/UndoableToast";
import { useTopBarActions } from "./components/layout";
import { useParamAdminSearch, type ParamAdminSearch } from "./hooks/useParamAdminSearch";
import { getCoverage } from "./parameterAdminAnalytics";

function buildParameterAuditCenterPath(projectId: string) {
  const params = new URLSearchParams({ app: "parameter" });
  if (projectId) {
    params.set("projectId", projectId);
  }
  return `/audit?${params.toString()}`;
}

export function ParameterAdminPage({
  state,
  dispatch,
  onNavigate,
  search: rawSearch,
  parameterActions,
  runtimeMode
}: PageProps) {
  const [definitionDialogParameterId, setDefinitionDialogParameterId] = useState<string | null>(null);
  const [valuesDialogParameterId, setValuesDialogParameterId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const urlSearch = useParamAdminSearch();
  const search = rawSearch ? parseParamAdminSearch(rawSearch) : urlSearch.search;
  const updateSearch = urlSearch.updateSearch;
  const isApiMode = runtimeMode === "api";
  const projects = state.configDraft.projects;
  const library = useMemo(() => {
    if (isApiMode) {
      return buildParameterLibraryFromRecords(state.parameters, projects);
    }
    return state.configDraft.parameterLibrary;
  }, [isApiMode, projects, state.configDraft.parameterLibrary, state.parameters]);
  const modules = useMemo(() => {
    if (isApiMode) {
      return buildParameterModulesFromRecords(state.parameters, state.configDraft.parameterModules);
    }
    return state.configDraft.parameterModules;
  }, [isApiMode, state.configDraft.parameterModules, state.parameters]);
  const moduleNames = useMemo(() => listParameterModuleNames(modules), [modules]);
  const definitionParameter = library.find((parameter) => parameter.id === definitionDialogParameterId) ?? null;
  const valuesParameter = library.find((parameter) => parameter.id === valuesDialogParameterId) ?? null;
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
              { id: "view-orphans", label: "查看闲置参数", variant: "secondary", onClick: () => updateSearch({ coverage: "orphan" }) },
              {
                id: "draft-cleanup",
                label: "生成清理建议",
                variant: "primary",
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

  const auditCenterPath = buildParameterAuditCenterPath(state.activeProjectId);
  const openAuditCenter = () => onNavigate(auditCenterPath);

  useEffect(() => {
    if (rawSearch.includes("audit=open")) {
      onNavigate(auditCenterPath);
    }
  }, [rawSearch, auditCenterPath, onNavigate]);

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
      onClick: openAuditCenter
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
      onClick: openAuditCenter
    }
  ];

  const updateMetadata = (parameterId: string, patch: Partial<ParameterEditorDraft>) => {
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: state.configDraft.projects[0]?.id ?? state.activeProjectId,
      parameterId,
      patch
    });
  };

  const updateValue = (parameterId: string, projectId: string, patch: Partial<ParameterValueDraft>) => {
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_VALUE",
      projectId,
      parameterId,
      patch
    });
  };

  const updateRecommendedValue = (parameterId: string, recommendedValue: string) => {
    state.configDraft.projects.forEach((project) => {
      dispatch({
        type: "UPDATE_PROJECT_PARAMETER_VALUE",
        projectId: project.id,
        parameterId,
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
    setDeleteTargetId(null);
  };

  const openImportDialog = () => {
    setImportWizardOpen(true);
  };

  useTopBarActions(
    <>
      <button className="button primary" type="button" onClick={openImportDialog}>
        <Upload size={16} />
        批量参数导入
      </button>
    </>,
    [onNavigate, state.activeProjectId]
  );

  return (
    <div className="param-admin-shell">
      <ParameterAdminSubNav active="library" onNavigate={onNavigate} />
      <KpiStrip items={kpiItems} />
      <AgentInsightBar
        dismissedIds={state.insightDismissedIds}
        eyebrow="管理洞察"
        items={insights}
        persistKey="parameter-admin-insights"
        onDismiss={(insightId) => dispatch({ type: "DISMISS_INSIGHT", insightId })}
      />
      <main className="param-admin-main">
        {library.length === 0 ? (
          <div className="param-admin-empty">
            <Info size={22} aria-hidden="true" />
            <p>还没有任何参数。从下方开始</p>
            <div className="param-admin-empty-actions">
              <button className="button primary" type="button" onClick={() => dispatch({ type: "ADD_PROJECT_PARAMETER" })}>
                新增参数
              </button>
              <button className="button subtle" type="button" onClick={openImportDialog}>
                批量导入
              </button>
            </div>
          </div>
        ) : (
          <ParameterLibraryTable
            parameters={library}
            projects={projects}
            search={search}
            onUpdateSearch={updateSearch}
            onEditDefinition={setDefinitionDialogParameterId}
            onEditValues={setValuesDialogParameterId}
            onCreateParameter={() => setCreateDialogOpen(true)}
            onManageModules={() => setModuleDialogOpen(true)}
            onDeleteParameter={setDeleteTargetId}
          />
        )}
      </main>
      <DeleteParameterDialog
        open={Boolean(deleteTarget)}
        parameterName={deleteTarget?.name ?? ""}
        usedByProjects={deleteTargetProjects}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={confirmDelete}
      />
      <CreateParameterDialog
        open={createDialogOpen}
        projects={projects}
        modules={moduleNames}
        existingParameters={library}
        onCancel={() => setCreateDialogOpen(false)}
        onConfirm={(draft) => {
          dispatch({ type: "ADD_PROJECT_PARAMETER_FROM_DRAFT", draft });
          setCreateDialogOpen(false);
        }}
      />
      <ModuleManagementDialog
        open={moduleDialogOpen}
        modules={modules}
        parameters={library}
        onClose={() => setModuleDialogOpen(false)}
        onAddModule={(module) => dispatch({ type: "ADD_PARAMETER_MODULE", module })}
        onUpdateModule={(moduleName, patch) => dispatch({ type: "UPDATE_PARAMETER_MODULE", moduleName, patch })}
        onDeleteModule={(moduleName) => dispatch({ type: "DELETE_PARAMETER_MODULE", moduleName })}
        onEditParameterDefinition={(parameterId) => {
          setModuleDialogOpen(false);
          setDefinitionDialogParameterId(parameterId);
        }}
      />
      <ParameterImportWizard
        open={importWizardOpen}
        onClose={() => setImportWizardOpen(false)}
        projects={projects}
        parameters={state.parameters}
        activeProjectId={state.activeProjectId}
        parameterActions={parameterActions}
        dispatch={dispatch}
        onNavigate={onNavigate}
        runtimeMode={runtimeMode}
      />
      {definitionParameter ? (
        <ParameterDefinitionDialog
          parameter={definitionParameter}
          projects={projects}
          modules={moduleNames}
          allParameters={library}
          onMetadataChange={(patch) => updateMetadata(definitionParameter.id, patch)}
          onRecommendedValueChange={(value) => updateRecommendedValue(definitionParameter.id, value)}
          onClose={() => setDefinitionDialogParameterId(null)}
        />
      ) : null}
      {valuesParameter ? (
        <ParameterValuesDialog
          parameter={valuesParameter}
          projects={projects}
          onValueChange={(projectId, patch) => updateValue(valuesParameter.id, projectId, patch)}
          onClose={() => setValuesDialogParameterId(null)}
        />
      ) : null}
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
    audit: undefined,
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

export type ParameterAdminDispatch = React.Dispatch<AppAction>;
