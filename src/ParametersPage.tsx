import {
  ArrowRight,
  Download,
  FileText,
  Filter,
  History,
  Info,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import {
  Badge,
  DataTable,
  EmptyState,
  escapeExcelCell,
  getContextQuery,
  riskLabels,
  RiskBadge,
  SectionLabel,
  Timeline,
  WorkbenchLayout
} from "./workbenchUi";
import { projects } from "./mockData";
import type { ParameterRecord, PrototypeState } from "./mockData";

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

type ParametersPageAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "ADD_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[]; reason: string };

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
  const [targetValue, setTargetValue] = useState("80");
  const [reason, setReason] = useState("参考 Agent 巡检建议，将高风险参数回落到安全阈值内。");
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const parameters = projectParameters.filter(
    (parameter) =>
      (riskFilter === "All" || parameter.risk === riskFilter) && (moduleFilter === "All" || parameter.module === moduleFilter)
  );
  const selected = parameters.find((parameter) => parameter.id === focusedId) ?? parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];
  const activeProject = projects.find((project) => project.id === state.activeProjectId) ?? projects[0];
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const pendingSubmissionItems = useMemo(
    () =>
      Array.from(selectedIds)
        .map((parameterId) => {
          const parameter = state.parameters.find((candidate) => candidate.id === parameterId);
          if (!parameter) {
            return null;
          }
          const draft = drafts[parameterId];
          return {
            parameterId,
            targetValue: draft?.targetValue ?? parameter.recommendedValue,
            reason: draft?.reason ?? reason,
            parameter
          };
        })
        .filter((item): item is ParameterDraftItem & { parameter: ParameterRecord } => Boolean(item)),
    [drafts, reason, selectedIds, state.parameters]
  );

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
      setTargetValue(requestedParameter.recommendedValue);
    }
  }, [contextQuery.parameterId, projectParameters]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setFocusedId(selected.id);
    setTargetValue(drafts[selected.id]?.targetValue ?? selected.recommendedValue);
    if (drafts[selected.id]) {
      setReason(drafts[selected.id].reason);
    }
  }, [drafts, selected?.id, selected?.recommendedValue]);

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

  const focusParameter = (parameter: ParameterRecord) => {
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setTargetValue(drafts[parameter.id]?.targetValue ?? parameter.recommendedValue);
    if (drafts[parameter.id]) {
      setReason(drafts[parameter.id].reason);
    }
  };

  const toggleParameterSelection = (parameter: ParameterRecord, checked: boolean) => {
    const nextDraft = {
      targetValue: focusedId === parameter.id ? targetValue : parameter.recommendedValue,
      reason: focusedId === parameter.id ? reason : ""
    };
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setTargetValue(nextDraft.targetValue);
    setReason(nextDraft.reason);
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (checked) {
        next.add(parameter.id);
      } else {
        next.delete(parameter.id);
      }
      return next;
    });
    setDrafts((items) => {
      if (checked) {
        return items[parameter.id] ? items : { ...items, [parameter.id]: nextDraft };
      }
      const { [parameter.id]: _removed, ...remainingItems } = items;
      return remainingItems;
    });
  };

  const updateFocusedDraft = (patch: Partial<{ targetValue: string; reason: string }>) => {
    if (!selected || !selectedIds.has(selected.id)) {
      return;
    }
    setDrafts((items) => ({
      ...items,
      [selected.id]: {
        targetValue: items[selected.id]?.targetValue ?? selected.recommendedValue,
        reason: items[selected.id]?.reason ?? reason,
        ...patch
      }
    }));
  };

  const openSubmitPreview = () => {
    if (selectedIds.size === 0) {
      return;
    }
    setConfirmOpen(true);
  };

  const submitRound = () => {
    const itemsToSubmit = Array.from(selectedIds)
      .map((parameterId) => {
        const parameter = state.parameters.find((candidate) => candidate.id === parameterId);
        if (!parameter) {
          return null;
        }
        return {
          parameterId,
          targetValue: drafts[parameterId]?.targetValue ?? parameter.recommendedValue,
          reason: drafts[parameterId]?.reason ?? reason
        };
      })
      .filter((item): item is ParameterDraftItem => Boolean(item));
    if (itemsToSubmit.length === 0) {
      return;
    }
    dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: itemsToSubmit, reason });
    setSelectedIds(new Set());
    setDrafts({});
    setConfirmOpen(false);
  };
  const previewItems = pendingSubmissionItems;

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
        <DataTable
          headers={["选择", "参数名称", "模块", "当前值", "示例", "范围 / 单位", "重要性", "更新时间"]}
          rows={parameters}
          renderRow={(parameter) => (
            <tr
              className={selected?.id === parameter.id ? "selected-row" : ""}
              key={parameter.id}
              onClick={() => focusParameter(parameter)}
            >
              <td>
                <input
                  aria-label={`勾选 ${parameter.name}`}
                  checked={selectedIds.has(parameter.id)}
                  type="checkbox"
                  onChange={(event) => toggleParameterSelection(parameter, event.target.checked)}
                  onClick={(event) => event.stopPropagation()}
                />
              </td>
              <td>
                <strong>{parameter.name}</strong>
                <small>{parameter.description}</small>
              </td>
              <td>
                <Badge tone="tertiary">{parameter.module}</Badge>
              </td>
              <td className="mono">{parameter.currentValue}</td>
              <td className="mono recommended">
                <span className="value-change">
                  <ArrowRight size={14} />
                  <span>{parameter.recommendedValue}</span>
                </span>
              </td>
              <td>
                <span>{parameter.range}</span>
                <small>{parameter.unit}</small>
              </td>
              <td>
                <RiskBadge risk={parameter.risk} />
              </td>
              <td>{parameter.updatedAt}</td>
            </tr>
          )}
        />
      </section>
      <aside className="detail-panel">
        <SectionLabel icon={<Sparkles size={16} />} label="修改草稿" />
        {selected ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              openSubmitPreview();
            }}
          >
            <div className="detail-heading">
              <strong>{selected.name}</strong>
              <RiskBadge risk={selected.risk} />
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<Info size={15} />} label="参数说明" />
              <p>{selected.explanation}</p>
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<FileText size={15} />} label="参数配置格式" />
              <code>{selected.configFormat}</code>
            </div>
            <label className="field-label" htmlFor="target-value">
              目标值
            </label>
            <input
              id="target-value"
              value={targetValue}
              onChange={(event) => {
                setTargetValue(event.target.value);
                updateFocusedDraft({ targetValue: event.target.value });
              }}
            />
            <label className="field-label" htmlFor="reason">
              修改原因
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                updateFocusedDraft({ reason: event.target.value });
              }}
              rows={5}
            />
            <div className="round-draft-panel" aria-label="本轮提交草稿">
              <div>
                <strong>本轮提交 {selectedIds.size} 项</strong>
                <span>可先收集多个参数，再统一提交审阅。</span>
              </div>
              {pendingSubmissionItems.length > 0 ? (
                <ul>
                  {pendingSubmissionItems.map((item) => (
                    <li key={item.parameterId}>
                      <span>{item.parameter.name}</span>
                      <strong>{item.parameter.currentValue} → {item.targetValue}</strong>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => {
                          setSelectedIds((ids) => {
                            const next = new Set(ids);
                            next.delete(item.parameterId);
                            return next;
                          });
                          setDrafts((items) => {
                            const { [item.parameterId]: _removed, ...remainingItems } = items;
                            return remainingItems;
                          });
                        }}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Timeline steps={["选择参数", "填写目标值", "提交审阅", "管理员合入"]} activeIndex={1} />
            <button className="button primary full" type="submit" disabled={selectedIds.size === 0}>
              {selectedIds.size > 0 ? `提交本轮 (${selectedIds.size} 项)` : "提交本轮"}
            </button>
          </form>
        ) : (
          <EmptyState text="请选择一条参数后提交修改。" />
        )}
      </aside>
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
