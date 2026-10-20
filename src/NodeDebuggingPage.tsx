import { Copy, Eye, Pencil, RotateCcw, RotateCw, Send } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { canPerform } from "@/app/permissions";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { ColumnFilter } from "./components/ColumnFilter";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { ModuleTreeSelect } from "./components/common/ModuleTreeSelect";
import { SearchField } from "./components/common/SearchField";
import { NavigatorWorkbench } from "./components/layout/NavigatorWorkbench";
import { Button } from "@/components/ui/button";
import { SectionError, SectionSkeleton } from "./components/common/SectionState";
import { createSearchIndex } from "@/lib/search";
import { debugParameterSearchProfile } from "@/lib/search/profiles";
import { LocalDeviceBridgePanel } from "./components/LocalDeviceBridgePanel";
import { NodeOperationHistoryPanel } from "./components/NodeOperationHistoryPanel";
import { RollbackConfirmDialog } from "./components/RollbackConfirmDialog";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { useTopBarActions } from "./components/layout";
import { DtsTopologyNavigator } from "./components/parameter-topology/DtsTopologyNavigator";
import { useModuleNodeSelection } from "./hooks/useModuleNodeSelection";
import {
  probeLocalBridgeHealthDetailed,
  type LocalBridgeProbeResult
} from "./infrastructure/http/bridgeConnectLauncher";
import type { DeviceBridgePairingCode, DeviceBridgeRecord } from "./infrastructure/http/deviceBridgeClient";
import type { DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import {
  bindingUnavailableReason,
  bridgeTargetLabel,
  canRead,
  canWrite,
  readInitialNodeDebuggingProtocol,
  type RuntimeRow
} from "./application/debugging/nodeDebuggingSession";
import { useNodeDebuggingSession } from "./application/debugging/useNodeDebuggingSession";
import { buildParameterModuleFilterNodes } from "./application/parameters/buildModuleFilterNodes";
import type { DtsWorkbenchTreeNode } from "./application/parameters/buildDtsTopologyTree";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "./domain/modules/moduleTree";
import {
  debugValueEditorRows,
  debugValuePreview,
  getDebugNormalizationModeLabel,
  getDebugValueFormatLabel,
  isComplexDebugParameter,
  TABLE_PREVIEW_MAX_CHARS
} from "./debugValueKind";
import { resolveWriteFormatExample, resolveWriteFormatHint } from "@/domain/debugging/writeFormat";
import { nodeRowSubtitle } from "@/domain/debugging/nodeRowSubtitle";
import {
  buildRuntimeDebugModuleTree,
  debugNodeModuleId,
  filterDebugNodesByModuleTree,
  modulePathLabelForDebugNode
} from "@/debugAdminModules";
import type { PrototypeState } from "@/domain/prototype/types";
import "./node-debugging-refinement.css";

export { readInitialNodeDebuggingProtocol };

const unsupportedNodeValueLabel = "该节点不支持";

/** Stable default so the bridge panel's refresh effect is not re-triggered every render. */
const defaultProbeBridgeHealth = () => probeLocalBridgeHealthDetailed();

function isUnsupportedParameterError(message?: string) {
  if (!message) return false;
  return message.includes("not configured for the selected protocol")
    || message.includes("binding is disabled for the selected protocol")
    || message.includes("当前协议未配置该节点")
    || message.includes("当前设备未配置该节点")
    || message.includes("绑定已禁用");
}

function canonicalAssociationLabel(row: Pick<RuntimeRow, "protectedReferenceKind" | "protectedReferenceReason">) {
  if (row.protectedReferenceKind === "canonical-pin") return "参数关联：已关联";
  if (row.protectedReferenceReason === "project-scope") return "参数关联：无项目访问权限";
  if (row.protectedReferenceReason === "legacy-binding-id") return "参数关联：旧关联需重新配置";
  if (row.protectedReferenceReason && row.protectedReferenceReason !== "missing-binding") {
    return "参数关联：不可用";
  }
  return "参数关联：未关联";
}

function statusClass(status: RuntimeRow["runtimeStatus"]) {
  const classMap: Record<RuntimeRow["runtimeStatus"], string> = {
    "未读取": "node-status-untested",
    "读取中": "node-status-running",
    "写入中": "node-status-running",
    "写入已执行": "node-status-pending",
    "写入已回读": "node-status-success",
    "回读失败": "node-status-failed",
    "回读结果未知": "node-status-pending",
    "读取成功": "node-status-success",
    "读取失败": "node-status-failed",
    "写入失败": "node-status-failed",
    "写入结果未知": "node-status-pending",
    "不可用": "node-status-unavailable"
  };
  return `node-status-badge ${classMap[status]}`;
}

function nodeStatusDescription(row: RuntimeRow) {
  if (row.error) return row.error;
  if (row.runtimeStatus === "写入已回读") return "写命令已执行，并已取得回读值；回读值仅供核对，不代表与目标值一致。";
  if (row.runtimeStatus === "写入已执行") return "写命令已执行，尚未取得回读值。";
  if (row.runtimeStatus === "不可用") return bindingUnavailableReason(row) || "仅写节点暂不支持安全写入。";
  if (row.runtimeStatus === "未读取") return "尚未取得本次连接的节点值。";
  return row.runtimeStatus;
}

function NodeRowStatus({ row }: { row: RuntimeRow }) {
  return <div className="node-row-status">
    <span data-row-status className={statusClass(row.runtimeStatus)} title={nodeStatusDescription(row)}>{row.runtimeStatus}</span>
    {row.pendingWrite ? <span className="node-status-badge node-status-pending" title="目标值已暂存，尚未执行写入；读取不会清除队列。">待写入</span> : null}
  </div>;
}

function nodeErrorSummary(error: string) {
  if (/permission denied/i.test(error)) return "节点访问被拒绝，请检查权限";
  if (/no such file|node missing/i.test(error)) return "节点不存在，请检查节点路径";
  if (/timed?\s*out|timeout/i.test(error)) return "操作超时，请检查设备连接后重试";
  return error;
}

function buildDebugModuleNavigationTree(
  rows: readonly RuntimeRow[],
  moduleNodes: readonly FlatModuleNode[]
): DtsWorkbenchTreeNode[] {
  const rowIdsByModule = new Map<string, string[]>();
  for (const row of rows) {
    const moduleId = debugNodeModuleId(row, moduleNodes);
    rowIdsByModule.set(moduleId, [...(rowIdsByModule.get(moduleId) ?? []), row.id]);
  }

  const toNavigationNode = (module: ModuleTreeNode): DtsWorkbenchTreeNode => {
    const children = module.children.map(toNavigationNode);
    const bindingIds = rowIdsByModule.get(module.id) ?? [];
    return {
      id: module.id,
      parentId: module.parentId,
      label: module.name,
      name: module.name,
      unitAddress: null,
      compatible: null,
      bindingIds,
      bindingCount: bindingIds.length + children.reduce((count, child) => count + child.bindingCount, 0),
      attentionCount: 0,
      children
    };
  };

  return buildModuleTree(moduleNodes).map(toNavigationNode);
}

function displayCurrentValue(row: RuntimeRow, context: "table" | "detail" = "detail"): string {
  if (row.accessMode === "WO") return "安全写入不可用";
  if (bindingUnavailableReason(row)) return unsupportedNodeValueLabel;
  if (row.runtimeStatus === "写入失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    if (row.lastReadValue !== undefined) {
      return context === "table" && isComplexDebugParameter(row)
        ? debugValuePreview(row.runtimeCurrentValue, row)
        : row.runtimeCurrentValue;
    }
    return "未取得值";
  }
  if (row.runtimeStatus === "读取失败" || row.runtimeStatus === "回读失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    if (row.lastReadValue === undefined) return "未取得值";
  }
  if (row.lastReadValue !== undefined) {
    return context === "table" && isComplexDebugParameter(row)
      ? debugValuePreview(row.runtimeCurrentValue, row)
      : row.runtimeCurrentValue;
  }
  if (row.activeOperation) {
    return row.activeOperation === "write" ? "写入中..." : "读取中...";
  }
  return "等待读取";
}

function DebugValueFormatBadge({ row }: { row: Pick<RuntimeRow, "valueKind" | "valueFormat"> }) {
  if (!isComplexDebugParameter(row)) {
    return null;
  }

  return <span className="debug-value-format-badge">{getDebugValueFormatLabel(row)}</span>;
}

function DebugTableValuePreview({ value, row }: { value: string; row: RuntimeRow }) {
  if (!isComplexDebugParameter(row)) {
    return <>{value}</>;
  }

  return (
    <span className="debug-value-cell">
      <span className="debug-value-preview" title={value}>{debugValuePreview(value, row)}</span>
      <DebugValueFormatBadge row={row} />
    </span>
  );
}

function DebugTableValueText({ value }: { value: string }) {
  return (
    <span className="debug-value-cell">
      <span className="debug-value-preview" title={value}>{value}</span>
    </span>
  );
}

function DebugCurrentValueCell({ row, connected }: { row: RuntimeRow; connected: boolean }) {
  const text = displayCurrentValue(row, "table");
  const hasComplexPayload =
    isComplexDebugParameter(row) &&
    row.lastReadValue !== undefined &&
    row.runtimeStatus !== "读取失败" &&
    row.runtimeStatus !== "回读失败" &&
    row.runtimeStatus !== "写入失败";

  if (hasComplexPayload) {
    return (
      <>
        <DebugTableValuePreview value={row.runtimeCurrentValue} row={row} />
        {row.currentValueStale && row.lastReadValue !== undefined ? <small className="node-row-warning">上次读取值 · 待重新读取</small> : null}
      </>
    );
  }

  return (
    <>
      <DebugTableValueText value={!connected && text === "等待读取" ? "设备未连接 · 等待读取" : text} />
      {row.currentValueStale && row.lastReadValue !== undefined ? <small className="node-row-warning">上次读取值 · 待重新读取</small> : null}
    </>
  );
}

function readbackOutcomeLabel(row: RuntimeRow) {
  if (row.readbackOutcome === "observed") return row.lastReadValue === undefined ? "已回读" : "已回读 · 返回值见当前值";
  if (row.readbackOutcome === "failed") return "回读失败";
  if (row.readbackOutcome === "unsupported") return "不支持回读";
  if (row.readbackOutcome === "not_requested") return "未执行回读";
  if (row.readbackOutcome === "unknown") return "回读结果未知";
  return "尚未回读";
}

function DebugValueCodeBlock({ label, row, value }: { label: string; row: RuntimeRow; value: string }) {
  return (
    <div className={`debug-value-code-block${isComplexDebugParameter(row) ? "" : " debug-value-code-block--text"}`}>
      <div className="debug-value-code-block__head">
        <strong>{label}</strong>
        {!isComplexDebugParameter(row) && row.unit ? <span className="node-detail-meta-label">单位：{row.unit}</span> : <DebugValueFormatBadge row={row} />}
      </div>
      <pre aria-label={label} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing code scrollport must support keyboard scrolling. */}>
        <code>{value || "-"}</code>
      </pre>
    </div>
  );
}

function NodeWriteFormatPanel({ row }: { row: RuntimeRow }) {
  const titleId = `node-write-format-${row.id}`;
  const exampleValue = resolveWriteFormatExample(row);
  const exampleHint = resolveWriteFormatHint(row, exampleValue);
  const isComplex = isComplexDebugParameter(row);

  return (
    <section className="node-write-format-panel" aria-labelledby={titleId}>
      <div className="node-write-format-head">
        <h3 id={titleId}>{isComplex ? "复杂值写入格式" : "写入格式"}</h3>
      </div>
      <p>
        {isComplex
          ? "复杂值会按所选格式与规范化模式写入设备端调试节点；写后回读仅展示设备返回值，不做相等性判定。"
          : "输入内容会作为原始字符串写入设备端调试节点。"}
      </p>
      <dl>
        {isComplex ? (
          <>
            <div>
              <dt>值类型</dt>
              <dd>复杂值</dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>{getDebugValueFormatLabel(row)}</dd>
            </div>
            <div>
              <dt>规范化模式</dt>
              <dd>{getDebugNormalizationModeLabel(row.normalizationMode)}</dd>
            </div>
            {row.maxValueBytes ? (
              <div>
                <dt>最大字节</dt>
                <dd>{row.maxValueBytes}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        <div>
          <dt>写入方式</dt>
          <dd>{row.accessMode === "RW" ? "写入后自动回读并展示返回值" : "无法取得写前快照，安全写入不可用"}</dd>
        </div>
      </dl>
      {!isComplex ? (
        <div className="node-write-format-example">
          <strong>示例</strong>
          <code>{exampleValue}</code>
          <span className="node-write-format-hint">{exampleHint}</span>
        </div>
      ) : null}
    </section>
  );
}

type NodeDebuggingRuntimeStatus = "loading" | "ready" | "error";

export function NodeDebuggingPage({
  state,
  debuggingActions,
  runtimeStatus: runtimeStatusOverride,
  runtimeError: runtimeErrorOverride,
  onRuntimeRetry,
  runtimeMode,
  bridges,
  probeBridgeHealth = defaultProbeBridgeHealth,
  createBridgePairingCode
}: {
  state: PrototypeState;
  /** All node operations go through the DebuggingGateway port behind these actions. */
  debuggingActions: DebuggingRuntimeActions;
  /** Test overrides; when absent the page manages the runtime lifecycle through its own mount refresh. */
  runtimeStatus?: NodeDebuggingRuntimeStatus;
  runtimeError?: string;
  onRuntimeRetry?: () => void;
  runtimeMode?: WiseEffRuntimeMode;
  /** Bridge panel seam for non-API runtimes; defaults to the HTTP bridge listing. */
  bridges?: DeviceBridgeRecord[];
  /** Local bridge health seam; defaults to the local HTTP health probe. */
  probeBridgeHealth?: () => Promise<LocalBridgeProbeResult>;
  /** Pairing-code seam for non-API runtimes; defaults to the HTTP client. */
  createBridgePairingCode?: () => Promise<DeviceBridgePairingCode>;
}) {
  // The runtime catalog hydrates when the page mounts; the shell no longer
  // watches page.key on the page's behalf. Non-api runtimes are ready at once.
  const isApiRuntime = runtimeMode === "api";
  const [selfRuntimeStatus, setSelfRuntimeStatus] = useState<NodeDebuggingRuntimeStatus>(
    isApiRuntime ? "loading" : "ready"
  );
  const [selfRuntimeError, setSelfRuntimeError] = useState("");
  const [runtimeReloadToken, setRuntimeReloadToken] = useState(0);
  useEffect(() => {
    if (!isApiRuntime || !canPerform(migrateLegacyRoleId(state.activeRoleId), "debugging.use")) {
      return;
    }

    let cancelled = false;
    // First load / retry-after-error shows the skeleton; once hydrated,
    // re-entering the page refreshes in the background without one.
    setSelfRuntimeStatus((current) => (current === "ready" ? current : "loading"));
    void debuggingActions
      .refresh({ protocol: readInitialNodeDebuggingProtocol() })
      .then(() => {
        if (!cancelled) {
          setSelfRuntimeStatus("ready");
          setSelfRuntimeError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelfRuntimeStatus("error");
          setSelfRuntimeError(presentError(error, "无法加载调试节点数据，请稍后重试。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debuggingActions, isApiRuntime, runtimeReloadToken, state.activeRoleId]);
  const runtimeStatus = runtimeStatusOverride ?? selfRuntimeStatus;
  const runtimeError = runtimeErrorOverride ?? selfRuntimeError;
  const handleRuntimeRetry = onRuntimeRetry ?? (() => setRuntimeReloadToken((token) => token + 1));
  const runtimeReady = runtimeStatus === "ready";

  const {
    session,
    protocol,
    rows,
    target,
    detecting,
    events,
    selectedIds,
    bridgeTargetCandidates,
    selectingBridgeTargetId,
    pendingHighRiskWrite,
    pendingBulkWrite,
    bulkWriteSummary,
    rollbackDialogOpen,
    connected,
    pendingRows,
    pendingSelectedRows,
    batchTargetRows
  } = useNodeDebuggingSession({
    initialParameters: state.debugParameters
  });

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [pathCopyResult, setPathCopyResult] = useState<{ path: string; message: string } | null>(null);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [moduleFilters, setModuleFilters] = useState<string[]>([]);
  const [selectedModuleNodeId, setSelectedModuleNodeId] = useModuleNodeSelection();
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    session.syncParameters(state.debugParameters);
  }, [session, state.debugParameters]);

  const detect = () => {
    if (!runtimeReady) {
      return;
    }
    guardEditorChange(() => {
      closeEditor();
      void session.detect(debuggingActions, probeBridgeHealth, { autoDetectProtocol: true });
    });
  };

  useEffect(() => {
    if (!runtimeReady) return;
    void session.detect(debuggingActions, probeBridgeHealth, { autoDetectProtocol: true });
    // Protocol comes from detection; changing it must not trigger another discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeReady]);

  const moduleNodes = useMemo(() => buildRuntimeDebugModuleTree(rows), [rows]);
  const moduleFilterNodes = useMemo(
    () =>
      buildParameterModuleFilterNodes(
        rows.map((row) => ({
          moduleId: debugNodeModuleId(row),
          moduleName: row.module,
          modulePath: row.modulePath
        })),
        moduleNodes.map((node) => ({
          id: node.id,
          name: node.name,
          parentId: node.parentId,
          sortOrder: node.sortOrder
        }))
      ),
    [moduleNodes, rows]
  );
  const moduleNavigationTree = useMemo(
    () => buildDebugModuleNavigationTree(rows, moduleNodes),
    [moduleNodes, rows]
  );
  const activeSelectedModuleNodeId = useMemo(
    () => selectedModuleNodeId && moduleNodes.some((node) => node.id === selectedModuleNodeId)
      ? selectedModuleNodeId
      : null,
    [moduleNodes, selectedModuleNodeId]
  );
  const activeModuleFilters = useMemo(() => {
    const availableModuleIds = new Set(moduleNodes.map((node) => node.id));
    return moduleFilters.filter((moduleId) => availableModuleIds.has(moduleId));
  }, [moduleFilters, moduleNodes]);
  const navigatedRows = useMemo(() => {
    return filterDebugNodesByModuleTree(
      rows,
      moduleNodes,
      activeSelectedModuleNodeId ? [activeSelectedModuleNodeId] : []
    );
  }, [activeSelectedModuleNodeId, moduleNodes, rows]);
  const moduleScopedRows = useMemo(() => {
    return filterDebugNodesByModuleTree(navigatedRows, moduleNodes, activeModuleFilters);
  }, [activeModuleFilters, moduleNodes, navigatedRows]);
  const visibleRows = useMemo(() => {
    const searched = createSearchIndex(moduleScopedRows, debugParameterSearchProfile).search(searchQuery);
    return searched
      .map((hit) => hit.item)
      .filter((row) => statusFilters.length === 0 || statusFilters.includes(row.runtimeStatus) || (row.pendingWrite && statusFilters.includes("待写入")));
  }, [moduleScopedRows, searchQuery, statusFilters]);

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => [row.runtimeStatus, ...(row.pendingWrite ? ["待写入"] : [])]))).map((status) => ({ value: status, label: status })),
    [rows]
  );
  const toggleArrayFilter = (currentValues: string[], value: string) =>
    currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
  const editingRow = editingRowId ? rows.find((row) => row.id === editingRowId) ?? null : null;
  const editingDirty = Boolean(editingRow && editingValue !== editingRow.draftValue);
  const closeEditor = () => setEditingRowId(null);
  const guardEditorChange = (action: () => void) => {
    if (editingDirty) setDiscardAction(() => action);
    else action();
  };
  const openEditor = (row: RuntimeRow) => guardEditorChange(() => {
    setEditingValue(row.draftValue);
    setPathCopyResult(null);
    setEditingRowId(row.id);
  });
  const copyNodePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setPathCopyResult({ path, message: "已复制节点路径" });
    } catch {
      setPathCopyResult({ path, message: "复制失败，请选中路径手动复制。" });
    }
  };
  const selectableVisibleIds = useMemo(
    () => visibleRows.filter((row) => canWrite(row)).map((row) => row.id),
    [visibleRows]
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleIds.filter((id) => selectedIds.includes(id)).length,
    [selectableVisibleIds, selectedIds]
  );
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;

  const renderModuleFilter = (label: string) => (
    <ModuleTreeSelect
      label={label}
      mode="multi-filter"
      nodes={moduleNodes}
      value={activeModuleFilters}
      onChange={(next) => setModuleFilters(Array.isArray(next) ? next : [next])}
      disabled={moduleNodes.length === 0}
      portalMenu
    />
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleIds.length;
    }
  }, [selectableVisibleIds.length, selectedVisibleCount]);

  useTopBarActions(
    <div className="device-pill">
      <span className={connected ? "live-dot" : "idle-dot"} />
      {connected ? `已连接：${target}` : detecting ? "检测中..." : "未连接设备"}
      <button className="link-button" type="button" disabled={!runtimeReady} onClick={() => detect()}>
        重新检测
      </button>
    </div>,
    [connected, detecting, protocol, runtimeReady, target, editingDirty, editingRowId, debuggingActions, probeBridgeHealth, session]
  );

  return (
    <div className="workbench-page node-debugging-page">
      <div className="debugging-workbench-content">
        <div>
        <NavigatorWorkbench
          pageKey="node-debugging"
          toolbar={<>
            <span className="parameters-table-count">
              <strong>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : `${pendingRows.length} 项节点等待写入`}</strong>
              {selectedIds.length > 0 ? ` · 其中 ${pendingSelectedRows.length} 项为待写入状态` : " · 编辑后暂存，再统一下发"}
            </span>
            <Button variant="outline" disabled={!runtimeReady || !connected || !state.lastDebugSnapshot}
              title={state.lastDebugSnapshot ? "回滚到上次写前快照" : "尚无快照，写入成功后自动生成"}
              onClick={() => session.requestRollback()}>
              <RotateCcw aria-hidden="true" />回滚快照
            </Button>
          </>}
          primaryAction={<Button data-primary-action="true" disabled={!runtimeReady || !connected || batchTargetRows.length === 0}
            onClick={() => void session.requestBulkWrite(debuggingActions)}>
            <Send aria-hidden="true" />
            {selectedIds.length > 0 ? `下发选中 (${pendingSelectedRows.length})` : "批量下发节点"}
          </Button>}
          context={<>
        <LocalDeviceBridgePanel
          compact
          target={target}
          detecting={detecting}
          protocol={protocol}
          onDetect={() => detect()}
          bridgesOverride={bridges}
          probeHealth={probeBridgeHealth}
          createPairingCode={createBridgePairingCode}
        />
        {bridgeTargetCandidates.length > 1 ? (
          <section className="bridge-target-picker" aria-label="设备代理目标选择">
            <div className="bridge-target-picker__head">
              <strong>检测到多个设备代理目标</strong>
              <small>请选择要连接的设备后再开始节点调试。</small>
            </div>
            <ul className="bridge-target-picker__list">
              {bridgeTargetCandidates.map((candidate) => {
                const selecting = selectingBridgeTargetId === candidate.id;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className="button subtle"
                      disabled={detecting && !selecting}
                      onClick={() => void session.selectBridgeTarget(candidate, debuggingActions)}
                    >
                      {selecting ? "连接中..." : `连接 ${bridgeTargetLabel(candidate)}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
          </>}
          navigatorLabel="模块导航"
          taskLabel="节点调试任务"
          navigator={
                <DtsTopologyNavigator
                  view="effective"
                  nodes={moduleNavigationTree}
                  selectedNodeId={activeSelectedModuleNodeId}
                  defaultExpandDepth={2}
                  labelKind="text"
                  countUnit="节点"
                  emptyMessage="暂无模块分组"
                  ariaLabel="调试节点模块树"
                  onSelectNode={(nodeId) =>
                    setSelectedModuleNodeId((current) => (current === nodeId ? null : nodeId))
                  }
                />
          }
        >
          {runtimeStatus === "loading" ? (
            <SectionSkeleton label="正在加载调试节点" />
          ) : runtimeStatus === "error" ? (
            <SectionError message={runtimeError || "无法加载调试节点数据，请稍后重试。"} onRetry={handleRuntimeRetry} />
          ) : (
          <section className="parameters-table parameters-table--column-filters" aria-label="节点调试参数">
            <div className="parameters-table-toolbar">
              <SearchField
                value={searchQuery}
                onValueChange={setSearchQuery}
                placeholder="搜索名称、Key、描述、模块或路径"
                ariaLabel="搜索名称、Key、描述、模块或路径"
              />
              <span className="parameters-table-count">显示 {visibleRows.length} / {navigatedRows.length} 个参数</span>
              <div className="node-debugging-mobile-filters">
                {renderModuleFilter("模块筛选")}
              </div>
            </div>

            <HorizontalDragScroll className="parameters-table-scroll">
              <table className="parameters-table-grid node-debugging-grid">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="全选当前可写节点"
                        checked={allVisibleSelected}
                        disabled={selectableVisibleIds.length === 0}
                        onChange={() => session.toggleSelectAll(selectableVisibleIds)}
                      />
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>参数名称</span>
                      </div>
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>模块</span>
                        <ColumnFilter
                          label="模块"
                          groupLabel="所属模块筛选"
                          mode="tree"
                          treeNodes={moduleFilterNodes}
                          selectedTreeIds={activeModuleFilters}
                          onTreeChange={setModuleFilters}
                          treeSearchable
                          onClear={() => setModuleFilters([])}
                        />
                      </div>
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>当前值</span>
                      </div>
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>目标写入值</span>
                      </div>
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>状态</span>
                        <ColumnFilter
                          label="状态"
                          groupLabel="状态筛选"
                          values={statusOptions.map((option) => option.value)}
                          selectedValues={statusFilters}
                          onToggle={(status) => setStatusFilters((current) => toggleArrayFilter(current, status))}
                          onClear={() => setStatusFilters([])}
                        />
                      </div>
                    </th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const subtitle = nodeRowSubtitle(row);
                    const modulePath = modulePathLabelForDebugNode(row, moduleNodes);
                    return (
                    <tr key={row.id}>
                      <td data-label="选择">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${row.name}`}
                          checked={selectedIds.includes(row.id)}
                          disabled={!canWrite(row)}
                          onChange={() => session.toggleSelect(row.id)}
                        />
                      </td>
                      <td data-label="参数名称">
                        <strong>{row.name}</strong>
                        {row.protectedReferenceKind === "canonical-pin"
                          || (row.protectedReferenceReason && row.protectedReferenceReason !== "missing-binding") ? <small
                          className="node-canonical-reference"
                          data-testid={`node-canonical-reference-${row.id}`}
                          aria-label={canonicalAssociationLabel(row)}
                        >
                          {canonicalAssociationLabel(row)}
                        </small> : null}
                        {subtitle ? <small>{subtitle}</small> : null}
                      </td>
                      <td data-label="模块">
                        <span
                          className="node-debug-module-cell"
                          title={modulePath}
                        >
                          {modulePath || "未分类"}
                        </span>
                      </td>
                      <td className="mono" data-label="当前值">
                        <DebugCurrentValueCell row={row} connected={connected} />
                        {bindingUnavailableReason(row) ? <small className="node-row-error">{bindingUnavailableReason(row)}</small> : null}
                        {row.error ? <small className="node-row-error" title={row.error}>{nodeErrorSummary(row.error)}</small> : null}
                      </td>
                      <td data-label="目标写入值">
                        {canWrite(row) ? (
                          !row.draftValue ? <span className="node-value-placeholder">未设置</span> : isComplexDebugParameter(row) ? (
                            <DebugTableValuePreview value={row.draftValue} row={row} />
                          ) : (
                            <DebugTableValueText value={row.draftValue} />
                          )
                        ) : (
                          <span>{row.accessMode === "WO" ? "只写（安全写入不可用）" : "只读"}</span>
                        )}
                      </td>
                      <td data-label="状态"><NodeRowStatus row={row} /></td>
                      <td className="parameter-row-actions" data-label="操作">
                        <button
                          className="icon-button parameter-row-edit"
                          type="button"
                          aria-label={`${canWrite(row) ? "查看/修改" : "查看详情"} ${row.name}`}
                          title={canWrite(row) ? "查看/修改" : "查看详情"}
                          onClick={(event) => {
                            event.currentTarget.focus();
                            openEditor(row);
                          }}
                        >
                          {canWrite(row) ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </HorizontalDragScroll>

            {visibleRows.length === 0 ? (
              <div className="parameters-table-empty">
                <p>{rows.length === 0 ? "暂无调试节点" : "没有符合筛选条件的节点"}</p>
                {rows.length === 0 ? (
                  <span>调试节点由管理员在调试管理后台维护，配置后即可在此读写设备节点。</span>
                ) : (
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilters([]);
                      setModuleFilters([]);
                      setSelectedModuleNodeId(null);
                    }}
                  >
                    清除筛选条件
                  </button>
                )}
              </div>
            ) : null}
          </section>
          )}
        <NodeOperationHistoryPanel events={events} />
        </NavigatorWorkbench>
        </div>
      </div>

      {editingRow ? (
        <div className={`node-detail-editor${isComplexDebugParameter(editingRow) ? " node-complex-editor" : ""}`}>
        <WorkbenchSheet
          key={editingRow.id}
          open
          onClose={() => guardEditorChange(closeEditor)}
          closeLabel="关闭节点详情"
          title={editingRow.name}
          description={editingRow.description.trim() || undefined}
          footer={
            canWrite(editingRow) ? (
              <div className="draft-sheet-footer">
                <span>
                  {editingDirty ? "有未暂存的修改" : editingRow.pendingWrite ? "已加入待写入队列" : "暂存后加入队列；写入立即执行"}
                </span>
                <div className="draft-sheet-footer-actions">
                  <button className="button subtle" type="button" onClick={() => guardEditorChange(closeEditor)}>
                    取消
                  </button>
                  <button
                    className="button subtle"
                    type="button"
                    disabled={Boolean(editingRow.activeOperation)}
                    onClick={() => {
                      session.setDraftValue(editingRow.id, editingValue);
                      session.stashRow(editingRow.id);
                      setEditingRowId(null);
                    }}
                  >
                    暂存
                  </button>
                  <button
                    className="submit-round-button debugging-deploy-button"
                    data-primary-action="true"
                    type="button"
                    disabled={!connected || editingRow.activeOperation === "write"}
                    onClick={() => {
                      session.setDraftValue(editingRow.id, editingValue);
                      void session.requestWrite(editingRow.id, debuggingActions);
                    }}
                  >
                    {editingRow.accessMode === "RW" ? <RotateCw size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                    {editingRow.accessMode === "RW" ? "写入并回读" : "写入"}
                  </button>
                </div>
              </div>
            ) : undefined
          }
        >
          <div className="draft-sheet-stack">
            <div className="debug-detail-card node-detail-card">
              <div className="debug-detail-head">
                <NodeRowStatus row={editingRow} />
                <span className={editingRow.risk === "High" ? "node-detail-risk node-detail-risk--high" : "node-detail-risk"}>
                  {editingRow.risk === "High" ? "高风险 · 写入前需确认" : editingRow.risk === "Medium" ? "中风险" : "低风险"}
                </span>
              </div>
              <div className="node-detail-device">
                <span className="node-detail-meta-label">目标设备</span>
                <strong>{connected ? target : "设备未连接"}</strong>
              </div>
              <section className="node-detail-path" aria-labelledby={`node-detail-path-${editingRow.id}`}>
                <div className="node-detail-path__head">
                  <span id={`node-detail-path-${editingRow.id}`} className="node-detail-meta-label">节点路径</span>
                  {editingRow.nodePath ? <button className="icon-button" type="button" aria-label="复制节点路径"
                    title="复制节点路径" onClick={() => void copyNodePath(editingRow.nodePath)}>
                    <Copy size={14} aria-hidden="true" />
                  </button> : null}
                </div>
                {editingRow.nodePath ? <code className="node-detail-path__value" title={editingRow.nodePath}>
                  {editingRow.nodePath.split("/").map((segment, index) => <Fragment key={index}>
                    {index > 0 ? <wbr /> : null}
                    <span className="node-detail-path__segment">{index > 0 ? "/" : ""}{segment}</span>
                  </Fragment>)}
                </code> : <p className="node-detail-path__unavailable">{bindingUnavailableReason(editingRow) || "未配置节点路径"}</p>}
                {pathCopyResult?.path === editingRow.nodePath ? <small role="status" className="node-detail-path__feedback">{pathCopyResult.message}</small> : null}
              </section>
              <div className="debug-detail-fields">
                {editingRow.lastReadValue !== undefined && (isComplexDebugParameter(editingRow)
                  || /[\r\n]/.test(editingRow.runtimeCurrentValue)
                  || editingRow.runtimeCurrentValue.length > TABLE_PREVIEW_MAX_CHARS) ? (
                  <DebugValueCodeBlock label="当前值" row={editingRow} value={editingRow.runtimeCurrentValue} />
                ) : (
                  <div className="debug-detail-row">
                    <span>当前值</span>
                    <strong className="mono">{displayCurrentValue(editingRow)} {editingRow.lastReadValue !== undefined ? editingRow.unit : ""}</strong>
                  </div>
                )}
                {canWrite(editingRow) ? (
                  <div className="node-detail-target">
                    <label className="field-label" htmlFor={`node-target-${editingRow.id}`}>目标写入值</label>
                    <textarea
                      id={`node-target-${editingRow.id}`}
                      aria-label="目标写入值"
                      className={`node-target-editor${isComplexDebugParameter(editingRow) ? " node-complex-target-editor" : ""}`}
                      rows={debugValueEditorRows(editingValue, isComplexDebugParameter(editingRow) ? 6 : 3)}
                      wrap={isComplexDebugParameter(editingRow) ? "off" : "soft"}
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                    />
                    <small className="node-detail-target-hint">{editingRow.unit ? `单位：${editingRow.unit} · ` : ""}写入后自动回读，返回值仅供核对。</small>
                  </div>
                ) : null}
                <div className="debug-detail-row">
                  <span>访问模式</span>
                  <strong>{editingRow.accessMode} · {editingRow.accessMode === "RW" ? "可读写" : editingRow.accessMode === "RO" ? "只读" : "只写（安全写入不可用）"}</strong>
                </div>
                {editingRow.writeOutcome ? (
                  <div className="debug-detail-row">
                    <span>写命令</span>
                    <strong>{editingRow.writeOutcome === "executed" ? "写入已执行" : editingRow.writeOutcome === "failed" ? "写入失败" : "写入结果未知"}</strong>
                  </div>
                ) : null}
                {editingRow.readbackOutcome ? (
                  <div className="debug-detail-row">
                    <span>写后回读</span>
                    <strong>{readbackOutcomeLabel(editingRow)}</strong>
                  </div>
                ) : null}
                <div className="debug-detail-row">
                  <span>模块</span>
                  <strong>{editingRow.module}</strong>
                </div>
                {editingRow.range ? <div className="debug-detail-row"><span>参考范围</span><strong>{editingRow.range}</strong></div> : null}
              </div>
              {editingRow.error ? <p className="node-row-error">{editingRow.error}</p> : null}
              {canRead(editingRow) ? (
                <button
                  className="button subtle"
                  type="button"
                  disabled={!connected || Boolean(editingRow.activeOperation)}
                  onClick={() => void session.retryRead(editingRow.id, debuggingActions)}
                >
                  <RotateCw size={14} aria-hidden="true" />
                  {editingRow.lastWriteOperationId && editingRow.writeOutcome !== "failed" ? "重新回读（不会再次写入）" : "重新读取"}
                </button>
              ) : null}
              {editingRow.detailedDescription?.trim() && editingRow.detailedDescription.trim() !== editingRow.description.trim() ? (
                <details className="node-detail-disclosure">
                  <summary>使用说明</summary>
                  <p className="node-debug-detail-description">{editingRow.detailedDescription}</p>
                </details>
              ) : null}
              {canWrite(editingRow) ? <details className="node-detail-disclosure">
                <summary>写入格式与示例</summary>
            <NodeWriteFormatPanel row={editingRow} />
              </details> : null}
            </div>
          </div>
        </WorkbenchSheet>
        </div>
      ) : null}

      <ConfirmDialog
        open={discardAction !== null}
        title="放弃未保存的修改？"
        description="目标值尚未加入待写入队列。放弃后将恢复上次暂存的内容。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        onCancel={() => setDiscardAction(null)}
        onConfirm={() => {
          discardAction?.();
          setDiscardAction(null);
        }}
      />

      <ConfirmDialog
        open={pendingHighRiskWrite !== null}
        title="确认高风险节点写入"
        description={
          pendingHighRiskWrite
            ? `将向设备「${target ?? "未连接"}」的高风险节点「${pendingHighRiskWrite.name}」写入「${pendingHighRiskWrite.draftValue}」。请核对设备与目标值，确认后立即执行。`
            : null
        }
        confirmLabel="确认写入"
        tone="danger"
        onCancel={() => session.cancelWrite()}
        onConfirm={() => {
          void session.confirmWrite(debuggingActions);
        }}
      />

      <ConfirmDialog
        open={pendingBulkWrite !== null}
        title={`批量写入包含 ${pendingBulkWrite?.highRiskRows.length ?? 0} 个高风险节点`}
        description={
          pendingBulkWrite ? (
            <div>
              <p>
                本次批量共 {pendingBulkWrite.rows.length} 个节点，其中高风险 {pendingBulkWrite.highRiskRows.length} 个。
                将写入设备「{target}」。请核对以下节点与目标值；确认后开始执行，取消则不写入任何节点。
              </p>
              <ul className="node-bulk-high-risk-list" aria-label="高风险节点清单">
                {pendingBulkWrite.highRiskRows.map((row) => (
                  <li key={row.id}>
                    <strong>{row.name}</strong>
                    <span>
                      {(row.runtimeCurrentValue || row.currentValue || "未知") + " → " + row.draftValue}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        confirmLabel={`确认写入（含 ${pendingBulkWrite?.highRiskRows.length ?? 0} 个高风险）`}
        tone="danger"
        onCancel={() => session.cancelBulkWrite()}
        onConfirm={() => {
          void session.confirmBulkWrite(debuggingActions);
        }}
      />

      {bulkWriteSummary ? (
        <div className="node-bulk-write-summary" role="status" aria-live="polite">
          {bulkWriteSummary}
        </div>
      ) : null}

      {rollbackDialogOpen && state.lastDebugSnapshot ? (
        <RollbackConfirmDialog
          snapshot={state.lastDebugSnapshot}
          parameters={state.debugParameters}
          onCancel={() => session.cancelRollback()}
          onConfirm={() => {
            const snapshot = state.lastDebugSnapshot;
            if (!snapshot) return;
            session.confirmRollback(debuggingActions, snapshot.id);
          }}
        />
      ) : null}
    </div>
  );
}
