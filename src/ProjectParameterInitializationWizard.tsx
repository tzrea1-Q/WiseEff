import { Eye, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { AppAction } from "./App";
import { ColumnFilter } from "./components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./components/tableFilterUtils";
import { getInitializationCandidateParameters } from "./domain/parameters/initialization";
import type { ProjectParameterInitializationSnapshotItem, RiskLevel } from "./domain/parameters/types";
import type { PrototypeState } from "./mockData";

type Props = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
};

const riskLevels: RiskLevel[] = ["Medium", "High", "Low"];
const riskLevelLabels: Record<RiskLevel, string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};
const sourceRoleLabels = {
  primary: "主来源",
  supplement: "补充来源"
};

type CandidateColumnFilterKey = "parameter" | "module" | "risk" | "recommendedValue" | "source";

const wizardSteps = [
  {
    label: "项目信息",
    title: "先定义新项目",
    description: "填写新项目的名称、代号和负责人，后续步骤会沿用这些信息。"
  },
  {
    label: "来源项目",
    title: "选择要继承的项目",
    description: "选择一个或多个已有项目。多来源时需要指定主来源，冲突参数以主来源为准。"
  },
  {
    label: "参数范围",
    title: "筛选并确认参数",
    description: "用模块和风险缩小范围，再选择本次初始化要复制的参数。"
  },
  {
    label: "提交审阅",
    title: "预览初始化快照",
    description: "检查快照摘要，补充说明后提交审阅。"
  }
] as const;

export function ProjectParameterInitializationWizard({ state, dispatch, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(state.currentUserId);
  const [sourceProjectIds, setSourceProjectIds] = useState<string[]>([]);
  const [primarySourceProjectId, setPrimarySourceProjectId] = useState("");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [selectedRisks, setSelectedRisks] = useState<RiskLevel[]>([]);
  const [selectedParameterIds, setSelectedParameterIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<HeaderFilterState>({});
  const [detailParameterId, setDetailParameterId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const activeStep = wizardSteps[currentStepIndex];
  const isReviewStep = currentStepIndex === wizardSteps.length - 1;
  const ownerName = state.users.find((user) => user.id === ownerUserId)?.name ?? ownerUserId;
  const modules = useMemo(
    () => Array.from(new Set(state.configDraft.parameterLibrary.map((parameter) => parameter.module))).sort(),
    [state.configDraft.parameterLibrary]
  );
  const projectNameById = useMemo(
    () => new Map(state.configDraft.projects.map((project) => [project.id, project.name])),
    [state.configDraft.projects]
  );
  const parameterNameById = useMemo(
    () => new Map(state.configDraft.parameterLibrary.map((parameter) => [parameter.id, parameter.name])),
    [state.configDraft.parameterLibrary]
  );
  const parameterById = useMemo(
    () => new Map(state.configDraft.parameterLibrary.map((parameter) => [parameter.id, parameter])),
    [state.configDraft.parameterLibrary]
  );
  const supplementSourceProjectIds = sourceProjectIds.filter((projectId) => projectId !== primarySourceProjectId);
  const candidatePool = useMemo(() => {
    if (!primarySourceProjectId) {
      return [];
    }

    return getInitializationCandidateParameters(state.configDraft, {
      primarySourceProjectId,
      supplementSourceProjectIds,
      selectedModules: [],
      selectedRisks: []
    });
  }, [primarySourceProjectId, state.configDraft, supplementSourceProjectIds]);
  const candidates = useMemo(() => {
    const selectedModuleSet = new Set(selectedModules);
    const selectedRiskSet = new Set<RiskLevel>(selectedRisks);

    return candidatePool.filter((candidate) => {
      const matchesModule = selectedModuleSet.size === 0 || selectedModuleSet.has(candidate.module);
      const matchesRisk = selectedRiskSet.size === 0 || selectedRiskSet.has(candidate.risk);
      const matchesColumnFilters = (["parameter", "recommendedValue", "source"] as CandidateColumnFilterKey[]).every((key) => {
        const selectedValues = columnFilters[key] ?? [];
        return selectedValues.length === 0 || selectedValues.includes(getCandidateFilterValue(candidate, key));
      });

      return matchesModule && matchesRisk && matchesColumnFilters;
    });
  }, [candidatePool, columnFilters, parameterNameById, projectNameById, selectedModules, selectedRisks]);
  const availableCandidateIds = useMemo(() => {
    if (!primarySourceProjectId) {
      return new Set<string>();
    }

    return new Set(
      getInitializationCandidateParameters(state.configDraft, {
        primarySourceProjectId,
        supplementSourceProjectIds,
        selectedModules: [],
        selectedRisks: []
      }).map((candidate) => candidate.parameterId)
    );
  }, [primarySourceProjectId, state.configDraft, supplementSourceProjectIds]);
  const visibleSelectedParameterIds = selectedParameterIds.filter((parameterId) =>
    candidates.some((candidate) => candidate.parameterId === parameterId)
  );
  const selectedAvailableParameterIds = selectedParameterIds.filter((parameterId) => availableCandidateIds.has(parameterId));
  const allCandidatesSelected = candidates.length > 0 && visibleSelectedParameterIds.length === candidates.length;
  const detailCandidate = candidates.find((candidate) => candidate.parameterId === detailParameterId) ?? null;
  const detailParameter = detailCandidate ? parameterById.get(detailCandidate.parameterId) : undefined;
  const detailSourceValue = detailCandidate && detailParameter
    ? detailParameter.values[detailCandidate.sourceProjectId]
    : undefined;

  useEffect(() => {
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  function getFocusableElements() {
    return Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function toggleSource(projectId: string) {
    setError("");
    setSourceProjectIds((current) => {
      if (current.includes(projectId)) {
        const next = current.filter((id) => id !== projectId);
        setPrimarySourceProjectId((primary) => {
          if (primary !== projectId) {
            return primary;
          }
          return next.length === 1 ? next[0] : "";
        });
        return next;
      }

      const next = [...current, projectId];
      setPrimarySourceProjectId(next.length === 1 ? projectId : "");
      return next;
    });
  }

  function toggleValue<T extends string>(value: T, values: T[], update: (next: T[]) => void) {
    setError("");
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function toggleParameter(parameterId: string) {
    toggleValue(parameterId, selectedParameterIds, setSelectedParameterIds);
  }

  function toggleAllCandidates() {
    setError("");
    setSelectedParameterIds((current) => {
      const candidateIds = candidates.map((candidate) => candidate.parameterId);
      if (allCandidatesSelected) {
        return current.filter((parameterId) => !candidateIds.includes(parameterId));
      }

      return Array.from(new Set([...current, ...candidateIds]));
    });
  }

  function validateProjectStep() {
    if (!projectName.trim() || !projectCode.trim()) {
      setError("请先填写项目名称和项目代号。");
      return false;
    }

    return true;
  }

  function validateSourceStep() {
    if (sourceProjectIds.length === 0) {
      setError("请选择至少一个来源项目。");
      return false;
    }
    if (!primarySourceProjectId) {
      setError("请先选择主来源项目。");
      return false;
    }

    return true;
  }

  function validateParameterStep() {
    if (selectedAvailableParameterIds.length === 0) {
      setError("请至少选择一个参数。");
      return false;
    }

    return true;
  }

  function validateStep(stepIndex: number) {
    if (stepIndex === 0) {
      return validateProjectStep();
    }
    if (stepIndex === 1) {
      return validateSourceStep();
    }
    if (stepIndex === 2) {
      return validateParameterStep();
    }

    return true;
  }

  function goToNextStep() {
    if (!validateStep(currentStepIndex)) {
      return;
    }

    setError("");
    setCurrentStepIndex((stepIndex) => Math.min(stepIndex + 1, wizardSteps.length - 1));
  }

  function goToPreviousStep() {
    if (currentStepIndex === 0) {
      onClose();
      return;
    }

    setError("");
    setCurrentStepIndex((stepIndex) => Math.max(stepIndex - 1, 0));
  }

  function submitReview() {
    if (!validateProjectStep()) {
      setCurrentStepIndex(0);
      return;
    }
    if (!validateSourceStep()) {
      setCurrentStepIndex(1);
      return;
    }
    if (!validateParameterStep()) {
      setCurrentStepIndex(2);
      return;
    }

    dispatch({
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName,
        projectCode,
        ownerUserId,
        sourceProjectIds,
        primarySourceProjectId,
        supplementSourceProjectIds,
        selectedModules: [],
        selectedRisks: [],
        selectedParameterIds: selectedAvailableParameterIds,
        notes
      }
    });
    onClose();
  }

  function renderProjectStep() {
    return (
      <section className="project-init-form-card" aria-label="项目信息">
        <div className="project-init-form-card__header">
          <span className="eyebrow">基本资料</span>
          <strong>新项目档案</strong>
        </div>
        <div className="project-init-form-card__fields">
          <label>
            <span>项目名称</span>
            <input
              value={projectName}
              onChange={(event) => {
                setError("");
                setProjectName(event.target.value);
              }}
            />
          </label>
          <label>
            <span>项目代号</span>
            <input
              value={projectCode}
              onChange={(event) => {
                setError("");
                setProjectCode(event.target.value);
              }}
            />
          </label>
          <label>
            <span>负责人</span>
            <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
              {state.users
                .filter((user) => user.isActive)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </section>
    );
  }

  function renderSourceStep() {
    return (
      <section aria-label="来源项目">
        <div className="project-init-source-grid">
          {state.configDraft.projects.map((project) => {
            const checked = sourceProjectIds.includes(project.id);
            return (
              <div className="project-init-source" key={project.id}>
                <label>
                  <input type="checkbox" checked={checked} onChange={() => toggleSource(project.id)} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.code}</small>
                  </span>
                </label>
                <label className="project-init-primary">
                  <input
                    type="radio"
                    name="primary-source-project"
                    aria-label={`设 ${project.name} 为主来源`}
                    checked={primarySourceProjectId === project.id}
                    disabled={!checked}
                    onChange={() => {
                      setError("");
                      setPrimarySourceProjectId(project.id);
                    }}
                  />
                  <span>设为主来源</span>
                </label>
              </div>
            );
          })}
        </div>
        <div className="project-init-step-summary">
          已选择 {sourceProjectIds.length} 个来源项目
          {primarySourceProjectId ? `，主来源为 ${projectNameById.get(primarySourceProjectId) ?? primarySourceProjectId}` : ""}
        </div>
      </section>
    );
  }

  function getCandidateFilterValue(candidate: ProjectParameterInitializationSnapshotItem, key: CandidateColumnFilterKey) {
    if (key === "parameter") {
      return parameterNameById.get(candidate.parameterId) ?? candidate.parameterId;
    }
    if (key === "module") {
      return candidate.module;
    }
    if (key === "risk") {
      return candidate.risk;
    }
    if (key === "recommendedValue") {
      return candidate.needsRecommendedValueConfirmation ? "需确认" : candidate.recommendedValue;
    }
    return `${projectNameById.get(candidate.sourceProjectId) ?? candidate.sourceProjectId} (${sourceRoleLabels[candidate.sourceRole]})`;
  }

  function toggleColumnFilter(key: CandidateColumnFilterKey, value: string) {
    setColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  }

  function clearColumnFilter(key: CandidateColumnFilterKey) {
    setColumnFilters((current) => ({ ...current, [key]: [] }));
  }

  function renderColumnFilter(key: CandidateColumnFilterKey, label: string) {
    const selectedValues = key === "module"
      ? selectedModules
      : key === "risk"
        ? selectedRisks
        : columnFilters[key] ?? [];
    const onToggle = key === "module"
      ? (value: string) => toggleValue(value, selectedModules, setSelectedModules)
      : key === "risk"
        ? (value: string) => toggleValue(value as RiskLevel, selectedRisks, setSelectedRisks)
        : (value: string) => toggleColumnFilter(key, value);
    const onClear = key === "module"
      ? () => {
          setError("");
          setSelectedModules([]);
        }
      : key === "risk"
        ? () => {
            setError("");
            setSelectedRisks([]);
          }
        : () => clearColumnFilter(key);

    return (
      <ColumnFilter
        label={label}
        groupLabel={`${label}筛选`}
        values={key === "module" ? modules : key === "risk" ? riskLevels : uniqueFilterValues(candidatePool, (candidate) => getCandidateFilterValue(candidate, key))}
        selectedValues={selectedValues}
        renderLabel={key === "risk" ? (risk) => riskLevelLabels[risk as RiskLevel] : undefined}
        onToggle={onToggle}
        onClear={onClear}
      />
    );
  }

  function renderHeader(key: CandidateColumnFilterKey, label: string) {
    return (
      <div className="project-init-table-head">
        <span>{label}</span>
        {renderColumnFilter(key, label)}
      </div>
    );
  }

  function renderParameterStep() {
    return (
      <section className="project-init-parameter-step" aria-label="参数范围">
        <section>
          <div className="project-init-section-head">
            <span className="eyebrow">候选参数</span>
            <p>{candidates.length} 个参数可生成初始化快照，已选 {selectedAvailableParameterIds.length} 个。</p>
          </div>
          <div className="project-init-table">
            <table aria-label="初始化候选参数">
              <colgroup>
                <col className="project-init-col-select" />
                <col className="project-init-col-parameter" />
                <col className="project-init-col-module" />
                <col className="project-init-col-risk" />
                <col className="project-init-col-value" />
                <col className="project-init-col-source" />
                <col className="project-init-col-detail" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="选择">
                    <input
                      type="checkbox"
                      aria-label="全选初始化候选参数"
                      checked={allCandidatesSelected}
                      disabled={candidates.length === 0}
                      onChange={toggleAllCandidates}
                    />
                  </th>
                  <th>{renderHeader("parameter", "参数")}</th>
                  <th>{renderHeader("module", "模块")}</th>
                  <th>{renderHeader("risk", "风险")}</th>
                  <th>{renderHeader("recommendedValue", "推荐值")}</th>
                  <th>{renderHeader("source", "来源")}</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length > 0 ? (
                  candidates.map((candidate) => (
                    <tr key={candidate.parameterId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${parameterNameById.get(candidate.parameterId) ?? candidate.parameterId}`}
                          checked={visibleSelectedParameterIds.includes(candidate.parameterId)}
                          onChange={() => toggleParameter(candidate.parameterId)}
                        />
                      </td>
                      <td
                        className="project-init-table__parameter"
                        title={parameterNameById.get(candidate.parameterId) ?? candidate.parameterId}
                      >
                        {parameterNameById.get(candidate.parameterId) ?? candidate.parameterId}
                      </td>
                      <td className="project-init-table__module" title={candidate.module}>
                        {candidate.module}
                      </td>
                      <td>
                        <span className={`risk-badge ${candidate.risk.toLowerCase()}`}>{riskLevelLabels[candidate.risk]}</span>
                      </td>
                      <td className="project-init-table__value" title={candidate.needsRecommendedValueConfirmation ? "需确认" : candidate.recommendedValue}>
                        {candidate.needsRecommendedValueConfirmation ? "需确认" : candidate.recommendedValue}
                      </td>
                      <td className="project-init-table__source">
                        {projectNameById.get(candidate.sourceProjectId) ?? candidate.sourceProjectId} ({sourceRoleLabels[candidate.sourceRole]})
                      </td>
                      <td className="project-init-table__detail">
                        <button
                          className="project-init-detail-button"
                          type="button"
                          aria-label={`查看 ${parameterNameById.get(candidate.parameterId) ?? candidate.parameterId} 详情`}
                          onClick={() => {
                            setDetailParameterId(candidate.parameterId);
                          }}
                        >
                          <Eye size={13} />
                          详情
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>暂无可预览的候选参数。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {detailCandidate && detailParameter ? (
          <aside className="project-init-parameter-detail" role="complementary" aria-label="参数详情">
            <div className="project-init-parameter-detail__head">
              <div>
                <span className="eyebrow">参数详情</span>
                <strong>{detailParameter.name}</strong>
              </div>
              <button className="button subtle" type="button" aria-label="关闭参数详情" onClick={() => setDetailParameterId("")}>
                <X size={14} />
              </button>
            </div>
            <p>{detailParameter.description}</p>
            <dl>
              <div>
                <dt>模块</dt>
                <dd>{detailCandidate.module}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>{riskLevelLabels[detailCandidate.risk]}</dd>
              </div>
              <div>
                <dt>推荐值</dt>
                <dd>{detailCandidate.needsRecommendedValueConfirmation ? "需确认" : `${detailCandidate.recommendedValue} ${detailParameter.unit}`.trim()}</dd>
              </div>
              <div>
                <dt>当前值</dt>
                <dd>{detailSourceValue ? `${detailSourceValue.currentValue} ${detailParameter.unit}`.trim() : "-"}</dd>
              </div>
              <div>
                <dt>范围</dt>
                <dd>{`${detailParameter.range} ${detailParameter.unit}`.trim()}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>
                  {projectNameById.get(detailCandidate.sourceProjectId) ?? detailCandidate.sourceProjectId} ({sourceRoleLabels[detailCandidate.sourceRole]})
                </dd>
              </div>
            </dl>
            <div className="project-init-parameter-detail__note">
              <span>配置格式</span>
              <code>{detailParameter.configFormat || "-"}</code>
            </div>
            {detailParameter.explanation ? (
              <div className="project-init-parameter-detail__note">
                <span>说明</span>
                <p>{detailParameter.explanation}</p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>
    );
  }

  function renderReviewStep() {
    return (
      <section className="project-init-review" aria-label="初始化快照预览">
        <div className="project-init-review-card">
          <div>
            <span className="eyebrow">快照摘要</span>
            <strong>{projectName || "未命名项目"}</strong>
            <p>将以一次性快照复制方式提交初始化审阅。</p>
          </div>
          <dl>
            <div>
              <dt>项目代号</dt>
              <dd>{projectCode || "-"}</dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd>{ownerName}</dd>
            </div>
            <div>
              <dt>主来源</dt>
              <dd>{projectNameById.get(primarySourceProjectId) ?? "-"}</dd>
            </div>
            <div>
              <dt>补充来源</dt>
              <dd>{supplementSourceProjectIds.length > 0 ? supplementSourceProjectIds.length : "无"}</dd>
            </div>
            <div>
              <dt>参数数量</dt>
              <dd>{selectedAvailableParameterIds.length}</dd>
            </div>
          </dl>
        </div>
        <label className="project-init-notes">
          <span>备注</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </section>
    );
  }

  function renderCurrentStep() {
    if (currentStepIndex === 0) {
      return renderProjectStep();
    }
    if (currentStepIndex === 1) {
      return renderSourceStep();
    }
    if (currentStepIndex === 2) {
      return renderParameterStep();
    }

    return renderReviewStep();
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-init-title"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="project-init-wizard">
        <header className="project-init-header">
          <div>
            <span className="eyebrow">项目初始化</span>
            <h2 id="project-init-title">新项目参数初始化</h2>
            <p>从已有项目一次性复制推荐值，生成初始化快照并提交审阅。</p>
          </div>
          <button
            className="button subtle"
            type="button"
            aria-label="关闭项目初始化向导"
            onClick={onClose}
            ref={closeButtonRef}
          >
            <X size={16} />
          </button>
        </header>

        <div className="project-init-steps" aria-label="初始化步骤">
          {wizardSteps.map((step, index) => (
            <span
              aria-current={index === currentStepIndex ? "step" : undefined}
              className={index === currentStepIndex ? "active" : index < currentStepIndex ? "complete" : undefined}
              key={step.label}
            >
              <small>{index + 1}</small>
              {step.label}
            </span>
          ))}
        </div>

        <div className="project-init-main">
          <section
            className={`project-init-step-panel${currentStepIndex === 0 ? " project-init-step-panel--project" : ""}`}
            aria-labelledby="project-init-step-title"
          >
            <div className="project-init-step-copy">
              <span className="eyebrow">第 {currentStepIndex + 1} 步</span>
              <h3 id="project-init-step-title">{activeStep.title}</h3>
              <p>{activeStep.description}</p>
            </div>
            {renderCurrentStep()}
          </section>
        </div>

        {error ? <div className="field-warning">{error}</div> : null}

        <footer className="project-init-footer">
          <span className="project-init-footer-progress">
            第 {currentStepIndex + 1} 步 / 共 {wizardSteps.length} 步
          </span>
          <div className="project-init-footer-actions">
            <button className="button subtle" type="button" onClick={goToPreviousStep}>
              {currentStepIndex === 0 ? "取消" : "上一步"}
            </button>
            <button className="button primary" type="button" onClick={isReviewStep ? submitReview : goToNextStep}>
              {isReviewStep ? "提交初始化审阅" : "下一步"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
