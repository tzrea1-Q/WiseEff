import { History, Info, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listParameterModuleNames } from "./powerManagementConfig";
import { buildParameterLibraryFromRecords, buildParameterModulesFromRecords } from "./parameterAdminLibrary";
import type { AppAction, ParameterEditorDraft, ParameterValueDraft } from "./App";
import type { PageProps } from "./app/routes";
import type { ParameterImportBatchDto, ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";
import { CreateParameterDialog } from "./components/CreateParameterDialog";
import { DeleteParameterDialog } from "./components/DeleteParameterDialog";
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { ModuleManagementDialog } from "./components/admin/ModuleManagementDialog";
import { ParameterDefinitionDialog } from "./components/admin/ParameterDefinitionDialog";
import { ParameterLibraryTable } from "./components/admin/ParameterLibraryTable";
import { ParameterValuesDialog } from "./components/admin/ParameterValuesDialog";
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

function isEligibleImportItem(item: ParameterImportBatchDto["items"][number]) {
  return item.classification === "added" || item.classification === "updated";
}

function getImportClassificationLabel(item: ParameterImportBatchDto["items"][number]) {
  return isEligibleImportItem(item) ? item.classification : `${item.classification} · not eligible`;
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importSourceName, setImportSourceName] = useState("pasted-import.json");
  const [importPreview, setImportPreview] = useState<ParameterImportBatchDto | null>(null);
  const [selectedImportItemIds, setSelectedImportItemIds] = useState<string[]>([]);
  const [importPending, setImportPending] = useState(false);
  const [importMessage, setImportMessage] = useState("");
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
    setImportDialogOpen(true);
    setImportPreview(null);
    setSelectedImportItemIds([]);
    setImportMessage("");
  };

  const handleImportFileChange = (file: File | undefined) => {
    if (!file) {
      return;
    }
    setImportSourceName(file.name);
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const createPreview = async () => {
    const items = parseImportItems(importText);
    if (items.length === 0) {
      setImportMessage("没有可预览的导入项。");
      return;
    }
    setImportPending(true);
    setImportMessage("");
    try {
      const result = parameterActions
        ? await parameterActions.createImportPreview({
            projectId: state.activeProjectId,
            sourceName: importSourceName || "pasted-import.json",
            items
          })
        : createLocalImportPreview(state.activeProjectId, importSourceName || "pasted-import.json", items);
      if ("notification" in result) {
        if (!result.alreadyNotified) {
          dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
        }
        setImportMessage(result.notification);
        return;
      }
      setImportPreview(result);
      setSelectedImportItemIds(result.items.filter(isEligibleImportItem).map((item) => item.id));
    } finally {
      setImportPending(false);
    }
  };

  const applyPreview = async () => {
    if (!importPreview) {
      return;
    }
    if (selectedImportItemIds.length === 0) {
      setImportMessage("请选择至少一个导入项。");
      return;
    }
    setImportPending(true);
    setImportMessage("");
    try {
      const result = parameterActions
        ? await parameterActions.applyImportBatch({ batchId: importPreview.id, selectedItemIds: selectedImportItemIds })
        : await Promise.resolve(dispatch({ type: "IMPORT_PARAMETERS" }));
      if (result && "notification" in result) {
        if (!result.alreadyNotified) {
          dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
        }
        setImportMessage(result.notification);
        return;
      }
      setImportDialogOpen(false);
    } finally {
      setImportPending(false);
    }
  };

  useTopBarActions(
    <>
      <button className="button primary" type="button" onClick={openImportDialog}>
        <Upload size={16} />
        批量参数导入
      </button>
      <button className="button subtle" type="button" data-route="/user-permissions" onClick={() => onNavigate("/user-permissions")}>
        <ShieldCheck size={16} />
        权限
      </button>
      <button className="button ghost" type="button" onClick={openAuditCenter}>
        <History size={16} />
        审计
      </button>
    </>,
    [onNavigate, state.activeProjectId]
  );

  return (
    <div className="param-admin-shell">
      <KpiStrip items={kpiItems} />
      <AgentInsightBar
        dismissedIds={state.insightDismissedIds}
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
      {importDialogOpen ? (
        <ParameterImportDialog
          sourceName={importSourceName}
          sourceText={importText}
          preview={importPreview}
          selectedItemIds={selectedImportItemIds}
          pending={importPending}
          message={importMessage}
          onSourceNameChange={setImportSourceName}
          onSourceTextChange={setImportText}
          onFileChange={handleImportFileChange}
          onPreview={createPreview}
          onApply={applyPreview}
          onSelectedItemIdsChange={setSelectedImportItemIds}
          onClose={() => setImportDialogOpen(false)}
        />
      ) : null}
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

function ParameterImportDialog({
  sourceName,
  sourceText,
  preview,
  selectedItemIds,
  pending,
  message,
  onSourceNameChange,
  onSourceTextChange,
  onFileChange,
  onPreview,
  onApply,
  onSelectedItemIdsChange,
  onClose
}: {
  sourceName: string;
  sourceText: string;
  preview: ParameterImportBatchDto | null;
  selectedItemIds: string[];
  pending: boolean;
  message: string;
  onSourceNameChange: (value: string) => void;
  onSourceTextChange: (value: string) => void;
  onFileChange: (file: File | undefined) => void;
  onPreview: () => void;
  onApply: () => void;
  onSelectedItemIdsChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const toggleItem = (itemId: string) => {
    onSelectedItemIdsChange(
      selectedItemIds.includes(itemId)
        ? selectedItemIds.filter((id) => id !== itemId)
        : [...selectedItemIds, itemId]
    );
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="参数导入">
      <div className="submission-dialog">
        <div className="submission-dialog-head">
          <div>
            <span className="eyebrow">参数导入</span>
            <p>选择文件或粘贴导入内容，先生成预览后再应用。</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>导入文件</span>
            <input type="file" accept=".json,.csv,.txt" onChange={(event) => onFileChange(event.target.files?.[0])} />
          </label>
          <label>
            <span>来源名称</span>
            <input value={sourceName} onChange={(event) => onSourceNameChange(event.target.value)} />
          </label>
          <label className="full-row">
            <span>粘贴导入内容</span>
            <textarea rows={8} value={sourceText} onChange={(event) => onSourceTextChange(event.target.value)} />
          </label>
        </div>
        {message ? <p role="status">{message}</p> : null}
        {preview ? (
          <section aria-label="导入预览">
            <div className="kpi-strip">
              <span>新增 {preview.summary.added}</span>
              <span>更新 {preview.summary.updated}</span>
              <span>不变 {preview.summary.unchanged}</span>
              <span>冲突 {preview.summary.conflict}</span>
              <span>高风险 {preview.summary.highRisk}</span>
            </div>
            <div className="submission-diff-list">
              {preview.items.map((item) => {
                const eligible = isEligibleImportItem(item);
                return (
                  <label className="submission-diff-card" key={item.id}>
                    <input
                      type="checkbox"
                      checked={selectedItemIds.includes(item.id)}
                      disabled={!eligible}
                      onChange={() => toggleItem(item.id)}
                    />
                    <strong>{item.name}</strong>
                    <small>{getImportClassificationLabel(item)}</small>
                    <small>{item.module} · {item.risk}</small>
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}
        <div className="dialog-actions">
          <button className="button subtle" type="button" disabled={pending} onClick={onClose}>
            关闭
          </button>
          <button className="button subtle" type="button" disabled={pending || !sourceText.trim()} onClick={onPreview}>
            {pending && !preview ? "预览中" : "生成预览"}
          </button>
          <button className="button primary" type="button" disabled={pending || !preview || selectedItemIds.length === 0} onClick={onApply}>
            {pending && preview ? "应用中" : "应用导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function createLocalImportPreview(projectId: string, sourceName: string, items: ParameterImportSourceItem[]): ParameterImportBatchDto {
  return {
    id: `local-import-${Date.now()}`,
    projectId,
    sourceName,
    status: "previewed",
    createdAt: new Date().toISOString(),
    summary: {
      added: items.length,
      updated: 0,
      unchanged: 0,
      conflict: 0,
      highRisk: items.filter((item) => item.risk === "High").length
    },
    items: items.map((item, index) => ({
      ...item,
      id: `local-import-item-${index + 1}`,
      classification: "added",
      riskFlag: item.risk === "High"
    }))
  };
}

function parseImportItems(source: string): ParameterImportSourceItem[] {
  const trimmed = source.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    const rows: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    return rows.map(normalizeImportItem).filter((item): item is ParameterImportSourceItem => Boolean(item));
  } catch {
    return parseCsvImportItems(trimmed);
  }
}

function parseCsvImportItems(source: string): ParameterImportSourceItem[] {
  const [headerLine, ...lines] = source.split(/\r?\n/).filter((line) => line.trim());
  if (!headerLine) {
    return [];
  }
  const headers = splitCsvLine(headerLine).map((header) => header.trim());
  return lines
    .map((line) => {
      const values = splitCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      return normalizeImportItem(row);
    })
    .filter((item): item is ParameterImportSourceItem => Boolean(item));
}

function splitCsvLine(line: string) {
  return line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
}

function normalizeImportItem(row: unknown): ParameterImportSourceItem | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const record = row as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  const module = String(record.module ?? "").trim();
  const risk = normalizeRisk(record.risk);
  const unit = String(record.unit ?? "").trim();
  const range = String(record.range ?? "").trim();
  if (!name || !module || !risk || !unit || !range) {
    return null;
  }
  return {
    name,
    module,
    risk,
    unit,
    range,
    currentValue: String(record.currentValue ?? ""),
    recommendedValue: String(record.recommendedValue ?? ""),
    description: String(record.description ?? ""),
    explanation: String(record.explanation ?? ""),
    configFormat: String(record.configFormat ?? "")
  };
}

function normalizeRisk(value: unknown): ParameterImportSourceItem["risk"] | null {
  if (value === "High" || value === "Medium" || value === "Low") {
    return value;
  }
  return null;
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
