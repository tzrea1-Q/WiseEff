import { Eye, Pencil, RotateCcw, RotateCw, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canPerform } from "@/app/permissions";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { ColumnFilter } from "./components/ColumnFilter";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { SectionError, SectionSkeleton } from "./components/common/SectionState";
import { LocalDeviceBridgePanel } from "./components/LocalDeviceBridgePanel";
import { NodeOperationHistoryPanel } from "./components/NodeOperationHistoryPanel";
import { RollbackConfirmDialog } from "./components/RollbackConfirmDialog";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { useTopBarActions } from "./components/layout";
import {
  probeLocalBridgeHealthDetailed,
  type LocalBridgeProbeResult
} from "./infrastructure/http/bridgeConnectLauncher";
import type { DeviceBridgePairingCode, DeviceBridgeRecord } from "./infrastructure/http/deviceBridgeClient";
import type { DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import {
  bindingUnavailableReason,
  bridgeTargetLabel,
  canWrite,
  protocolLabel,
  readInitialNodeDebuggingProtocol,
  type RuntimeRow
} from "./application/debugging/nodeDebuggingSession";
import { useNodeDebuggingSession } from "./application/debugging/useNodeDebuggingSession";
import type { DebugConnectionProtocol } from "./domain/debugging/types";
import {
  debugValueEditorRows,
  debugValuePreview,
  getDebugNormalizationModeLabel,
  getDebugValueFormatLabel,
  isComplexDebugParameter
} from "./debugValueKind";
import { resolveWriteFormatExample, resolveWriteFormatHint } from "@/domain/debugging/writeFormat";
import { nodeRowSubtitle } from "@/domain/debugging/nodeRowSubtitle";
import type { PrototypeState } from "@/domain/prototype/types";

export { readInitialNodeDebuggingProtocol };

const unsupportedNodeValueLabel = "该节点不支持";

/** Stable default so the bridge panel's refresh effect is not re-triggered every render. */
const defaultProbeBridgeHealth = () => probeLocalBridgeHealthDetailed();

function isUnsupportedParameterError(message?: string) {
  if (!message) return false;
  return message.includes("not configured for the selected protocol")
    || message.includes("binding is disabled for the selected protocol");
}

function statusClass(status: RuntimeRow["runtimeStatus"]) {
  const classMap: Record<RuntimeRow["runtimeStatus"], string> = {
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    session.syncParameters(state.debugParameters);
  }, [session, state.debugParameters]);

  const detect = () => {
    if (!runtimeReady) {
      return;
    }
    void session.detect(debuggingActions, probeBridgeHealth);
  };

  useEffect(() => {
    if (!runtimeReady) return;
    void session.detect(debuggingActions, probeBridgeHealth);
    // Match the page-era auto-detect: protocol and catalog readiness only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocol, runtimeReady]);

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
    () => selectableVisibleIds.filter((id) => selectedIds.includes(id)).length,
    [selectableVisibleIds, selectedIds]
  );
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleIds.length;
    }
  }, [selectableVisibleIds.length, selectedVisibleCount]);

  useTopBarActions(
    <div className="device-pill">
      <span className={connected ? "live-dot" : "idle-dot"} />
      {connected ? `已连接：${target}` : detecting ? "检测中..." : `未连接 ${protocolLabel(protocol)} 设备`}
      <button className="link-button" type="button" disabled={!runtimeReady} onClick={() => detect()}>
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
                onClick={() => session.setProtocol(item, debuggingActions)}
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

        <section className="debug-table">
          <div className="panel-header">
            <strong>节点调试参数</strong>
            <span>{connected ? `${protocolLabel(protocol)} 设备在线` : "等待设备检测"}</span>
          </div>

          {runtimeStatus === "loading" ? (
            <SectionSkeleton label="正在加载调试节点" />
          ) : runtimeStatus === "error" ? (
            <SectionError
              message={runtimeError || "无法加载调试节点数据，请稍后重试。"}
              onRetry={handleRuntimeRetry}
            />
          ) : (
            <>
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
              <span className="parameters-table-count">显示 {visibleRows.length} / {rows.length} 个参数</span>
            </div>

            <HorizontalDragScroll className="parameters-table-scroll">
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
                          checked={selectedIds.includes(row.id)}
                          disabled={!canWrite(row)}
                          onChange={() => session.toggleSelect(row.id)}
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
                    }}
                  >
                    清除筛选条件
                  </button>
                )}
              </div>
            ) : null}
          </section>

          <div className="parameters-submit-bar parameters-submit-bar-active" aria-label="节点批量下发操作栏">
            <div>
              <strong>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : `${pendingRows.length} 项节点等待写入`}</strong>
              <span>{selectedIds.length > 0 ? `其中 ${pendingSelectedRows.length} 项为待写入状态` : "可先在节点详情中暂存目标值，再批量下发到设备。"}</span>
            </div>
            <div className="debugging-action-buttons">
              <button
                className="button subtle"
                type="button"
                disabled={!connected || !state.lastDebugSnapshot}
                title={state.lastDebugSnapshot ? "回滚到上次写前快照" : "尚无快照，写入成功后自动生成"}
                onClick={() => session.requestRollback()}
              >
                <RotateCcw size={16} aria-hidden="true" />
                回滚快照
              </button>
              <button
                className="submit-round-button debugging-deploy-button"
                type="button"
                disabled={!connected || batchTargetRows.length === 0}
                onClick={() => void session.requestBulkWrite(debuggingActions)}
              >
                <Send size={16} aria-hidden="true" />
                {selectedIds.length > 0 ? `下发选中 (${pendingSelectedRows.length})` : "批量下发节点"}
              </button>
            </div>
          </div>
            </>
          )}
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
                    onClick={() => {
                      session.stashRow(editingRow.id);
                      setEditingRowId(null);
                    }}
                  >
                    暂存
                  </button>
                  <button
                    className="submit-round-button debugging-deploy-button"
                    type="button"
                    disabled={!connected || editingRow.runtimeStatus === "执行中"}
                    onClick={() => void session.requestWrite(editingRow.id, debuggingActions)}
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
                    onChange={(event) => session.setDraftValue(editingRow.id, event.target.value)}
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
