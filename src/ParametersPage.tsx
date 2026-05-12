import {
  ArrowRight,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import {
  Badge,
  escapeExcelCell,
  getContextQuery,
  riskLabels,
  RiskBadge,
  WorkbenchLayout
} from "./workbenchUi";
import { projects } from "./mockData";
import type { ParameterRecord, PrototypeState } from "./mockData";
import { ParametersTable } from "./components/ParametersTable";
import { WorkbenchSheet } from "./components/WorkbenchSheet";
import { MultiSelectDropdown } from "./components/MultiSelectDropdown";
import { ParameterInsightBar } from "./components/ParameterInsightBar";
import { deriveParameterWorkbenchInsightSnapshot } from "./parameterWorkbenchInsights";

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

type ParametersPageAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "ADD_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] }
  | { type: "STASH_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] };

type ParametersPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<ParametersPageAction>;
  onNavigate: (path: string) => void;
  search: string;
};

function parseRange(range: string) {
  const [min, max] = range.split("-").map((part) => Number.parseFloat(part.trim()));
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

function getRangeWarning(parameter: ParameterRecord, targetValue: string) {
  const numericValue = Number.parseFloat(targetValue);
  const parsedRange = parseRange(parameter.range);
  if (!parsedRange || !Number.isFinite(numericValue)) {
    return "";
  }
  if (numericValue < parsedRange.min || numericValue > parsedRange.max) {
    return `超出 ${parameter.range} ${parameter.unit}`.trim();
  }
  return "";
}

function exportProjectParametersAsExcel(rows: ParameterRecord[], projectCode: string) {
  const headers = ["参数名称", "模块", "当前值", "示例", "范围 / 单位", "重要性", "更新时间"];
  const tableRows = rows
    .map(
      (parameter) => `
        <tr>
          <td>${escapeExcelCell(parameter.name)}</td>
          <td>${escapeExcelCell(parameter.module)}</td>
          <td>${escapeExcelCell(parameter.currentValue)}</td>
          <td>${escapeExcelCell(parameter.recommendedValue)}</td>
          <td>${escapeExcelCell(`${parameter.range} ${parameter.unit}`.trim())}</td>
          <td>${riskLabels[parameter.risk]}</td>
          <td>${escapeExcelCell(parameter.updatedAt)}</td>
        </tr>`
    )
    .join("");
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectCode}-project-parameters.xls`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ParametersPage({ state, dispatch, onNavigate, search }: ParametersPageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilters, setRiskFilters] = useState<Set<ParameterRiskFilter>>(new Set());
  const [moduleFilters, setModuleFilters] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState(state.parameters[0]?.id ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { targetValue: string; reason: string }>>({});
  const [focusedId, setFocusedId] = useState<string | null>(state.parameters[0]?.id ?? null);
  const todayKey = new Date().toISOString().slice(0, 10);
  const insightStorageKey = `parameter-workbench-insight:${state.activeProjectId}:${todayKey}`;
  const [insightDismissed, setInsightDismissed] = useState(() => sessionStorage.getItem(insightStorageKey) === "dismissed");
  const [insightCollapsed, setInsightCollapsed] = useState(false);
  const projectParameters = useMemo(
    () => state.parameters.filter((parameter) => parameter.projectId === state.activeProjectId),
    [state.activeProjectId, state.parameters]
  );
  const moduleOptions = useMemo(
    () => Array.from(new Set(projectParameters.map((parameter) => parameter.module))),
    [projectParameters]
  );
  const parameterById = useMemo(
    () => new Map(state.parameters.map((parameter) => [parameter.id, parameter])),
    [state.parameters]
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const parameters = useMemo(
    () =>
      projectParameters.filter((parameter) => {
        const matchesSearch =
          !normalizedSearchQuery ||
          [parameter.name, parameter.description, parameter.module].some((value) => value.toLowerCase().includes(normalizedSearchQuery));
        const matchesRisk = riskFilters.size === 0 || riskFilters.has(parameter.risk);
        const matchesModule = moduleFilters.size === 0 || moduleFilters.has(parameter.module);
        return matchesSearch && matchesRisk && matchesModule;
      }),
    [moduleFilters, normalizedSearchQuery, projectParameters, riskFilters]
  );
  const selected = parameters.find((parameter) => parameter.id === focusedId) ?? parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];
  const activeProject = projects.find((project) => project.id === state.activeProjectId) ?? projects[0];
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const insightSnapshot = useMemo(
    () => deriveParameterWorkbenchInsightSnapshot(state, state.activeProjectId),
    [state, state.activeProjectId]
  );
  const pendingSubmissionItems = useMemo(
    () =>
      Array.from(selectedIds)
        .map((parameterId) => {
          const parameter = parameterById.get(parameterId);
          if (!parameter) {
            return null;
          }
          const draft = drafts[parameterId];
          if (!draft) {
            return null;
          }
          return {
            parameterId,
            targetValue: draft.targetValue,
            reason: draft.reason,
            parameter
          };
        })
        .filter((item): item is ParameterDraftItem & { parameter: ParameterRecord } => Boolean(item)),
    [drafts, parameterById, selectedIds]
  );
  const modifiedIds = useMemo(
    () => new Set(Object.keys(drafts)),
    [drafts]
  );
  const stashedIds = useMemo(
    () => {
      const ids = new Set<string>();
      state.parameterSubmissionRounds
        .filter((round) => round.status === "已暂存" && round.projectId === state.activeProjectId)
        .forEach((round) => round.items.forEach((item) => ids.add(item.parameterId)));
      return ids;
    },
    [state.parameterSubmissionRounds, state.activeProjectId]
  );
  const validPendingSubmissionItems = useMemo(
    () => pendingSubmissionItems.filter((item) => item.targetValue.trim()),
    [pendingSubmissionItems]
  );
  const allSelectedDraftsHaveTargets =
    selectedIds.size > 0 &&
    pendingSubmissionItems.length === selectedIds.size &&
    validPendingSubmissionItems.length === pendingSubmissionItems.length;

  useEffect(() => {
    if (contextQuery.projectId || contextQuery.module) {
      return;
    }
    setModuleFilters(new Set());
    setRiskFilters(new Set());
  }, [contextQuery.module, contextQuery.projectId, state.activeProjectId]);

  useEffect(() => {
    if (contextQuery.projectId && projects.some((project) => project.id === contextQuery.projectId) && contextQuery.projectId !== state.activeProjectId) {
      dispatch({ type: "SET_PROJECT", projectId: contextQuery.projectId });
    }
  }, [contextQuery.projectId, dispatch, state.activeProjectId]);

  useEffect(() => {
    if (!contextQuery.module) {
      return;
    }
    if (moduleOptions.includes(contextQuery.module)) {
      setModuleFilters(new Set([contextQuery.module]));
    }
  }, [contextQuery.module, moduleOptions]);

  useEffect(() => {
    setInsightDismissed(sessionStorage.getItem(insightStorageKey) === "dismissed");
    setInsightCollapsed(false);
  }, [insightStorageKey]);

  useEffect(() => {
    if (!contextQuery.parameterId) {
      return;
    }
    const requestedParameter = projectParameters.find((parameter) => parameter.id === contextQuery.parameterId);
    if (requestedParameter) {
      setSelectedId(requestedParameter.id);
      setFocusedId(requestedParameter.id);
    }
  }, [contextQuery.parameterId, projectParameters]);

  useEffect(() => {
    if (!contextQuery.logId) {
      return;
    }

    const originLog = state.logs.find((log) => log.id === contextQuery.logId);
    const requestedParameter =
      (contextQuery.parameterId ? parameterById.get(contextQuery.parameterId) : null) ?? selected ?? projectParameters[0];

    if (!originLog || !requestedParameter) {
      return;
    }

    setSelectedIds((ids) => {
      if (ids.has(requestedParameter.id)) {
        return ids;
      }

      return new Set([...ids, requestedParameter.id]);
    });
    setSelectedId(requestedParameter.id);
    setFocusedId(requestedParameter.id);
    setSheetOpen(true);
    setDrafts((items) => {
      const nextDrafts = { ...items };
      nextDrafts[requestedParameter.id] = {
        targetValue: nextDrafts[requestedParameter.id]?.targetValue ?? requestedParameter.recommendedValue,
        reason: nextDrafts[requestedParameter.id]?.reason || `依据日志 ${originLog.fileName} 分析：${originLog.conclusion}`
      };

      return nextDrafts;
    });
  }, [contextQuery.logId, contextQuery.parameterId, parameterById, projectParameters, selected, state.logs]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setFocusedId(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    const activeParameterIds = new Set(projectParameters.map((parameter) => parameter.id));
    setSelectedIds((ids) => {
      const next = new Set(Array.from(ids).filter((id) => activeParameterIds.has(id)));
      return next.size === ids.size ? ids : next;
    });
    setDrafts((items) =>
      Object.fromEntries(Object.entries(items).filter(([parameterId]) => activeParameterIds.has(parameterId)))
    );
  }, [projectParameters]);

  useEffect(() => {
    if (selectedIds.size === 0 && !contextQuery.logId && Object.keys(drafts).length === 0) {
      setSheetOpen(false);
    }
  }, [contextQuery.logId, selectedIds.size, drafts]);

  const handleFocusRow = (id: string) => {
    const parameter = parameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
  };

  const handleEditRow = (id: string) => {
    const parameter = parameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setSelectedIds((ids) => {
      if (ids.has(id)) return ids;
      return new Set([...ids, id]);
    });
    setDrafts((items) => {
      if (items[id]) return items;
      return {
        ...items,
        [id]: {
          targetValue: parameter.recommendedValue,
          reason: ""
        }
      };
    });
    setSheetOpen(true);
  };

  const handleSelectedIdsChange = (next: Set<string>) => {
    const addedIds = Array.from(next).filter((id) => !selectedIds.has(id));
    const removedIds = Array.from(selectedIds).filter((id) => !next.has(id));

    setSelectedIds(next);
    setDrafts((items) => {
      const nextDrafts = { ...items };

      addedIds.forEach((id) => {
        const parameter = parameterById.get(id);
        if (parameter && !nextDrafts[id]) {
          nextDrafts[id] = {
            targetValue: drafts[id]?.targetValue ?? parameter.recommendedValue,
            reason: drafts[id]?.reason ?? ""
          };
        }
      });

      removedIds.forEach((id) => {
        delete nextDrafts[id];
      });

      return nextDrafts;
    });
  };

  const updateDraft = (parameter: ParameterRecord, patch: Partial<{ targetValue: string; reason: string }>) => {
    setDrafts((items) => ({
      ...items,
      [parameter.id]: {
        targetValue: items[parameter.id]?.targetValue ?? parameter.recommendedValue,
        reason: items[parameter.id]?.reason ?? "",
        ...patch
      }
    }));
  };

  const removeDraftItem = (parameterId: string) => {
    const nextSelectedIds = new Set(selectedIds);
    nextSelectedIds.delete(parameterId);
    setSelectedIds(nextSelectedIds);
    if (nextSelectedIds.size === 0) {
      setSheetOpen(false);
    }
    setDrafts((items) => {
      const { [parameterId]: _removed, ...remainingItems } = items;
      return remainingItems;
    });
  };

  const clearAllDrafts = () => {
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
  };

  const openSubmitPreview = () => {
    if (!allSelectedDraftsHaveTargets) {
      return;
    }
    setConfirmOpen(true);
  };

  const submitRound = () => {
    if (!allSelectedDraftsHaveTargets) {
      return;
    }
    const itemsToSubmit = pendingSubmissionItems.map(({ parameter: _parameter, ...item }) => item);
    if (itemsToSubmit.length === 0) {
      return;
    }
    dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: itemsToSubmit });
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
    setConfirmOpen(false);
  };
  const stashRound = () => {
    const itemsToStash = pendingSubmissionItems.map(({ parameter: _parameter, ...item }) => item);
    if (itemsToStash.length === 0) {
      return;
    }
    dispatch({ type: "STASH_PARAMETER_SUBMISSION_ROUND", items: itemsToStash });
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
  };
  const previewItems = pendingSubmissionItems;
  const handleAiAuditClick = () => {
    sessionStorage.removeItem(insightStorageKey);
    setInsightDismissed(false);
    setInsightCollapsed(false);
    document.querySelector(".parameter-insight-bar, .parameter-insight-collapsed")?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  };
  const submitButtonText = selectedIds.size > 0 ? `提交本轮 (${selectedIds.size} 项)` : "提交本轮";
  const clearFilters = () => {
    setSearchQuery("");
    setRiskFilters(new Set());
    setModuleFilters(new Set());
  };
  const dismissInsightForToday = () => {
    sessionStorage.setItem(insightStorageKey, "dismissed");
    setInsightDismissed(true);
  };
  const viewHighRiskFromInsight = () => {
    setRiskFilters(new Set(["High"]));
    setInsightCollapsed(true);
    document.querySelector(".parameters-table")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const addInsightItemsToDraft = () => {
    const insightIds = insightSnapshot.topParameters.map((parameter) => parameter.id);
    if (insightIds.length === 0) {
      return;
    }
    setSelectedIds(new Set([...Array.from(selectedIds), ...insightIds]));
    setDrafts((items) => {
      const nextDrafts = { ...items };
      insightSnapshot.topParameters.forEach((item) => {
        const parameter = parameterById.get(item.id);
        if (!parameter) {
          return;
        }
        nextDrafts[item.id] = {
          targetValue: nextDrafts[item.id]?.targetValue ?? parameter.recommendedValue,
          reason: nextDrafts[item.id]?.reason || `参考 Agent 巡检建议（${item.driftLabel}）`
        };
      });
      return nextDrafts;
    });
    setFocusedId(insightIds[0]);
    setSelectedId(insightIds[0]);
    setSheetOpen(true);
    setInsightCollapsed(true);
  };

  return (
    <WorkbenchLayout
      title="项目参数用户工作台"
      header={
        <nav className="breadcrumb" aria-label="面包屑">
          <span>参数管理</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>项目参数工作台</strong>
        </nav>
      }
      actions={
        <>
          <button className="button subtle" type="button" onClick={() => exportProjectParametersAsExcel(parameters, activeProject.code)}>
            导出 Excel
          </button>
          <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-submissions")}>
            历史提交
          </button>
          <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-comparison")}>
            跨项目对比
          </button>
          <button className="button primary" type="button" onClick={handleAiAuditClick}>
            <Sparkles size={16} />
            AI 巡检
          </button>
        </>
      }
    >
      <div className="parameters-page-layout">
        {!insightDismissed ? (
          <ParameterInsightBar
            snapshot={insightSnapshot}
            collapsed={insightCollapsed}
            onExpand={() => setInsightCollapsed(false)}
            onViewHighRisk={viewHighRiskFromInsight}
            onAddToDraft={addInsightItemsToDraft}
            onDismiss={dismissInsightForToday}
          />
        ) : null}
        <div className="workbench-one-col parameters-workbench-main">
          <section className="workbench-main">
            <ParametersTable
              rows={parameters}
              totalRows={projectParameters.length}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onClearFilters={clearFilters}
              filters={
                <>
                  <MultiSelectDropdown
                    label="重要性"
                    value={Array.from(riskFilters)}
                    options={(["High", "Medium", "Low"] as const).map((risk) => ({
                      value: risk,
                      label: `${riskLabels[risk]} ${projectParameters.filter((p) => p.risk === risk).length}`
                    }))}
                    onChange={(next) => setRiskFilters(new Set(next as ParameterRiskFilter[]))}
                  />
                  <MultiSelectDropdown
                    label="模块"
                    value={Array.from(moduleFilters)}
                    options={moduleOptions.map((module) => ({ value: module, label: module }))}
                    onChange={(nextModules) => setModuleFilters(new Set(nextModules))}
                  />
                </>
              }
              selectedIds={selectedIds}
              onSelectedIdsChange={handleSelectedIdsChange}
              focusedId={focusedId}
              onFocusRow={handleFocusRow}
              modifiedIds={modifiedIds}
              onEditRow={handleEditRow}
              stashedIds={stashedIds}
            />
            <div className="parameters-bottom-actions">
              <button className="button subtle" type="button" disabled={pendingSubmissionItems.length === 0} onClick={stashRound}>
                暂存本轮{pendingSubmissionItems.length > 0 ? ` (${pendingSubmissionItems.length} 项)` : ""}
              </button>
              <button className="button primary" type="button" disabled={!allSelectedDraftsHaveTargets} onClick={openSubmitPreview}>
                {submitButtonText}
              </button>
            </div>
          </section>
        </div>
        {Object.keys(drafts).length > 0 && sheetOpen ? (
          <WorkbenchSheet
            open
            onClose={() => setSheetOpen(false)}
            title="修改草稿"
            description="勾选即加入草稿，提交前可逐项调整目标值和原因。"
            footer={
              <div className="draft-sheet-footer">
                <span>
                  提交后将进入参数管理员审阅队列 ·{" "}
                  <button className="link-button" type="button" onClick={() => onNavigate("/parameter-submissions")}>
                    查看我的提交
                  </button>
                </span>
                <div className="draft-sheet-footer-actions">
                  <button className="button subtle" type="button" onClick={stashRound}>
                    暂存本轮
                  </button>
                  <button className="button primary" type="button" disabled={!allSelectedDraftsHaveTargets} onClick={openSubmitPreview}>
                    {submitButtonText}
                  </button>
                </div>
              </div>
            }
          >
            <div className="draft-sheet-stack">
              <div className="round-draft-panel" aria-label="本轮提交草稿">
                <div>
                  <strong>本轮提交 {selectedIds.size} 项</strong>
                  <span>可先收集多个参数，再统一提交审阅。</span>
                </div>
                <button className="link-button" type="button" onClick={clearAllDrafts}>
                  全部清空
                </button>
              </div>
              <div className="draft-card-list">
                {pendingSubmissionItems.map((item) => {
                  const isFocusedCard = focusedId === item.parameterId;
                  const targetInputId = `target-value-${item.parameterId}`;
                  const reasonInputId = `reason-${item.parameterId}`;
                  const warning = getRangeWarning(item.parameter, item.targetValue);

                  return (
                    <article className="draft-card" key={item.parameterId}>
                      <div className="draft-card-head">
                        <div>
                          <strong>{item.parameter.name}</strong>
                          <small>{item.parameter.module} · {riskLabels[item.parameter.risk]}</small>
                        </div>
                        <RiskBadge risk={item.parameter.risk} />
                      </div>
                      <div className="draft-diff">
                        <span>{item.parameter.currentValue}{item.parameter.unit}</span>
                        <ArrowRight size={15} aria-hidden="true" />
                        <strong>{item.targetValue}{item.parameter.unit}</strong>
                      </div>
                      <p className="draft-drift-note">
                        Agent 建议调整到推荐值，当前偏差 {item.parameter.currentValue} → {item.parameter.recommendedValue}{item.parameter.unit}
                      </p>
                      <label className="field-label" htmlFor={targetInputId}>
                        {isFocusedCard ? "目标值" : `目标值 ${item.parameter.name}`}
                      </label>
                      <input
                        id={targetInputId}
                        aria-label={isFocusedCard ? "目标值" : `目标值 ${item.parameter.name}`}
                        value={item.targetValue}
                        onChange={(event) => {
                          updateDraft(item.parameter, { targetValue: event.target.value });
                        }}
                      />
                      {warning ? <p className="field-warning">{warning}</p> : null}
                      <label className="field-label" htmlFor={reasonInputId}>
                        {isFocusedCard ? "修改原因" : `修改原因 ${item.parameter.name}`}
                      </label>
                      <textarea
                        id={reasonInputId}
                        aria-label={isFocusedCard ? "修改原因" : `修改原因 ${item.parameter.name}`}
                        value={item.reason}
                        onChange={(event) => {
                          updateDraft(item.parameter, { reason: event.target.value });
                        }}
                        placeholder={`说明为什么要把 ${item.parameter.name} 改为 ${item.targetValue}`}
                        rows={3}
                      />
                      <button className="button subtle" type="button" onClick={() => removeDraftItem(item.parameterId)}>
                        移除本项
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          </WorkbenchSheet>
        ) : null}
      </div>
      {confirmOpen && previewItems.length > 0 ? (
        <ParameterSubmissionDialog
          items={previewItems}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submitRound}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function ParameterSubmissionDialog({
  items,
  onCancel,
  onConfirm
}: {
  items: Array<ParameterDraftItem & { parameter: ParameterRecord }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submission-preview-title">
      <div className="submission-dialog">
        <div className="submission-dialog-head">
          <div>
            <span className="eyebrow">参数提交预览</span>
            <h2 id="submission-preview-title">提交本轮参数</h2>
            <p>本轮提交包含 {items.length} 个参数修改，确认后会按一轮提交进入历史记录，并拆分为管理员审阅队列中的参数项。</p>
          </div>
          <Badge tone="secondary">Diff 预览</Badge>
        </div>
        <div className="submission-diff-list">
          {items.map((item) => (
            <article className="submission-diff-card" key={item.parameterId}>
              <div>
                <strong>{item.parameter.name}</strong>
                <small>{item.parameter.module} · {riskLabels[item.parameter.risk]}</small>
              </div>
              <div className="diff-values">
                <span className="diff-before">{item.parameter.currentValue}{item.parameter.unit}</span>
                <span>→</span>
                <span className="diff-after">{item.targetValue}{item.parameter.unit}</span>
              </div>
              {item.parameter.configFormat ? (
                <div className="submission-config-format">
                  <code className="config-before">{item.parameter.configFormat}</code>
                  <code className="config-after">{item.parameter.configFormat.replace(/=.*$/, `=${item.targetValue}`)}</code>
                </div>
              ) : null}
              {item.reason ? <p>{item.reason}</p> : null}
            </article>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            返回修改
          </button>
          <button className="button primary" type="button" onClick={onConfirm}>
            确认提交本轮
          </button>
        </div>
      </div>
    </div>
  );
}
