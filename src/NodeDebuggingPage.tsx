import { Eye, Pencil, RotateCcw, RotateCw, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isHdcPlaceholderTarget } from "@wiseeff/device-command-core/hdcTargets";
import { ColumnFilter } from "./components/ColumnFilter";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { LocalDeviceBridgePanel } from "./components/LocalDeviceBridgePanel";
import { formatDetectFailureMessage } from "./components/bridgePanelStatus";
import { NodeOperationHistoryPanel, type NodeOperationEvent } from "./components/NodeOperationHistoryPanel";
import { RollbackConfirmDialog } from "./components/RollbackConfirmDialog";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { useTopBarActions } from "./components/layout";
import {
  probeLocalBridgeHealthDetailed,
  type LocalBridgeProbeResult
} from "./infrastructure/http/bridgeConnectLauncher";
import type { DeviceBridgePairingCode, DeviceBridgeRecord } from "./infrastructure/http/deviceBridgeClient";
import { formatDebuggingRuntimeError, type DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import type { DeviceTarget, NodeOperationSnapshot, NodeReadResult, NodeWriteResult } from "./application/ports/DebuggingGateway";
import type {
  DebugConnectionProtocol,
  DebugParameterBindingStatus,
  DebugParameterNodeBinding
} from "./domain/debugging/types";
import {
  buildValuePreview,
  debugValueEditorRows,
  debugValuePreview,
  getDebugNormalizationModeLabel,
  getDebugValueFormatLabel,
  isComplexDebugParameter
} from "./debugValueKind";
import { resolveWriteFormatExample, resolveWriteFormatHint } from "@/domain/debugging/writeFormat";
import { nodeRowSubtitle } from "@/domain/debugging/nodeRowSubtitle";
import type { DebugParameter, PrototypeState } from "@/domain/prototype/types";

type NodeRuntimeStatus =
  | "未检测"
  | "待写入"
  | "执行中"
  | "成功"
  | "失败"
  | "写入失败"
  | "不可用";

type ProtocolAwareDebugParameter = DebugParameter & {
  selectedProtocol?: DebugConnectionProtocol;
  bindingStatus?: DebugParameterBindingStatus;
  bindingDisabledReason?: string;
  bindings?: DebugParameterNodeBinding[];
};

type RowOperationKind = "read" | "write";

type RuntimeRow = ProtocolAwareDebugParameter & {
  runtimeCurrentValue: string;
  draftValue: string;
  runtimeStatus: NodeRuntimeStatus;
  activeOperation?: RowOperationKind;
  error?: string;
  lastReadValue?: string;
};

const unsupportedNodeValueLabel = "该节点不支持";

type PageNodeOperationEvent = NodeOperationEvent & {
  durationMs?: number;
};

const protocolStorageKey = "wiseeff.nodeDebugging.protocol";

/** Stable default so the bridge panel's refresh effect is not re-triggered every render. */
const defaultProbeBridgeHealth = () => probeLocalBridgeHealthDetailed();

export function readInitialNodeDebuggingProtocol(): DebugConnectionProtocol {
  try {
    return window.localStorage.getItem(protocolStorageKey) === "adb" ? "adb" : "hdc";
  } catch {
    return "hdc";
  }
}

function storeSelectedProtocol(protocol: DebugConnectionProtocol) {
  try {
    window.localStorage.setItem(protocolStorageKey, protocol);
  } catch {
    // Protocol state still updates in memory when browser storage is unavailable.
  }
}

function protocolLabel(protocol: DebugConnectionProtocol) {
  return protocol.toUpperCase();
}

function bindingUnavailableReason(row: Pick<ProtocolAwareDebugParameter, "bindingStatus" | "nodePath">) {
  if (row.bindingStatus === "missing") return "未配置该协议节点";
  if (row.bindingStatus === "disabled") return "该协议节点已停用";
  if (!row.nodePath) return "节点不可用";
  return "";
}

function deriveParameterForProtocol(parameter: DebugParameter, protocol: DebugConnectionProtocol): ProtocolAwareDebugParameter {
  const protocolParameter = parameter as ProtocolAwareDebugParameter;
  if (!protocolParameter.bindings) {
    if (protocolParameter.selectedProtocol && protocolParameter.selectedProtocol !== protocol) {
      return {
        ...protocolParameter,
        selectedProtocol: protocol,
        nodePath: "",
        accessMode: "RO",
        bindingStatus: "missing",
        bindingDisabledReason: undefined
      };
    }

    return { ...protocolParameter, selectedProtocol: protocol };
  }

  const selectedBinding = protocolParameter.bindings.find((binding) => binding.protocol === protocol);
  if (!selectedBinding) {
    return {
      ...protocolParameter,
      selectedProtocol: protocol,
      nodePath: "",
      accessMode: "RO",
      bindingStatus: "missing",
      bindingDisabledReason: undefined
    };
  }

  if (!selectedBinding.enabled) {
    return {
      ...protocolParameter,
      selectedProtocol: protocol,
      nodePath: "",
      accessMode: "RO",
      bindingStatus: "disabled",
      bindingDisabledReason: selectedBinding.notes
    };
  }

  return {
    ...protocolParameter,
    selectedProtocol: protocol,
    nodePath: selectedBinding.nodePath,
    accessMode: selectedBinding.accessMode,
    bindingStatus: "configured",
    bindingDisabledReason: undefined
  };
}

function canRead(row: Pick<ProtocolAwareDebugParameter, "accessMode" | "nodePath" | "bindingStatus">) {
  return !bindingUnavailableReason(row) && (row.accessMode === "RO" || row.accessMode === "RW");
}

function canWrite(row: Pick<ProtocolAwareDebugParameter, "accessMode" | "nodePath" | "bindingStatus">) {
  return !bindingUnavailableReason(row) && (row.accessMode === "WO" || row.accessMode === "RW");
}

function initialStatus(row: ProtocolAwareDebugParameter): NodeRuntimeStatus {
  if (bindingUnavailableReason(row)) return "不可用";
  return row.accessMode === "WO" ? "待写入" : "未检测";
}

function runtimeRowFromParameter(parameter: DebugParameter, protocol: DebugConnectionProtocol, existing?: RuntimeRow): RuntimeRow {
  const protocolParameter = deriveParameterForProtocol(parameter, protocol);
  const bindingReason = bindingUnavailableReason(protocolParameter);
  const bindingChanged = existing
    ? existing.selectedProtocol !== protocol ||
      existing.nodePath !== protocolParameter.nodePath ||
      existing.accessMode !== protocolParameter.accessMode ||
      existing.bindingStatus !== protocolParameter.bindingStatus
    : false;
  const preserveRuntimeState = existing && !bindingChanged;

  return {
    ...protocolParameter,
    runtimeCurrentValue: preserveRuntimeState ? existing.runtimeCurrentValue : canRead(protocolParameter) ? "" : protocolParameter.currentValue,
    draftValue: existing?.draftValue ?? protocolParameter.targetValue,
    runtimeStatus: preserveRuntimeState ? existing.runtimeStatus : initialStatus(protocolParameter),
    error: bindingReason ? undefined : preserveRuntimeState ? existing.error : undefined,
    lastReadValue: preserveRuntimeState ? existing.lastReadValue : undefined
  };
}

function isUnsupportedParameterError(message?: string) {
  if (!message) return false;
  return message.includes("not configured for the selected protocol")
    || message.includes("binding is disabled for the selected protocol");
}

function statusClass(status: NodeRuntimeStatus) {
  const classMap: Record<NodeRuntimeStatus, string> = {
    "未检测": "node-status-untested",
    "待写入": "node-status-pending",
    "执行中": "node-status-running",
    "成功": "node-status-success",
    "失败": "node-status-failed",
    "写入失败": "node-status-failed",
    "不可用": "node-status-unavailable"
  };
  return `node-status-badge ${classMap[status]}`;
}

function displayCurrentValue(row: RuntimeRow, context: "table" | "detail" = "detail"): string {
  if (row.accessMode === "WO") return "写入后不可回读";
  if (bindingUnavailableReason(row)) return unsupportedNodeValueLabel;
  if (row.runtimeStatus === "写入失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    if (row.lastReadValue !== undefined) {
      return context === "table" && isComplexDebugParameter(row)
        ? debugValuePreview(row.runtimeCurrentValue, row)
        : row.runtimeCurrentValue;
    }
    return row.error || "写入失败";
  }
  if (row.runtimeStatus === "失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    return row.error || "读取失败";
  }
  if (row.lastReadValue !== undefined) {
    return context === "table" && isComplexDebugParameter(row)
      ? debugValuePreview(row.runtimeCurrentValue, row)
      : row.runtimeCurrentValue;
  }
  if (row.runtimeStatus === "执行中") {
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
      <span className="debug-value-preview">{debugValuePreview(value, row)}</span>
      <DebugValueFormatBadge row={row} />
    </span>
  );
}

function DebugCurrentValueCell({ row }: { row: RuntimeRow }) {
  const text = displayCurrentValue(row, "table");
  const hasComplexPayload =
    isComplexDebugParameter(row) &&
    row.lastReadValue !== undefined &&
    row.runtimeStatus !== "失败" &&
    row.runtimeStatus !== "写入失败";

  if (hasComplexPayload) {
    return <DebugTableValuePreview value={row.runtimeCurrentValue} row={row} />;
  }

  return <>{text}</>;
}

function DebugValueCodeBlock({ label, row, value }: { label: string; row: RuntimeRow; value: string }) {
  return (
    <div className="debug-value-code-block">
      <div className="debug-value-code-block__head">
        <strong>{label}</strong>
        <DebugValueFormatBadge row={row} />
      </div>
      <pre>
        <code tabIndex={0}>{value || "-"}</code>
      </pre>
    </div>
  );
}

function complexOperationMetadata(
  row: RuntimeRow | undefined,
  operation: NodeOperationSnapshot,
  stdout?: string
): Pick<NodeOperationEvent, "valuePreview" | "valueDigest" | "valueFormat"> {
  const isComplex = row ? isComplexDebugParameter(row) : operation.valueKind === "complex";
  if (!isComplex) {
    return {};
  }

  const previewSource = operation.valuePreview ?? (stdout ? buildValuePreview(stdout) : undefined);
  const valueDigest =
    operation.readbackValueDigest ??
    operation.requestedValueDigest ??
    operation.previousValueDigest;

  return {
    valuePreview: previewSource,
    valueDigest,
    valueFormat: operation.valueFormat ?? row?.valueFormat
  };
}

function readFailureMessage(error: unknown) {
  return formatDebuggingRuntimeError(error);
}

function looksLikeFailedNodeReadValue(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  return /^\[Fail\]/i.test(trimmed) || /\[E\d{6}\]/.test(trimmed);
}

function resolveReadRowOutcome(result: NodeReadResult) {
  const value = result.value ?? result.stdout?.trim() ?? "";
  if (!result.ok) {
    return {
      ok: false as const,
      value,
      error: result.error || result.stderr || value || "读取失败"
    };
  }
  if (looksLikeFailedNodeReadValue(value)) {
    return {
      ok: false as const,
      value,
      error: value
    };
  }
  return {
    ok: true as const,
    value
  };
}

function bridgeTargetLabel(target: Pick<DeviceTarget, "label" | "targetRef" | "bridgeMachineLabel">) {
  const machineLabel = target.bridgeMachineLabel?.trim();
  if (!machineLabel) {
    return target.label;
  }
  const targetIdentity = target.targetRef?.trim() || target.label;
  return `${machineLabel} · ${targetIdentity}`;
}

function eventActionFromOperation(operation: NodeOperationSnapshot): NodeOperationEvent["action"] {
  if (operation.operationType === "write") {
    return operation.readbackValue !== undefined || operation.status === "readback_mismatch" ? "write-readback" : "write";
  }
  return operation.operationType === "detect" ? "detect" : "read";
}

function eventStatusFromOperation(operation: NodeOperationSnapshot) {
  if (operation.status === "succeeded") {
    if (operation.operationType === "detect") return "已连接";
    if (operation.operationType === "read") return "读取成功";
    return operation.readbackValue !== undefined ? "回读一致" : "写入成功";
  }
  if (operation.status === "readback_mismatch") return "回读不一致";
  if (operation.operationType === "detect") return "检测失败";
  if (operation.operationType === "read") return "读取失败";
  return "写入失败";
}

function returncodeFromOperation(operation: NodeOperationSnapshot) {
  return operation.status === "succeeded" ? 0 : 1;
}

function findOperationParameter(operation: NodeOperationSnapshot, rows: RuntimeRow[]) {
  return rows.find((row) => row.id === operation.nodeId || row.id === operation.parameterId || row.nodePath === operation.nodePath);
}

function eventFromOperation(operation: NodeOperationSnapshot, rows: RuntimeRow[]): Omit<PageNodeOperationEvent, "id" | "at"> & { at?: string } {
  const row = findOperationParameter(operation, rows);
  const stdout = operation.readbackValue ?? operation.readValue ?? operation.previousValue ?? operation.requestedValue;
  const complexMetadata = complexOperationMetadata(row, operation, stdout);
  const isComplex = row ? isComplexDebugParameter(row) : operation.valueKind === "complex";

  return {
    parameterName: row?.name ?? (operation.operationType === "detect" ? `${protocolLabel(operation.protocol ?? "hdc")} 设备` : operation.parameterId ?? operation.nodePath),
    parameterKey: row?.key ?? operation.parameterId ?? operation.nodePath,
    accessMode: row?.accessMode ?? "RO",
    action: eventActionFromOperation(operation),
    status: eventStatusFromOperation(operation),
    returncode: returncodeFromOperation(operation),
    stdout: isComplex ? undefined : stdout,
    stderr: operation.failureReason,
    nodePath: operation.nodePath,
    durationMs: operation.durationMs,
    at: operation.createdAt,
    ...complexMetadata
  };
}

type CommandResultMeta = { returncode?: number };
type DiagnosticError = Error & { stderr?: string; stdout?: string; returncode?: number };
type ReadResultWithOperation = NodeReadResult & CommandResultMeta & { operation?: NodeOperationSnapshot };
type WriteResultWithOperation = NodeWriteResult & { operation?: NodeOperationSnapshot };
type DetectResultWithOperation = Awaited<ReturnType<DebuggingRuntimeActions["detectAndStartSession"]>> & {
  operation?: NodeOperationSnapshot;
};

function NodeWriteFormatPanel({ row, protocol }: { row: RuntimeRow; protocol: DebugConnectionProtocol }) {
  const titleId = `node-write-format-${row.id}`;
  const exampleValue = resolveWriteFormatExample(row);
  const exampleHint = resolveWriteFormatHint(row, exampleValue, protocol);
  const isComplex = isComplexDebugParameter(row);

  return (
    <section className="node-write-format-panel" role="region" aria-labelledby={titleId}>
      <div className="node-write-format-head">
        <h3 id={titleId}>{isComplex ? "复杂值写入格式" : "写入格式"}</h3>
        <span>{row.accessMode}</span>
      </div>
      <p>
        {isComplex
          ? "复杂值会按所选格式与规范化模式写入设备端调试节点，写入后按相同规则回读校验。"
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
          <dd>{row.accessMode === "RW" ? "写入后自动回读并校验" : "仅写入，设备不支持回读确认"}</dd>
        </div>
      </dl>
      {!isComplex ? (
        <div className="node-write-format-example">
          <strong>示例</strong>
          <code>{exampleValue}</code>
          <span>{exampleHint}</span>
        </div>
      ) : null}
    </section>
  );
}

export function NodeDebuggingPage({
  state,
  debuggingActions,
  runtimeReady = true,
  bridges,
  probeBridgeHealth = defaultProbeBridgeHealth,
  createBridgePairingCode
}: {
  state: PrototypeState;
  /** All node operations go through the DebuggingGateway port behind these actions. */
  debuggingActions: DebuggingRuntimeActions;
  runtimeReady?: boolean;
  /** Bridge panel seam for non-API runtimes; defaults to the HTTP bridge listing. */
  bridges?: DeviceBridgeRecord[];
  /** Local bridge health seam; defaults to the local HTTP health probe. */
  probeBridgeHealth?: () => Promise<LocalBridgeProbeResult>;
  /** Pairing-code seam for non-API runtimes; defaults to the HTTP client. */
  createBridgePairingCode?: () => Promise<DeviceBridgePairingCode>;
}) {
  const [protocol, setProtocol] = useState<DebugConnectionProtocol>(readInitialNodeDebuggingProtocol);
  const [rows, setRows] = useState<RuntimeRow[]>(() =>
    state.debugParameters.map((parameter) => runtimeRowFromParameter(parameter, protocol))
  );
  const [target, setTarget] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [events, setEvents] = useState<PageNodeOperationEvent[]>([]);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [activeTargetId, setActiveTargetId] = useState<string | undefined>();
  const [bridgeTargetCandidates, setBridgeTargetCandidates] = useState<DeviceTarget[]>([]);
  const [selectingBridgeTargetId, setSelectingBridgeTargetId] = useState<string | null>(null);
  const [pendingHighRiskWrite, setPendingHighRiskWrite] = useState<RuntimeRow | null>(null);
  const [pendingBulkWrite, setPendingBulkWrite] = useState<{
    rows: RuntimeRow[];
    highRiskRows: RuntimeRow[];
  } | null>(null);
  const [bulkWriteSummary, setBulkWriteSummary] = useState<string | null>(null);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const autoReadSignatureRef = useRef("");
  const protocolRef = useRef(protocol);
  const detectRequestSeqRef = useRef(0);
  const rowsRef = useRef(rows);
  const rowOperationSeqRef = useRef<Record<string, number>>({});
  const rowOperationGenerationRef = useRef(0);
  const activeSessionIdRef = useRef<string | undefined>(undefined);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const appendEvent = (event: Omit<PageNodeOperationEvent, "id" | "at"> & { at?: string }) => {
    setEvents((current) => [
      ...current,
      { ...event, id: `node-event-${current.length + 1}`, at: event.at ?? new Date().toISOString() }
    ]);
  };

  const replaceEventsFromOperations = (operations: NodeOperationSnapshot[]) => {
    setEvents(
      operations.map((operation, index) => {
        const base = eventFromOperation(operation, rowsRef.current);
        return {
          ...base,
          id: operation.id || `node-event-session-${index + 1}`,
          at: operation.createdAt ?? new Date().toISOString()
        };
      })
    );
  };

  const nextRowOperationSeq = (rowId: string) => {
    const nextSeq = (rowOperationSeqRef.current[rowId] ?? 0) + 1;
    rowOperationSeqRef.current[rowId] = nextSeq;
    return nextSeq;
  };

  const isLatestRowOperation = (
    rowId: string,
    operationSeq: number,
    generation: number,
    requestProtocol: DebugConnectionProtocol
  ) =>
    rowOperationGenerationRef.current === generation &&
    protocolRef.current === requestProtocol &&
    rowOperationSeqRef.current[rowId] === operationSeq;

  const connected = Boolean(target) && !isHdcPlaceholderTarget(target ?? "");
  const normalizedQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    protocolRef.current = protocol;
  }, [protocol]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    setRows((current) => {
      const existingById = new Map(current.map((row) => [row.id, row]));
      return state.debugParameters.map((parameter) => runtimeRowFromParameter(parameter, protocol, existingById.get(parameter.id)));
    });
  }, [protocol, state.debugParameters]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesSearch =
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.key.toLowerCase().includes(normalizedQuery) ||
        row.description.toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(row.runtimeStatus);
      return matchesSearch && matchesStatus;
    });
  }, [normalizedQuery, rows, statusFilters]);

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.runtimeStatus))).map((status) => ({ value: status, label: status })),
    [rows]
  );
  const toggleArrayFilter = (currentValues: string[], value: string) =>
    currentValues.includes(value) ? currentValues.filter((item) => item !== value) : [...currentValues, value];
  const editingRow = editingRowId ? rows.find((row) => row.id === editingRowId) ?? null : null;
  const editingRowSubtitle = editingRow ? nodeRowSubtitle(editingRow) : "";
  const selectableVisibleIds = useMemo(
    () => visibleRows.filter((row) => canWrite(row)).map((row) => row.id),
    [visibleRows]
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleIds.filter((id) => selectedIds.has(id)).length,
    [selectableVisibleIds, selectedIds]
  );
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;
  const pendingRows = useMemo(
    () => rows.filter((row) => canWrite(row) && row.runtimeStatus === "待写入"),
    [rows]
  );
  const pendingSelectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id) && canWrite(row) && row.runtimeStatus === "待写入"),
    [rows, selectedIds]
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleIds.length;
    }
  }, [selectableVisibleIds.length, selectedVisibleCount]);

  const updateRow = (id: string, patch: Partial<RuntimeRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const switchProtocol = (nextProtocol: DebugConnectionProtocol) => {
    if (nextProtocol === protocol) return;
    detectRequestSeqRef.current += 1;
    rowOperationGenerationRef.current += 1;
    storeSelectedProtocol(nextProtocol);
    setProtocol(nextProtocol);
    setDetecting(false);
    setTarget(undefined);
    setActiveTargetId(undefined);
    setActiveSessionId(undefined);
    setBridgeTargetCandidates([]);
    setSelectingBridgeTargetId(null);
    autoReadSignatureRef.current = "";
    rowOperationSeqRef.current = {};
    setSelectedIds(new Set());
    void Promise.resolve()
      .then(() => debuggingActions.refresh({ protocol: nextProtocol }))
      .catch(() => undefined);
  };

  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      selectableVisibleIds.forEach((id) => next.delete(id));
    } else {
      selectableVisibleIds.forEach((id) => next.add(id));
    }
    setSelectedIds(next);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const stashRow = (row: RuntimeRow) => {
    updateRow(row.id, { runtimeStatus: "待写入" });
    setSelectedIds((current) => new Set([...current, row.id]));
    setEditingRowId(null);
  };

  const readRowWithTarget = async (row: RuntimeRow, activeTarget?: string, sessionId?: string) => {
    if ((!activeTarget && !sessionId) || !canRead(row)) return;
    const requestProtocol = protocolRef.current;
    const generation = rowOperationGenerationRef.current;
    const operationSeq = nextRowOperationSeq(row.id);
    updateRow(row.id, { runtimeStatus: "执行中", activeOperation: "read", error: undefined });
    try {
      const result: ReadResultWithOperation = await debuggingActions.readNode({
        sessionId,
        target: activeTarget,
        nodeId: row.id,
        nodePath: row.nodePath
      });
      const outcome = resolveReadRowOutcome(result);
      const isLatest = isLatestRowOperation(row.id, operationSeq, generation, requestProtocol);
      if (isLatest) {
        if (outcome.ok) {
          updateRow(row.id, {
            runtimeCurrentValue: outcome.value,
            lastReadValue: outcome.value,
            runtimeStatus: "成功",
            activeOperation: undefined,
            error: undefined
          });
        } else {
          updateRow(row.id, {
            runtimeCurrentValue: outcome.value || undefined,
            runtimeStatus: "失败",
            activeOperation: undefined,
            error: outcome.error
          });
        }
      }
      if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rowsRef.current));
      } else {
        appendEvent({
          parameterName: row.name,
          parameterKey: row.key,
          accessMode: row.accessMode,
          action: "read",
          status: outcome.ok ? "读取成功" : "读取失败",
          returncode: result.returncode,
          stdout: isComplexDebugParameter(row) ? undefined : result.stdout,
          stderr: result.stderr || outcome.error,
          nodePath: row.nodePath,
          ...complexOperationMetadata(row, {
            id: "",
            sessionId: "",
            nodePath: row.nodePath,
            operationType: "read",
            status: outcome.ok ? "succeeded" : "failed",
            verified: outcome.ok,
            durationMs: result.durationMs ?? 0,
            createdAt: "",
            readValue: outcome.value,
            valueKind: row.valueKind,
            valueFormat: row.valueFormat
          }, outcome.value)
        });
      }
    } catch (error) {
      const message = readFailureMessage(error);
      if (isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) {
        updateRow(row.id, {
          runtimeStatus: "失败",
          activeOperation: undefined,
          error: message
        });
      }
      appendEvent({
        parameterName: row.name,
        parameterKey: row.key,
        accessMode: row.accessMode,
        action: "read",
        status: "读取失败",
        returncode: (error as DiagnosticError | undefined)?.returncode,
        stderr: (error as DiagnosticError | undefined)?.stderr || message,
        nodePath: row.nodePath
      });
    }
  };

  const readReadableRows = async (activeTarget: string | undefined, currentRows: RuntimeRow[], sessionId?: string) => {
    const generation = rowOperationGenerationRef.current;
    const requestProtocol = protocolRef.current;
    for (const row of currentRows) {
      if (
        rowOperationGenerationRef.current !== generation ||
        protocolRef.current !== requestProtocol ||
        (sessionId !== undefined && activeSessionIdRef.current !== sessionId)
      ) {
        return;
      }
      if (canRead(row)) {
        await readRowWithTarget(row, activeTarget, sessionId);
      }
    }
  };

  useEffect(() => {
    if (!activeSessionId || !activeTargetId) {
      return;
    }

    const readableRows = rows.filter(canRead);
    const signature = `${activeSessionId}:${readableRows.map((row) => row.id).join("|")}`;
    if (autoReadSignatureRef.current === signature) {
      return;
    }

    autoReadSignatureRef.current = signature;
    void readReadableRows(activeTargetId, readableRows, activeSessionId).catch(() => undefined);
  }, [activeSessionId, activeTargetId, debuggingActions, rows]);

  const applyDetectedSession = (session: { id: string; startedAt: string }, detectedTarget: DeviceTarget) => {
    if (isHdcPlaceholderTarget(detectedTarget.targetRef ?? detectedTarget.label ?? "")) {
      setActiveSessionId(undefined);
      setActiveTargetId(undefined);
      setTarget(undefined);
      setBridgeTargetCandidates([]);
      return;
    }
    setActiveSessionId(session.id);
    setActiveTargetId(detectedTarget.id);
    setTarget(bridgeTargetLabel(detectedTarget));
    setBridgeTargetCandidates([]);
  };

  const detect = async () => {
    if (!runtimeReady) {
      return;
    }

    const requestProtocol = protocol;
    const requestSeq = detectRequestSeqRef.current + 1;
    detectRequestSeqRef.current = requestSeq;
    const isCurrentDetectRequest = () =>
      detectRequestSeqRef.current === requestSeq && protocolRef.current === requestProtocol;

    setDetecting(true);
    setSelectingBridgeTargetId(null);
    try {
      const healthProbe = await probeBridgeHealth().catch(
        (): LocalBridgeProbeResult => ({ health: null, reachability: "offline" })
      );
      const localBridgeId =
        healthProbe.health?.connected && healthProbe.health.bridgeId
          ? healthProbe.health.bridgeId
          : undefined;
      const result = await debuggingActions.detectAndStartSession({
        protocol: requestProtocol,
        ...(localBridgeId ? { bridgeId: localBridgeId } : {})
      }) as DetectResultWithOperation;
      if (!isCurrentDetectRequest()) return;
      if ("candidates" in result) {
        setTarget(undefined);
        setActiveSessionId(undefined);
        setActiveTargetId(undefined);
        setBridgeTargetCandidates(result.candidates);
        return;
      }
      const { session, target: detectedTarget } = result;
      applyDetectedSession(session, detectedTarget);
      if ("operations" in result && result.operations) {
        replaceEventsFromOperations(result.operations);
      } else if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rowsRef.current));
      }
    } catch (error) {
      if (!isCurrentDetectRequest()) return;
      setTarget(undefined);
      setActiveSessionId(undefined);
      setActiveTargetId(undefined);
      setBridgeTargetCandidates([]);
      const diagnosticError = error instanceof Error ? error as DiagnosticError : undefined;
      const healthSnapshot = (await probeBridgeHealth().catch(() => null))?.health ?? null;
      const detectFailureMessage = formatDetectFailureMessage({
        error,
        health: healthSnapshot,
        protocol: requestProtocol,
        formatError: formatDebuggingRuntimeError
      });
      const detectFailureStderr = diagnosticError?.stderr || detectFailureMessage;
      appendEvent({
        parameterName: `${protocolLabel(requestProtocol)} 设备`,
        parameterKey: "debugging.detect",
        accessMode: "RO",
        action: "detect",
        status: "检测失败",
        returncode: diagnosticError?.returncode ?? 1,
        stdout: diagnosticError?.stdout,
        stderr: detectFailureStderr
      });
    } finally {
      if (isCurrentDetectRequest()) {
        setDetecting(false);
      }
    }
  };

  const selectBridgeTarget = async (selectedTarget: DeviceTarget) => {
    if (detecting) {
      return;
    }
    setSelectingBridgeTargetId(selectedTarget.id);
    setDetecting(true);
    try {
      const result = await debuggingActions.detectAndStartSession({
        protocol,
        targetId: selectedTarget.id,
        bridgeId: selectedTarget.bridgeId
      }) as DetectResultWithOperation;
      if ("candidates" in result) {
        setBridgeTargetCandidates(result.candidates);
        return;
      }
      applyDetectedSession(result.session, result.target);
      if ("operations" in result && result.operations) {
        replaceEventsFromOperations(result.operations);
      } else if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rowsRef.current));
      }
    } catch {
    } finally {
      setSelectingBridgeTargetId(null);
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (!runtimeReady) return;
    void detect();
  }, [protocol, runtimeReady]);

  /** Returns true when the write landed (and, for RW rows, read back consistent). */
  const writeRow = async (row: RuntimeRow, confirmationToken?: string): Promise<boolean> => {
    if ((!target && !activeSessionId) || !canWrite(row)) return false;
    if (row.risk === "High" && !confirmationToken) {
      setPendingHighRiskWrite(row);
      return false;
    }
    const readBack = row.accessMode === "RW";
    const requestProtocol = protocolRef.current;
    const generation = rowOperationGenerationRef.current;
    const operationSeq = nextRowOperationSeq(row.id);
    updateRow(row.id, { runtimeStatus: "执行中", activeOperation: "write", error: undefined });
    try {
      const result: WriteResultWithOperation = await debuggingActions.writeNode({
        sessionId: activeSessionId,
        target: activeTargetId,
        nodeId: row.id,
        nodePath: row.nodePath,
        value: row.draftValue,
        readBack,
        risk: row.risk,
        ...(confirmationToken ? { confirmationToken } : {})
      });

      if (!isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) return false;

      if (!result.ok) {
        updateRow(row.id, {
          runtimeStatus: "写入失败",
          activeOperation: undefined,
          error: result.error || result.writeResult?.stderr || "写入失败"
        });
      } else if (readBack && result.verified) {
        const value = result.value ?? result.readResult?.stdout?.trim() ?? row.draftValue;
        updateRow(row.id, {
          runtimeCurrentValue: value,
          lastReadValue: value,
          runtimeStatus: "成功",
          activeOperation: undefined
        });
      } else if (readBack) {
        const value = result.value ?? result.readResult?.stdout?.trim();
        updateRow(row.id, {
          runtimeCurrentValue: value ?? row.runtimeCurrentValue,
          lastReadValue: value ?? row.lastReadValue,
          runtimeStatus: "失败",
          activeOperation: undefined,
          error: result.error || result.readResult?.stderr || "回读不一致"
        });
      } else {
        updateRow(row.id, { runtimeStatus: "成功", activeOperation: undefined });
      }

      if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rowsRef.current));
      } else {
        appendEvent({
          parameterName: row.name,
          parameterKey: row.key,
          accessMode: row.accessMode,
          action: readBack ? "write-readback" : "write",
          status: !result.ok ? "写入失败" : readBack ? (result.verified ? "回读一致" : "回读不一致") : "写入成功",
          returncode: (result.writeResult as CommandResultMeta | undefined)?.returncode,
          stdout: isComplexDebugParameter(row) ? undefined : result.readResult?.stdout || result.writeResult?.stdout,
          stderr: result.readResult?.stderr || result.writeResult?.stderr || result.error,
          nodePath: row.nodePath,
          ...complexOperationMetadata(row, {
            id: "",
            sessionId: "",
            nodePath: row.nodePath,
            operationType: "write",
            status: !result.ok ? "failed" : readBack && !result.verified ? "readback_mismatch" : "succeeded",
            verified: Boolean(result.verified),
            durationMs: 0,
            createdAt: "",
            requestedValue: row.draftValue,
            readbackValue: result.value ?? result.readResult?.stdout?.trim(),
            valueKind: row.valueKind,
            valueFormat: row.valueFormat
          }, result.value ?? result.readResult?.stdout?.trim() ?? row.draftValue)
        });
      }
      return Boolean(result.ok) && (!readBack || Boolean(result.verified));
    } catch (error) {
      const message = readFailureMessage(error);
      if (isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) {
        updateRow(row.id, {
          runtimeStatus: "写入失败",
          activeOperation: undefined,
          error: message
        });
      }
      appendEvent({
        parameterName: row.name,
        parameterKey: row.key,
        accessMode: row.accessMode,
        action: readBack ? "write-readback" : "write",
        status: "写入失败",
        returncode: (error as DiagnosticError | undefined)?.returncode ?? 1,
        stderr: (error as DiagnosticError | undefined)?.stderr || message,
        nodePath: row.nodePath
      });
      return false;
    }
  };

  /** Batch dispatch after any required aggregate confirmation; token covers high-risk rows. */
  const runBulkWrite = async (rowsToWrite: RuntimeRow[], confirmationToken?: string) => {
    let succeeded = 0;
    let failed = 0;
    for (const row of rowsToWrite) {
      const ok = await writeRow(
        row,
        row.risk === "High" ? confirmationToken : undefined
      );
      if (ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }
    // Only rows that were actually dispatched leave the selection.
    setSelectedIds((current) => {
      const next = new Set(current);
      rowsToWrite.forEach((row) => next.delete(row.id));
      return next;
    });
    setBulkWriteSummary(`批量写入完成：成功 ${succeeded} / 失败 ${failed}`);
  };

  const bulkWriteRows = async () => {
    const rowsToWrite = selectedIds.size > 0 ? pendingSelectedRows : pendingRows;
    if (!connected || rowsToWrite.length === 0) return;

    // High-risk rows require a single aggregate confirmation before dispatch —
    // never per-row dialogs that overwrite each other or silent skips.
    const highRiskRows = rowsToWrite.filter((row) => row.risk === "High");
    if (highRiskRows.length > 0) {
      setPendingBulkWrite({ rows: rowsToWrite, highRiskRows });
      return;
    }

    await runBulkWrite(rowsToWrite);
  };

  useEffect(() => {
    if (!bulkWriteSummary) return undefined;
    const timer = window.setTimeout(() => setBulkWriteSummary(null), 8000);
    return () => window.clearTimeout(timer);
  }, [bulkWriteSummary]);

  const batchTargetRows = selectedIds.size > 0 ? pendingSelectedRows : pendingRows;

  useTopBarActions(
    <div className="device-pill">
      <span className={connected ? "live-dot" : "idle-dot"} />
      {connected ? `已连接：${target}` : detecting ? "检测中..." : `未连接 ${protocolLabel(protocol)} 设备`}
      <button className="link-button" type="button" disabled={!runtimeReady} onClick={() => void detect()}>
        重新检测
      </button>
    </div>,
    [connected, detecting, protocol, runtimeReady, target]
  );

  return (
    <div className="workbench-page node-debugging-page">
      <div className="workbench-one-col">
        <div className="node-debugging-controls">
          <div className="protocol-switch" role="group" aria-label="连接协议">
            {(["hdc", "adb"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={protocol === item ? "protocol-switch-button active" : "protocol-switch-button"}
                aria-pressed={protocol === item}
                onClick={() => switchProtocol(item)}
              >
                {protocolLabel(item)}
              </button>
            ))}
          </div>
        </div>
        <LocalDeviceBridgePanel
          target={target}
          detecting={detecting}
          protocol={protocol}
          onDetect={() => void detect()}
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
                      onClick={() => void selectBridgeTarget(candidate)}
                    >
                      {selecting ? "连接中..." : `连接 ${bridgeTargetLabel(candidate)}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="debug-table">
          <div className="panel-header">
            <strong>节点调试参数</strong>
            <span>{connected ? `${protocolLabel(protocol)} 设备在线` : "等待设备检测"}</span>
          </div>

          <section className="parameters-table parameters-table--column-filters" aria-label="节点调试参数">
            <div className="parameters-table-toolbar">
              <label className="parameters-table-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="按名称 / Key 搜索"
                  aria-label="按名称 / Key 搜索"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
              <span className="parameters-table-count">Showing {visibleRows.length} of {rows.length}</span>
            </div>

            <div className="parameters-table-scroll">
              <table className="parameters-table-grid">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="全选当前可写节点"
                        checked={allVisibleSelected}
                        disabled={selectableVisibleIds.length === 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>参数名称</span>
                      </div>
                    </th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>访问模式</span>
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
                    return (
                    <tr key={row.id}>
                      <td data-label="选择">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${row.name}`}
                          checked={selectedIds.has(row.id)}
                          disabled={!canWrite(row)}
                          onChange={() => toggleSelect(row.id)}
                        />
                      </td>
                      <td data-label="参数名称">
                        <strong>{row.name}</strong>
                        {subtitle ? <small>{subtitle}</small> : null}
                      </td>
                      <td data-label="访问模式">{row.accessMode}</td>
                      <td className="mono" data-label="当前值">
                        <DebugCurrentValueCell row={row} />
                        {bindingUnavailableReason(row) ? <small className="node-row-error">{bindingUnavailableReason(row)}</small> : null}
                        {row.error && row.runtimeStatus !== "失败" && row.runtimeStatus !== "写入失败" ? <small className="node-row-error">{row.error}</small> : null}
                      </td>
                      <td data-label="目标写入值">
                        {canWrite(row) ? (
                          isComplexDebugParameter(row) ? (
                            <DebugTableValuePreview value={row.draftValue} row={row} />
                          ) : (
                            row.draftValue
                          )
                        ) : (
                          <span>只读</span>
                        )}
                      </td>
                      <td data-label="状态"><span className={statusClass(row.runtimeStatus)}>{row.runtimeStatus}</span></td>
                      <td className="parameter-row-actions" data-label="操作">
                        <button
                          className="icon-button parameter-row-edit"
                          type="button"
                          aria-label={`${canWrite(row) ? "查看/修改" : "查看详情"} ${row.name}`}
                          title={canWrite(row) ? "查看/修改" : "查看详情"}
                          onClick={() => setEditingRowId(row.id)}
                        >
                          {canWrite(row) ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="parameters-submit-bar parameters-submit-bar-active" aria-label="节点批量下发操作栏">
            <div>
              <strong>{selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : `${pendingRows.length} 项节点等待写入`}</strong>
              <span>{selectedIds.size > 0 ? `其中 ${pendingSelectedRows.length} 项为待写入状态` : "可先在节点详情中暂存目标值，再批量下发到设备。"}</span>
            </div>
            <div className="debugging-action-buttons">
              <button
                className="button subtle"
                type="button"
                disabled={!connected || !state.lastDebugSnapshot}
                title={state.lastDebugSnapshot ? "回滚到上次写前快照" : "尚无快照，写入成功后自动生成"}
                onClick={() => setRollbackDialogOpen(true)}
              >
                <RotateCcw size={16} aria-hidden="true" />
                回滚快照
              </button>
              <button
                className="submit-round-button debugging-deploy-button"
                type="button"
                disabled={!connected || batchTargetRows.length === 0}
                onClick={() => void bulkWriteRows()}
              >
                <Send size={16} aria-hidden="true" />
                {selectedIds.size > 0 ? `下发选中 (${pendingSelectedRows.length})` : "批量下发节点"}
              </button>
            </div>
          </div>
        </section>

        <NodeOperationHistoryPanel events={events} />
      </div>

      {editingRow ? (
        <div className={isComplexDebugParameter(editingRow) ? "node-complex-editor" : undefined}>
        <WorkbenchSheet
          open
          onClose={() => setEditingRowId(null)}
          title="节点详情"
          description={editingRowSubtitle ? `${editingRow.name} · ${editingRowSubtitle}` : editingRow.name}
          footer={
            canWrite(editingRow) ? (
              <div className="draft-sheet-footer">
                <span>
                  {editingRow.accessMode === "RW"
                    ? "写入后将自动回读并校验设备返回值。"
                    : "该节点仅支持写入，写入后不可回读。"}
                </span>
                <div className="draft-sheet-footer-actions">
                  <button
                    className="button subtle"
                    type="button"
                    disabled={editingRow.runtimeStatus === "执行中"}
                    onClick={() => stashRow(editingRow)}
                  >
                    暂存
                  </button>
                  <button
                    className="submit-round-button debugging-deploy-button"
                    type="button"
                    disabled={!connected || editingRow.runtimeStatus === "执行中"}
                    onClick={() => void writeRow(editingRow)}
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
                <div>
                  <strong>{editingRow.name}</strong>
                  <code>{editingRow.key}</code>
                </div>
                <span className={statusClass(editingRow.runtimeStatus)}>{editingRow.runtimeStatus}</span>
              </div>
              {editingRow.description ? (
                <p className="debug-detail-description">{editingRow.description}</p>
              ) : null}
              <div className="debug-detail-fields">
                <div className="debug-detail-row">
                  <span>访问模式</span>
                  <strong>{editingRow.accessMode}</strong>
                </div>
                {isComplexDebugParameter(editingRow) && editingRow.lastReadValue !== undefined ? (
                  <DebugValueCodeBlock label="当前值" row={editingRow} value={editingRow.runtimeCurrentValue} />
                ) : (
                  <div className="debug-detail-row">
                    <span>当前值</span>
                    <strong className="mono">{displayCurrentValue(editingRow)} {editingRow.lastReadValue !== undefined ? editingRow.unit : ""}</strong>
                  </div>
                )}
                <div className="debug-detail-row">
                  <span>目标写入值</span>
                  <strong className="mono">{canWrite(editingRow) ? editingRow.draftValue : "只读"}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>模块</span>
                  <strong>{editingRow.module}</strong>
                </div>
                {isComplexDebugParameter(editingRow) ? (
                  <>
                    <div className="debug-detail-row">
                      <span>格式</span>
                      <strong>{getDebugValueFormatLabel(editingRow)}</strong>
                    </div>
                    <div className="debug-detail-row">
                      <span>规范化</span>
                      <strong>{getDebugNormalizationModeLabel(editingRow.normalizationMode)}</strong>
                    </div>
                  </>
                ) : null}
              </div>
              {editingRow.error ? <p className="node-row-error">{editingRow.error}</p> : null}
              {canWrite(editingRow) ? (
                <>
                  <NodeWriteFormatPanel row={editingRow} protocol={protocol} />
                  <label className="field-label" htmlFor={`node-target-${editingRow.id}`}>目标写入值</label>
                  <textarea
                    id={`node-target-${editingRow.id}`}
                    aria-label="目标写入值"
                    className={isComplexDebugParameter(editingRow) ? "node-target-editor node-complex-target-editor" : "node-target-editor"}
                    rows={isComplexDebugParameter(editingRow) ? debugValueEditorRows(editingRow.draftValue) : 8}
                    wrap={isComplexDebugParameter(editingRow) ? "off" : undefined}
                    value={editingRow.draftValue}
                    onChange={(event) => updateRow(editingRow.id, { draftValue: event.target.value, runtimeStatus: "待写入" })}
                  />
                </>
              ) : null}
            </div>
          </div>
        </WorkbenchSheet>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingHighRiskWrite !== null}
        title="确认高风险节点写入"
        description={
          pendingHighRiskWrite
            ? `节点「${pendingHighRiskWrite.name}」风险为高。确认后才会带 confirmation token 写入设备。`
            : null
        }
        confirmLabel="确认写入"
        tone="danger"
        onCancel={() => setPendingHighRiskWrite(null)}
        onConfirm={() => {
          const row = pendingHighRiskWrite;
          setPendingHighRiskWrite(null);
          if (row) {
            void writeRow(row, "confirm-high-risk-write");
          }
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
                确认后高风险节点将统一携带 confirmation token 下发；取消则不写入任何节点。
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
        onCancel={() => setPendingBulkWrite(null)}
        onConfirm={() => {
          const batch = pendingBulkWrite;
          setPendingBulkWrite(null);
          if (batch) {
            void runBulkWrite(batch.rows, "confirm-high-risk-write");
          }
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
          onCancel={() => setRollbackDialogOpen(false)}
          onConfirm={() => {
            const snapshot = state.lastDebugSnapshot;
            if (!snapshot) return;
            void debuggingActions.rollbackSnapshot({
              snapshotId: snapshot.id,
              confirmationToken: "confirm-rollback"
            });
            setRollbackDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
