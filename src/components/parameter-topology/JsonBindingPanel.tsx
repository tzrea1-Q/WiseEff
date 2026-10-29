import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { SectionEmpty } from "@/components/common/SectionState";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Boxes, CircleX, Download, FileCode } from "lucide-react";
import type {
  CanonicalDtsDefinitionDetail,
  ProjectParameterBinding,
  TopologyDiagnostic
} from "@/domain/parameter-topology/types";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { SearchField } from "@/components/common/SearchField";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Textarea } from "@/components/ui/textarea";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import { clearUnsavedParameterWork, reportUnsavedParameterWork } from "@/application/parameters/unsavedParameterWork";
import type { PendingBindingDraft } from "./draftTrayTypes";
import "./json-binding-detail.css";
import { presentError } from "@/infrastructure/http/presentError";
import { formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { buildModuleTree } from "@/application/parameters/buildModuleTree";
import { DtsTopologyNavigator } from "./DtsTopologyNavigator";
import { useModuleNodeSelection } from "@/hooks/useModuleNodeSelection";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";
import { downloadJsonWorkbenchCsv } from "@/application/parameters/exportJsonWorkbenchRows";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";

export type BindingEditValidation = {
  valid: boolean;
  diagnostics: TopologyDiagnostic[];
};

export type BindingEditInput = {
  bindingId: string;
  rawValue: string;
  reason: string;
  action?: "set" | "delete";
};

export type JsonBindingHistoryEntry = {
  id: string;
  reason: string;
  createdAt: string;
  actor?: string | null;
  fromRawValue?: string | null;
  toRawValue?: string | null;
  oldCurrentValueId: string | null;
  newCurrentValueId: string | null;
  valueState?: "present" | "deleted" | null;
};

export type PrimaryJsonSource = {
  fileName: string;
  versionNumber: number;
  text: string;
};

export type JsonBindingPanelProps = {
  bindings: readonly ProjectParameterBinding[];
  requestedBindingId?: string;
  pendingDrafts?: readonly PendingBindingDraft[];
  requestedEditBindingId?: string;
  editRequestToken?: number;
  moduleRegistry?: ParameterModuleRegistry | null;
  canEdit?: boolean;
  editableBindingIds?: ReadonlySet<string>;
  draftBindingIds?: ReadonlySet<string>;
  currentEdits?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  notice?: React.ReactNode;
  onValidateEdit?: (input: BindingEditInput) =>
    | BindingEditValidation
    | Promise<BindingEditValidation>;
  onExportBinding?: (bindingId: string) => Promise<void>;
  onLoadHistory?: (bindingId: string) => Promise<readonly JsonBindingHistoryEntry[]>;
  loadPrimaryJsonSource?: () => Promise<PrimaryJsonSource>;
  loadLatestParameterSpec?: (definitionId: string, propertyKey: string) => Promise<CanonicalDtsDefinitionDetail>;
  onExportRows?: (bindings: readonly ProjectParameterBinding[]) => void;
  projectName?: string;
};

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

function selectedSubtreeBindingIds(
  roots: DtsWorkbenchTreeNode[],
  selectedNodeId: string | null
): Set<string> | null {
  if (!selectedNodeId) return null;
  const pending = [...roots];
  let selected: DtsWorkbenchTreeNode | undefined;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.id === selectedNodeId) {
      selected = node;
      break;
    }
    pending.push(...node.children);
  }
  if (!selected) return null;

  const bindingIds = new Set<string>();
  const subtree = [selected];
  while (subtree.length > 0) {
    const node = subtree.pop()!;
    for (const bindingId of node.bindingIds) bindingIds.add(bindingId);
    subtree.push(...node.children);
  }
  return bindingIds;
}

function treeContainsNode(nodes: DtsWorkbenchTreeNode[], nodeId: string): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) return true;
    if (treeContainsNode(node.children, nodeId)) return true;
  }
  return false;
}

export function synthesizeJsonSource(
  bindings: readonly ProjectParameterBinding[],
  projectName?: string
): PrimaryJsonSource {
  const obj: Record<string, unknown> = {};
  for (const b of bindings) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(b.rawValue);
    } catch {
      parsed = b.rawValue;
    }
    obj[b.propertyKey] = parsed;
  }
  return {
    fileName: projectName ? `${projectName}.json` : "parameters.json",
    versionNumber: 1,
    text: JSON.stringify(obj, null, 2) + "\n"
  };
}

function findEarliestJsonSourceLine(
  text: string,
  bindings: readonly ProjectParameterBinding[],
  subtreeBindingIds: Set<string> | null
): number | null {
  if (!subtreeBindingIds || subtreeBindingIds.size === 0 || !text) return null;
  const targetKeys = bindings
    .filter((b) => subtreeBindingIds.has(b.id))
    .map((b) => b.propertyKey);
  if (targetKeys.length === 0) return null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const key of targetKeys) {
      if (line.includes(`"${key}"`) || line.includes(key)) {
        return i + 1;
      }
    }
  }
  return null;
}

/** JSON bindings workbench matching DTS layout (Topology Navigator + Table + Modal Dialogs). */
export function JsonBindingPanel({
  bindings,
  requestedBindingId,
  pendingDrafts,
  requestedEditBindingId,
  editRequestToken,
  moduleRegistry,
  canEdit = false,
  editableBindingIds,
  draftBindingIds,
  currentEdits,
  toolbarActions,
  notice,
  onValidateEdit,
  onExportBinding,
  onLoadHistory,
  loadPrimaryJsonSource,
  loadLatestParameterSpec,
  onExportRows,
  projectName
}: JsonBindingPanelProps) {
  const canEditBinding = (bindingId: string) => canEdit &&
    (editableBindingIds === undefined || editableBindingIds.has(bindingId));
  const jsonBindings = useMemo(
    () => bindings.filter((binding) => binding.effectiveValue.kind === "json"),
    [bindings]
  );
  const [resultsMode, setResultsMode] = useState<"parameters" | "jsonSource">("parameters");
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [jsonFindQuery, setJsonFindQuery] = useState("");
  const [findNextToken, setFindNextToken] = useState(0);
  const [findStatus, setFindStatus] = useState({ matchCount: 0, activeIndex: 0 });

  // Source viewer states
  const [jsonSourceStatus, setJsonSourceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [jsonSource, setJsonSource] = useState<PrimaryJsonSource | null>(null);
  const [jsonSourceErrorMessage, setJsonSourceErrorMessage] = useState<string | null>(null);
  const [jsonSourceLoadToken, setJsonSourceLoadToken] = useState(0);

  // Dialog states
  const [viewingBindingId, setViewingBindingId] = useState<string | null>(null);
  const handledRequest = useRef<string | null>(null);

  // Draft form states inside edit dialog
  const activeViewBinding = useMemo(
    () => (viewingBindingId ? jsonBindings.find((b) => b.id === viewingBindingId) ?? null : null),
    [viewingBindingId, jsonBindings]
  );
  const [latestDefinition, setLatestDefinition] = useState<CanonicalDtsDefinitionDetail | null>(null);
  const [latestStatus, setLatestStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  useEffect(() => {
    if (!activeViewBinding?.definitionId || !loadLatestParameterSpec) {
      setLatestDefinition(null);
      setLatestStatus("idle");
      return undefined;
    }
    let cancelled = false;
    setLatestDefinition(null);
    setLatestStatus("loading");
    void loadLatestParameterSpec(activeViewBinding.definitionId, activeViewBinding.propertyKey)
      .then((detail) => {
        if (cancelled) return;
        if (detail.definitionId !== activeViewBinding.definitionId || detail.propertyKey !== activeViewBinding.propertyKey) {
          setLatestStatus("error");
          return;
        }
        setLatestDefinition(detail);
        setLatestStatus("ready");
      })
      .catch(() => { if (!cancelled) setLatestStatus("error"); });
    return () => { cancelled = true; };
  }, [activeViewBinding?.definitionId, activeViewBinding?.propertyKey, loadLatestParameterSpec]);
  const visibleLatestDefinition = latestStatus === "ready" && latestDefinition?.definitionId === activeViewBinding?.definitionId &&
    latestDefinition?.propertyKey === activeViewBinding?.propertyKey ? latestDefinition : null;

  type Draft = { rawValue: string; reason: string; action: "set" | "delete" };
  const [localDrafts, setLocalDrafts] = useState<Record<string, Draft>>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, Draft>>({});
  useEffect(() => {
    const acknowledged = Object.keys(savedDrafts).filter((id) => {
      const pending = pendingDrafts?.find((draft) => draft.projectParameterBindingId === id);
      const saved = savedDrafts[id]!;
      return pending && pending.rawText === saved.rawValue && pending.reason === saved.reason && pending.action === saved.action;
    });
    if (!acknowledged.length) return;
    setSavedDrafts((current) => {
      const next = { ...current };
      for (const id of acknowledged) delete next[id];
      return next;
    });
    setLocalDrafts((current) => {
      const next = { ...current };
      for (const id of acknowledged) {
        const local = next[id];
        const saved = savedDrafts[id]!;
        if (local && local.rawValue === saved.rawValue && local.reason === saved.reason && local.action === saved.action) delete next[id];
      }
      return next;
    });
  }, [pendingDrafts, savedDrafts]);
  const pendingFor = (id: string): Draft | undefined => {
    const pending = pendingDrafts?.find((draft) => draft.projectParameterBindingId === id);
    return pending ? { rawValue: pending.rawText, reason: pending.reason, action: pending.action } : undefined;
  };
  const baselineFor = (binding: ProjectParameterBinding): Draft => savedDrafts[binding.id] ?? pendingFor(binding.id)
    ?? { rawValue: binding.rawValue, reason: "", action: "set" };
  const activeDraft = activeViewBinding ? localDrafts[activeViewBinding.id] ?? baselineFor(activeViewBinding) : null;
  const draftRaw = activeDraft?.rawValue ?? "";
  const draftReason = activeDraft?.reason ?? "";
  const draftAction = activeDraft?.action ?? "set";
  const updateDraft = (patch: Partial<Draft>) => {
    if (!activeViewBinding || !activeDraft || validating || !canEditBinding(activeViewBinding.id)) return;
    setLocalDrafts((current) => ({ ...current, [activeViewBinding.id]: { ...activeDraft, ...patch } }));
    setDiagnostics([]);
    setSaveMessage(null);
  };
  const sameDraft = (left: Draft, right: Draft) => left.rawValue === right.rawValue && left.reason === right.reason && left.action === right.action;
  const activeDirty = Boolean(activeViewBinding && activeDraft && !sameDraft(activeDraft, baselineFor(activeViewBinding)));
  const [detailTab, setDetailTab] = useState("configuration");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<TopologyDiagnostic[]>([]);
  const [validating, setValidating] = useState(false);
  const diagnosticId = useId();
  const targetInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Export & History states
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly JsonBindingHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyRequest = useRef(0);

  // Focus restore ref
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (viewingBindingId) {
      historyRequest.current += 1;
      setDetailTab("configuration");
      setHistory([]);
      setHistoryError(null);
      setHistoryLoaded(false);
      setHistoryLoading(false);
      setDiagnostics([]);
      setSaveMessage(null);
    }
  }, [viewingBindingId]);

  const unsavedCount = jsonBindings.filter((binding) => localDrafts[binding.id]
    && !sameDraft(localDrafts[binding.id]!, baselineFor(binding))).length;
  useEffect(() => {
    const key = `json-workbench:${resultsId}`;
    reportUnsavedParameterWork(key, unsavedCount);
    return () => clearUnsavedParameterWork(key);
  }, [resultsId, unsavedCount]);

  // Module ids are opaque; show the registry name, else the driver module, before falling back to the id.
  const moduleLabel = useCallback((binding: { moduleId?: string | null; driverModule?: string | null }) =>
    moduleRegistry?.modules.find((m) => m.id === binding.moduleId)?.name
      ?? binding.driverModule ?? binding.moduleId ?? "固定配置", [moduleRegistry]);

  // Build module navigation tree
  const jsonRows = useMemo(() => {
    return jsonBindings.map((b) => {
      const mod = moduleRegistry?.modules.find((m) => m.id === b.moduleId);
      const moduleName = moduleLabel(b);
      const moduleSortOrder = mod?.sortOrder ?? 100;
      return {
        bindingId: b.id,
        moduleId: b.moduleId ?? b.driverModule ?? "json-general",
        moduleName,
        moduleSortOrder,
        driverModule: b.driverModule,
        compatible: null,
        instanceName: b.instanceName,
        topologyPath: b.locator,
        governanceState: "valid" as const
      };
    });
  }, [jsonBindings, moduleRegistry, moduleLabel]);

  const tree = useMemo(() => {
    return buildModuleTree({
      rows: jsonRows,
      modules: moduleRegistry?.modules,
      groupByDevice: true
    });
  }, [jsonRows, moduleRegistry]);

  const [selectedNodeId, setSelectedNodeId] = useModuleNodeSelection((nodeId) => treeContainsNode(tree, nodeId));
  const selectedNodeExists = selectedNodeId ? treeContainsNode(tree, selectedNodeId) : true;
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;
  const selectedModulePath = useMemo(() => {
    const pending = tree.map((node) => ({ node, path: node.label }));
    while (pending.length) {
      const current = pending.pop()!;
      if (current.node.id === effectiveSelectedNodeId) return current.path;
      pending.push(...current.node.children.map((node) => ({ node, path: `${current.path} / ${node.label}` })));
    }
    return null;
  }, [tree, effectiveSelectedNodeId]);

  useEffect(() => {
    if (!requestedBindingId || handledRequest.current === requestedBindingId
      || !jsonBindings.some((binding) => binding.id === requestedBindingId)) return;
    handledRequest.current = requestedBindingId;
    setResultsMode("parameters");
    setQuery("");
    setSelectedNodeId(null);
    setViewingBindingId(requestedBindingId);
  }, [jsonBindings, requestedBindingId, setSelectedNodeId]);

  const handledEditRequest = useRef<string | null>(null);
  useEffect(() => {
    const request = `${requestedEditBindingId}:${editRequestToken ?? 0}`;
    if (!requestedEditBindingId || handledEditRequest.current === request
      || !jsonBindings.some((binding) => binding.id === requestedEditBindingId)) return;
    handledEditRequest.current = request;
    setViewingBindingId(requestedEditBindingId);
    setDetailTab("configuration");
  }, [requestedEditBindingId, editRequestToken, jsonBindings]);

  const subtreeBindingIds = useMemo(
    () => selectedSubtreeBindingIds(tree, effectiveSelectedNodeId),
    [effectiveSelectedNodeId, tree]
  );

  const filteredBindings = useMemo(() => {
    let result = jsonBindings;
    if (subtreeBindingIds) {
      result = result.filter((b) => subtreeBindingIds.has(b.id));
    }
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter((binding) => {
      const prop = `${binding.propertyKey} ${binding.currentDisplayName ?? ""} ${binding.displayName ?? ""}`.toLowerCase();
      const mod = `${moduleLabel(binding)} ${binding.moduleId ?? ""} ${binding.driverModule ?? ""}`.toLowerCase();
      const inst = (binding.instanceName ?? "").toLowerCase();
      const loc = (binding.locator ?? "").toLowerCase();
      const val = (binding.rawValue ?? "").toLowerCase();
      return (
        prop.includes(q) ||
        mod.includes(q) ||
        inst.includes(q) ||
        loc.includes(q) ||
        val.includes(q)
      );
    });
  }, [jsonBindings, query, subtreeBindingIds, moduleLabel]);

  const syntaxStatus = useMemo(() => {
    if (!draftRaw.trim()) return { valid: false, message: "请输入有效的 JSON 值；空字符串请填写双引号。" };
    try {
      JSON.parse(draftRaw);
      return { valid: true, message: "JSON 格式有效" };
    } catch {
      return { valid: false, message: "JSON 语法解析异常，请检查标点及闭合" };
    }
  }, [draftRaw]);

  const submitDraft = (action: "set" | "delete") => {
    if (!activeViewBinding || !canEditBinding(activeViewBinding.id) || validating || !onValidateEdit
      || !draftReason.trim() || !activeDirty || (action === "set" && !syntaxStatus.valid)) return;
    const bindingId = activeViewBinding.id;
    const savedDraft: Draft = { rawValue: action === "delete" ? "" : draftRaw, reason: draftReason.trim(), action };
    setValidating(true);
    void Promise.resolve().then(() =>
      onValidateEdit({
        bindingId,
        rawValue: savedDraft.rawValue,
        reason: savedDraft.reason,
        ...(action === "delete" ? { action } : {})
      })
    )
      .then((result) => {
        setDiagnostics(result?.diagnostics ?? []);
        if (result?.valid !== false) {
          setSavedDrafts((current) => ({ ...current, [bindingId]: savedDraft }));
          setLocalDrafts((current) => ({ ...current, [bindingId]: savedDraft }));
          setSaveMessage("草稿已保存，待提交审核。当前生效值未改变。");
        }
      })
      .catch((error: unknown) => setDiagnostics([{ message: presentError(error, "草稿保存失败，输入已保留，请重试。") }]))
      .finally(() => {
        setValidating(false);
      });
  };

  const loadHistoryFor = (bindingId: string) => {
    if (!onLoadHistory) return;
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(null);
    void onLoadHistory(bindingId)
      .then((items) => { if (request === historyRequest.current) { setHistory(items); setHistoryLoaded(true); } })
      .catch(() => { if (request === historyRequest.current) setHistoryError("固定值历史加载失败，请稍后重试。"); })
      .finally(() => { if (request === historyRequest.current) setHistoryLoading(false); });
  };

  const openDetail = (bindingId: string) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setViewingBindingId(bindingId);
  };

  const closeDialogs = () => {
    if (validating) return;
    setViewingBindingId(null);
    queueMicrotask(() => {
      if (openerRef.current?.isConnected) {
        openerRef.current.focus();
      }
    });
  };

  const handleExport = (bindingId: string) => {
    if (!onExportBinding) return;
    setExportingId(bindingId);
    setExportError(null);
    void onExportBinding(bindingId)
      .catch(() => setExportError("固定源导出失败，请稍后重试。"))
      .finally(() => setExportingId(null));
  };

  const loadJsonSource = useCallback(() => {
    setJsonSourceStatus("loading");
    setJsonSourceErrorMessage(null);
    setJsonSourceLoadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if ((resultsMode !== "jsonSource" && detailTab !== "source") || jsonSourceLoadToken === 0) {
      return undefined;
    }
    let cancelled = false;

    if (!loadPrimaryJsonSource) {
      setJsonSource(synthesizeJsonSource(jsonBindings, projectName));
      setJsonSourceStatus("ready");
      setJsonSourceErrorMessage(null);
      return undefined;
    }

    void loadPrimaryJsonSource()
      .then((source) => {
        if (!cancelled) {
          setJsonSource(source);
          setJsonSourceStatus("ready");
          setJsonSourceErrorMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setJsonSource(null);
          setJsonSourceStatus("error");
          setJsonSourceErrorMessage(presentError(error, "无法加载 JSON 源码，请稍后重试。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jsonBindings, jsonSourceLoadToken, loadPrimaryJsonSource, projectName, resultsMode, detailTab]);

  const enterJsonSourceMode = () => {
    setResultsMode("jsonSource");
    if (jsonSourceStatus !== "ready" || !jsonSource) {
      loadJsonSource();
    }
  };

  const downloadJsonSource = () => {
    if (!jsonSource) return;
    const blob = new Blob([jsonSource.text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = jsonSource.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportRows = () => {
    if (onExportRows) {
      onExportRows(filteredBindings);
      return;
    }
    downloadJsonWorkbenchCsv(
      filteredBindings,
      projectName ? `json-parameters-${projectName}.csv` : "json-parameters-export.csv"
    );
  };

  const moduleFocusLine = useMemo(() => {
    if (resultsMode !== "jsonSource" || !jsonSource) return null;
    return findEarliestJsonSourceLine(jsonSource.text, jsonBindings, subtreeBindingIds);
  }, [jsonBindings, jsonSource, resultsMode, subtreeBindingIds]);

  const moduleJumpStatus = useMemo(() => {
    if (resultsMode !== "jsonSource" || subtreeBindingIds === null) return null;
    if (moduleFocusLine !== null) return null;
    return "当前模块暂无源码行定位";
  }, [moduleFocusLine, resultsMode, subtreeBindingIds]);

  if (jsonBindings.length === 0) return null;

  return (
    <section className="dts-parameter-workbench json-parameter-workbench" aria-label="JSON 参数">
      <NavigatorWorkbench pageKey="parameters" navigatorLabel="模块导航"
        taskLabel={resultsMode === "parameters" ? "JSON 参数列表" : "JSON 源码结果"}
        taskClassName="dts-workbench-list"
        panelId={`${resultsId}-${resultsMode}-panel`} tabId={`${resultsId}-${resultsMode}-tab`}
        taskState={resultsMode === "parameters" ? undefined
          : jsonSourceStatus === "loading" ? { kind: "loading", message: "正在加载 JSON 源码…" }
          : jsonSourceStatus === "error" ? { kind: "error", message: "无法加载 JSON 源码。", detail: jsonSourceErrorMessage ?? undefined, onRetry: loadJsonSource }
          : !jsonSource ? { kind: "empty", message: "暂无 JSON 源码。" } : undefined}
        notice={notice}
        toolbar={(primaryAction) => <>
        <label className="dts-parameter-workbench__search">
          <span>{resultsMode === "jsonSource" ? "查找源码" : "搜索参数"}</span>
          <SearchField
            value={resultsMode === "jsonSource" ? jsonFindQuery : query}
            onValueChange={resultsMode === "jsonSource" ? setJsonFindQuery : setQuery}
            ariaLabel={resultsMode === "jsonSource" ? "在 JSON 源码中查找" : "搜索 JSON 参数"}
            placeholder={
              resultsMode === "jsonSource"
                ? "在 JSON 文本中查找"
                : "搜索参数名、所属模块、器件定位或取值…"
            }
            onKeyDown={(event) => {
              if (resultsMode === "jsonSource" && event.key === "Enter") {
                event.preventDefault();
                setFindNextToken((current) => current + 1);
              }
            }}
            onClear={() => {
              if (resultsMode === "jsonSource") {
                setJsonFindQuery("");
              } else {
                setQuery("");
              }
            }}
          />
        </label>
        {resultsMode === "jsonSource" ? (
          <p role="status" aria-live="polite" className="dts-parameter-workbench__result-count">
            {moduleJumpStatus
              ?? (jsonFindQuery.trim()
                ? `匹配 ${findStatus.activeIndex} / ${findStatus.matchCount}`
                : null)}
          </p>
        ) : (
          <span className="dts-parameter-workbench__result-count">
            {query.trim() || effectiveSelectedNodeId
              ? `匹配 ${filteredBindings.length} / ${jsonBindings.length} 项`
              : `共 ${jsonBindings.length} 项`}
          </span>
        )}
        {resultsMode === "parameters" && (query.trim() || selectedModulePath) ? <div className="json-binding-detail__filter-context" aria-label="当前筛选">
          {selectedModulePath ? <span>模块：{selectedModulePath}</span> : null}
          {query.trim() ? <span>搜索：{query.trim()}</span> : null}
          <button type="button" className="button subtle" onClick={() => { setQuery(""); setSelectedNodeId(null); }}>清除筛选</button>
        </div> : null}
        <div className="dts-parameter-workbench__toolbar-actions">
          <div className="dts-parameter-workbench__header-actions">
            <ViewSwitch
              variant="tabs"
              ariaLabel="结果模式"
              value={resultsMode}
              onValueChange={(value) => value === "parameters" ? setResultsMode("parameters") : enterJsonSourceMode()}
              items={[
                { value: "parameters", label: <><Boxes size={15} strokeWidth={1.9} aria-hidden="true" />参数列表</>,
                  id: `${resultsId}-parameters-tab`, panelId: `${resultsId}-parameters-panel` },
                { value: "jsonSource", label: <><FileCode size={15} strokeWidth={1.9} aria-hidden="true" />JSON 源码</>,
                  id: `${resultsId}-jsonSource-tab`, panelId: `${resultsId}-jsonSource-panel` }
              ]}
            />
          </div>
          {toolbarActions}
          {primaryAction}
        </div>
        </>}
        primaryAction={resultsMode === "jsonSource" ? (
              <button
                type="button"
                className="button subtle"
                disabled={jsonSourceStatus !== "ready" || !jsonSource}
                onClick={downloadJsonSource}
              >
                <Download size={15} strokeWidth={1.9} aria-hidden="true" />
                下载 JSON
              </button>
            ) : (
              <button
                type="button"
                className="button subtle"
                disabled={filteredBindings.length === 0}
                onClick={handleExportRows}
              >
                <Download size={15} strokeWidth={1.9} aria-hidden="true" />
                导出当前结果
              </button>
            )}
        context={currentEdits ? (
        <div
          className="dts-parameter-workbench__current-edits dts-draft-tray"
          role="region"
          aria-label="本轮已修改"
        >
          {currentEdits}
        </div>
      ) : null}

        navigator={
          <DtsTopologyNavigator
            view="effective"
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            defaultExpandDepth={2}
            labelKind="text"
            emptyMessage="暂无模块分组"
            ariaLabel="业务模块树"
            onSelectNode={(nodeId) =>
              setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
            }
          />
        }
      >
          {resultsMode === "parameters" ? (
            <div className="dts-workbench-list__scroll-x">
              <div className="dts-workbench-list__scroll-y">
                <table role="table" aria-label="JSON 参数列表" className="json-parameter-workbench-table">
                  <thead className="json-parameter-workbench-table__head">
                    <tr>
                      <th scope="col" className="json-parameter-workbench-table__th-property">参数名</th>
                      <th scope="col" className="json-parameter-workbench-table__th-module">所属模块</th>
                      <th scope="col" className="json-parameter-workbench-table__th-locator">器件 / 定位</th>
                      <th scope="col" className="json-parameter-workbench-table__th-value">当前值</th>
                      <th scope="col" className="json-parameter-workbench-table__th-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody className="json-parameter-workbench-table__body">
                    {filteredBindings.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="json-parameter-workbench__empty">
                          <SectionEmpty message="无匹配的 JSON 参数" />
                        </td>
                      </tr>
                    ) : (
                      filteredBindings.map((binding) => {
                        const isDraft = draftBindingIds?.has(binding.id) ?? false;
                        const isSelected = viewingBindingId === binding.id;
                        const rowModuleLabel = moduleLabel(binding);

                        return (
                          <tr
                            key={binding.id}
                            className={`json-parameter-workbench-table__row${isSelected ? " is-selected" : ""}${isDraft ? " is-draft" : ""}`}
                            onClick={() => openDetail(binding.id)}
                          >
                            <td className="dts-parameter-workbench-table__property">
                              <div className="json-parameter-workbench__property-cell">
                                <strong>{binding.currentDisplayName || binding.displayName || binding.propertyKey}</strong>
                                {(binding.currentDisplayName || binding.displayName) ? <small><code>{binding.propertyKey}</code></small> : null}
                                {isDraft ? (
                                  <span className="dts-parameter-workbench-table__draft-badge">草稿</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <span className="dts-parameter-workbench-table__module">
                                <strong>{rowModuleLabel}</strong>
                              </span>
                            </td>
                            <td className="dts-parameter-workbench-table__identity">
                              <div className="json-parameter-workbench__identity-cell">
                                <strong>{binding.instanceName ?? "—"}</strong>
                                {binding.locator ? <small>{binding.locator}</small> : null}
                              </div>
                            </td>
                            <td>
                              <code className="json-parameter-workbench-table__value-preview" title={binding.rawValue}>
                                {binding.rawValue}
                              </code>
                            </td>
                            <td className="json-parameter-workbench-table__th-actions" onClick={(e) => e.stopPropagation()}>
                              <div className="dts-parameter-workbench-table__actions">
                                <button
                                  type="button"
                                  className="button subtle dts-parameter-workbench-table__icon-action"
                                  title="参数详情"
                                  aria-label={`参数详情 ${binding.propertyKey}`}
                                  onClick={() => openDetail(binding.id)}
                                >
                                  <ArrowUpRight size={15} strokeWidth={1.9} aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : jsonSource ? (
            <ProjectPrimaryDtsViewer
              fileName={jsonSource.fileName}
              versionNumber={jsonSource.versionNumber}
              text={jsonSource.text}
              focusLine={moduleFocusLine}
              findQuery={jsonFindQuery}
              findNextToken={findNextToken}
              onFindStatusChange={setFindStatus}
              bodyAriaLabel="JSON 源码"
            />
          ) : null}
      </NavigatorWorkbench>

      {activeViewBinding ? (
        <ModalDialog open onDismiss={validating ? undefined : closeDialogs}
          className="dts-binding-detail-dialog json-binding-detail"
          backdropClassName="dts-binding-detail-dialog__overlay" describedBy>
          {({ titleId, descriptionId }) => <>
            <header className="json-binding-detail__head">
              <div>
                <h2 id={titleId}>{visibleLatestDefinition?.displayName || activeViewBinding.currentDisplayName || activeViewBinding.displayName || activeViewBinding.propertyKey} 参数详情</h2>
                <p id={descriptionId}>{projectName ? `${projectName} · ` : ""}{moduleLabel(activeViewBinding)} · {activeViewBinding.instanceName || "固定配置"}</p>
                <code>{activeViewBinding.propertyKey}</code>
              </div>
              <button type="button" className="button ghost" aria-label="关闭参数详情" disabled={validating} onClick={closeDialogs}>
                <CircleX size={18} aria-hidden="true" />
              </button>
            </header>
            <ViewSwitch variant="tabs" ariaLabel="参数详情内容" value={detailTab}
              onValueChange={(value) => {
                setDetailTab(value);
                if (value === "history" && !historyLoaded && !historyLoading) loadHistoryFor(activeViewBinding.id);
                if (value === "source" && jsonSourceStatus !== "ready" && jsonSourceStatus !== "loading") loadJsonSource();
              }}
              items={[{ value: "configuration", label: "配置" }, { value: "history", label: "变更历史" }, { value: "source", label: "配置来源" }]
                .map((item) => ({ ...item, id: `${diagnosticId}-${item.value}-tab`, panelId: `${diagnosticId}-${item.value}-panel` }))} />
            <div className="json-binding-detail__body">
              <div role="tabpanel" id={`${diagnosticId}-configuration-panel`} aria-labelledby={`${diagnosticId}-configuration-tab`} hidden={detailTab !== "configuration"}>
                <div className="json-binding-detail__configuration">
                  <section aria-label="当前配置">
                    <h3>当前生效值</h3>
                    {latestStatus === "loading" ? <p role="status">正在读取最新目录说明…</p> : null}
                     {latestStatus === "error" ? <p role="status">最新目录说明暂不可用，当前展示项目固定修订。</p> : null}
                     {visibleLatestDefinition && visibleLatestDefinition.revisionId !== (activeViewBinding.effectiveRevisionId ?? activeViewBinding.parameterSpecVersionId) ?
                       <p role="status">当前目录定义 v{visibleLatestDefinition.revisionNumber} · 项目合同仍固定于 {activeViewBinding.effectiveRevisionId ?? activeViewBinding.parameterSpecVersionId}。说明来自最新目录，项目的校验规则与参数值未改变。</p> : null}
                     {visibleLatestDefinition ? (visibleLatestDefinition.documentation ? <p>{visibleLatestDefinition.documentation}</p> : null)
                       : activeViewBinding.description || activeViewBinding.documentation ? <p>{activeViewBinding.description || activeViewBinding.documentation}</p> : null}
                     {visibleLatestDefinition?.examples?.length ? <div><strong>最新目录示例（仅供参考）</strong><pre>{JSON.stringify(visibleLatestDefinition.examples, null, 2)}</pre></div> : null}
                    <pre className="json-binding-card__preview-code">{prettyJson(activeViewBinding.rawValue)}</pre>
                    <p className="json-binding-detail__hint">类型：JSON · {activeViewBinding.schemaState === "valid" ? "有效配置" : "待校验"}</p>
                  </section>
                  <section aria-label="草稿配置" className="json-binding-detail__form">
                    {!canEditBinding(activeViewBinding.id) ? <p role="status">{validating ? "正在保存草稿，请稍候…" : "当前参数只读。可查看配置、历史及来源。"}</p> : null}
                    <label htmlFor={`${diagnosticId}-target`}>目标值</label>
                    <Textarea ref={targetInputRef} id={`${diagnosticId}-target`} aria-label="目标值" value={draftRaw}
                      disabled={!canEditBinding(activeViewBinding.id) || validating || draftAction === "delete"} rows={8}
                      aria-invalid={draftAction === "set" && (!syntaxStatus.valid || diagnostics.length > 0)}
                      aria-describedby={diagnostics.length > 0 ? diagnosticId : `${diagnosticId}-syntax`}
                      onChange={(event) => updateDraft({ rawValue: event.target.value })} />
                    <p id={`${diagnosticId}-syntax`} role="status" className="json-binding-detail__hint">
                      {draftAction === "delete" ? "保存后将删除此属性，需提交审核后生效。" : syntaxStatus.message}
                    </p>
                    <label htmlFor={`${diagnosticId}-reason`}>修改原因</label>
                    <Textarea id={`${diagnosticId}-reason`} aria-label="修改原因" value={draftReason} rows={2}
                      disabled={!canEditBinding(activeViewBinding.id) || validating} placeholder="说明本次配置调整的原因" onChange={(event) => updateDraft({ reason: event.target.value })} />
                    <details><summary>属性操作</summary>
                      <label><input type="checkbox" aria-label="删除此属性" checked={draftAction === "delete"} disabled={!canEditBinding(activeViewBinding.id) || validating}
                        onChange={(event) => updateDraft({ action: event.target.checked ? "delete" : "set" })} /> 删除此属性</label>
                      <p>删除操作会移除配置属性，与将 JSON 值设为 null 不同。</p>
                    </details>
                  </section>
                </div>
                {activeDirty ? <section aria-label="当前到目标差异"><h3>变更预览</h3>
                  <DiffCodeBlock baseValue={prettyJson(activeViewBinding.rawValue)} targetValue={draftAction === "delete" ? "已删除" : prettyJson(draftRaw)} />
                </section> : null}
              </div>
              <div role="tabpanel" id={`${diagnosticId}-history-panel`} aria-labelledby={`${diagnosticId}-history-tab`} hidden={detailTab !== "history"}>
                {!onLoadHistory ? <p>当前环境未提供参数历史。</p> : <>
                  {historyLoading ? <p role="status">正在加载变更历史…</p> : null}
                  {historyError ? <><p role="alert">{historyError}</p><button className="button subtle" onClick={() => loadHistoryFor(activeViewBinding.id)}>重试</button></> : null}
                  {historyLoaded && history.length === 0 ? <p role="status">暂无参数变更记录</p> : null}
                  <ol className="json-binding-card__history-timeline">{history.map((entry) => <li key={entry.id} className="json-binding-card__history-entry">
                    <strong>{entry.valueState === "deleted" ? "删除属性" : "配置变更"}</strong>
                    <p><time dateTime={entry.createdAt}>{formatRelativeOrAbsolute(entry.createdAt)}</time>{entry.actor ? ` · ${entry.actor}` : ""}</p>
                    <p>{entry.reason === "source-revision-propagation" ? "同步来源修订" : entry.reason === "project-value-append" ? "项目配置写入" : entry.reason || "未记录修改原因"}</p>
                    {entry.fromRawValue !== undefined || entry.toRawValue !== undefined ? <DiffCodeBlock
                      baseValue={entry.fromRawValue == null ? "尚未配置" : prettyJson(entry.fromRawValue)}
                      targetValue={entry.valueState === "deleted" ? "已删除" : entry.toRawValue == null ? "未知" : prettyJson(entry.toRawValue)} /> : null}
                    <details><summary>技术信息</summary><dl>
                      <div><dt>事件标识</dt><dd><code>{entry.id}</code></dd></div>
                      <div><dt>原值标识</dt><dd><code>{entry.oldCurrentValueId || "无"}</code></dd></div>
                      <div><dt>新值标识</dt><dd><code>{entry.newCurrentValueId || "无"}</code></dd></div>
                    </dl></details>
                  </li>)}</ol>
                </>}
              </div>
              <div role="tabpanel" id={`${diagnosticId}-source-panel`} aria-labelledby={`${diagnosticId}-source-tab`} hidden={detailTab !== "source"}>
                <dl><div><dt>配置定位</dt><dd><code>{activeViewBinding.locator || activeViewBinding.propertyKey}</code></dd></div>
                  <div><dt>所属模块</dt><dd>{moduleLabel(activeViewBinding)}</dd></div></dl>
                {jsonSourceStatus === "loading" ? <p role="status">正在加载配置来源…</p> : null}
                {jsonSourceStatus === "error" ? <><p role="alert">{jsonSourceErrorMessage}</p><button className="button subtle" onClick={loadJsonSource}>重试</button></> : null}
                {jsonSource ? <><p>{jsonSource.fileName} · 第 {jsonSource.versionNumber} 版 · 只读{!loadPrimaryJsonSource ? " · 当前配置快照" : ""}</p>
                  <pre className="json-binding-card__preview-code">{jsonSource.text}</pre></> : null}
                {onExportBinding ? <button type="button" className="button subtle" disabled={exportingId === activeViewBinding.id}
                  onClick={() => handleExport(activeViewBinding.id)}><Download size={14} aria-hidden="true" />{exportingId ? "导出中…" : "导出源文件"}</button> : null}
                {exportError ? <p role="alert">{exportError}</p> : null}
              </div>
            </div>
            {diagnostics.length > 0 ? <ul id={diagnosticId} role="alert" className="json-binding-card__alert">{diagnostics.map((item, index) => <li key={index}>
              {presentError(new Error(item.message), "目标值未通过校验，请检查格式、范围及来源版本后重试。")}</li>)}</ul> : null}
            <footer className="json-binding-detail__footer">
              <span role="status">{saveMessage || (activeDirty ? "未保存修改 · 关闭后保留本次输入" : pendingFor(activeViewBinding.id) || savedDrafts[activeViewBinding.id] ? "已保存，待提交审核" : "尚无修改")}</span>
              {activeDirty ? <button type="button" className="button subtle" disabled={validating} onClick={() => setDiscardOpen(true)}>放弃本地修改</button> : null}
              <button type="button" className="button primary"
                disabled={!canEditBinding(activeViewBinding.id) || validating || !onValidateEdit || !activeDirty || !draftReason.trim() || (draftAction === "set" && !syntaxStatus.valid)}
                onClick={() => submitDraft(draftAction)}>{validating ? "保存中…" : draftAction === "delete" ? "保存删除草稿" : "保存草稿"}</button>
              <button type="button" className="button subtle" disabled={validating} onClick={closeDialogs}>关闭</button>
            </footer>
          </>}
        </ModalDialog>
      ) : null}
      <ConfirmDialog open={discardOpen} title="放弃本地修改" description="本次尚未保存的输入将被清除，已保存的草稿不受影响。"
        confirmLabel="放弃修改" cancelLabel="继续编辑" tone="danger"
        onConfirm={() => { if (activeViewBinding) setLocalDrafts((current) => { const next = { ...current }; delete next[activeViewBinding.id]; return next; }); setDiscardOpen(false); setDiagnostics([]); }}
        onCancel={() => setDiscardOpen(false)} />
    </section>
  );
}
