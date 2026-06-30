import { Eye, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { AppAction } from "./App";
import { ColumnFilter } from "./components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./components/tableFilterUtils";
import { getInitializationScopeParameters, resolveInitializationConfig } from "./domain/parameters/initialization";
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
  supplement: "补充来源",
  library: "参数库"
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
    title: "从参数库选择项目参数",
    description: "浏览全局参数库并勾选纳入本项目的参数；若已选来源项目，对应条目会标注继承来源与推荐值。"
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
  const [startFromEmpty, setStartFromEmpty] = useState(false);
  const [sourceProjectSearchQuery, setSourceProjectSearchQuery] = useState("");
  const [error, setError] = useState("");

  const activeStep = wizardSteps[currentStepIndex];
  const projects = state.configDraft.projects;
  const initializationConfig = useMemo(
    () => resolveInitializationConfig(state.configDraft, state.parameters),
    [state.configDraft, state.parameters]
  );
  const hasAvailableSourceProjects = projects.length > 0;
  const isEmptyInitialization = startFromEmpty || !hasAvailableSourceProjects;
  const isReviewStep = currentStepIndex === wizardSteps.length - 1;
  const ownerName = state.users.find((user) => user.id === ownerUserId)?.name ?? ownerUserId;
  const modules = useMemo(
    () => Array.from(new Set(initializationConfig.parameterLibrary.map((parameter) => parameter.module))).sort(),
    [initializationConfig.parameterLibrary]
  );
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const parameterNameById = useMemo(
    () => new Map(initializationConfig.parameterLibrary.map((parameter) => [parameter.id, parameter.name])),
    [initializationConfig.parameterLibrary]
  );
  const parameterById = useMemo(
    () => new Map(initializationConfig.parameterLibrary.map((parameter) => [parameter.id, parameter])),
    [initializationConfig.parameterLibrary]
  );
  const supplementSourceProjectIds = sourceProjectIds.filter((projectId) => projectId !== primarySourceProjectId);
  const filteredSourceProjects = useMemo(() => {
    const normalizedQuery = sourceProjectSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = `${project.name} ${project.code} ${project.id}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [projects, sourceProjectSearchQuery]);
  const scopePool = useMemo(
    () =>
      getInitializationScopeParameters(initializationConfig, {
        primarySourceProjectId,
        supplementSourceProjectIds
      }),
    [initializationConfig, primarySourceProjectId, supplementSourceProjectIds]
  );
  const candidates = useMemo(() => {
    const selectedModuleSet = new Set(selectedModules);
    const selectedRiskSet = new Set<RiskLevel>(selectedRisks);

    return scopePool.filter((candidate) => {
      const matchesModule = selectedModuleSet.size === 0 || selectedModuleSet.has(candidate.module);
      const matchesRisk = selectedRiskSet.size === 0 || selectedRiskSet.has(candidate.risk);
      const matchesColumnFilters = (["parameter", "recommendedValue", "source"] as CandidateColumnFilterKey[]).every((key) => {
        const selectedValues = columnFilters[key] ?? [];
        return selectedValues.length === 0 || selectedValues.includes(getCandidateFilterValue(candidate, key));
      });

      return matchesModule && matchesRisk && matchesColumnFilters;
    });
  }, [scopePool, columnFilters, parameterNameById, projectNameById, selectedModules, selectedRisks]);
  const availableScopeParameterIds = useMemo(() => new Set(scopePool.map((candidate) => candidate.parameterId)), [scopePool]);
  const visibleSelectedParameterIds = selectedParameterIds.filter((parameterId) =>
    candidates.some((candidate) => candidate.parameterId === parameterId)
  );
  const selectedAvailableParameterIds = selectedParameterIds.filter((parameterId) => availableScopeParameterIds.has(parameterId));
  const selectedFromSourceCount = selectedAvailableParameterIds.filter((parameterId) => {
    const candidate = scopePool.find((item) => item.parameterId === parameterId);
    return candidate?.sourceRole !== "library";
  }).length;
  const selectedFromLibraryCount = selectedAvailableParameterIds.length - selectedFromSourceCount;
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

  function toggleStartFromEmpty() {
    setError("");
    setStartFromEmpty((current) => {
      const next = !current;
      if (next) {
        setSourceProjectIds([]);
        setPrimarySourceProjectId("");
      }
      return next;
    });
  }

  function toggleSource(projectId: string) {
    setError("");
    setStartFromEmpty(false);
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
    if (isEmptyInitialization) {
      return true;
    }
    if (sourceProjectIds.length === 0) {
      setError("请选择至少一个来源项目，或选择从零开始。");
      return false;
    }
    if (!primarySourceProjectId) {
      setError("请先选择主来源项目。");
      return false;
    }

    return true;
  }

  function validateParameterStep() {
    if (isEmptyInitialization) {
      return true;
    }
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
      <section className="project-init-source-step" aria-label="来源项目">
        {!hasAvailableSourceProjects ? (
          <p className="project-init-empty-hint" role="status">
            当前平台尚无已有项目，可直接进入下一步创建空项目。
          </p>
        ) : (
          <div className="project-init-source-card">
            <div className="project-init-source-head">
              <div className="project-init-step-copy project-init-step-copy--source">
                <span className="eyebrow">第 2 步</span>
                <h3 id="project-init-step-title">{activeStep.title}</h3>
                <p>{activeStep.description}</p>
              </div>
              <label
                className={[
                  "project-init-source-empty-toggle",
                  startFromEmpty ? "is-selected" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input type="checkbox" checked={startFromEmpty} onChange={toggleStartFromEmpty} />
                <span>
                  <strong>从零开始</strong>
                  <small>不继承来源参数，下一步直接从参数库勾选</small>
                </span>
              </label>
            </div>
            <div className="project-init-source-toolbar">
              <label className="project-init-source-search">
                <span className="sr-only">搜索来源项目</span>
                <input
                  type="search"
                  value={sourceProjectSearchQuery}
                  disabled={startFromEmpty}
                  placeholder="搜索项目名称或代号"
                  aria-label="搜索来源项目"
                  onChange={(event) => {
                    setError("");
                    setSourceProjectSearchQuery(event.target.value);
                  }}
                />
              </label>
              <span className="project-init-source-toolbar__meta" aria-live="polite">
                {sourceProjectSearchQuery.trim()
                  ? `显示 ${filteredSourceProjects.length} / ${projects.length} 个项目`
                  : `共 ${projects.length} 个项目`}
              </span>
            </div>
            <div className={startFromEmpty ? "project-init-source-table-wrap is-disabled" : "project-init-source-table-wrap"}>
              <table className="project-init-source-table" aria-label="可选来源项目">
                <thead>
                  <tr>
                    <th aria-label="选择" scope="col" />
                    <th scope="col">项目名称</th>
                    <th scope="col">代号</th>
                    <th scope="col">主来源</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSourceProjects.length > 0 ? (
                    filteredSourceProjects.map((project) => {
                      const checked = sourceProjectIds.includes(project.id);
                      const isPrimary = primarySourceProjectId === project.id;

                      return (
                        <tr
                          className={[checked ? "is-selected" : "", isPrimary ? "is-primary" : ""].filter(Boolean).join(" ")}
                          key={project.id}
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={project.name}
                              checked={checked}
                              disabled={startFromEmpty}
                              onChange={() => toggleSource(project.id)}
                            />
                          </td>
                          <td className="project-init-source-table__name" title={project.name}>
                            {project.name}
                          </td>
                          <td className="project-init-source-table__code" title={project.code}>
                            {project.code}
                          </td>
                          <td className="project-init-source-table__primary">
                            <label className="project-init-source-table__primary-label">
                              <input
                                type="radio"
                                name="primary-source-project"
                                aria-label={`设 ${project.name} 为主来源`}
                                checked={isPrimary}
                                disabled={!checked || startFromEmpty}
                                onChange={() => {
                                  setError("");
                                  setPrimarySourceProjectId(project.id);
                                }}
                              />
                              <span>{isPrimary ? "主来源" : checked ? "设为主来源" : "—"}</span>
                            </label>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4}>没有匹配的项目，请调整搜索关键词。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="project-init-step-summary project-init-source-card__summary">
              {isEmptyInitialization
                ? "将从零开始创建项目，不继承来源参数。"
                : `已选择 ${sourceProjectIds.length} 个来源项目${
                    primarySourceProjectId
                      ? `，主来源为 ${projectNameById.get(primarySourceProjectId) ?? primarySourceProjectId}`
                      : ""
                  }`}
            </div>
          </div>
        )}
      </section>
    );
  }

  function formatCandidateSource(candidate: ProjectParameterInitializationSnapshotItem) {
    if (candidate.sourceRole === "library") {
      return sourceRoleLabels.library;
    }

    return `${projectNameById.get(candidate.sourceProjectId) ?? candidate.sourceProjectId} (${sourceRoleLabels[candidate.sourceRole]})`;
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
    return formatCandidateSource(candidate);
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
        values={key === "module" ? modules : key === "risk" ? riskLevels : uniqueFilterValues(scopePool, (candidate) => getCandidateFilterValue(candidate, key))}
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
    const emptyCandidateMessage = initializationConfig.parameterLibrary.length === 0
      ? "参数库尚未加载或当前为空，请稍后重试或联系管理员。"
      : "当前筛选条件下没有匹配参数。可清除模块、风险或列筛选后重试。";
    const scopeStatsMessage = initializationConfig.parameterLibrary.length === 0
      ? "参数库暂不可用。"
      : isEmptyInitialization
        ? `${scopePool.length} 个参数库条目可选，已选 ${selectedAvailableParameterIds.length} 个。`
        : `${scopePool.length} 个参数库条目可选，已选 ${selectedAvailableParameterIds.length} 个（来源继承 ${selectedFromSourceCount}，参数库 ${selectedFromLibraryCount}）。`;

    return (
      <section className="project-init-parameter-step" aria-label="参数范围">
        <div className="project-init-scope-head">
          <div className="project-init-step-copy project-init-step-copy--scope">
            <span className="eyebrow">第 3 步</span>
            <h3 id="project-init-step-title">{activeStep.title}</h3>
            <p>{activeStep.description}</p>
          </div>
          <div className="project-init-scope-meta">
            <p>{scopeStatsMessage}</p>
            {!isEmptyInitialization && initializationConfig.parameterLibrary.length > 0 ? (
              <p className="project-init-scope-hint">
                已选来源项目的参数会标注继承来源；未出现在来源中的条目仍可从参数库直接纳入本项目。
              </p>
            ) : null}
          </div>
        </div>
        <section className="project-init-scope-table-panel">
          <div className="project-init-table">
            <table aria-label="参数库选择表">
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
                      aria-label="全选参数库条目"
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
                      <td
                        className="project-init-table__source"
                        title={formatCandidateSource(candidate)}
                      >
                        {formatCandidateSource(candidate)}
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
                    <td colSpan={7}>{emptyCandidateMessage}</td>
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
                <dd>{formatCandidateSource(detailCandidate)}</dd>
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
              <dd>{isEmptyInitialization ? "从零开始" : projectNameById.get(primarySourceProjectId) ?? "-"}</dd>
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

  function getStepPanelClassName(stepIndex: number) {
    if (stepIndex === 0) {
      return " project-init-step-panel--project";
    }
    if (stepIndex === 1) {
      return " project-init-step-panel--source";
    }
    if (stepIndex === 2) {
      return " project-init-step-panel--scope";
    }
    if (stepIndex === 3) {
      return " project-init-step-panel--review";
    }

    return "";
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
            <p>从参数库选择纳入本项目的参数，生成初始化快照并提交审阅。</p>
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
            className={`project-init-step-panel${getStepPanelClassName(currentStepIndex)}`}
            aria-labelledby="project-init-step-title"
          >
            {currentStepIndex !== 1 && currentStepIndex !== 2 ? (
              <div className="project-init-step-copy">
                <span className="eyebrow">第 {currentStepIndex + 1} 步</span>
                <h3 id="project-init-step-title">{activeStep.title}</h3>
                <p>{activeStep.description}</p>
              </div>
            ) : null}
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
