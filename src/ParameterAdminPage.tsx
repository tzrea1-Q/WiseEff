import { Info, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { ParameterSpecDetail } from "@/domain/parameter-topology/types";
import { buildParameterModuleTree } from "./parameterAdminLibrary";
import type { AppAction, ParameterEditorDraft, ParameterValueDraft } from "./App";
import type { PageProps } from "./app/routes";
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";
import { CreateParameterDialog } from "./components/CreateParameterDialog";
import { DeleteParameterDialog } from "./components/DeleteParameterDialog";
import { ParameterAdminSubNav } from "./components/admin/ParameterAdminSubNav";
import { ParameterFileConflictPanel } from "./components/admin/ParameterFileConflictPanel";
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { ModuleManagementDialog } from "./components/admin/ModuleManagementDialog";
import { ParameterDefinitionDialog } from "./components/admin/ParameterDefinitionDialog";
import { ParameterLibraryTable } from "./components/admin/ParameterLibraryTable";
import { ParameterValuesDialog } from "./components/admin/ParameterValuesDialog";
import {
  mapParameterSpecToLibraryRow,
  ParameterSpecLibrary,
  type ParameterSpecLibraryRow
} from "./components/parameter-topology/ParameterSpecLibrary";
import type { ParameterSpecDetailView } from "./components/parameter-topology/ParameterSpecDetail";
import { SpecReviewQueue, type SpecReviewTaskView } from "./components/parameter-topology/SpecReviewQueue";
import { ParameterImportWizard } from "./components/ParameterImportWizard/ParameterImportWizard";
import { UndoableToast } from "./components/UndoableToast";
import { useTopBarActions } from "./components/layout";
import { useParamAdminSearch, type ParamAdminSearch } from "./hooks/useParamAdminSearch";
import { resolveParameterFileRepository } from "./application/parameters/parameterFileRuntime";
import { createParameterAdminClient } from "./infrastructure/http/parameterAdminClient";
import { createHttpParameterTopologyRepository } from "./infrastructure/http/parameterTopologyClient";
import { getCoverage } from "./parameterAdminAnalytics";
import type { ParameterModuleDraft } from "./powerManagementConfig";

function toSpecDetailView(detail: ParameterSpecDetail, usageCount = 0): ParameterSpecDetailView {
  return {
    ...mapParameterSpecToLibraryRow({
      id: detail.id,
      propertyKey: detail.propertyKey,
      specificationKey: detail.specificationKey,
      driverModule: detail.driverModule,
      lifecycle: detail.lifecycle,
      currentVersion: detail.currentVersion,
      compatiblePatterns: detail.compatiblePatterns,
      valueShape: detail.valueShape,
      exampleValue: detail.exampleValue,
      schemaNamespace: detail.schemaNamespace,
      usageCount
    }),
    schemaDefault: detail.schemaDefault,
    policyTarget: detail.policyTarget,
    usage: [],
    schemaHistory: detail.currentVersion
      ? [{ version: detail.currentVersion, source: detail.schemaNamespace ?? detail.sourceKind }]
      : []
  };
}

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
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [openConflictCount, setOpenConflictCount] = useState(0);
  const [adminModuleNodes, setAdminModuleNodes] = useState<FlatModuleNode[]>([]);
  const [specRows, setSpecRows] = useState<ParameterSpecLibraryRow[]>([]);
  const [specLoading, setSpecLoading] = useState(false);
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetailView | null>(null);
  const [reviewTasks, setReviewTasks] = useState<SpecReviewTaskView[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const urlSearch = useParamAdminSearch();
  const search = rawSearch ? parseParamAdminSearch(rawSearch) : urlSearch.search;
  const updateSearch = urlSearch.updateSearch;
  const isApiMode = runtimeMode === "api";
  const parameterAdminClient = useMemo(() => (isApiMode ? createParameterAdminClient() : null), [isApiMode]);
  const topologyRepository = useMemo(
    () => (isApiMode ? createHttpParameterTopologyRepository() : null),
    [isApiMode]
  );
  const parameterFileRepository = useMemo(() => resolveParameterFileRepository(runtimeMode), [runtimeMode]);
  const projects = state.configDraft.projects;
  // Mock keeps the flat draft library. API mode library UI reads parameter specs — not state.parameters.
  const library = useMemo(() => {
    if (isApiMode) {
      return [];
    }
    return state.configDraft.parameterLibrary;
  }, [isApiMode, state.configDraft.parameterLibrary]);
  const moduleNodes = useMemo(() => {
    if (isApiMode && adminModuleNodes.length > 0) {
      return adminModuleNodes;
    }
    return buildParameterModuleTree(state.parameters, state.configDraft.parameterModules);
  }, [adminModuleNodes, isApiMode, state.configDraft.parameterModules, state.parameters]);

  const reloadAdminModules = useCallback(async () => {
    if (!parameterAdminClient) {
      return;
    }
    const items = await parameterAdminClient.listModules();
    setAdminModuleNodes(items);
  }, [parameterAdminClient]);

  useEffect(() => {
    if (!parameterAdminClient) {
      return undefined;
    }

    let cancelled = false;
    reloadAdminModules().catch(() => {
      if (!cancelled) {
        setAdminModuleNodes([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [parameterAdminClient, reloadAdminModules]);

  useEffect(() => {
    if (!topologyRepository) {
      setSpecRows([]);
      setSpecDetail(null);
      setSelectedSpecId(null);
      setReviewTasks([]);
      return undefined;
    }

    let cancelled = false;
    setSpecLoading(true);
    topologyRepository
      .listSpecs({})
      .then((items) => {
        if (cancelled) {
          return;
        }
        setSpecRows(
          items.map((item) =>
            mapParameterSpecToLibraryRow({
              id: item.id,
              propertyKey: item.propertyKey,
              specificationKey: item.specificationKey,
              driverModule: item.driverModule,
              lifecycle: item.lifecycle,
              currentVersion: item.currentVersion
            })
          )
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSpecRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSpecLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [topologyRepository]);

  const reloadReviewTasks = useCallback(async () => {
    if (!topologyRepository) {
      setReviewTasks([]);
      return;
    }
    setReviewLoading(true);
    setReviewActionError(null);
    try {
      const result = await topologyRepository.listSpecReviewTasks({ status: "open", limit: 50 });
      setReviewTasks(
        result.items.map((task) => ({
          id: task.id,
          propertyKey: task.propertyKey ?? "unknown",
          driverModule: task.driverModule,
          evidence: task.evidence,
          candidates: task.candidates,
          ambiguous: task.ambiguous,
          projectCount: task.projectCount
        }))
      );
    } catch {
      setReviewTasks([]);
      setReviewActionError("无法加载规格审核队列。");
    } finally {
      setReviewLoading(false);
    }
  }, [topologyRepository]);

  useEffect(() => {
    if (!topologyRepository) {
      setReviewTasks([]);
      return undefined;
    }
    let cancelled = false;
    reloadReviewTasks().catch(() => {
      if (!cancelled) {
        setReviewTasks([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadReviewTasks, topologyRepository]);

  const handleApproveReview = useCallback(
    async (input: { taskId: string; parameterSpecId: string; reason: string }) => {
      if (!topologyRepository) {
        return;
      }
      setReviewActionError(null);
      try {
        await topologyRepository.resolveSpecReviewTask(input.taskId, {
          decision: "resolved",
          parameterSpecId: input.parameterSpecId,
          reason: input.reason
        });
        await reloadReviewTasks();
      } catch {
        setReviewActionError("批准失败，请重试。");
      }
    },
    [reloadReviewTasks, topologyRepository]
  );

  const handleDismissReview = useCallback(
    async (input: { taskId: string; reason: string }) => {
      if (!topologyRepository) {
        return;
      }
      setReviewActionError(null);
      try {
        await topologyRepository.resolveSpecReviewTask(input.taskId, {
          decision: "dismissed",
          reason: input.reason
        });
        await reloadReviewTasks();
      } catch {
        setReviewActionError("驳回失败，请重试。");
      }
    },
    [reloadReviewTasks, topologyRepository]
  );

  const handleSelectSpec = useCallback(
    async (specId: string) => {
      setSelectedSpecId(specId);
      if (!topologyRepository) {
        return;
      }
      try {
        const detail = await topologyRepository.getSpec(specId);
        const view = toSpecDetailView(detail, specRows.find((row) => row.id === specId)?.usageCount ?? 0);
        setSpecDetail(view);
        setSpecRows((current) =>
          current.map((row) => (row.id === specId ? { ...row, ...mapParameterSpecToLibraryRow(detail) } : row))
        );
      } catch {
        const row = specRows.find((item) => item.id === specId) ?? null;
        setSpecDetail(row);
      }
    },
    [specRows, topologyRepository]
  );

  useEffect(() => {
    let cancelled = false;
    parameterFileRepository
      .listConflicts(state.activeProjectId)
      .then((items) => {
        if (!cancelled) {
          setOpenConflictCount(items.filter((item) => item.status === "open").length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOpenConflictCount(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [parameterFileRepository, state.activeProjectId]);

  const resolveModuleName = useCallback(
    (moduleId: string) => moduleNodes.find((node) => node.id === moduleId)?.name ?? moduleId,
    [moduleNodes]
  );

  const handleAddModule = async (module: ParameterModuleDraft, parentId?: string | null) => {
    if (isApiMode && parameterAdminClient) {
      await parameterAdminClient.createModule({
        name: module.name,
        description: module.description,
        scope: module.scope,
        parentId: parentId ?? null
      });
      await reloadAdminModules();
      await parameterActions?.refresh();
      return;
    }
    dispatch({ type: "ADD_PARAMETER_MODULE", module: { ...module, ...(parentId ? { parent: resolveModuleName(parentId) } : {}) } });
  };

  const handleUpdateModule = async (moduleId: string, patch: ParameterModuleDraft) => {
    if (isApiMode && parameterAdminClient) {
      await parameterAdminClient.updateModule(moduleId, {
        name: patch.name,
        description: patch.description,
        scope: patch.scope
      });
      await reloadAdminModules();
      await parameterActions?.refresh();
      return;
    }
    dispatch({ type: "UPDATE_PARAMETER_MODULE", moduleName: resolveModuleName(moduleId), patch });
  };

  const handleMoveModule = async (moduleId: string, parentId: string | null) => {
    if (isApiMode && parameterAdminClient) {
      await parameterAdminClient.moveModule(moduleId, { parentId });
      await reloadAdminModules();
      await parameterActions?.refresh();
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (isApiMode && parameterAdminClient) {
      await parameterAdminClient.deleteModule(moduleId);
      await reloadAdminModules();
      await parameterActions?.refresh();
      return;
    }
    dispatch({ type: "DELETE_PARAMETER_MODULE", moduleName: resolveModuleName(moduleId) });
  };
  const definitionParameter = library.find((parameter) => parameter.id === definitionDialogParameterId) ?? null;
  const valuesParameter = library.find((parameter) => parameter.id === valuesDialogParameterId) ?? null;
  const highRiskCount = isApiMode
    ? specRows.filter((spec) => spec.reviewState === "needs_review").length
    : library.filter((parameter) => parameter.risk === "High").length;
  const orphanCount = isApiMode
    ? specRows.filter((spec) => spec.usageCount === 0).length
    : library.filter((parameter) => getCoverage(parameter, projects) === "orphan").length;
  const highRiskOrphans = library.filter((parameter) => parameter.risk === "High" && getCoverage(parameter, projects) === "orphan");
  const todayChanges = state.auditEvents.filter((event) => isWithinHours(event.time, 24)).length;
  const lastImport = state.auditEvents.find((event) => event.kind === "batch-import");
  const insights: Insight[] =
    !isApiMode && highRiskOrphans.length > 0
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
    { id: "shared", label: isApiMode ? "规格数" : "共享参数", value: isApiMode ? specRows.length : library.length },
    {
      id: "high",
      label: isApiMode ? "待审核" : "高风险",
      value: highRiskCount,
      interactive: !isApiMode && highRiskCount > 0,
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
      label: isApiMode ? "未使用规格" : "闲置参数",
      value: orphanCount,
      interactive: !isApiMode && orphanCount > 0,
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
      <button className="button subtle parameter-file-conflict-trigger" type="button" onClick={() => setConflictPanelOpen(true)}>
        参数文件冲突
        {openConflictCount > 0 ? <span className="parameter-file-conflict-badge">{openConflictCount}</span> : null}
      </button>
      <button className="button primary" type="button" onClick={openImportDialog}>
        <Upload size={16} />
        批量参数导入
      </button>
    </>,
    [openConflictCount, onNavigate, state.activeProjectId]
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
        {isApiMode ? (
          <ParameterSpecLibrary
            specs={specRows}
            loading={specLoading}
            selectedSpecId={selectedSpecId}
            detail={specDetail}
            onSelectSpec={handleSelectSpec}
            reviewQueueSlot={
              <>
                {reviewActionError ? <p className="form-error" role="alert">{reviewActionError}</p> : null}
                {reviewLoading && reviewTasks.length === 0 ? (
                  <p className="parameters-table-empty">正在加载规格审核队列…</p>
                ) : null}
                <SpecReviewQueue
                  tasks={reviewTasks}
                  onApprove={(input) => {
                    void handleApproveReview(input);
                  }}
                  onDismiss={(input) => {
                    void handleDismissReview(input);
                  }}
                />
              </>
            }
          />
        ) : library.length === 0 ? (
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
            moduleNodes={moduleNodes}
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
        moduleNodes={moduleNodes}
        existingParameters={library}
        onCancel={() => setCreateDialogOpen(false)}
        onConfirm={(draft) => {
          dispatch({ type: "ADD_PROJECT_PARAMETER_FROM_DRAFT", draft });
          setCreateDialogOpen(false);
        }}
      />
      <ModuleManagementDialog
        open={moduleDialogOpen}
        moduleNodes={moduleNodes}
        parameters={library}
        onClose={() => setModuleDialogOpen(false)}
        onAddModule={handleAddModule}
        onUpdateModule={handleUpdateModule}
        onMoveModule={handleMoveModule}
        onDeleteModule={handleDeleteModule}
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
      <ParameterFileConflictPanel
        open={conflictPanelOpen}
        projectId={state.activeProjectId}
        repository={parameterFileRepository}
        onClose={() => setConflictPanelOpen(false)}
        onOpenConflictCountChange={setOpenConflictCount}
      />
      {definitionParameter ? (
        <ParameterDefinitionDialog
          parameter={definitionParameter}
          projects={projects}
          moduleNodes={moduleNodes}
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
