/**
 * Node-debugging session — the orchestration state machine behind `/node-debugging`
 * (`NodeDebuggingPage`), extracted to match the dtsReloadRunSession snapshot/subscribe/
 * command shape.
 *
 * Owns protocol persistence, detect / active session + target, bridge-target picking,
 * runtime rows (status, drafts, read/write), and the high-risk write / bulk write /
 * rollback confirmation commands. Framework-free: snapshot + subscribe + command verbs.
 * React adapts through `useNodeDebuggingSession`.
 *
 * Confirmation-token invariants:
 * - `confirm-high-risk-write` is attached only by `confirmWrite` / `confirmBulkWrite`.
 * - `confirm-rollback` is attached only by `confirmRollback`.
 * The page still renders the confirmation dialogs from snapshot flags.
 */

import { isHdcPlaceholderTarget } from "@wiseeff/device-command-core/hdcTargets";

import { normalizeBridgeProtocol } from "@/application/bridge/bridgeTargetSession";
import type { DebuggingRuntimeActions } from "@/application/debugging/debuggingRuntime";
import { formatDebuggingRuntimeError } from "@/application/debugging/debuggingRuntime";
import type {
  DebugReadbackOutcome,
  DebugWriteOutcome,
  DeviceTarget,
  NodeOperationSnapshot,
  NodeReadResult,
  NodeWriteResult
} from "@/application/ports/DebuggingGateway";
import { formatDetectFailureMessage } from "@/components/bridgePanelStatus";
import type { NodeOperationEvent } from "@/components/NodeOperationHistoryPanel";
import { buildValuePreview, isComplexDebugParameter } from "@/debugValueKind";
import type {
  DebugConnectionProtocol,
  DebugParameterBindingStatus,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";
import type { DebugParameter } from "@/domain/prototype/types";
import type { LocalBridgeProbeResult } from "@/infrastructure/http/bridgeConnectLauncher";

export type NodeRuntimeStatus =
  | "未检测"
  | "待写入"
  | "执行中"
  | "写入已执行"
  | "成功"
  | "失败"
  | "写入失败"
  | "写入结果未知"
  | "不可用";

export type ProtocolAwareDebugParameter = DebugParameter & {
  selectedProtocol?: DebugConnectionProtocol;
  bindingStatus?: DebugParameterBindingStatus;
  bindingDisabledReason?: string;
  bindings?: DebugParameterNodeBinding[];
};

type RowOperationKind = "read" | "write";

export type RuntimeRow = ProtocolAwareDebugParameter & {
  runtimeCurrentValue: string;
  draftValue: string;
  runtimeStatus: NodeRuntimeStatus;
  activeOperation?: RowOperationKind;
  error?: string;
  lastReadValue?: string;
  writeOutcome?: DebugWriteOutcome;
  readbackOutcome?: DebugReadbackOutcome;
  currentValueStale?: boolean;
  lastWriteOperationId?: string;
};

export type NodeDebuggingOperationEvent = NodeOperationEvent & {
  durationMs?: number;
};

export const NODE_DEBUGGING_PROTOCOL_STORAGE_KEY = "wiseeff.nodeDebugging.protocol";
export const NODE_DEBUGGING_HIGH_RISK_WRITE_TOKEN = "confirm-high-risk-write";
export const NODE_DEBUGGING_ROLLBACK_TOKEN = "confirm-rollback";

export type NodeDebuggingSessionActions = Pick<
  DebuggingRuntimeActions,
  "detectAndStartSession" | "readNode" | "writeNode" | "rollbackSnapshot" | "refresh"
>;

export type NodeDebuggingProbeBridgeHealth = () => Promise<LocalBridgeProbeResult>;

export type NodeDebuggingPendingBulkWrite = {
  rows: RuntimeRow[];
  highRiskRows: RuntimeRow[];
};

export type NodeDebuggingSessionSnapshot = {
  protocol: DebugConnectionProtocol;
  rows: RuntimeRow[];
  target: string | undefined;
  detecting: boolean;
  events: NodeDebuggingOperationEvent[];
  selectedIds: readonly string[];
  activeSessionId: string | undefined;
  activeTargetId: string | undefined;
  bridgeTargetCandidates: DeviceTarget[];
  selectingBridgeTargetId: string | null;
  pendingHighRiskWrite: RuntimeRow | null;
  pendingBulkWrite: NodeDebuggingPendingBulkWrite | null;
  bulkWriteSummary: string | null;
  rollbackDialogOpen: boolean;
  connected: boolean;
  pendingRows: RuntimeRow[];
  pendingSelectedRows: RuntimeRow[];
  batchTargetRows: RuntimeRow[];
};

export type NodeDebuggingSessionOptions = {
  initialParameters?: DebugParameter[];
  initialProtocol?: DebugConnectionProtocol;
  readProtocol?: () => DebugConnectionProtocol;
  writeProtocol?: (protocol: DebugConnectionProtocol) => void;
};

export type NodeDebuggingSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NodeDebuggingSessionSnapshot;
  syncParameters(parameters: DebugParameter[]): void;
  setProtocol(protocol: DebugConnectionProtocol, actions: Pick<NodeDebuggingSessionActions, "refresh">): void;
  detect(actions: NodeDebuggingSessionActions, probeBridgeHealth: NodeDebuggingProbeBridgeHealth): Promise<void>;
  selectBridgeTarget(target: DeviceTarget, actions: NodeDebuggingSessionActions): Promise<void>;
  setDraftValue(rowId: string, value: string): void;
  toggleSelect(rowId: string): void;
  toggleSelectAll(visibleWritableIds: readonly string[]): void;
  stashRow(rowId: string): void;
  requestWrite(rowId: string, actions: Pick<NodeDebuggingSessionActions, "writeNode">): Promise<boolean>;
  retryRead(rowId: string, actions: Pick<NodeDebuggingSessionActions, "readNode">): Promise<void>;
  confirmWrite(actions: Pick<NodeDebuggingSessionActions, "writeNode">): Promise<boolean>;
  cancelWrite(): void;
  requestBulkWrite(actions: Pick<NodeDebuggingSessionActions, "writeNode">): Promise<void>;
  confirmBulkWrite(actions: Pick<NodeDebuggingSessionActions, "writeNode">): Promise<void>;
  cancelBulkWrite(): void;
  requestRollback(): void;
  confirmRollback(actions: Pick<NodeDebuggingSessionActions, "rollbackSnapshot">, snapshotId: string): void;
  cancelRollback(): void;
};

type CommandResultMeta = { returncode?: number };
type DiagnosticError = Error & { stderr?: string; stdout?: string; returncode?: number };
type ReadResultWithOperation = NodeReadResult & CommandResultMeta & { operation?: NodeOperationSnapshot };
type WriteResultWithOperation = NodeWriteResult & { operation?: NodeOperationSnapshot };
type DetectResultWithOperation = Awaited<ReturnType<DebuggingRuntimeActions["detectAndStartSession"]>> & {
  operation?: NodeOperationSnapshot;
};

const BULK_WRITE_SUMMARY_MS = 8000;

export function readInitialNodeDebuggingProtocol(): DebugConnectionProtocol {
  try {
    return normalizeBridgeProtocol(window.localStorage.getItem(NODE_DEBUGGING_PROTOCOL_STORAGE_KEY));
  } catch {
    return "hdc";
  }
}

export function storeSelectedProtocol(protocol: DebugConnectionProtocol) {
  try {
    window.localStorage.setItem(NODE_DEBUGGING_PROTOCOL_STORAGE_KEY, protocol);
  } catch {
    // Protocol state still updates in memory when browser storage is unavailable.
  }
}

export function protocolLabel(protocol: DebugConnectionProtocol) {
  return protocol.toUpperCase();
}

export function bindingUnavailableReason(row: Pick<ProtocolAwareDebugParameter, "bindingStatus" | "nodePath">) {
  if (row.bindingStatus === "missing") return "未配置该协议节点";
  if (row.bindingStatus === "disabled") return "该协议节点已停用";
  if (!row.nodePath) return "节点不可用";
  return "";
}

export function canRead(row: Pick<ProtocolAwareDebugParameter, "accessMode" | "nodePath" | "bindingStatus">) {
  return !bindingUnavailableReason(row) && (row.accessMode === "RO" || row.accessMode === "RW");
}

export function canWrite(row: Pick<ProtocolAwareDebugParameter, "accessMode" | "nodePath" | "bindingStatus">) {
  return !bindingUnavailableReason(row) && row.accessMode === "RW";
}

export function bridgeTargetLabel(target: Pick<DeviceTarget, "label" | "targetRef" | "bridgeMachineLabel">) {
  const machineLabel = target.bridgeMachineLabel?.trim();
  if (!machineLabel) {
    return target.label;
  }
  const targetIdentity = target.targetRef?.trim() || target.label;
  return `${machineLabel} · ${targetIdentity}`;
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

function initialStatus(row: ProtocolAwareDebugParameter): NodeRuntimeStatus {
  if (bindingUnavailableReason(row)) return "不可用";
  return row.accessMode === "WO" ? "不可用" : "未检测";
}

function runtimeRowFromParameter(
  parameter: DebugParameter,
  protocol: DebugConnectionProtocol,
  existing?: RuntimeRow
): RuntimeRow {
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
    runtimeCurrentValue: preserveRuntimeState
      ? existing.runtimeCurrentValue
      : canRead(protocolParameter)
        ? ""
        : protocolParameter.currentValue,
    draftValue: existing?.draftValue ?? protocolParameter.targetValue,
    runtimeStatus: preserveRuntimeState ? existing.runtimeStatus : initialStatus(protocolParameter),
    error: bindingReason ? undefined : preserveRuntimeState ? existing.error : undefined,
    lastReadValue: preserveRuntimeState ? existing.lastReadValue : undefined,
    writeOutcome: preserveRuntimeState ? existing.writeOutcome : undefined,
    readbackOutcome: preserveRuntimeState ? existing.readbackOutcome : undefined,
    currentValueStale: preserveRuntimeState ? existing.currentValueStale : false,
    lastWriteOperationId: preserveRuntimeState ? existing.lastWriteOperationId : undefined
  };
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
    operation.readbackValueDigest ?? operation.requestedValueDigest ?? operation.previousValueDigest;

  return {
    valuePreview: previewSource,
    valueDigest,
    valueFormat: operation.valueFormat ?? row?.valueFormat
  };
}

function eventActionFromOperation(operation: NodeOperationSnapshot): NodeOperationEvent["action"] {
  if (operation.operationType === "write") {
    return operation.readbackValue !== undefined || operation.status === "readback_mismatch" ? "write-readback" : "write";
  }
  return operation.operationType === "detect" ? "detect" : "read";
}

function eventStatusFromOperation(operation: NodeOperationSnapshot) {
  if (operation.operationType === "write" && operation.writeOutcome) {
    if (operation.writeOutcome !== "executed") return operation.writeOutcome === "unknown" ? "写入结果未知" : "写入失败";
    if (operation.readbackOutcome === "observed") return "已回读";
    if (operation.readbackOutcome === "failed") return "回读失败";
    if (operation.readbackOutcome === "unsupported") return "不支持回读";
    return "写入已执行";
  }
  if (operation.status === "succeeded") {
    if (operation.operationType === "detect") return "已连接";
    if (operation.operationType === "read") return "读取成功";
    return operation.readbackValue !== undefined ? "已回读（历史策略）" : "写入成功（历史策略）";
  }
  if (operation.status === "readback_mismatch") return "回读不一致（历史策略）";
  if (operation.operationType === "detect") return "检测失败";
  if (operation.operationType === "read") return "读取失败";
  return "写入失败";
}

function operationFailureMessage(
  reason: string | undefined,
  outcome?: { writeOutcome?: DebugWriteOutcome; readbackOutcome?: DebugReadbackOutcome }
) {
  if (outcome?.writeOutcome === "unknown") return "写入结果未知，请升级 Device Bridge 后重新读取节点";
  if (outcome?.writeOutcome === "failed") return "节点写入失败，请查看审计详情";
  if (outcome?.writeOutcome === "executed" && outcome.readbackOutcome === "failed") return "写后回读失败，可重新回读";
  if (!reason) return undefined;
  if (reason === "Post-write readback failed.") return "写后回读失败";
  if (reason === "Node write failed.") return "节点写入失败";
  if (reason.startsWith("Device Bridge result did not include outcome details")) {
    return "写入结果未知，请升级 Device Bridge 后重新读取节点";
  }
  return reason;
}

function isUnsupportedWriteError(message: string | undefined) {
  return Boolean(
    message?.includes("not configured for the selected protocol") ||
      message?.includes("binding is disabled for the selected protocol")
  );
}

function returncodeFromOperation(operation: NodeOperationSnapshot) {
  if (operation.status === "succeeded") return 0;
  if (operation.status === "unknown") return undefined;
  return 1;
}

function findOperationParameter(operation: NodeOperationSnapshot, currentRows: RuntimeRow[]) {
  return currentRows.find(
    (row) => row.id === operation.nodeId || row.id === operation.parameterId || row.nodePath === operation.nodePath
  );
}

function eventFromOperation(
  operation: NodeOperationSnapshot,
  currentRows: RuntimeRow[]
): Omit<NodeDebuggingOperationEvent, "id" | "at"> & { at?: string } {
  const row = findOperationParameter(operation, currentRows);
  const stdout = operation.readbackValue ?? operation.readValue ?? operation.previousValue ?? operation.requestedValue;
  const complexMetadata = complexOperationMetadata(row, operation, stdout);
  const isComplex = row ? isComplexDebugParameter(row) : operation.valueKind === "complex";

  return {
    parameterName:
      row?.name ??
      (operation.operationType === "detect" ? `${protocolLabel(operation.protocol ?? "hdc")} 设备` : operation.parameterId ?? operation.nodePath),
    parameterKey: row?.key ?? operation.parameterId ?? operation.nodePath,
    accessMode: row?.accessMode ?? "RO",
    action: eventActionFromOperation(operation),
    status: eventStatusFromOperation(operation),
    returncode: returncodeFromOperation(operation),
    stdout: isComplex ? undefined : stdout,
    stderr: operationFailureMessage(operation.failureReason, operation),
    nodePath: operation.nodePath,
    durationMs: operation.durationMs,
    at: operation.createdAt,
    ...complexMetadata
  };
}

function rebuildRows(
  parameters: DebugParameter[],
  nextProtocol: DebugConnectionProtocol,
  existingRows: RuntimeRow[]
): RuntimeRow[] {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  return parameters.map((parameter) => runtimeRowFromParameter(parameter, nextProtocol, existingById.get(parameter.id)));
}

export function createNodeDebuggingSession(
  options: NodeDebuggingSessionOptions = {}
): NodeDebuggingSession {
  const readProtocol = options.readProtocol ?? readInitialNodeDebuggingProtocol;
  const writeProtocol = options.writeProtocol ?? storeSelectedProtocol;
  const listeners = new Set<() => void>();

  let debugParameters: DebugParameter[] = options.initialParameters ?? [];
  let protocol: DebugConnectionProtocol = options.initialProtocol ?? readProtocol();
  let rows: RuntimeRow[] = rebuildRows(debugParameters, protocol, []);
  let target: string | undefined;
  let detecting = false;
  let events: NodeDebuggingOperationEvent[] = [];
  let selectedIds = new Set<string>();
  let activeSessionId: string | undefined;
  let activeTargetId: string | undefined;
  let bridgeTargetCandidates: DeviceTarget[] = [];
  let selectingBridgeTargetId: string | null = null;
  let pendingHighRiskWrite: RuntimeRow | null = null;
  let pendingBulkWrite: NodeDebuggingPendingBulkWrite | null = null;
  let bulkWriteSummary: string | null = null;
  let rollbackDialogOpen = false;

  let autoReadSignature = "";
  let detectRequestSeq = 0;
  let rowOperationGeneration = 0;
  const rowOperationSeq: Record<string, number> = {};
  let boundReadActions: Pick<NodeDebuggingSessionActions, "readNode"> | null = null;
  let bulkWriteSummaryTimer: ReturnType<typeof setTimeout> | null = null;

  function pendingRowsNow() {
    return rows.filter((row) => canWrite(row) && row.runtimeStatus === "待写入");
  }

  function pendingSelectedRowsNow() {
    return rows.filter(
      (row) =>
        selectedIds.has(row.id) &&
        canWrite(row) &&
        (row.runtimeStatus === "待写入" || row.runtimeStatus === "写入失败")
    );
  }

  function rebuildSnapshot(): NodeDebuggingSessionSnapshot {
    const pendingRows = pendingRowsNow();
    const pendingSelected = pendingSelectedRowsNow();
    return {
      protocol,
      rows,
      target,
      detecting,
      events,
      selectedIds: [...selectedIds],
      activeSessionId,
      activeTargetId,
      bridgeTargetCandidates,
      selectingBridgeTargetId,
      pendingHighRiskWrite,
      pendingBulkWrite,
      bulkWriteSummary,
      rollbackDialogOpen,
      connected: Boolean(target) && !isHdcPlaceholderTarget(target ?? ""),
      pendingRows,
      pendingSelectedRows: pendingSelected,
      batchTargetRows: selectedIds.size > 0 ? pendingSelected : pendingRows
    };
  }

  let cachedSnapshot = rebuildSnapshot();

  function emit(): void {
    cachedSnapshot = rebuildSnapshot();
    for (const listener of listeners) listener();
  }

  function rememberReadActions(actions: Pick<NodeDebuggingSessionActions, "readNode">) {
    boundReadActions = actions;
  }

  function appendEvent(event: Omit<NodeDebuggingOperationEvent, "id" | "at"> & { at?: string }) {
    events = [
      ...events,
      { ...event, id: `node-event-${events.length + 1}`, at: event.at ?? new Date().toISOString() }
    ];
  }

  function replaceEventsFromOperations(operations: NodeOperationSnapshot[]) {
    events = operations.map((operation, index) => {
      const base = eventFromOperation(operation, rows);
      return {
        ...base,
        id: operation.id || `node-event-session-${index + 1}`,
        at: operation.createdAt ?? new Date().toISOString()
      };
    });
  }

  function nextRowOperationSeq(rowId: string) {
    const nextSeq = (rowOperationSeq[rowId] ?? 0) + 1;
    rowOperationSeq[rowId] = nextSeq;
    return nextSeq;
  }

  function isLatestRowOperation(
    rowId: string,
    operationSeq: number,
    generation: number,
    requestProtocol: DebugConnectionProtocol
  ) {
    return (
      rowOperationGeneration === generation &&
      protocol === requestProtocol &&
      rowOperationSeq[rowId] === operationSeq
    );
  }

  function patchRow(id: string, patch: Partial<RuntimeRow>) {
    rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
  }

  function scheduleBulkWriteSummaryClear() {
    if (bulkWriteSummaryTimer) {
      clearTimeout(bulkWriteSummaryTimer);
    }
    bulkWriteSummaryTimer = setTimeout(() => {
      bulkWriteSummary = null;
      bulkWriteSummaryTimer = null;
      emit();
    }, BULK_WRITE_SUMMARY_MS);
  }

  function applyDetectedSession(session: { id: string; startedAt: string }, detectedTarget: DeviceTarget) {
    if (isHdcPlaceholderTarget(detectedTarget.targetRef ?? detectedTarget.label ?? "")) {
      activeSessionId = undefined;
      activeTargetId = undefined;
      target = undefined;
      bridgeTargetCandidates = [];
      return;
    }
    activeSessionId = session.id;
    activeTargetId = detectedTarget.id;
    target = bridgeTargetLabel(detectedTarget);
    bridgeTargetCandidates = [];
  }

  function maybeAutoRead() {
    if (!boundReadActions || !activeSessionId || !activeTargetId) {
      return;
    }

    const readableRows = rows.filter(canRead);
    const signature = `${activeSessionId}:${readableRows.map((row) => row.id).join("|")}`;
    if (autoReadSignature === signature) {
      return;
    }

    autoReadSignature = signature;
    void readReadableRows(activeTargetId, readableRows, activeSessionId, boundReadActions).catch(() => undefined);
  }

  async function readRowWithTarget(
    row: RuntimeRow,
    activeTarget: string | undefined,
    sessionId: string | undefined,
    actions: Pick<NodeDebuggingSessionActions, "readNode">,
    relatedOperationId?: string
  ) {
    if ((!activeTarget && !sessionId) || !canRead(row)) return;
    const requestProtocol = protocol;
    const generation = rowOperationGeneration;
    const operationSeq = nextRowOperationSeq(row.id);
    patchRow(row.id, { runtimeStatus: "执行中", activeOperation: "read", error: undefined });
    emit();
    try {
      const result: ReadResultWithOperation = await actions.readNode({
        sessionId,
        target: activeTarget,
        nodeId: row.id,
        nodePath: row.nodePath,
        ...(relatedOperationId ? { relatedOperationId } : {})
      });
      const outcome = resolveReadRowOutcome(result);
      const isLatest = isLatestRowOperation(row.id, operationSeq, generation, requestProtocol);
      if (isLatest) {
        if (outcome.ok) {
          patchRow(row.id, {
            runtimeCurrentValue: outcome.value,
            lastReadValue: outcome.value,
            runtimeStatus: "成功",
            activeOperation: undefined,
            error: undefined,
            readbackOutcome: relatedOperationId ? "observed" : row.readbackOutcome,
            currentValueStale: false
          });
        } else {
          patchRow(row.id, {
            runtimeStatus: "失败",
            activeOperation: undefined,
            error: outcome.error,
            readbackOutcome: relatedOperationId ? "failed" : row.readbackOutcome
          });
        }
      }
      if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rows));
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
          ...complexOperationMetadata(
            row,
            {
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
            },
            outcome.value
          )
        });
      }
      emit();
    } catch (error) {
      const message = formatDebuggingRuntimeError(error);
      if (isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) {
        patchRow(row.id, {
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
      emit();
    }
  }

  async function readReadableRows(
    activeTarget: string | undefined,
    currentRows: RuntimeRow[],
    sessionId: string | undefined,
    actions: Pick<NodeDebuggingSessionActions, "readNode">
  ) {
    const generation = rowOperationGeneration;
    const requestProtocol = protocol;
    for (const row of currentRows) {
      if (
        rowOperationGeneration !== generation ||
        protocol !== requestProtocol ||
        (sessionId !== undefined && activeSessionId !== sessionId)
      ) {
        return;
      }
      if (canRead(row)) {
        await readRowWithTarget(row, activeTarget, sessionId, actions);
      }
    }
  }

  async function applyDetectResult(result: DetectResultWithOperation) {
    if ("candidates" in result) {
      target = undefined;
      activeSessionId = undefined;
      activeTargetId = undefined;
      bridgeTargetCandidates = result.candidates;
      return;
    }
    const { session, target: detectedTarget } = result;
    applyDetectedSession(session, detectedTarget);
    if ("operations" in result && result.operations) {
      replaceEventsFromOperations(result.operations);
    } else if (result.operation) {
      appendEvent(eventFromOperation(result.operation, rows));
    }
  }

  async function writeRow(
    row: RuntimeRow,
    actions: Pick<NodeDebuggingSessionActions, "writeNode">,
    confirmationToken?: string
  ): Promise<{ writeOutcome: DebugWriteOutcome; readbackOutcome: DebugReadbackOutcome }> {
    if ((!target && !activeSessionId) || !canWrite(row)) return { writeOutcome: "failed", readbackOutcome: "not_requested" };
    if (row.risk === "High" && !confirmationToken) {
      pendingHighRiskWrite = row;
      emit();
      return { writeOutcome: "failed", readbackOutcome: "not_requested" };
    }
    const readBack = row.accessMode === "RW";
    const requestProtocol = protocol;
    const generation = rowOperationGeneration;
    const operationSeq = nextRowOperationSeq(row.id);
    patchRow(row.id, { runtimeStatus: "执行中", activeOperation: "write", error: undefined });
    emit();
    try {
      const result: WriteResultWithOperation = await actions.writeNode({
        sessionId: activeSessionId,
        target: activeTargetId,
        nodeId: row.id,
        nodePath: row.nodePath,
        value: row.draftValue,
        readBack,
        risk: row.risk,
        ...(confirmationToken ? { confirmationToken } : {})
      });

      if (!isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) {
        return { writeOutcome: "unknown", readbackOutcome: "unknown" };
      }

      const writeOutcome: DebugWriteOutcome = result.writeOutcome ?? (result.ok ? "executed" : "failed");
      const readbackOutcome: DebugReadbackOutcome =
        result.readbackOutcome ??
        (!readBack ? "not_requested" : result.verified ? "observed" : result.readResult ? (result.readResult.ok ? "observed" : "failed") : "unknown");
      const observedValue = result.value ?? result.readResult?.value ?? result.readResult?.stdout?.trim();
      const lastWriteOperationId = result.operation?.id;

      if (writeOutcome !== "executed") {
        patchRow(row.id, {
          runtimeStatus: writeOutcome === "unknown" ? "写入结果未知" : "写入失败",
          activeOperation: undefined,
          error:
            writeOutcome === "unknown"
              ? "写入结果未知，请升级 Device Bridge 后重新读取节点"
              : isUnsupportedWriteError(result.error || result.writeResult?.stderr)
                ? "当前协议未配置该节点或绑定已禁用"
                : "节点写入失败，请查看审计详情",
          writeOutcome,
          readbackOutcome,
          currentValueStale: writeOutcome === "unknown",
          lastWriteOperationId
        });
      } else if (readbackOutcome === "observed") {
        const value = observedValue ?? row.runtimeCurrentValue;
        patchRow(row.id, {
          runtimeCurrentValue: value,
          lastReadValue: value,
          runtimeStatus: "写入已执行",
          activeOperation: undefined,
          error: undefined,
          writeOutcome,
          readbackOutcome,
          currentValueStale: false,
          lastWriteOperationId
        });
      } else {
        patchRow(row.id, {
          runtimeStatus: "写入已执行",
          activeOperation: undefined,
          error:
            readbackOutcome === "failed"
              ? "回读失败：未能取得写后观测值，可重新回读"
              : readbackOutcome === "unknown"
                ? result.error || "回读结果未知，请升级 Device Bridge 后重新读取节点"
                : undefined,
          writeOutcome,
          readbackOutcome,
          currentValueStale: true,
          lastWriteOperationId
        });
      }

      if (result.operation) {
        appendEvent(eventFromOperation(result.operation, rows));
      } else {
        appendEvent({
          parameterName: row.name,
          parameterKey: row.key,
          accessMode: row.accessMode,
          action: readBack ? "write-readback" : "write",
          status:
            writeOutcome !== "executed"
              ? writeOutcome === "unknown" ? "写入结果未知" : "写入失败"
              : readbackOutcome === "observed"
                ? "已回读"
                : readbackOutcome === "failed"
                  ? "回读失败"
                  : readbackOutcome === "unsupported"
                    ? "不支持回读"
                    : "写入已执行",
          returncode: (result.writeResult as CommandResultMeta | undefined)?.returncode,
          stdout: isComplexDebugParameter(row) ? undefined : result.readResult?.stdout || result.writeResult?.stdout,
          stderr: result.readResult?.stderr || result.writeResult?.stderr || result.error,
          nodePath: row.nodePath,
          ...complexOperationMetadata(
            row,
            {
              id: "",
              sessionId: "",
              nodePath: row.nodePath,
              operationType: "write",
              status: writeOutcome === "executed" ? "succeeded" : "failed",
              verified: null,
              writeOutcome,
              readbackOutcome,
              durationMs: 0,
              createdAt: "",
              requestedValue: row.draftValue,
              readbackValue: result.value ?? result.readResult?.stdout?.trim(),
              valueKind: row.valueKind,
              valueFormat: row.valueFormat
            },
            result.value ?? result.readResult?.stdout?.trim() ?? row.draftValue
          )
        });
      }
      emit();
      return { writeOutcome, readbackOutcome };
    } catch (error) {
      const message = formatDebuggingRuntimeError(error);
      if (isLatestRowOperation(row.id, operationSeq, generation, requestProtocol)) {
        patchRow(row.id, {
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
      emit();
      return { writeOutcome: "failed", readbackOutcome: "not_requested" };
    }
  }

  async function runBulkWrite(
    rowsToWrite: RuntimeRow[],
    actions: Pick<NodeDebuggingSessionActions, "writeNode">,
    confirmationToken?: string
  ) {
    let succeeded = 0;
    let failed = 0;
    let unknown = 0;
    let observed = 0;
    let readbackFailed = 0;
    let unsupported = 0;
    const executedIds = new Set<string>();
    for (const row of rowsToWrite) {
      const outcome = await writeRow(row, actions, row.risk === "High" ? confirmationToken : undefined);
      if (outcome.writeOutcome === "executed") {
        succeeded += 1;
        executedIds.add(row.id);
      } else if (outcome.writeOutcome === "unknown") {
        unknown += 1;
      } else {
        failed += 1;
      }
      if (outcome.readbackOutcome === "observed") observed += 1;
      else if (outcome.readbackOutcome === "failed") readbackFailed += 1;
      else if (outcome.readbackOutcome === "unsupported" || outcome.readbackOutcome === "not_requested" || outcome.readbackOutcome === "unknown") unsupported += 1;
    }
    const next = new Set(selectedIds);
    executedIds.forEach((rowId) => next.delete(rowId));
    selectedIds = next;
    bulkWriteSummary = `批量写入完成：写入已执行 ${succeeded} / 写入失败 ${failed} / 写入结果未知 ${unknown}；已回读 ${observed} / 回读失败 ${readbackFailed} / 不支持回读 ${unsupported}`;
    scheduleBulkWriteSummaryClear();
    emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cachedSnapshot;
    },

    syncParameters(parameters) {
      debugParameters = parameters;
      rows = rebuildRows(parameters, protocol, rows);
      emit();
      maybeAutoRead();
    },

    setProtocol(nextProtocol, actions) {
      if (nextProtocol === protocol) return;
      detectRequestSeq += 1;
      rowOperationGeneration += 1;
      writeProtocol(nextProtocol);
      protocol = nextProtocol;
      detecting = false;
      target = undefined;
      activeTargetId = undefined;
      activeSessionId = undefined;
      bridgeTargetCandidates = [];
      selectingBridgeTargetId = null;
      autoReadSignature = "";
      for (const key of Object.keys(rowOperationSeq)) {
        delete rowOperationSeq[key];
      }
      selectedIds = new Set();
      rows = rebuildRows(debugParameters, protocol, rows);
      emit();
      void Promise.resolve()
        .then(() => actions.refresh({ protocol: nextProtocol }))
        .catch(() => undefined);
    },

    async detect(actions, probeBridgeHealth) {
      rememberReadActions(actions);
      const requestProtocol = protocol;
      const requestSeq = detectRequestSeq + 1;
      detectRequestSeq = requestSeq;
      const isCurrentDetectRequest = () => detectRequestSeq === requestSeq && protocol === requestProtocol;

      detecting = true;
      selectingBridgeTargetId = null;
      emit();
      try {
        const healthProbe = await probeBridgeHealth().catch(
          (): LocalBridgeProbeResult => ({ health: null, reachability: "offline" })
        );
        const localBridgeId =
          healthProbe.health?.connected && healthProbe.health.bridgeId ? healthProbe.health.bridgeId : undefined;
        const result = (await actions.detectAndStartSession({
          protocol: requestProtocol,
          ...(localBridgeId ? { bridgeId: localBridgeId } : {})
        })) as DetectResultWithOperation;
        if (!isCurrentDetectRequest()) return;
        await applyDetectResult(result);
        emit();
        maybeAutoRead();
      } catch (error) {
        if (!isCurrentDetectRequest()) return;
        target = undefined;
        activeSessionId = undefined;
        activeTargetId = undefined;
        bridgeTargetCandidates = [];
        const diagnosticError = error instanceof Error ? (error as DiagnosticError) : undefined;
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
        emit();
      } finally {
        if (isCurrentDetectRequest()) {
          detecting = false;
          emit();
        }
      }
    },

    async selectBridgeTarget(selectedTarget, actions) {
      if (detecting) {
        return;
      }
      rememberReadActions(actions);
      selectingBridgeTargetId = selectedTarget.id;
      detecting = true;
      emit();
      try {
        const result = (await actions.detectAndStartSession({
          protocol,
          targetId: selectedTarget.id,
          bridgeId: selectedTarget.bridgeId
        })) as DetectResultWithOperation;
        if ("candidates" in result) {
          bridgeTargetCandidates = result.candidates;
          emit();
          return;
        }
        applyDetectedSession(result.session, result.target);
        if ("operations" in result && result.operations) {
          replaceEventsFromOperations(result.operations);
        } else if (result.operation) {
          appendEvent(eventFromOperation(result.operation, rows));
        }
        emit();
        maybeAutoRead();
      } catch {
        emit();
      } finally {
        selectingBridgeTargetId = null;
        detecting = false;
        emit();
      }
    },

    setDraftValue(rowId, value) {
      patchRow(rowId, { draftValue: value, runtimeStatus: "待写入" });
      emit();
    },

    toggleSelect(rowId) {
      const next = new Set(selectedIds);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      selectedIds = next;
      emit();
    },

    toggleSelectAll(visibleWritableIds) {
      const allSelected =
        visibleWritableIds.length > 0 && visibleWritableIds.every((id) => selectedIds.has(id));
      const next = new Set(selectedIds);
      if (allSelected) {
        visibleWritableIds.forEach((id) => next.delete(id));
      } else {
        visibleWritableIds.forEach((id) => next.add(id));
      }
      selectedIds = next;
      emit();
    },

    stashRow(rowId) {
      patchRow(rowId, { runtimeStatus: "待写入" });
      const next = new Set(selectedIds);
      next.add(rowId);
      selectedIds = next;
      emit();
    },

    async requestWrite(rowId, actions) {
      const row = rows.find((item) => item.id === rowId);
      if (!row) return false;
      return (await writeRow(row, actions)).writeOutcome === "executed";
    },

    async retryRead(rowId, actions) {
      const row = rows.find((item) => item.id === rowId);
      if (!row?.lastWriteOperationId || !canRead(row)) return;
      await readRowWithTarget(row, activeTargetId, activeSessionId, actions, row.lastWriteOperationId);
    },

    async confirmWrite(actions) {
      const row = pendingHighRiskWrite;
      pendingHighRiskWrite = null;
      emit();
      if (!row) return false;
      return (await writeRow(row, actions, NODE_DEBUGGING_HIGH_RISK_WRITE_TOKEN)).writeOutcome === "executed";
    },

    cancelWrite() {
      pendingHighRiskWrite = null;
      emit();
    },

    async requestBulkWrite(actions) {
      const rowsToWrite = selectedIds.size > 0 ? pendingSelectedRowsNow() : pendingRowsNow();
      if (!(Boolean(target) && !isHdcPlaceholderTarget(target ?? "")) || rowsToWrite.length === 0) return;

      const highRiskRows = rowsToWrite.filter((row) => row.risk === "High");
      if (highRiskRows.length > 0) {
        pendingBulkWrite = { rows: rowsToWrite, highRiskRows };
        emit();
        return;
      }

      await runBulkWrite(rowsToWrite, actions);
    },

    async confirmBulkWrite(actions) {
      const batch = pendingBulkWrite;
      pendingBulkWrite = null;
      emit();
      if (!batch) return;
      await runBulkWrite(batch.rows, actions, NODE_DEBUGGING_HIGH_RISK_WRITE_TOKEN);
    },

    cancelBulkWrite() {
      pendingBulkWrite = null;
      emit();
    },

    requestRollback() {
      rollbackDialogOpen = true;
      emit();
    },

    confirmRollback(actions, snapshotId) {
      rollbackDialogOpen = false;
      emit();
      void actions.rollbackSnapshot({
        snapshotId,
        confirmationToken: NODE_DEBUGGING_ROLLBACK_TOKEN
      });
    },

    cancelRollback() {
      rollbackDialogOpen = false;
      emit();
    }
  };
}
