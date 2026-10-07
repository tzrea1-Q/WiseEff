import { Eye, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { AppAction } from "@/application/state/appState";
import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import { toInitializationUiCandidate, type InitializationUiCandidate } from "@/application/parameters/initializationUiMappers";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SearchField } from "@/components/common/SearchField";
import { filterItems } from "@/lib/search";
import { projectAdminSearchProfile } from "@/lib/search/profiles";
import { ColumnFilter } from "./components/ColumnFilter";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./components/tableFilterUtils";
import { getInitializationScopeParameters, resolveInitializationConfig } from "./domain/parameters/initialization";
import type { SemanticInitializationSnapshotItem } from "@/domain/parameters/initializationTypes";
import type { ProjectParameterInitializationSnapshotItem, RiskLevel } from "./domain/parameters/types";
import type { PrototypeState } from "@/domain/prototype/types";

type Props = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onClose: () => void;
  onPreview?: ParameterInitializationRepository["previewSnapshot"];
  onSubmit?: (
    action: Extract<AppAction, { type: "SUBMIT_PARAMETER_INITIALIZATION" }>,
    snapshots: SemanticInitializationSnapshotItem[]
  ) => Promise<void>;
};

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
type WizardCandidate = ProjectParameterInitializationSnapshotItem | InitializationUiCandidate;

const wizardSteps = [
  {
    label: "项目信息",
    title: "先定义新项目",
    description: "填写新项目的名称、代号和负责人，后续步骤会沿用这些信息。"
  },
  {
    label: "来源项目",
    title: "选择要继承的项目",
    description: "选择一个或多个已有项目。多来源时需要指定主来源，差异参数会保留独立来源并逐项确认。"
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

export function ProjectParameterInitializationWizard({ state, dispatch, onClose, onPreview, onSubmit }: Props) {
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
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [canonicalSnapshots, setCanonicalSnapshots] = useState<SemanticInitializationSnapshotItem[]>([]);
  const [previewingCanonicalSnapshots, setPreviewingCanonicalSnapshots] = useState(false);
  const [submittingApiInitialization, setSubmittingApiInitialization] = useState(false);

  const activeStep = wizardSteps[currentStepIndex];
  const isApiMode = Boolean(onPreview && onSubmit);
  const projects = state.configDraft.projects;
  const initializationConfig = useMemo(
    () => resolveInitializationConfig(state.configDraft, state.parameters),
    [state.configDraft, state.parameters]
  );
  const hasAvailableSourceProjects = projects.length > 0;
  const isEmptyInitialization = startFromEmpty || !hasAvailableSourceProjects;
  const isReviewStep = currentStepIndex === wizardSteps.length - 1;
  const ownerName = state.users.find((user) => user.id === ownerUserId)?.name ?? ownerUserId;
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
  const apiCandidatePool = useMemo(
    () => canonicalSnapshots.map(toInitializationUiCandidate),
    [canonicalSnapshots]
  );
  const apiSnapshotByBindingId = useMemo(
    () => new Map(canonicalSnapshots.map((item) => [item.sourceProjectParameterBindingId, item])),
    [canonicalSnapshots]
  );
  const moduleNameById = useMemo(
    () => new Map(
      [...initializationConfig.parameterLibrary, ...state.parameters]
        .filter((parameter) => parameter.moduleId)
        .map((parameter) => [parameter.moduleId!, parameter.module])
    ),
    [initializationConfig.parameterLibrary, state.parameters]
  );
  const supplementSourceProjectIds = sourceProjectIds.filter((projectId) => projectId !== primarySourceProjectId);
  const filteredSourceProjects = useMemo(
    () => filterItems(projects, sourceProjectSearchQuery, projectAdminSearchProfile),
    [projects, sourceProjectSearchQuery]
  );
  const scopePool: WizardCandidate[] = useMemo(
    () => isApiMode
      ? apiCandidatePool
      : getInitializationScopeParameters(initializationConfig, {
          primarySourceProjectId,
          supplementSourceProjectIds
        }),
    [apiCandidatePool, initializationConfig, isApiMode, primarySourceProjectId, supplementSourceProjectIds]
  );
  const modules = useMemo(
    () => Array.from(new Set(scopePool.map((parameter) => parameter.module))).sort(),
    [scopePool]
  );
  const candidates = useMemo(() => {
    const selectedModuleSet = new Set(selectedModules);
    const selectedRiskSet = new Set<RiskLevel>(selectedRisks);

    return scopePool.filter((candidate) => {
      const matchesModule = selectedModuleSet.size === 0 || selectedModuleSet.has(candidate.module);
      const candidateRisk = getCandidateRisk(candidate);
      const matchesRisk = selectedRiskSet.size === 0 || (candidateRisk !== null && selectedRiskSet.has(candidateRisk));
      const matchesColumnFilters = (["parameter", "recommendedValue", "source"] as CandidateColumnFilterKey[]).every((key) => {
        const selectedValues = columnFilters[key] ?? [];
        return selectedValues.length === 0 || selectedValues.includes(getCandidateFilterValue(candidate, key));
      });

      return matchesModule && matchesRisk && matchesColumnFilters;
    });
  }, [scopePool, columnFilters, parameterNameById, projectNameById, selectedModules, selectedRisks, apiSnapshotByBindingId]);
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
  const detailSnapshot = detailCandidate ? apiSnapshotByBindingId.get(detailCandidate.parameterId) : undefined;
  const detailSourceValue = detailCandidate && detailParameter
    ? detailParameter.values[detailCandidate.sourceProjectId]
    : undefined;
  const detailCurrentValue = detailSourceValue?.currentValue ?? detailSnapshot?.rawValue;

  function toggleStartFromEmpty() {
    if (previewingCanonicalSnapshots || submittingApiInitialization) {
      return;
    }
    setError("");
    setCanonicalSnapshots([]);
    setSelectedParameterIds([]);
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
    if (previewingCanonicalSnapshots || submittingApiInitialization) {
      return;
    }
    setError("");
    setCanonicalSnapshots([]);
    setSelectedParameterIds([]);
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

  // Any field or selection the user has made counts as protected work.
  const wizardDirty =
    currentStepIndex > 0 ||
    Boolean(projectName.trim()) ||
    Boolean(projectCode.trim()) ||
    Boolean(notes.trim()) ||
    ownerUserId !== state.currentUserId ||
    sourceProjectIds.length > 0 ||
    Boolean(primarySourceProjectId) ||
    selectedModules.length > 0 ||
    selectedRisks.length > 0 ||
    selectedParameterIds.length > 0 ||
    startFromEmpty;

  function requestClose() {
    if (previewingCanonicalSnapshots || submittingApiInitialization) {
      return;
    }
    if (wizardDirty) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  function normalizeProspectiveProjectId() {
    return projectCode
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function validateCanonicalSnapshots(items: SemanticInitializationSnapshotItem[]) {
    if (items.some((item) =>
      !item.sourceProjectValueId ||
      !item.sourceConfigSetId ||
      !item.sourceOccurrenceId ||
      !item.sourceName ||
      !item.sourceLocatorLabel ||
      !item.sourceFormat ||
      !item.sourceConfigRevisionId
    )) {
      throw new Error("来源快照缺少精确来源固定、文件或定位信息，已停止加载。");
    }
    return items;
  }

  async function goToNextStep() {
    if (!validateStep(currentStepIndex)) {
      return;
    }

    setError("");
    if (currentStepIndex === 1 && isApiMode && onPreview) {
      const prospectiveProjectId = normalizeProspectiveProjectId();
      if (!prospectiveProjectId) {
        setError("项目代号无法生成有效项目标识，请使用字母或数字。");
        return;
      }
      setPreviewingCanonicalSnapshots(true);
      setCanonicalSnapshots([]);
      setSelectedParameterIds([]);
      try {
        const snapshots = validateCanonicalSnapshots(await onPreview({
          projectId: prospectiveProjectId,
          primarySourceProjectId: isEmptyInitialization ? null : primarySourceProjectId,
          supplementSourceProjectIds: isEmptyInitialization ? [] : supplementSourceProjectIds
        }));
        setCanonicalSnapshots(snapshots);
        setCurrentStepIndex(2);
      } catch (previewError: unknown) {
        setError(previewError instanceof Error ? previewError.message : "来源候选加载失败。");
      } finally {
        setPreviewingCanonicalSnapshots(false);
      }
      return;
    }
    setCurrentStepIndex((stepIndex) => Math.min(stepIndex + 1, wizardSteps.length - 1));
  }

  function goToPreviousStep() {
    if (currentStepIndex === 0) {
      requestClose();
      return;
    }

    setError("");
    setCurrentStepIndex((stepIndex) => Math.max(stepIndex - 1, 0));
  }

  async function submitReview() {
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

    const action: Extract<AppAction, { type: "SUBMIT_PARAMETER_INITIALIZATION" }> = {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName,
        projectCode,
        ownerUserId,
        sourceProjectIds,
        primarySourceProjectId,
        supplementSourceProjectIds,
        selectedModules,
        selectedRisks,
        selectedParameterIds: selectedAvailableParameterIds,
        notes
      }
    };

    if (isApiMode && onSubmit) {
      setSubmittingApiInitialization(true);
      setError("");
      try {
        const selectedSnapshots = canonicalSnapshots.filter((item) =>
          selectedAvailableParameterIds.includes(item.sourceProjectParameterBindingId)
        );
        await onSubmit(action, selectedSnapshots);
        onClose();
      } catch (submitError: unknown) {
        setError(submitError instanceof Error ? submitError.message : "参数初始化提交失败，请稍后重试。");
      } finally {
        setSubmittingApiInitialization(false);
      }
      return;
    }

    dispatch(action);
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
                <input
                  type="checkbox"
                  checked={startFromEmpty}
                  disabled={previewingCanonicalSnapshots || submittingApiInitialization}
                  onChange={toggleStartFromEmpty}
                />
                <span>
                  <strong>从零开始</strong>
                  <small>{isApiMode ? "不继承参数，创建空项目后再导入配置来源" : "不继承来源参数，下一步直接从参数库勾选"}</small>
                </span>
              </label>
            </div>
            <div className="project-init-source-toolbar">
              <SearchField
                className="project-init-source-search"
                value={sourceProjectSearchQuery}
                disabled={startFromEmpty || previewingCanonicalSnapshots || submittingApiInitialization}
                placeholder="搜索项目名称或代号"
                ariaLabel="搜索来源项目"
                onValueChange={(value) => {
                  if (previewingCanonicalSnapshots || submittingApiInitialization) {
                    return;
                  }
                  setError("");
                  setSourceProjectSearchQuery(value);
                }}
              />
              <span className="project-init-source-toolbar__meta" aria-live="polite">
                {sourceProjectSearchQuery.trim()
                  ? `显示 ${filteredSourceProjects.length} / ${projects.length} 个项目`
                  : `共 ${projects.length} 个项目`}
              </span>
            </div>
            <HorizontalDragScroll className={startFromEmpty ? "project-init-source-table-wrap is-disabled" : "project-init-source-table-wrap"}>
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
                              disabled={startFromEmpty || previewingCanonicalSnapshots || submittingApiInitialization}
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
                                disabled={!checked || startFromEmpty || previewingCanonicalSnapshots || submittingApiInitialization}
                                onChange={() => {
                                  if (previewingCanonicalSnapshots || submittingApiInitialization) {
                                    return;
                                  }
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
            </HorizontalDragScroll>
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

  function getCandidateRisk(candidate: WizardCandidate): RiskLevel | null {
    return apiSnapshotByBindingId.get(candidate.parameterId)?.risk ?? candidate.risk;
  }

  function getCandidateModuleLabel(candidate: WizardCandidate) {
    return moduleNameById.get(candidate.module) ?? (isApiMode ? "未归类" : candidate.module);
  }

  function formatCandidateSource(candidate: WizardCandidate) {
    const snapshot = apiSnapshotByBindingId.get(candidate.parameterId);
    if (snapshot) {
      const sourceProject = projectNameById.get(snapshot.sourceProjectId) ?? snapshot.sourceProjectId;
      const sourceLocator = [snapshot.sourceName, snapshot.sourceLocatorLabel].filter(Boolean).join(" · ");
      return `${sourceProject} (${sourceRoleLabels[snapshot.sourceRole]})${sourceLocator ? ` · ${sourceLocator}` : ""}`;
    }
    if (candidate.sourceRole === "library") {
      return sourceRoleLabels.library;
    }

    return `${projectNameById.get(candidate.sourceProjectId) ?? candidate.sourceProjectId} (${sourceRoleLabels[candidate.sourceRole]})`;
  }

  function getCandidateDisplayName(candidate: WizardCandidate) {
    return apiSnapshotByBindingId.get(candidate.parameterId)?.propertyKey
      ?? parameterNameById.get(candidate.parameterId)
      ?? candidate.parameterId;
  }

  function getAlternativeSourceNotice(candidate: WizardCandidate) {
    const snapshot = apiSnapshotByBindingId.get(candidate.parameterId);
    const alternativeCount = snapshot?.alternativeSourceValueIds?.length
      ?? snapshot?.alternativeSourceBindingIds.length
      ?? candidate.alternativeSourceProjectIds.length;
    return alternativeCount > 0
      ? `多来源同定义：${alternativeCount} 个独立来源值待确认；来源配置集保持独立。`
      : null;
  }

  function getCandidateFilterValue(candidate: WizardCandidate, key: CandidateColumnFilterKey) {
    if (key === "parameter") {
      return getCandidateDisplayName(candidate);
    }
    if (key === "module") {
      return candidate.module;
    }
    if (key === "risk") {
      return getCandidateRisk(candidate) ?? "";
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
        values={key === "module"
            ? modules
            : key === "risk"
            ? Array.from(new Set(scopePool.map(getCandidateRisk).filter((risk): risk is RiskLevel => risk !== null))).sort()
            : uniqueFilterValues(scopePool, (candidate) => getCandidateFilterValue(candidate, key))}
        selectedValues={selectedValues}
        renderLabel={key === "module"
          ? (moduleId) => moduleNameById.get(moduleId) ?? (isApiMode ? "未归类" : moduleId)
          : key === "risk"
            ? (risk) => riskLevelLabels[risk as RiskLevel]
            : undefined}
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
    const emptyCandidateMessage = isApiMode
      ? "当前来源没有可用的来源参数。"
      : initializationConfig.parameterLibrary.length === 0
        ? "参数库尚未加载或当前为空，请稍后重试或联系管理员。"
        : "当前筛选条件下没有匹配参数。可清除模块、风险或列筛选后重试。";
    const scopeStatsMessage = isApiMode
      ? `${scopePool.length} 个来源参数可选，已选 ${selectedAvailableParameterIds.length} 个。`
      : initializationConfig.parameterLibrary.length === 0
        ? "参数库暂不可用。"
        : isEmptyInitialization
          ? `${scopePool.length} 个参数库条目可选，已选 ${selectedAvailableParameterIds.length} 个。`
          : `${scopePool.length} 个参数库条目可选，已选 ${selectedAvailableParameterIds.length} 个（来源继承 ${selectedFromSourceCount}，参数库 ${selectedFromLibraryCount}）。`;
    const detailName = detailParameter?.name ?? detailSnapshot?.propertyKey ?? detailCandidate?.parameterId ?? "参数";
    const detailDescription = detailParameter?.description ?? "来源参数绑定";
    const detailUnit = detailParameter?.unit ?? "";
    const detailRecommendedValue = detailCandidate?.needsRecommendedValueConfirmation
      ? "需确认"
      : `${detailCandidate?.recommendedValue ?? "-"} ${detailUnit}`.trim();
    const detailCurrentValueText = detailCurrentValue === undefined
      ? "-"
      : `${detailCurrentValue} ${detailUnit}`.trim();
    const detailRange = detailParameter ? `${detailParameter.range} ${detailUnit}`.trim() : "-";
    const detailFormat = detailParameter?.configFormat || detailSnapshot?.sourceFormat?.toUpperCase() || "-";
    const detailAlternativeSourceNotice = detailCandidate ? getAlternativeSourceNotice(detailCandidate) : null;

    return (
      <section className="project-init-parameter-step" aria-label="参数范围">
        <div className="project-init-scope-head">
          <div className="project-init-step-copy project-init-step-copy--scope">
            <span className="eyebrow">第 3 步</span>
            <h3 id="project-init-step-title">{isApiMode ? "从来源项目选择参数" : activeStep.title}</h3>
            <p>{isApiMode ? "浏览所选来源的参数，逐项确认来源值与文件定位。" : activeStep.description}</p>
          </div>
          <div className="project-init-scope-meta">
            <p>{scopeStatsMessage}</p>
            {!isApiMode && !isEmptyInitialization && initializationConfig.parameterLibrary.length > 0 ? (
              <p className="project-init-scope-hint">
                已选来源项目的参数会标注继承来源；未出现在来源中的条目仍可从参数库直接纳入本项目。
              </p>
            ) : null}
          </div>
        </div>
        <section className="project-init-scope-table-panel">
          <HorizontalDragScroll className="project-init-table">
            <table aria-label={isApiMode ? "来源参数选择表" : "参数库选择表"}>
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
                      aria-label={isApiMode ? "全选来源参数" : "全选参数库条目"}
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
                          aria-label={`选择 ${getCandidateDisplayName(candidate)}`}
                          checked={visibleSelectedParameterIds.includes(candidate.parameterId)}
                          onChange={() => toggleParameter(candidate.parameterId)}
                        />
                      </td>
                      <td
                        className="project-init-table__parameter"
                        title={getCandidateDisplayName(candidate)}
                      >
                        {getCandidateDisplayName(candidate)}
                      </td>
                      <td className="project-init-table__module" title={getCandidateModuleLabel(candidate)}>
                        {getCandidateModuleLabel(candidate)}
                      </td>
                      <td>
                        <span className={`risk-badge ${(getCandidateRisk(candidate) ?? "unclassified").toLowerCase()}`}>
                          {getCandidateRisk(candidate) ? riskLevelLabels[getCandidateRisk(candidate)!] : "未分类"}
                        </span>
                      </td>
                      <td className="project-init-table__value" title={candidate.needsRecommendedValueConfirmation ? "需确认" : candidate.recommendedValue}>
                        {candidate.needsRecommendedValueConfirmation ? "需确认" : candidate.recommendedValue}
                        {getAlternativeSourceNotice(candidate) ? (
                          <small className="project-init-table__source-warning" role="status">
                            {getAlternativeSourceNotice(candidate)}
                          </small>
                        ) : null}
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
                          aria-label={`查看 ${getCandidateDisplayName(candidate)} 详情`}
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
          </HorizontalDragScroll>
        </section>
        {detailCandidate && (detailParameter || detailSnapshot) ? (
          <aside className="project-init-parameter-detail" role="complementary" aria-label="参数详情">
            <div className="project-init-parameter-detail__head">
              <div>
                <span className="eyebrow">参数详情</span>
                <strong>{detailName}</strong>
              </div>
              <button className="button subtle" type="button" aria-label="关闭参数详情" onClick={() => setDetailParameterId("")}>
                <X size={14} />
              </button>
            </div>
            <p>{detailDescription}</p>
            <dl>
              <div>
                <dt>模块</dt>
                <dd>{getCandidateModuleLabel(detailCandidate)}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>{getCandidateRisk(detailCandidate) ? riskLevelLabels[getCandidateRisk(detailCandidate)!] : "未分类"}</dd>
              </div>
              <div>
                <dt>推荐值</dt>
                <dd>{detailRecommendedValue}</dd>
              </div>
              <div>
                <dt>当前值</dt>
                <dd>{detailCurrentValueText}</dd>
              </div>
              <div>
                <dt>范围</dt>
                <dd>{detailRange}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{formatCandidateSource(detailCandidate)}</dd>
              </div>
            </dl>
            {detailAlternativeSourceNotice ? (
              <p className="project-init-table__source-warning" role="status">{detailAlternativeSourceNotice}</p>
            ) : null}
            <div className="project-init-parameter-detail__note">
              <span>配置格式</span>
              <code>{detailFormat}</code>
            </div>
            {detailSnapshot ? (
              <>
                <div className="project-init-parameter-detail__note">
                  <span>定义标识</span>
                  <code>{detailSnapshot.parameterSpecId} · {detailSnapshot.parameterSpecVersionId}</code>
                </div>
                <div className="project-init-parameter-detail__note">
                  <span>来源快照</span>
                  <code>
                    {detailSnapshot.sourceProjectValueId} · {detailSnapshot.sourceConfigSetId}
                    {detailSnapshot.sourceConfigRevisionId ? ` · ${detailSnapshot.sourceConfigRevisionId}` : ""}
                  </code>
                </div>
              </>
            ) : null}
            {detailParameter?.explanation ? (
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
          <textarea
            value={notes}
            disabled={submittingApiInitialization}
            onChange={(event) => setNotes(event.target.value)}
          />
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
    <>
      <ModalDialog open onDismiss={requestClose} className="project-init-wizard">
      {({ titleId }) => (
        <>
        <header className="project-init-header">
          <div>
            <span className="eyebrow">项目初始化</span>
            <h2 id={titleId}>新项目参数初始化</h2>
            <p>{isApiMode ? "从来源项目选择纳入本项目的参数，复制其配置来源并提交初始化审阅。" : "从参数库选择纳入本项目的参数，生成初始化快照并提交审阅。"}</p>
          </div>
          <button
            className="button subtle"
            type="button"
            aria-label="关闭项目初始化向导"
            disabled={previewingCanonicalSnapshots || submittingApiInitialization}
            onClick={requestClose}
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
            <button
              className="button subtle"
              type="button"
              disabled={previewingCanonicalSnapshots || submittingApiInitialization}
              onClick={goToPreviousStep}
            >
              {currentStepIndex === 0 ? "取消" : "上一步"}
            </button>
            <button
              className="button primary"
              type="button"
              disabled={previewingCanonicalSnapshots || submittingApiInitialization}
              onClick={isReviewStep ? submitReview : goToNextStep}
            >
              {previewingCanonicalSnapshots ? "加载中…" : submittingApiInitialization ? "提交中…" : isReviewStep ? "提交初始化审阅" : "下一步"}
            </button>
          </div>
        </footer>
        </>
      )}
      </ModalDialog>
      <ConfirmDialog
        open={closeConfirmOpen}
        title="放弃项目初始化？"
        description={<p>已填写的项目信息与参数选择尚未提交，关闭向导后将全部丢失。</p>}
        confirmLabel="放弃并关闭"
        cancelLabel="继续填写"
        tone="danger"
        onCancel={() => setCloseConfirmOpen(false)}
        onConfirm={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
      />
    </>
  );
}
