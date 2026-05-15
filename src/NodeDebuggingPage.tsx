import { ChevronRight, RotateCw, Search, Send, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "./hdcClient";
import { MultiSelectDropdown } from "./components/MultiSelectDropdown";
import { NodeOperationHistoryPanel, type NodeOperationEvent } from "./components/NodeOperationHistoryPanel";
import type { DebugParameter, PrototypeState } from "./mockData";
import { Badge, RiskBadge, riskLabels } from "./workbenchUi";

const riskFilterValues = ["High", "Medium", "Low"] as const;
const accessModeOptions = ["RO", "WO", "RW"] as const;

type NodeRuntimeStatus =
  | "未检测"
  | "可读取"
  | "待写入"
  | "读取中"
  | "读取成功"
  | "读取失败"
  | "写入中"
  | "写入成功"
  | "回读校验中"
  | "回读一致"
  | "回读不一致"
  | "写入失败"
  | "不可用";

type RuntimeRow = DebugParameter & {
  runtimeCurrentValue: string;
  draftValue: string;
  runtimeStatus: NodeRuntimeStatus;
  error?: string;
  lastReadValue?: string;
};

type PendingWrite = {
  row: RuntimeRow;
  readBack: boolean;
} | null;

function canRead(row: Pick<DebugParameter, "accessMode" | "nodePath">) {
  return Boolean(row.nodePath) && (row.accessMode === "RO" || row.accessMode === "RW");
}

function canWrite(row: Pick<DebugParameter, "accessMode" | "nodePath">) {
  return Boolean(row.nodePath) && (row.accessMode === "WO" || row.accessMode === "RW");
}

function initialStatus(row: DebugParameter): NodeRuntimeStatus {
  if (!row.nodePath) return "不可用";
  return row.accessMode === "WO" ? "待写入" : "未检测";
}

function statusTone(status: NodeRuntimeStatus): "neutral" | "tertiary" | "secondary" {
  if (status.includes("失败") || status === "回读不一致") return "secondary";
  if (status.includes("成功") || status === "回读一致" || status === "可读取") return "tertiary";
  return "neutral";
}

export function NodeDebuggingPage({ state }: { state: PrototypeState }) {
  const [rows, setRows] = useState<RuntimeRow[]>(() =>
    state.debugParameters.map((parameter) => ({
      ...parameter,
      runtimeCurrentValue: parameter.currentValue,
      draftValue: parameter.targetValue,
      runtimeStatus: initialStatus(parameter)
    }))
  );
  const [target, setTarget] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [events, setEvents] = useState<NodeOperationEvent[]>([]);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilters, setRiskFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [moduleFilters, setModuleFilters] = useState<string[]>([]);
  const [modeFilters, setModeFilters] = useState<string[]>([]);
  const didAutoDetectRef = useRef(false);

  const appendEvent = (event: Omit<NodeOperationEvent, "id" | "at">) => {
    setEvents((current) => [
      ...current,
      { ...event, id: `node-event-${current.length + 1}`, at: new Date().toISOString() }
    ]);
  };

  const detect = async () => {
    setDetecting(true);
    try {
      const result = await detectHdcTargets();
      setTarget(result.activeTarget);
      setConnectionError(result.ok ? "" : result.error || result.stderr || "未检测到 HDC 设备");
      appendEvent({
        parameterName: "HDC 设备",
        parameterKey: "hdc.list.targets",
        accessMode: "RO",
        action: "detect",
        status: result.ok ? "已连接" : "检测失败",
        returncode: result.ok ? 0 : 1,
        stdout: result.targets.join("\n"),
        stderr: result.stderr
      });
    } catch (error) {
      setTarget(undefined);
      setConnectionError(error instanceof Error ? error.message : "检测失败");
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (didAutoDetectRef.current) return;
    didAutoDetectRef.current = true;
    void detect();
  }, []);

  const connected = Boolean(target);
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesSearch =
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.key.toLowerCase().includes(normalizedQuery);
      const matchesRisk = riskFilters.length === 0 || riskFilters.includes(row.risk);
      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(row.runtimeStatus);
      const matchesModule = moduleFilters.length === 0 || moduleFilters.includes(row.module);
      const matchesMode = modeFilters.length === 0 || modeFilters.includes(row.accessMode);
      return matchesSearch && matchesRisk && matchesStatus && matchesModule && matchesMode;
    });
  }, [modeFilters, moduleFilters, normalizedQuery, riskFilters, rows, statusFilters]);

  const moduleOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.module))).map((module) => ({ value: module, label: module })),
    [rows]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.runtimeStatus))).map((status) => ({ value: status, label: status })),
    [rows]
  );
  const riskOptions = useMemo(
    () => riskFilterValues.map((risk) => ({ value: risk, label: `${riskLabels[risk]} (${rows.filter((row) => row.risk === risk).length})` })),
    [rows]
  );
  const modeOptions = useMemo(
    () => accessModeOptions.map((mode) => ({ value: mode, label: `${mode} (${rows.filter((row) => row.accessMode === mode).length})` })),
    [rows]
  );

  const updateRow = (id: string, patch: Partial<RuntimeRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const readRow = async (row: RuntimeRow) => {
    if (!target || !canRead(row)) return;
    updateRow(row.id, { runtimeStatus: "读取中", error: undefined });
    const result = await readNodeValue({ target, nodePath: row.nodePath });
    if (result.ok) {
      updateRow(row.id, {
        runtimeCurrentValue: result.value ?? "",
        lastReadValue: result.value,
        runtimeStatus: "读取成功"
      });
    } else {
      updateRow(row.id, {
        runtimeStatus: "读取失败",
        error: result.error || result.stderr || "读取失败"
      });
    }
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
  };

  const confirmWrite = async () => {
    if (!pendingWrite || !target) return;
    const { row, readBack } = pendingWrite;
    setPendingWrite(null);
    updateRow(row.id, { runtimeStatus: readBack ? "回读校验中" : "写入中", error: undefined });
    const result = await writeNodeValue({ target, nodePath: row.nodePath, value: row.draftValue, readBack });

    if (!result.ok) {
      updateRow(row.id, {
        runtimeStatus: "写入失败",
        error: result.error || result.writeResult?.stderr || "写入失败"
      });
    } else if (readBack && result.verified) {
      updateRow(row.id, { runtimeCurrentValue: result.value ?? row.draftValue, runtimeStatus: "回读一致" });
    } else if (readBack) {
      updateRow(row.id, { runtimeCurrentValue: result.value ?? row.runtimeCurrentValue, runtimeStatus: "回读不一致" });
    } else {
      updateRow(row.id, { runtimeStatus: "写入成功" });
    }

    appendEvent({
      parameterName: row.name,
      parameterKey: row.key,
      accessMode: row.accessMode,
      action: readBack ? "write-readback" : "write",
      status: !result.ok ? "写入失败" : readBack ? (result.verified ? "回读一致" : "回读不一致") : "写入成功",
      returncode: result.writeResult?.returncode,
      stdout: result.readResult?.stdout || result.writeResult?.stdout,
      stderr: result.readResult?.stderr || result.writeResult?.stderr || result.error,
      nodePath: row.nodePath
    });
  };

  return (
    <div className="workbench-page node-debugging-page">
      <header className="page-header">
        <div>
          <nav className="breadcrumb" aria-label="面包屑">
            <span>调试平台</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>节点调试平台</strong>
          </nav>
          <p className="workbench-page-subtitle">通过 HDC 读写设备节点，完成调试参数验证。</p>
        </div>
        <div className="page-actions">
          <div className="device-pill">
            <span className={connected ? "live-dot" : "idle-dot"} />
            {connected ? `已连接：${target}` : detecting ? "检测中..." : "未连接 HDC 设备"}
            <button className="link-button" type="button" onClick={() => void detect()}>
              重新检测
            </button>
          </div>
        </div>
      </header>

      <div className="workbench-one-col">
        {connectionError ? (
          <div className="disconnected-banner" role="status">
            <Terminal size={18} aria-hidden="true" />
            <span>{connectionError}</span>
          </div>
        ) : null}

        <section className="debug-table">
          <div className="panel-header">
            <strong>节点调试参数</strong>
            <span>{connected ? "HDC 设备在线" : "等待设备检测"}</span>
          </div>

          <section className="parameters-table" aria-label="节点调试参数">
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
              <div className="parameters-table-filters">
                <MultiSelectDropdown label="风险等级" value={riskFilters} options={riskOptions} onChange={setRiskFilters} />
                <MultiSelectDropdown label="状态" value={statusFilters} options={statusOptions} onChange={setStatusFilters} />
                <MultiSelectDropdown label="模块" value={moduleFilters} options={moduleOptions} onChange={setModuleFilters} />
                <MultiSelectDropdown label="访问模式" value={modeFilters} options={modeOptions} onChange={setModeFilters} />
              </div>
              <span className="parameters-table-count">Showing {visibleRows.length} of {rows.length}</span>
            </div>

            <div className="parameters-table-scroll">
              <table className="parameters-table-grid">
                <thead>
                  <tr>
                    <th scope="col">参数名称</th>
                    <th scope="col">访问模式</th>
                    <th scope="col">当前值</th>
                    <th scope="col">目标写入值</th>
                    <th scope="col">范围</th>
                    <th scope="col">风险</th>
                    <th scope="col">状态</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="参数名称">
                        <strong>{row.name}</strong>
                        <small>{row.key}</small>
                      </td>
                      <td data-label="访问模式">{row.accessMode}</td>
                      <td className="mono" data-label="当前值">
                        {row.accessMode === "WO" ? "写入后不可回读" : row.runtimeCurrentValue}
                        {row.error ? <small className="node-row-error">{row.error}</small> : null}
                      </td>
                      <td data-label="目标写入值">
                        {canWrite(row) ? (
                          <input
                            aria-label={`${row.key} 目标写入值`}
                            value={row.draftValue}
                            onChange={(event) => updateRow(row.id, { draftValue: event.target.value, runtimeStatus: "待写入" })}
                          />
                        ) : (
                          <span>只读</span>
                        )}
                      </td>
                      <td data-label="范围">{row.range} {row.unit}</td>
                      <td data-label="风险"><RiskBadge risk={row.risk} /></td>
                      <td data-label="状态"><Badge tone={statusTone(row.runtimeStatus)}>{row.runtimeStatus}</Badge></td>
                      <td className="parameter-row-actions" data-label="操作">
                        {canRead(row) ? (
                          <button
                            className="button subtle"
                            type="button"
                            disabled={!connected || row.runtimeStatus === "读取中"}
                            onClick={() => void readRow(row)}
                          >
                            <Terminal size={14} />
                            读取
                          </button>
                        ) : null}
                        {canWrite(row) ? (
                          <button
                            className="submit-round-button debugging-deploy-button"
                            type="button"
                            disabled={!connected || row.runtimeStatus === "写入中" || row.runtimeStatus === "回读校验中"}
                            onClick={() => setPendingWrite({ row, readBack: row.accessMode === "RW" })}
                          >
                            {row.accessMode === "RW" ? <RotateCw size={14} /> : <Send size={14} />}
                            {row.accessMode === "RW" ? "写入并回读" : "写入"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <NodeOperationHistoryPanel events={events} />
      </div>

      {pendingWrite ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="node-write-confirm-title">
          <div className="confirm-dialog node-write-confirm-dialog">
            <h2 id="node-write-confirm-title">确认写入节点</h2>
            <p>{pendingWrite.row.name} 将写入目标值 {pendingWrite.row.draftValue}。风险等级：{riskLabels[pendingWrite.row.risk]}。</p>
            <div className="dialog-actions">
              <button className="button subtle" type="button" onClick={() => setPendingWrite(null)}>取消</button>
              <button className="button danger" type="button" onClick={() => void confirmWrite()}>确认写入</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
