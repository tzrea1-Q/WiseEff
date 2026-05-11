import {
  ArrowRight,
  Download,
  Filter,
  History
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import {
  Badge,
  escapeExcelCell,
  getContextQuery,
  riskLabels,
  RiskBadge,
  SectionLabel,
  WorkbenchLayout
} from "./workbenchUi";
import { projects } from "./mockData";
import type { ParameterRecord, PrototypeState } from "./mockData";
import { ParametersTable } from "./components/ParametersTable";
import { WorkbenchSheet } from "./components/WorkbenchSheet";

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

type ParametersPageAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "ADD_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] };

type ParametersPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<ParametersPageAction>;
  onNavigate: (path: string) => void;
  search: string;
};

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
  const [riskFilter, setRiskFilter] = useState<ParameterRiskFilter>("All");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(state.parameters[0]?.id ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, { targetValue: string; reason: string }>>({});
  const [focusedId, setFocusedId] = useState<string | null>(state.parameters[0]?.id ?? null);
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
  const parameters = useMemo(
    () =>
      projectParameters.filter(
        (parameter) =>
          (riskFilter === "All" || parameter.risk === riskFilter) && (moduleFilter === "All" || parameter.module === moduleFilter)
      ),
    [moduleFilter, projectParameters, riskFilter]
  );
  const selected = parameters.find((parameter) => parameter.id === focusedId) ?? parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];
  const activeProject = projects.find((project) => project.id === state.activeProjectId) ?? projects[0];
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
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
  const validPendingSubmissionItems = useMemo(
    () => pendingSubmissionItems.filter((item) => item.targetValue.trim()),
    [pendingSubmissionItems]
  );
  const allSelectedDraftsHaveTargets =
    selectedIds.size > 0 &&
    pendingSubmissionItems.length === selectedIds.size &&
    validPendingSubmissionItems.length === pendingSubmissionItems.length;

  useEffect(() => {
    if (contextQuery.projectId) {
      return;
    }
    setModuleFilter("All");
  }, [contextQuery.projectId, state.activeProjectId]);

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
      setModuleFilter(contextQuery.module);
    }
  }, [contextQuery.module, moduleOptions]);

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
    if (selectedIds.size === 0) {
      setSheetOpen(false);
    }
  }, [selectedIds.size]);

  const handleFocusRow = (id: string) => {
    const parameter = parameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
  };

  const handleSelectedIdsChange = (next: Set<string>) => {
    const addedIds = Array.from(next).filter((id) => !selectedIds.has(id));
    const removedIds = Array.from(selectedIds).filter((id) => !next.has(id));
    const firstAddedParameter = addedIds.map((id) => parameterById.get(id)).find((parameter): parameter is ParameterRecord => Boolean(parameter));

    if (firstAddedParameter) {
      setSelectedId(firstAddedParameter.id);
      setFocusedId(firstAddedParameter.id);
    }

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

    if (next.size > 0) {
      setSheetOpen(true);
    } else {
      setSheetOpen(false);
    }
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
  const previewItems = pendingSubmissionItems;
  const submitButtonText = selectedIds.size > 0 ? `提交本轮 (${selectedIds.size} 项)` : "提交本轮";

  return (
    <WorkbenchLayout
      title="项目参数用户工作台"
      actions={
        <>
          <button className="button subtle" type="button" onClick={() => exportProjectParametersAsExcel(parameters, activeProject.code)}>
            <Download size={16} />
            导出 Excel
          </button>
          <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-submissions")}>
            <History size={16} />
            历史提交
          </button>
          <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-comparison")}>
            <ArrowRight size={16} />
            跨项目对比
          </button>
        </>
      }
    >
      <div className="parameters-page-layout">
        <div className="workbench-two-col">
          <aside className="filter-panel" aria-label="参数筛选">
            <SectionLabel icon={<Filter size={16} />} label="筛选条件" />
            <label className="field-label" htmlFor="parameter-project-filter">
              项目
            </label>
            <select
              id="parameter-project-filter"
              className="filter-select"
              value={state.activeProjectId}
              onChange={(event) => dispatch({ type: "SET_PROJECT", projectId: event.target.value })}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="parameter-risk-filter">
              重要性
            </label>
            <select
              id="parameter-risk-filter"
              className="filter-select"
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value as ParameterRiskFilter)}
            >
              {([
                ["All", "全部"],
                ["High", "高"],
                ["Medium", "中"],
                ["Low", "低"]
              ] as const).map(([risk, label]) => (
                <option key={risk} value={risk}>
                  {label}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="parameter-module-filter">
              模块
            </label>
            <select
              id="parameter-module-filter"
              className="filter-select"
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
            >
              {["All", ...moduleOptions].map((module) => (
                <option key={module} value={module}>
                  {module === "All" ? "全部" : module}
                </option>
              ))}
            </select>
          </aside>
          <section className="workbench-main">
            {selected ? (
              <div className="detail-panel parameter-focus-summary" aria-label="当前参数">
                <div>
                  <span>当前参数</span>
                  <strong>{selected.name}</strong>
                </div>
                <RiskBadge risk={selected.risk} />
              </div>
            ) : null}
            <ParametersTable
              rows={parameters}
              selectedIds={selectedIds}
              onSelectedIdsChange={handleSelectedIdsChange}
              focusedId={focusedId}
              onFocusRow={handleFocusRow}
            />
            {selectedIds.size === 0 ? (
              <div className="parameters-empty-submit">
                <button className="button primary" type="button" disabled>
                  提交本轮
                </button>
              </div>
            ) : !sheetOpen ? (
              <div className="parameters-empty-submit">
                <button className="button primary" type="button" onClick={() => setSheetOpen(true)}>
                  重新打开草稿 ({selectedIds.size} 项)
                </button>
              </div>
            ) : null}
          </section>
        </div>
        {selectedIds.size > 0 && sheetOpen ? (
          <WorkbenchSheet
            open
            onClose={() => setSheetOpen(false)}
            title="修改草稿"
            footer={
              <div className="draft-sheet-footer">
                <span>
                  提交后将进入参数管理员审阅队列 ·{" "}
                  <button className="link-button" type="button" onClick={() => onNavigate("/parameter-submissions")}>
                    查看我的提交
                  </button>
                </span>
                <button className="button primary" type="button" disabled={!allSelectedDraftsHaveTargets} onClick={openSubmitPreview}>
                  {submitButtonText}
                </button>
              </div>
            }
          >
            <div className="draft-sheet-stack">
              <div className="round-draft-panel" aria-label="本轮提交草稿">
                <strong>本轮提交 {selectedIds.size} 项</strong>
                <span>可先收集多个参数，再统一提交审阅。</span>
              </div>
              <div className="draft-card-list">
                {pendingSubmissionItems.map((item) => {
                  const isFocusedCard = focusedId === item.parameterId;
                  const targetInputId = `target-value-${item.parameterId}`;
                  const reasonInputId = `reason-${item.parameterId}`;

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
              <p>{item.reason}</p>
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
