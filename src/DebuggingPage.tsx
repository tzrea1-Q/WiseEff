import { Pencil, Search, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppAction } from "./App";
import { DisconnectedBanner } from "./components/DisconnectedBanner";
import { MultiSelectDropdown } from "./components/MultiSelectDropdown";
import { OperationHistoryPanel } from "./components/OperationHistoryPanel";
import { RollbackConfirmDialog } from "./components/RollbackConfirmDialog";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { useTopBarActions } from "./components/layout";
import type { DebugParameter, PrototypeState } from "./mockData";
import { RiskBadge, Badge, riskLabels } from "./workbenchUi";

const riskFilterValues = ["High", "Medium", "Low"] as const;
type RiskFilter = (typeof riskFilterValues)[number];

type SortKey = "name" | "currentValue" | "targetValue" | "range" | "risk" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" };

const riskScores: Record<DebugParameter["risk"], number> = { High: 3, Medium: 2, Low: 1 };

const sortableHeaders: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "参数名称" },
  { key: "currentValue", label: "当前值" },
  { key: "targetValue", label: "目标设定值" },
  { key: "range", label: "范围" },
  { key: "risk", label: "风险" },
  { key: "status", label: "状态" },
];

function sortValue(row: DebugParameter, key: SortKey) {
  if (key === "risk") return riskScores[row.risk];
  if (key === "range") return `${row.range} ${row.unit}`.trim();
  return row[key];
}

function compareRows(a: DebugParameter, b: DebugParameter, sort: SortState) {
  const av = sortValue(a, sort.key);
  const bv = sortValue(b, sort.key);
  const dir = sort.dir === "asc" ? 1 : -1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
}

type DebuggingPageProps = {
  state: PrototypeState;
  dispatch: (action: AppAction) => void;
};

export function DebuggingPage({ state, dispatch }: DebuggingPageProps) {
  const [nowTick, setNowTick] = useState(() => new Date());
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilters, setRiskFilters] = useState<Set<RiskFilter>>(new Set());
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [moduleFilters, setModuleFilters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeDevice = state.devices.find((d) => d.projectId === state.activeProjectId) ?? state.devices[0];
  const debugParameters = state.debugParameters;
  const connected = activeDevice.status === "已连接";

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    return debugParameters.filter((p) => {
      const matchesSearch = !normalizedQuery || [p.name, p.key].some((v) => v.toLowerCase().includes(normalizedQuery));
      const matchesRisk = riskFilters.size === 0 || riskFilters.has(p.risk);
      const matchesStatus = statusFilters.size === 0 || statusFilters.has(p.status);
      const matchesModule = moduleFilters.size === 0 || moduleFilters.has(p.module);
      return matchesSearch && matchesRisk && matchesStatus && matchesModule;
    });
  }, [debugParameters, normalizedQuery, riskFilters, statusFilters, moduleFilters]);

  const visibleRows = useMemo(() => {
    if (!sort) return filteredRows;
    return [...filteredRows].sort((a, b) => compareRows(a, b, sort));
  }, [filteredRows, sort]);

  const pendingParameters = debugParameters.filter((p) => p.status === "待下发");
  const pendingSelected = useMemo(
    () => visibleRows.filter((p) => selectedIds.has(p.id) && p.status === "待下发"),
    [visibleRows, selectedIds]
  );

  const riskFilterOptions = useMemo(
    () => riskFilterValues.map((r) => ({
      value: r,
      label: `${riskLabels[r]} (${debugParameters.filter((p) => p.risk === r).length})`
    })),
    [debugParameters]
  );

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(debugParameters.map((p) => p.status)));
    return statuses.map((s) => ({ value: s, label: s }));
  }, [debugParameters]);

  const moduleOptions = useMemo(
    () => Array.from(new Set(debugParameters.map((p) => p.module))).map((m) => ({ value: m, label: m })),
    [debugParameters]
  );

  const editingParameter = editingId ? debugParameters.find((p) => p.id === editingId) ?? null : null;

  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectableVisibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const selectedVisibleCount = useMemo(
    () => selectableVisibleIds.filter((id) => selectedIds.has(id)).length,
    [selectableVisibleIds, selectedIds]
  );
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleIds.length;
    }
  }, [selectedVisibleCount, selectableVisibleIds.length]);

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

  const updateSort = (key: SortKey) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: key === "risk" ? "desc" : "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const updateTargetValue = (parameter: DebugParameter, targetValue: string) => {
    dispatch({
      type: "UPDATE_DEBUG_PARAMETER",
      parameterId: parameter.id,
      patch: { targetValue, status: targetValue === parameter.currentValue ? "已同步" : "待下发" }
    });
  };

  const pushPendingValues = () => {
    if (selectedIds.size > 0) {
      if (pendingSelected.length === 0) return;
      dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingSelected.map((p) => p.id) });
      setSelectedIds(new Set());
    } else {
      if (pendingParameters.length === 0) return;
      dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingParameters.map((p) => p.id) });
    }
  };

  const openEditSheet = (id: string) => {
    setEditingId(id);
    setSheetOpen(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setRiskFilters(new Set());
    setStatusFilters(new Set());
    setModuleFilters(new Set());
  };
  useTopBarActions(
    <div className="device-pill">
      <span className={connected ? "live-dot" : "idle-dot"} />
      {connected ? `已连接：${activeDevice.name}` : `未连接：${activeDevice.name}`}
      <button className="link-button" type="button" onClick={() => dispatch({ type: "CONNECT_DEVICE", deviceId: activeDevice.id })}>
        连接
      </button>
    </div>,
    [activeDevice.id, activeDevice.name, connected]
  );

  return (
    <div className="workbench-page debugging-page">
      <div className="workbench-one-col">
        <DisconnectedBanner
          device={activeDevice}
          onConnect={() => dispatch({ type: "CONNECT_DEVICE", deviceId: activeDevice.id })}
        />
        <SessionSummaryCard
          state={state}
          now={nowTick}
          onRollbackRequest={() => setRollbackDialogOpen(true)}
        />
        <section className="debug-table">
          <div className="panel-header">
            <strong>实时可调参数</strong>
            <span>{connected ? "设备在线" : "需要连接"}</span>
          </div>
          <section className="parameters-table" aria-label="实时可调参数">
            <div className="parameters-table-toolbar">
              <label className="parameters-table-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="按名称 / Key 搜索"
                  aria-label="按名称 / Key 搜索"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <div className="parameters-table-filters">
                <MultiSelectDropdown
                  label="风险等级"
                  value={Array.from(riskFilters)}
                  options={riskFilterOptions}
                  onChange={(next) => setRiskFilters(new Set(next.filter((r): r is RiskFilter => riskFilterValues.includes(r as RiskFilter))))}
                />
                <MultiSelectDropdown
                  label="状态"
                  value={Array.from(statusFilters)}
                  options={statusOptions}
                  onChange={(next) => setStatusFilters(new Set(next))}
                />
                <MultiSelectDropdown
                  label="模块"
                  value={Array.from(moduleFilters)}
                  options={moduleOptions}
                  onChange={(next) => setModuleFilters(new Set(next))}
                />
              </div>
              <span className="parameters-table-count">Showing {visibleRows.length} of {debugParameters.length}</span>
            </div>

            <div className="parameters-table-scroll">
              <table className="parameters-table-grid">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="全选当前视图"
                        checked={allVisibleSelected}
                        disabled={selectableVisibleIds.length === 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    {sortableHeaders.map((h) => (
                      <th key={h.key} scope="col" aria-sort={sort?.key === h.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" className="parameters-table-sort-button" aria-label={`按 ${h.label} 排序`} onClick={() => updateSort(h.key)}>
                          {h.label}
                        </button>
                      </th>
                    ))}
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((p) => (
                    <tr
                      key={p.id}
                      className={[
                        selectedIds.has(p.id) ? "parameters-table-row-focused" : "",
                        p.status === "待下发" ? "parameters-table-row-edited" : ""
                      ].filter(Boolean).join(" ")}
                    >
                      <td data-label="选择">
                        <input
                          type="checkbox"
                          aria-label={`勾选 ${p.name}`}
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <td data-label="参数名称">
                        <strong>{p.name}</strong>
                        <small>{p.key}</small>
                      </td>
                      <td className="mono" data-label="当前值">{p.currentValue}</td>
                      <td data-label="目标设定值">
                        <input
                          aria-label={`${p.key} 目标设定值`}
                          value={p.targetValue}
                          onChange={(e) => updateTargetValue(p, e.target.value)}
                        />
                      </td>
                      <td data-label="范围">{p.range} {p.unit}</td>
                      <td data-label="风险"><RiskBadge risk={p.risk} /></td>
                      <td data-label="状态"><Badge tone={p.status === "待下发" ? "secondary" : "neutral"}>{p.status}</Badge></td>
                      <td className="parameter-row-actions" data-label="操作">
                        <button
                          className="icon-button parameter-row-edit"
                          type="button"
                          aria-label={`编辑 ${p.name}`}
                          title={`编辑 ${p.name}`}
                          onClick={() => openEditSheet(p.id)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visibleRows.length === 0 ? (
              <div className="parameters-table-empty">
                <p>没有匹配的参数</p>
                <button type="button" className="button subtle" onClick={clearFilters}>清除筛选条件</button>
              </div>
            ) : null}
          </section>

          <div className="parameters-submit-bar parameters-submit-bar-active" aria-label="下发操作栏">
            <div>
              <strong>{selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : `${pendingParameters.length} 项参数等待应用`}</strong>
              <span>{selectedIds.size > 0 ? `其中 ${pendingSelected.length} 项为待下发状态` : "勾选参数后可批量下发，或直接修改目标值后一键下发。"}</span>
            </div>
            <div className="debugging-action-buttons">
              <button
                className="submit-round-button debugging-deploy-button"
                type="button"
                disabled={!connected || (selectedIds.size > 0 ? pendingSelected.length === 0 : pendingParameters.length === 0)}
                onClick={pushPendingValues}
              >
                <Send size={16} />
                {selectedIds.size > 0 ? `下发选中 (${pendingSelected.length})` : "下发调试值"}
              </button>
            </div>
          </div>
        </section>
        <OperationHistoryPanel events={state.debugEvents} deviceName={activeDevice.name} />
      </div>

      {editingParameter && sheetOpen ? (
        <WorkbenchSheet
          open
          onClose={() => { setSheetOpen(false); setEditingId(null); }}
          title="编辑调试参数"
          description={`${editingParameter.name} · ${editingParameter.key}`}
          footer={
            <div className="draft-sheet-footer">
              <button
                className="submit-round-button debugging-stash-button"
                type="button"
                disabled={editingParameter.status !== "待下发"}
                onClick={() => {
                  setSelectedIds((ids) => new Set([...ids, editingParameter.id]));
                  setSheetOpen(false);
                  setEditingId(null);
                }}
              >
                暂存参数
              </button>
              <button
                className="submit-round-button debugging-deploy-button"
                type="button"
                disabled={!connected || editingParameter.status !== "待下发"}
                onClick={() => {
                  dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: [editingParameter.id] });
                  setSheetOpen(false);
                  setEditingId(null);
                }}
              >
                <Send size={14} />
                下发此参数
              </button>
            </div>
          }
        >
          <div className="draft-sheet-stack">
            <div className="debug-detail-card">
              <div className="debug-detail-head">
                <div>
                  <strong>{editingParameter.name}</strong>
                  <code>{editingParameter.key}</code>
                </div>
                <RiskBadge risk={editingParameter.risk} />
              </div>
              {editingParameter.description ? (
                <p className="debug-detail-description">{editingParameter.description}</p>
              ) : null}
              <div className="debug-detail-fields">
                <div className="debug-detail-row">
                  <span>当前值</span>
                  <strong className="mono">{editingParameter.currentValue} {editingParameter.unit}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>有效范围</span>
                  <strong>{editingParameter.range} {editingParameter.unit}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>模块</span>
                  <strong>{editingParameter.module}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>状态</span>
                  <Badge tone={editingParameter.status === "待下发" ? "secondary" : "neutral"}>{editingParameter.status}</Badge>
                </div>
              </div>
              <label className="field-label" htmlFor={`debug-target-${editingParameter.id}`}>目标设定值</label>
              <input
                id={`debug-target-${editingParameter.id}`}
                aria-label="目标设定值"
                value={editingParameter.targetValue}
                onChange={(e) => updateTargetValue(editingParameter, e.target.value)}
              />
            </div>
          </div>
        </WorkbenchSheet>
      ) : null}

      {rollbackDialogOpen && state.lastDebugSnapshot ? (
        <RollbackConfirmDialog
          snapshot={state.lastDebugSnapshot}
          parameters={state.debugParameters}
          onCancel={() => setRollbackDialogOpen(false)}
          onConfirm={() => {
            dispatch({ type: "ROLLBACK_LAST_SNAPSHOT" });
            setRollbackDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
