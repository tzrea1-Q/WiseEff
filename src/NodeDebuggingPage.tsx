import { Eye, Pencil, RotateCw, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "./hdcClient";
import { ColumnFilter } from "./components/ColumnFilter";
import { NodeOperationHistoryPanel, type NodeOperationEvent } from "./components/NodeOperationHistoryPanel";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { useTopBarActions } from "./components/layout";
import { formatDebuggingRuntimeError, type DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import type { NodeOperationSnapshot, NodeReadResult, NodeWriteResult } from "./application/ports/DebuggingGateway";
import type {
  DebugConnectionProtocol,
  DebugParameterBindingStatus,
  DebugParameterNodeBinding
} from "./domain/debugging/types";
import type { DebugParameter, PrototypeState } from "./mockData";

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
const protocolSwitchRedetectMessage = "切换协议后需要重新检测设备";

function readInitialProtocol(): DebugConnectionProtocol {
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

function displayCurrentValue(row: RuntimeRow) {
  if (row.accessMode === "WO") return "写入后不可回读";
  if (bindingUnavailableReason(row)) return unsupportedNodeValueLabel;
  if (row.runtimeStatus === "写入失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    if (row.lastReadValue !== undefined) return row.runtimeCurrentValue;
    return row.error || "写入失败";
  }
  if (row.runtimeStatus === "失败") {
    if (isUnsupportedParameterError(row.error)) return unsupportedNodeValueLabel;
    return row.error || "读取失败";
  }
  if (row.lastReadValue !== undefined) return row.runtimeCurrentValue;
  if (row.runtimeStatus === "执行中") {
    return row.activeOperation === "write" ? "写入中..." : "读取中...";
  }
  return "等待读取";
}

function readFailureMessage(error: unknown) {
  return formatDebuggingRuntimeError(error);
}

function formatSessionDuration(startedAt: string | null, now: Date) {
  if (!startedAt) return "—";
  const startTime = new Date(startedAt).getTime();
  if (!Number.isFinite(startTime)) return "—";
  return `${Math.max(0, Math.floor((now.getTime() - startTime) / 60_000))} 分钟`;
}

function isSuccessfulWriteEvent(event: PageNodeOperationEvent) {
  return (event.action === "write" || event.action === "write-readback") &&
    (event.status === "写入成功" || event.status === "回读一致");
}

function compactNodeEventStatus(status: string) {
  if (status.includes("失败") || status.includes("不一致")) return "失败";
  if (status.includes("成功") || status.includes("一致") || status.includes("已连接")) return "成功";
  return status;
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
  return rows.find((row) => row.id === operation.parameterId || row.nodePath === operation.nodePath);
}

function eventFromOperation(operation: NodeOperationSnapshot, rows: RuntimeRow[]): Omit<PageNodeOperationEvent, "id" | "at"> & { at?: string } {
  const row = findOperationParameter(operation, rows);
  const stdout = operation.readbackValue ?? operation.readValue ?? operation.previousValue ?? operation.requestedValue;
  return {
    parameterName: row?.name ?? (operation.operationType === "detect" ? `${protocolLabel(operation.protocol ?? "hdc")} 设备` : operation.parameterId ?? operation.nodePath),
    parameterKey: row?.key ?? operation.parameterId ?? operation.nodePath,
    accessMode: row?.accessMode ?? "RO",
    action: eventActionFromOperation(operation),
    status: eventStatusFromOperation(operation),
    returncode: returncodeFromOperation(operation),
    stdout,
    stderr: operation.failureReason,
    nodePath: operation.nodePath,
    durationMs: operation.durationMs,
    at: operation.createdAt
  };
}

type CommandResultMeta = { returncode?: number };
type DiagnosticError = Error & { stderr?: string; stdout?: string; returncode?: number };
type ReadResultWithOperation = NodeReadResult & CommandResultMeta & { operation?: NodeOperationSnapshot };
type WriteResultWithOperation = NodeWriteResult & { operation?: NodeOperationSnapshot };
type DetectResultWithOperation = Awaited<ReturnType<DebuggingRuntimeActions["detectAndStartSession"]>> & {
  operation?: NodeOperationSnapshot;
};

function NodeSessionSummaryCard({
  connected,
  target,
  detecting,
  connectionError,
  sessionStartedAt,
  now,
  writtenCount,
  pendingCount,
  failedCount,
  latestEvent,
  protocol,
  onDetect
}: {
  connected: boolean;
  target?: string;
  detecting: boolean;
  connectionError: string;
  sessionStartedAt: string | null;
  now: Date;
  writtenCount: number;
  pendingCount: number;
  failedCount: number;
  latestEvent: NodeOperationEvent | null;
  protocol: DebugConnectionProtocol;
  onDetect: () => void;
}) {
  const label = protocolLabel(protocol);
  const statusLabel = connected ? `在线 · ${target}` : detecting ? `检测中 · ${label} 设备` : `离线 · ${label} 设备`;
  const detailLabel = connected
    ? `通过 ${label} 读写 Linux 节点`
    : connectionError === protocolSwitchRedetectMessage ? protocolSwitchRedetectMessage : connectionError ? `检测失败，请检查 ${label} 环境` : "等待设备检测";

  return (
    <section className="session-summary-card" aria-label="调试会话摘要">
      <div className="session-summary-primary">
        <span className={connected ? "live-dot" : "idle-dot"} aria-hidden="true" />
        <div>
          <strong>{statusLabel}</strong>
          <small>{detailLabel}</small>
        </div>
      </div>
      <div className="session-summary-metrics">
        <div>
          <span>会话时长</span>
          <strong>{formatSessionDuration(sessionStartedAt, now)}</strong>
        </div>
        <div>
          <span>已写入</span>
          <strong>{writtenCount}</strong>
        </div>
        <div>
          <span>待写入</span>
          <strong>{pendingCount}</strong>
        </div>
        <div>
          <span>失败</span>
          <strong>{failedCount}</strong>
        </div>
      </div>
      <div className="session-summary-snapshot">
        {latestEvent ? (
          <>
            <span>最近操作</span>
            <strong>{latestEvent.parameterName}</strong>
            <small>{compactNodeEventStatus(latestEvent.status)}</small>
          </>
        ) : (
          <span>尚无操作 · 检测或写入后自动记录</span>
        )}
        <button className="button subtle" type="button" disabled={detecting} onClick={onDetect}>
          <RotateCw size={16} aria-hidden="true" />
          {detecting ? "检测中" : "重新检测"}
        </button>
      </div>
    </section>
  );
}

function NodeWriteFormatPanel({ row, protocol }: { row: RuntimeRow; protocol: DebugConnectionProtocol }) {
  const titleId = `node-write-format-${row.id}`;
  const exampleValue = row.targetValue || row.currentValue || "value";
  const rangeText = `${row.range} ${row.unit}`.trim();

  return (
    <section className="node-write-format-panel" role="region" aria-labelledby={titleId}>
      <div className="node-write-format-head">
        <h3 id={titleId}>写入格式</h3>
        <span>{row.accessMode}</span>
      </div>
      <p>输入内容会作为原始字符串写入设备端调试节点。</p>
      <dl>
        <div>
          <dt>取值范围</dt>
          <dd>{rangeText}</dd>
        </div>
        <div>
          <dt>单位</dt>
          <dd>{row.unit || "无单位"}</dd>
        </div>
        <div>
          <dt>写入方式</dt>
          <dd>{row.accessMode === "RW" ? "写入后自动回读并校验" : "仅写入，设备不支持回读确认"}</dd>
        </div>
      </dl>
      <div className="node-write-format-example">
        <strong>示例</strong>
        <code>{exampleValue}</code>
        <span>例如输入 {exampleValue}，系统会通过 {protocolLabel(protocol)} 将该值写入当前节点。</span>
      </div>
    </section>
  );
}

export function NodeDebuggingPage({
  state,
  debuggingActions,
  runtimeReady = true
}: {
  state: PrototypeState;
  debuggingActions?: DebuggingRuntimeActions;
  runtimeReady?: boolean;
}) {
  const [protocol, setProtocol] = useState<DebugConnectionProtocol>(readInitialProtocol);
  const [rows, setRows] = useState<RuntimeRow[]>(() =>
    state.debugParameters.map((parameter) => runtimeRowFromParameter(parameter, protocol))
  );
  const [target, setTarget] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [detectDiagnosticError, setDetectDiagnosticError] = useState("");
  const [events, setEvents] = useState<PageNodeOperationEvent[]>([]);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [activeTargetId, setActiveTargetId] = useState<string | undefined>();
  const autoReadSignatureRef = useRef("");
  const protocolRef = useRef(protocol);
  const detectRequestSeqRef = useRef(0);
  const rowsRef = useRef(rows);
  const rowOperationSeqRef = useRef<Record<string, number>>({});
  const selectAllRef = useRef<HTMLInputElement>(null);

  const appendEvent = (event: Omit<PageNodeOperationEvent, "id" | "at"> & { at?: string }) => {
    setEvents((current) => [
      ...current,
      { ...event, id: `node-event-${current.length + 1}`, at: event.at ?? new Date().toISOString() }
    ]);
  };

  const nextRowOperationSeq = (rowId: string) => {
    const nextSeq = (rowOperationSeqRef.current[rowId] ?? 0) + 1;
    rowOperationSeqRef.current[rowId] = nextSeq;
    return nextSeq;
  };

  const isLatestRowOperation = (rowId: string, operationSeq: number) =>
    rowOperationSeqRef.current[rowId] === operationSeq;

  const diagnosticConnectionError = detectDiagnosticError.trim();
  const connected = Boolean(target);
  const normalizedQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    protocolRef.current = protocol;
  }, [protocol]);

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
        row.key.toLowerCase().includes(normalizedQuery);
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
  const writtenCount = useMemo(
    () => events.filter(isSuccessfulWriteEvent).length,
    [events]
  );
  const failedCount = useMemo(
    () => rows.filter((row) => row.runtimeStatus === "失败" || row.runtimeStatus === "写入失败").length,
    [rows]
  );
  const latestEvent = events.at(-1) ?? null;

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
    storeSelectedProtocol(nextProtocol);
    setProtocol(nextProtocol);
    setDetecting(false);
    setTarget(undefined);
    setActiveTargetId(undefined);
    setActiveSessionId(undefined);
    setSessionStartedAt(null);
    setConnectionError("");
    setDetectDiagnosticError("");
    autoReadSignatureRef.current = "";
    rowOperationSeqRef.current = {};
    setSelectedIds(new Set());
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
    const operationSeq = nextRowOperationSeq(row.id);
    updateRow(row.id, { runtimeStatus: "执行中", activeOperation: "read", error: undefined });
    try {
      const result: ReadResultWithOperation = debuggingActions
        ? await debuggingActions.readNode({
            sessionId,
            target: activeTarget,
            parameterId: row.id,
            nodePath: row.nodePath
          })
        : await readNodeValue({ target: activeTarget ?? "", nodePath: row.nodePath });
      const isLatest = isLatestRowOperation(row.id, operationSeq);
      if (isLatest) {
        if (result.ok) {
          const value = result.value ?? result.stdout?.trim() ?? "";
          updateRow(row.id, {
            runtimeCurrentValue: value,
            lastReadValue: value,
            runtimeStatus: "成功",
            activeOperation: undefined
          });
        } else {
          updateRow(row.id, {
            runtimeStatus: "失败",
            activeOperation: undefined,
            error: result.error || result.stderr || "读取失败"
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
          status: result.ok ? "读取成功" : "读取失败",
          returncode: result.returncode,
          stdout: result.stdout,
          stderr: result.stderr || result.error,
          nodePath: row.nodePath
        });
      }
    } catch (error) {
      const message = readFailureMessage(error);
      if (isLatestRowOperation(row.id, operationSeq)) {
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
    for (const row of currentRows) {
      if (canRead(row)) {
        await readRowWithTarget(row, activeTarget, sessionId);
      }
    }
  };

  useEffect(() => {
    if (!debuggingActions || !activeSessionId || !activeTargetId) {
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
    setDetectDiagnosticError("");
    try {
      if (debuggingActions) {
        const result = await debuggingActions.detectAndStartSession(state.activeProjectId, { protocol: requestProtocol }) as DetectResultWithOperation;
        if (!isCurrentDetectRequest()) return;
        const { session, target: detectedTarget } = result;
        setActiveSessionId(session.id);
        setActiveTargetId(detectedTarget.id);
        setTarget(detectedTarget.label);
        setConnectionError("");
        setSessionStartedAt((current) => current ?? session.startedAt);
        if (result.operation) {
          appendEvent(eventFromOperation(result.operation, rowsRef.current));
        }
        return;
      }

      if (requestProtocol === "adb") {
        throw new Error("ADB 调试需要 API 模式后端 gateway。");
      }

      const result = await detectHdcTargets();
      if (!isCurrentDetectRequest()) return;
      setTarget(result.activeTarget);
      setActiveTargetId(result.activeTarget);
      setConnectionError(result.ok ? "" : result.error || result.stderr || "未检测到 HDC 设备");
      appendEvent({
        parameterName: `${protocolLabel(requestProtocol)} 设备`,
        parameterKey: `${requestProtocol}.list.targets`,
        accessMode: "RO",
        action: "detect",
        status: result.ok ? "已连接" : "检测失败",
        returncode: result.ok ? 0 : 1,
        stdout: result.targets.join("\n"),
        stderr: result.stderr
      });
      if (result.ok && result.activeTarget) {
        setSessionStartedAt((current) => current ?? new Date().toISOString());
        await readReadableRows(result.activeTarget, rowsRef.current);
      }
    } catch (error) {
      if (!isCurrentDetectRequest()) return;
      setTarget(undefined);
      setActiveSessionId(undefined);
      setActiveTargetId(undefined);
      const diagnosticError = error instanceof Error ? error as DiagnosticError : undefined;
      const detectFailureMessage = formatDebuggingRuntimeError(error);
      const detectFailureStderr = diagnosticError?.stderr || detectFailureMessage;
      setConnectionError(detectFailureMessage);
      setDetectDiagnosticError(detectFailureMessage);
      if (debuggingActions) {
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
      }
    } finally {
      if (isCurrentDetectRequest()) {
        setDetecting(false);
      }
    }
  };

  useEffect(() => {
    if (!runtimeReady) return;
    void detect();
  }, [protocol, runtimeReady]);

  const writeRow = async (row: RuntimeRow) => {
    if ((!target && !activeSessionId) || !canWrite(row)) return;
    const readBack = row.accessMode === "RW";
    const operationSeq = nextRowOperationSeq(row.id);
    updateRow(row.id, { runtimeStatus: "执行中", activeOperation: "write", error: undefined });
    try {
      const result: WriteResultWithOperation = debuggingActions
        ? await debuggingActions.writeNode({
            sessionId: activeSessionId,
            target: activeTargetId,
            parameterId: row.id,
            nodePath: row.nodePath,
            value: row.draftValue,
            readBack,
            risk: row.risk
          })
        : await writeNodeValue({ target: target ?? "", nodePath: row.nodePath, value: row.draftValue, readBack });

      if (!isLatestRowOperation(row.id, operationSeq)) return;

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
          stdout: result.readResult?.stdout || result.writeResult?.stdout,
          stderr: result.readResult?.stderr || result.writeResult?.stderr || result.error,
          nodePath: row.nodePath
        });
      }
    } catch (error) {
      const message = readFailureMessage(error);
      if (isLatestRowOperation(row.id, operationSeq)) {
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
    }
  };

  const bulkWriteRows = async () => {
    const rowsToWrite = selectedIds.size > 0 ? pendingSelectedRows : pendingRows;
    if (!connected || rowsToWrite.length === 0) return;

    for (const row of rowsToWrite) {
      await writeRow(row);
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      rowsToWrite.forEach((row) => next.delete(row.id));
      return next;
    });
  };

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
        <NodeSessionSummaryCard
          connected={connected}
          target={target}
          detecting={detecting}
          connectionError={connectionError}
          sessionStartedAt={sessionStartedAt}
          now={nowTick}
          writtenCount={writtenCount}
          pendingCount={pendingRows.length}
          failedCount={failedCount}
          latestEvent={latestEvent}
          protocol={protocol}
          onDetect={() => void detect()}
        />
        {diagnosticConnectionError ? (
          <p className="node-row-error">{diagnosticConnectionError}</p>
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
                        <span>范围</span>
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
                  {visibleRows.map((row) => (
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
                        <small>{row.key}</small>
                      </td>
                      <td data-label="访问模式">{row.accessMode}</td>
                      <td className="mono" data-label="当前值">
                        {displayCurrentValue(row)}
                        {bindingUnavailableReason(row) ? <small className="node-row-error">{bindingUnavailableReason(row)}</small> : null}
                        {row.error && row.runtimeStatus !== "失败" && row.runtimeStatus !== "写入失败" ? <small className="node-row-error">{row.error}</small> : null}
                      </td>
                      <td data-label="目标写入值">
                        {canWrite(row) ? row.draftValue : <span>只读</span>}
                      </td>
                      <td data-label="范围">{row.range} {row.unit}</td>
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
                  ))}
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
        <WorkbenchSheet
          open
          onClose={() => setEditingRowId(null)}
          title="节点详情"
          description={`${editingRow.name} · ${editingRow.key}`}
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
                <div className="debug-detail-row">
                  <span>当前值</span>
                  <strong className="mono">{displayCurrentValue(editingRow)} {editingRow.lastReadValue !== undefined ? editingRow.unit : ""}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>目标写入值</span>
                  <strong className="mono">{canWrite(editingRow) ? `${editingRow.draftValue} ${editingRow.unit}` : "只读"}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>有效范围</span>
                  <strong>{editingRow.range} {editingRow.unit}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>模块</span>
                  <strong>{editingRow.module}</strong>
                </div>
              </div>
              {editingRow.error ? <p className="node-row-error">{editingRow.error}</p> : null}
              {canWrite(editingRow) ? (
                <>
                  <NodeWriteFormatPanel row={editingRow} protocol={protocol} />
                  <label className="field-label" htmlFor={`node-target-${editingRow.id}`}>目标写入值</label>
                  <textarea
                    id={`node-target-${editingRow.id}`}
                    aria-label="目标写入值"
                    className="node-target-editor"
                    rows={8}
                    value={editingRow.draftValue}
                    onChange={(event) => updateRow(editingRow.id, { draftValue: event.target.value, runtimeStatus: "待写入" })}
                  />
                </>
              ) : null}
            </div>
          </div>
        </WorkbenchSheet>
      ) : null}
    </div>
  );
}
