import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import {
  Badge,
  escapeExcelCell,
  getContextQuery,
  riskLabels,
  WorkbenchLayout
} from "./workbenchUi";
import { projects } from "./mockData";
import type { ParameterRecord, PrototypeState } from "./mockData";
import { roleCanBeAssignedToWorkflowSlot } from "@/domain/users/types";
import { ParametersTable } from "./components/ParametersTable";
import { ParameterInsightBar } from "./components/ParameterInsightBar";
import { ParameterDetailDialog } from "./components/ParameterDetailDialog";
import { ParameterDraftDialog } from "./components/ParameterDraftDialog";
import { deriveParameterWorkbenchInsightSnapshot } from "./parameterWorkbenchInsights";
import { useTopBarActions } from "./components/layout";
import type { ParameterPageActions } from "./app/routes";
import type { ProjectInitializationStatus } from "./domain/parameters/types";
import {
  findOpenChangeRequestForParameter,
  formatOpenChangeRequestBlockerMessage
} from "./application/parameters/parameterRuntime";

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

type ParametersPageAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "ADD_NOTIFICATION"; message: string }
  | {
      type: "ADD_PARAMETER_SUBMISSION_ROUND";
      items: ParameterDraftItem[];
      assignees: {
        hardwareCommitterId: string;
        softwareCommitterId: string;
        softwareUserId: string;
      };
    }
  | { type: "STASH_PARAMETER_SUBMISSION_ROUND"; items: ParameterDraftItem[] }
  | { type: "DISCARD_STASHED_PARAMETER_DRAFTS"; projectId: string; parameterIds: string[] };

type ParametersPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<ParametersPageAction>;
  onNavigate: (path: string) => void;
  search: string;
  parameterActions?: ParameterPageActions;
  effectiveProjectId?: string;
  topBarProjectId?: string;
  canEdit?: boolean;
  initializationStatus?: ProjectInitializationStatus;
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

export function ParametersPage({
  state,
  dispatch,
  onNavigate,
  search,
  parameterActions,
  effectiveProjectId,
  topBarProjectId,
  canEdit = true,
  initializationStatus = "initialized"
}: ParametersPageProps) {
  const initializationLocked = initializationStatus !== "initialized";
  const effectiveCanEdit = canEdit && !initializationLocked;
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilters, setRiskFilters] = useState<Set<ParameterRiskFilter>>(new Set());
  const [moduleFilters, setModuleFilters] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewingParameterId, setViewingParameterId] = useState<string | null>(null);
  const [viewingParameterDetail, setViewingParameterDetail] = useState<ParameterRecord | null>(null);
  const [comparisonTargetProjectId, setComparisonTargetProjectId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { targetValue: string; reason: string }>>({});
  const [submittingRound, setSubmittingRound] = useState(false);
  const [stashingRound, setStashingRound] = useState(false);
  const previousUserIdRef = useRef(state.currentUserId);
  const todayKey = new Date().toISOString().slice(0, 10);
  const resolvedProjectId = effectiveProjectId || state.activeProjectId;
  const insightStorageKey = `parameter-workbench-insight:${resolvedProjectId}:${todayKey}`;
  const [insightDismissed, setInsightDismissed] = useState(() => sessionStorage.getItem(insightStorageKey) === "dismissed");
  const [insightCollapsed, setInsightCollapsed] = useState(false);
  const selectedProjectParameters = useMemo(
    () => state.parameters.filter((parameter) => parameter.projectId === resolvedProjectId),
    [resolvedProjectId, state.parameters]
  );
  const firstProjectParameterId = selectedProjectParameters[0]?.id ?? "";
  const topBarResolvedProjectId = topBarProjectId || resolvedProjectId;
  const projectParameters = useMemo(
    () => state.parameters.filter((parameter) => parameter.projectId === resolvedProjectId),
    [resolvedProjectId, state.parameters]
  );
  const activeParameterById = useMemo(
    () => new Map(projectParameters.map((parameter) => [parameter.id, parameter])),
    [projectParameters]
  );
  const activeParameterIds = useMemo(
    () => new Set(projectParameters.map((parameter) => parameter.id)),
    [projectParameters]
  );
  const restoredDrafts = useMemo(
    () =>
      state.parameterDrafts
        .filter((draft) => draft.projectId === resolvedProjectId && activeParameterIds.has(draft.parameterId))
        .reduce<Record<string, { targetValue: string; reason: string }>>((items, draft) => {
          items[draft.parameterId] = {
            targetValue: draft.targetValue,
            reason: draft.reason
          };
          return items;
        }, {}),
    [activeParameterIds, resolvedProjectId, state.parameterDrafts]
  );
  const [selectedId, setSelectedId] = useState<string>(firstProjectParameterId);
  const [focusedId, setFocusedId] = useState<string | null>(firstProjectParameterId || null);
  const moduleOptions = useMemo(
    () => Array.from(new Set(projectParameters.map((parameter) => parameter.module))),
    [projectParameters]
  );
  const parameterById = useMemo(
    () => new Map(state.parameters.map((parameter) => [parameter.id, parameter])),
    [state.parameters]
  );
  const modifiedIds = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredParameters = useMemo(
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
  const searchParameters = useMemo(
    () => filteredParameters.filter((parameter) => !modifiedIds.has(parameter.id)),
    [filteredParameters, modifiedIds]
  );
  const selected =
    projectParameters.find((parameter) => parameter.id === focusedId) ??
    projectParameters.find((parameter) => parameter.id === selectedId) ??
    projectParameters[0];
  const activeUsers = useMemo(() => state.users.filter((user) => user.isActive), [state.users]);
  const workflowCandidates = useMemo(
    () => ({
      hardwareCommitters: activeUsers.filter((user) => roleCanBeAssignedToWorkflowSlot(user.roleId, "hardwareCommitter")),
      softwareCommitters: activeUsers.filter((user) => roleCanBeAssignedToWorkflowSlot(user.roleId, "softwareCommitter")),
      softwareUsers: activeUsers.filter((user) => roleCanBeAssignedToWorkflowSlot(user.roleId, "softwareUser"))
    }),
    [activeUsers]
  );
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const activeInitializationDraft = state.parameterInitializationDrafts.find(
    (draft) => draft.projectId === resolvedProjectId
  );
  const runtimeProjects = state.configDraft.projects.length > 0 ? state.configDraft.projects : projects;
  const activeProject = runtimeProjects.find((project) => project.id === topBarResolvedProjectId) ??
    (activeInitializationDraft
      ? {
          id: activeInitializationDraft.projectId,
          name: activeInitializationDraft.projectName,
          code: activeInitializationDraft.projectCode
        }
      : runtimeProjects[0]);
  const viewingParameter = viewingParameterId
    ? viewingParameterDetail?.id === viewingParameterId
      ? viewingParameterDetail
      : projectParameters.find((parameter) => parameter.id === viewingParameterId) ?? null
    : null;
  const draftActionDisabledReason = initializationLocked
    ? "初始化通过前暂不可提交普通参数变更。"
    : !canEdit
      ? "需要 User 角色才能编辑、暂存或提交参数变更。"
      : undefined;
  const insightSnapshot = useMemo(
    () => deriveParameterWorkbenchInsightSnapshot(state, resolvedProjectId),
    [state, resolvedProjectId]
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
  const draftItems = useMemo(
    () =>
      Object.entries(drafts)
        .map(([parameterId, draft]) => {
          const parameter = parameterById.get(parameterId);
          if (!parameter) {
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
    [drafts, parameterById]
  );
  const draftDialogItems = useMemo(() => {
    if (!focusedId) {
      return draftItems;
    }
    const focusedDraft = draftItems.find((item) => item.parameterId === focusedId);
    if (!focusedDraft) {
      return draftItems;
    }
    return [focusedDraft, ...draftItems.filter((item) => item.parameterId !== focusedId)];
  }, [draftItems, focusedId]);
  const modifiedParameters = useMemo(
    () =>
      pendingSubmissionItems.map((item) => ({
        ...item.parameter,
        recommendedValue: item.targetValue
      })),
    [pendingSubmissionItems]
  );
  const stashedIds = useMemo(
    () => {
      const ids = new Set<string>();
      state.parameterDrafts
        .filter((draft) => draft.projectId === resolvedProjectId)
        .forEach((draft) => ids.add(draft.parameterId));
      state.parameterSubmissionRounds
        .filter((round) => round.status === "已暂存" && round.projectId === resolvedProjectId)
        .forEach((round) => round.items.forEach((item) => ids.add(item.parameterId)));
      return ids;
    },
    [resolvedProjectId, state.parameterDrafts, state.parameterSubmissionRounds]
  );
  const validPendingSubmissionItems = useMemo(
    () => pendingSubmissionItems.filter((item) => item.targetValue.trim() && item.reason.trim()),
    [pendingSubmissionItems]
  );
  const openChangeRequestBlockers = useMemo(
    () =>
      pendingSubmissionItems
        .map((item) => {
          const openRequest = findOpenChangeRequestForParameter(state.changeRequests, resolvedProjectId, item.parameterId);
          return openRequest ? { parameter: item.parameter, request: openRequest } : null;
        })
        .filter((item): item is { parameter: ParameterRecord; request: (typeof state.changeRequests)[number] } => Boolean(item)),
    [pendingSubmissionItems, resolvedProjectId, state.changeRequests]
  );
  const notifyOpenChangeRequestBlockers = () => {
    const blocker = openChangeRequestBlockers[0];
    if (!blocker) {
      return false;
    }
    dispatch({
      type: "ADD_NOTIFICATION",
      message: formatOpenChangeRequestBlockerMessage(blocker.parameter.name)
    });
    return true;
  };
  const validDraftItems = useMemo(
    () => draftItems.filter((item) => item.targetValue.trim() && item.reason.trim()),
    [draftItems]
  );
  const allSelectedDraftsAreSubmittable =
    selectedIds.size > 0 &&
    pendingSubmissionItems.length === selectedIds.size &&
    validPendingSubmissionItems.length === pendingSubmissionItems.length;
  const allDraftsAreSubmittable = draftItems.length > 0 && validDraftItems.length === draftItems.length;

  useEffect(() => {
    if (contextQuery.module) {
      return;
    }
    setModuleFilters(new Set());
    setRiskFilters(new Set());
  }, [contextQuery.module, contextQuery.projectId, resolvedProjectId]);

  useEffect(() => {
    const isKnownProject =
      runtimeProjects.some((project) => project.id === contextQuery.projectId) ||
      Boolean(state.projectInitializationStatuses[contextQuery.projectId]) ||
      state.parameterInitializationDrafts.some((draft) => draft.projectId === contextQuery.projectId) ||
      state.parameterInitializationReviews.some((review) => review.projectId === contextQuery.projectId);

    if (contextQuery.projectId && isKnownProject && contextQuery.projectId !== resolvedProjectId) {
      dispatch({ type: "SET_PROJECT", projectId: contextQuery.projectId });
    }
  }, [
    contextQuery.projectId,
    dispatch,
    resolvedProjectId,
    runtimeProjects,
    state.parameterInitializationDrafts,
    state.parameterInitializationReviews,
    state.projectInitializationStatuses
  ]);

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
    if (!effectiveCanEdit || !contextQuery.logId) {
      return;
    }

    const originLog = state.logs.find((log) => log.id === contextQuery.logId);
    const requestedParameter = contextQuery.parameterId
      ? activeParameterById.get(contextQuery.parameterId)
      : selected ?? projectParameters[0];

    if (!originLog || originLog.projectId !== resolvedProjectId || !requestedParameter) {
      return;
    }

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
  }, [activeParameterById, effectiveCanEdit, contextQuery.logId, contextQuery.parameterId, projectParameters, resolvedProjectId, selected, state.logs]);

  useEffect(() => {
    if (previousUserIdRef.current === state.currentUserId) {
      return;
    }

    previousUserIdRef.current = state.currentUserId;
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
    setConfirmOpen(false);
    setSubmittingRound(false);
    setStashingRound(false);
  }, [state.currentUserId]);

  useEffect(() => {
    if (effectiveCanEdit) {
      return;
    }
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
    setConfirmOpen(false);
  }, [effectiveCanEdit]);

  useEffect(() => {
    if (!effectiveCanEdit) {
      return;
    }
    const restoredIds = Object.keys(restoredDrafts);
    if (restoredIds.length === 0) {
      return;
    }

    setDrafts((items) => {
      const nextDrafts = { ...items };
      let changed = false;

      restoredIds.forEach((parameterId) => {
        if (nextDrafts[parameterId]) {
          return;
        }
        nextDrafts[parameterId] = restoredDrafts[parameterId];
        changed = true;
      });

      return changed ? nextDrafts : items;
    });
    setSelectedIds((ids) => {
      const nextIds = new Set(ids);
      restoredIds.forEach((parameterId) => nextIds.add(parameterId));
      return nextIds.size === ids.size ? ids : nextIds;
    });
  }, [effectiveCanEdit, restoredDrafts]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setFocusedId(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    setSelectedIds((ids) => {
      const next = new Set(Array.from(ids).filter((id) => activeParameterIds.has(id)));
      return next.size === ids.size ? ids : next;
    });
    setDrafts((items) =>
      Object.fromEntries(Object.entries(items).filter(([parameterId]) => activeParameterIds.has(parameterId)))
    );
    setViewingParameterId((id) => (id && !activeParameterIds.has(id) ? null : id));
    setViewingParameterDetail((parameter) => (parameter && !activeParameterIds.has(parameter.id) ? null : parameter));
  }, [activeParameterIds]);

  useEffect(() => {
    if (selectedIds.size === 0 && !contextQuery.logId && Object.keys(drafts).length === 0) {
      setSheetOpen(false);
    }
  }, [contextQuery.logId, selectedIds.size, drafts]);

  const handleFocusRow = (id: string) => {
    const parameter = activeParameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
  };

  const handleEditRow = (id: string, draftPatch?: { targetValue: string; reason: string }) => {
    if (!effectiveCanEdit) {
      return;
    }
    const parameter = activeParameterById.get(id);
    if (!parameter) {
      return;
    }
    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setDrafts((items) => {
      if (items[id] && !draftPatch) return items;
      return {
        ...items,
        [id]: {
          targetValue: draftPatch?.targetValue ?? items[id]?.targetValue ?? parameter.recommendedValue,
          reason: draftPatch?.reason ?? items[id]?.reason ?? ""
        }
      };
    });
    setSheetOpen(true);
  };

  const handleViewRow = (id: string) => {
    const parameter = activeParameterById.get(id);
    if (!parameter) {
      return;
    }
    const defaultTargetProject =
      runtimeProjects.find((project) => project.id !== parameter.projectId) ??
      runtimeProjects.find((project) => project.id === parameter.projectId) ??
      runtimeProjects[0];

    setSelectedId(parameter.id);
    setFocusedId(parameter.id);
    setViewingParameterId(parameter.id);
    setViewingParameterDetail(parameter);
    setComparisonTargetProjectId(defaultTargetProject?.id ?? parameter.projectId);
    void parameterActions?.getParameter(parameter.id)
      .then((detail) => {
        setViewingParameterDetail((current) => (current?.id === parameter.id ? detail : current));
      })
      .catch(() => {
        setViewingParameterDetail((current) => (current?.id === parameter.id ? parameter : current));
      });
  };

  const addViewingParameterToDraft = (draft?: { targetValue: string; reason: string }) => {
    if (!viewingParameter) {
      return;
    }
    handleEditRow(viewingParameter.id, draft);
    setViewingParameterId(null);
  };

  const handleSelectedIdsChange = (next: Set<string>) => {
    if (!effectiveCanEdit) {
      return;
    }
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
    setDrafts((items) => {
      const { [parameterId]: _removed, ...remainingItems } = items;
      if (Object.keys(remainingItems).length === 0) {
        setSheetOpen(false);
      }
      return remainingItems;
    });
    void discardPersistedDrafts([parameterId]);
  };

  const clearAllDrafts = () => {
    const parameterIds = Object.keys(drafts);
    setSelectedIds(new Set());
    setDrafts({});
    setSheetOpen(false);
    void discardPersistedDrafts(parameterIds);
  };

  const discardPersistedDrafts = async (parameterIds: string[]) => {
    if (parameterIds.length === 0) {
      return;
    }

    const persistedParameterIds = parameterIds.filter(
      (parameterId) =>
        stashedIds.has(parameterId) ||
        state.parameterDrafts.some((draft) => draft.projectId === resolvedProjectId && draft.parameterId === parameterId)
    );
    if (persistedParameterIds.length === 0) {
      return;
    }

    if (parameterActions) {
      const result = await parameterActions.discardDrafts({
        projectId: resolvedProjectId,
        parameterIds: persistedParameterIds
      });
      notifyActionFailure(result);
      return;
    }

    dispatch({
      type: "DISCARD_STASHED_PARAMETER_DRAFTS",
      projectId: resolvedProjectId,
      parameterIds: persistedParameterIds
    });
  };

  const openSubmitPreview = () => {
    if (!effectiveCanEdit) {
      return;
    }
    if (!allSelectedDraftsAreSubmittable) {
      return;
    }
    if (notifyOpenChangeRequestBlockers()) {
      return;
    }
    setConfirmOpen(true);
  };

  const submitParameterToModifiedTable = () => {
    if (!effectiveCanEdit) {
      return;
    }
    if (!allDraftsAreSubmittable) {
      return;
    }
    setSelectedIds((ids) => new Set([...Array.from(ids), ...Object.keys(drafts)]));
    setSheetOpen(false);
  };

  const notifyActionFailure = (result: Awaited<ReturnType<ParameterPageActions["submitChanges"]>>) => {
    if (result && "notification" in result) {
      if (!result.alreadyNotified) {
        dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
      }
      return true;
    }
    return false;
  };

  const submitRound = async (assignees: { hardwareCommitterId: string; softwareCommitterId: string; softwareUserId: string }) => {
    if (!effectiveCanEdit) {
      return;
    }
    if (submittingRound) {
      return;
    }
    if (!allSelectedDraftsAreSubmittable) {
      return;
    }
    if (notifyOpenChangeRequestBlockers()) {
      return;
    }
    const itemsToSubmit = pendingSubmissionItems.map(({ parameter: _parameter, ...item }) => item);
    if (itemsToSubmit.length === 0) {
      return;
    }
    setSubmittingRound(true);
    try {
      const submitInput = {
        projectId: resolvedProjectId,
        items: itemsToSubmit,
        assignees
      };
      if (!parameterActions) {
        dispatch({ type: "ADD_PARAMETER_SUBMISSION_ROUND", items: itemsToSubmit, assignees });
        setSelectedIds(new Set());
        setDrafts({});
        setSheetOpen(false);
        setConfirmOpen(false);
        return;
      }
      const result = await parameterActions.submitChanges(submitInput);
      if (notifyActionFailure(result)) {
        return;
      }
      setSelectedIds(new Set());
      setDrafts({});
      setSheetOpen(false);
      setConfirmOpen(false);
    } finally {
      setSubmittingRound(false);
    }
  };
  const stashRound = async () => {
    if (!effectiveCanEdit) {
      return;
    }
    if (stashingRound) {
      return;
    }
    const itemsToStash = pendingSubmissionItems.map(({ parameter: _parameter, ...item }) => item);
    if (itemsToStash.length === 0) {
      return;
    }
    setStashingRound(true);
    try {
      if (!parameterActions) {
        dispatch({ type: "STASH_PARAMETER_SUBMISSION_ROUND", items: itemsToStash });
        setSelectedIds(new Set());
        setDrafts({});
        setSheetOpen(false);
        return;
      }
      const result = await parameterActions.stashChanges(itemsToStash);
      if (notifyActionFailure(result)) {
        return;
      }
      setSelectedIds(new Set());
      setDrafts({});
      setSheetOpen(false);
    } finally {
      setStashingRound(false);
    }
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
  const roundActions =
    modifiedParameters.length > 0 ? (
      <div className="parameters-bottom-actions">
        <button className="button subtle" type="button" disabled={!effectiveCanEdit || pendingSubmissionItems.length === 0 || stashingRound} onClick={stashRound}>
          暂存本轮{pendingSubmissionItems.length > 0 ? ` (${pendingSubmissionItems.length} 项)` : ""}
        </button>
        <button className="button primary" type="button" disabled={!effectiveCanEdit || !allSelectedDraftsAreSubmittable} onClick={openSubmitPreview}>
          {submitButtonText}
        </button>
      </div>
    ) : null;
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
    if (!effectiveCanEdit) {
      return;
    }
    const insightIds = insightSnapshot.topParameters.map((parameter) => parameter.id);
    if (insightIds.length === 0) {
      return;
    }
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
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => exportProjectParametersAsExcel(filteredParameters, activeProject.code)}>
        导出 Excel
      </button>
      {effectiveCanEdit ? (
        <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-submissions")}>
          历史提交
        </button>
      ) : null}
      <button className="button primary" type="button" onClick={handleAiAuditClick}>
        <Sparkles size={16} />
        AI 巡检
      </button>
    </>,
    [activeProject.code, filteredParameters]
  );

  return (
    <WorkbenchLayout
      title="项目参数用户工作台"
    >
      <div className="parameters-page-layout">
        {!insightDismissed ? (
          <ParameterInsightBar
            snapshot={insightSnapshot}
            collapsed={insightCollapsed}
            onExpand={() => setInsightCollapsed(false)}
            onViewHighRisk={viewHighRiskFromInsight}
            onAddToDraft={addInsightItemsToDraft}
            canAddToDraft={effectiveCanEdit}
            onDismiss={dismissInsightForToday}
          />
        ) : null}
        {initializationLocked ? (
          <div className="permission-inline-note" role="status">
            <strong>初始化待审阅</strong>
            <span>该项目可查看，初始化通过前暂不可提交普通参数变更。</span>
          </div>
        ) : null}
        <div className="workbench-one-col parameters-workbench-main">
          <section className="workbench-main">
            {modifiedParameters.length > 0 ? (
              <section className="modified-parameters-section" aria-label="本轮已修改参数区">
                <ParametersTable
                  rows={modifiedParameters}
                  totalRows={modifiedParameters.length}
                  ariaLabel="本轮已修改参数表"
                  title="本轮已修改参数"
                  description="这些参数已从检索结果中移出，可在这里集中确认目标值并提交本轮。"
                  showToolbar={false}
                  valueColumnLabel="当前 → 目标"
                  selectedIds={selectedIds}
                  onSelectedIdsChange={handleSelectedIdsChange}
                  focusedId={focusedId}
                  onFocusRow={handleFocusRow}
                  modifiedIds={modifiedIds}
                  onEditRow={handleEditRow}
                  onViewRow={handleViewRow}
                  stashedIds={stashedIds}
                  canEdit={effectiveCanEdit}
                />
                {roundActions}
              </section>
            ) : null}
            <ParametersTable
              rows={searchParameters}
              totalRows={projectParameters.length}
              ariaLabel="检索参数表"
              title="检索参数"
              description="按名称、模块或重要性筛选参数。点击编辑只会打开草稿，提交参数后才会移到上方的本轮已修改参数表。"
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onClearFilters={clearFilters}
              columnFilters={[
                {
                  key: "module",
                  label: "模块",
                  groupLabel: "模块筛选",
                  values: moduleOptions,
                  selectedValues: Array.from(moduleFilters),
                  onToggle: (module) => {
                    setModuleFilters((current) => {
                      const next = new Set(current);
                      if (next.has(module)) {
                        next.delete(module);
                      } else {
                        next.add(module);
                      }
                      return next;
                    });
                  },
                  onClear: () => setModuleFilters(new Set())
                },
                {
                  key: "risk",
                  label: "重要性",
                  groupLabel: "重要性筛选",
                  values: ["High", "Medium", "Low"],
                  selectedValues: Array.from(riskFilters),
                  renderLabel: (risk) => `${riskLabels[risk as Exclude<ParameterRiskFilter, "All">]} ${
                    projectParameters.filter((parameter) => parameter.risk === risk).length
                  }`,
                  onToggle: (risk) => {
                    setRiskFilters((current) => {
                      const next = new Set(current);
                      const typedRisk = risk as ParameterRiskFilter;
                      if (next.has(typedRisk)) {
                        next.delete(typedRisk);
                      } else {
                        next.add(typedRisk);
                      }
                      return next;
                    });
                  },
                  onClear: () => setRiskFilters(new Set())
                }
              ]}
              selectedIds={selectedIds}
              onSelectedIdsChange={handleSelectedIdsChange}
              focusedId={focusedId}
              onFocusRow={handleFocusRow}
              modifiedIds={modifiedIds}
              onEditRow={handleEditRow}
              onViewRow={handleViewRow}
              stashedIds={stashedIds}
              canEdit={effectiveCanEdit}
            />
          </section>
        </div>
        {effectiveCanEdit && draftItems.length > 0 && sheetOpen ? (
          <ParameterDraftDialog
            open
            title="修改草稿"
            description="点击编辑会加入草稿，提交参数后才会进入上方的本轮已修改参数表。"
            drafts={draftDialogItems}
            focusedParameterId={focusedId}
            canEdit={effectiveCanEdit}
            onClose={() => setSheetOpen(false)}
            onClearAll={clearAllDrafts}
            onRemoveItem={removeDraftItem}
            onUpdateDraft={updateDraft}
            onSubmit={submitParameterToModifiedTable}
            onViewSubmissions={() => onNavigate("/parameter-submissions")}
          />
        ) : null}
      </div>
      {confirmOpen && previewItems.length > 0 ? (
        <ParameterSubmissionDialog
          items={previewItems}
          candidates={workflowCandidates}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submitRound}
          submitting={submittingRound}
        />
      ) : null}
      {viewingParameter ? (
        <ParameterDetailDialog
          parameter={viewingParameter}
          parameters={state.parameters}
          projects={runtimeProjects}
          currentProjectId={viewingParameter.projectId}
          targetProjectId={
            comparisonTargetProjectId ||
            runtimeProjects.find((project) => project.id !== viewingParameter.projectId)?.id ||
            viewingParameter.projectId
          }
          canEdit={effectiveCanEdit}
          disabledReason={draftActionDisabledReason}
          alreadyInDraft={Boolean(drafts[viewingParameter.id])}
          onTargetProjectChange={setComparisonTargetProjectId}
          onAddToDraft={addViewingParameterToDraft}
          onClose={() => {
            setViewingParameterId(null);
            setViewingParameterDetail(null);
          }}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function isComplexSubmissionValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

function isComplexSubmissionItem(item: ParameterDraftItem & { parameter: ParameterRecord }) {
  return (
    isComplexSubmissionValue(item.parameter.currentValue) ||
    isComplexSubmissionValue(item.targetValue) ||
    isComplexSubmissionValue(item.parameter.configFormat)
  );
}

function getSubmissionLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
}

type SubmissionPreviewDiffLineKind = "equal" | "remove" | "add";

type SubmissionPreviewDiffLine = {
  kind: SubmissionPreviewDiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitSubmissionDiffLines(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.length === 0 ? [""] : lines;
}

function buildSubmissionPreviewDiffLines(baseValue: string, targetValue: string): SubmissionPreviewDiffLine[] {
  const baseLines = splitSubmissionDiffLines(baseValue);
  const targetLines = splitSubmissionDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: SubmissionPreviewDiffLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseLine = baseLines[index];
    const targetLine = targetLines[index];
    const baseLineNumber = baseLine === undefined ? null : index + 1;
    const targetLineNumber = targetLine === undefined ? null : index + 1;

    if (baseLine === targetLine) {
      diffLines.push({
        kind: "equal",
        leftLineNumber: baseLineNumber,
        rightLineNumber: targetLineNumber,
        value: baseLine ?? ""
      });
      continue;
    }

    if (baseLine !== undefined) {
      diffLines.push({
        kind: "remove",
        leftLineNumber: baseLineNumber,
        rightLineNumber: null,
        value: baseLine
      });
    }

    if (targetLine !== undefined) {
      diffLines.push({
        kind: "add",
        leftLineNumber: null,
        rightLineNumber: targetLineNumber,
        value: targetLine
      });
    }
  }

  return diffLines;
}

function SubmissionPreviewDiff({ baseValue, targetValue }: { baseValue: string; targetValue: string }) {
  const diffLines = buildSubmissionPreviewDiffLines(baseValue, targetValue);

  return (
    <div className="submission-preview-diff" role="list">
      {diffLines.map((line, index) => (
        <div
          className="submission-preview-diff-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="submission-preview-diff-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="submission-preview-diff-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}

function ParameterSubmissionDialog({
  items,
  candidates,
  onCancel,
  onConfirm,
  submitting
}: {
  items: Array<ParameterDraftItem & { parameter: ParameterRecord }>;
  candidates: {
    hardwareCommitters: PrototypeState["users"];
    softwareCommitters: PrototypeState["users"];
    softwareUsers: PrototypeState["users"];
  };
  onCancel: () => void;
  onConfirm: (assignees: { hardwareCommitterId: string; softwareCommitterId: string; softwareUserId: string }) => void;
  submitting: boolean;
}) {
  const [hardwareCommitterId, setHardwareCommitterId] = useState(candidates.hardwareCommitters[0]?.id ?? "");
  const [softwareCommitterId, setSoftwareCommitterId] = useState(candidates.softwareCommitters[0]?.id ?? "");
  const [softwareUserId, setSoftwareUserId] = useState(candidates.softwareUsers[0]?.id ?? "");
  const canSubmit = Boolean(hardwareCommitterId && softwareCommitterId && softwareUserId);
  const hasComplexItems = items.some(isComplexSubmissionItem);
  const submitWithAssignees = () => {
    if (!canSubmit || submitting) {
      return;
    }
    onConfirm({ hardwareCommitterId, softwareCommitterId, softwareUserId });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="提交本轮参数">
      <div className={["submission-dialog", hasComplexItems ? "submission-dialog--wide" : ""].filter(Boolean).join(" ")}>
        <div className="submission-dialog-head">
          <div>
            <span className="eyebrow">参数提交预览</span>
            <p>本轮提交包含 {items.length} 个参数修改，确认后进入硬件与软件协同审阅流程。</p>
          </div>
          <Badge tone="secondary">Diff 预览</Badge>
        </div>
        <div className="submission-assignee-grid" aria-label="后续流程处理人">
          <label>
            <span>硬件 MDE</span>
            <select value={hardwareCommitterId} onChange={(event) => setHardwareCommitterId(event.target.value)} aria-label="硬件 MDE">
              {candidates.hardwareCommitters.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>软件 MDE</span>
            <select value={softwareCommitterId} onChange={(event) => setSoftwareCommitterId(event.target.value)} aria-label="软件 MDE">
              {candidates.softwareCommitters.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>软件开发</span>
            <select value={softwareUserId} onChange={(event) => setSoftwareUserId(event.target.value)} aria-label="软件开发">
              {candidates.softwareUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="submission-diff-list">
          {items.map((item) => {
            const isComplexItem = isComplexSubmissionItem(item);

            return (
              <article
                className={["submission-diff-card", isComplexItem ? "submission-diff-card--complex" : ""].filter(Boolean).join(" ")}
                key={item.parameterId}
              >
                <div className="submission-diff-card__head">
                  <div>
                    <strong>{item.parameter.name}</strong>
                    <small>{item.parameter.module} · {riskLabels[item.parameter.risk]}</small>
                  </div>
                  {isComplexItem ? <span>复杂配置</span> : null}
                </div>
                {isComplexItem ? (
                  <>
                    <div className="submission-preview-meta-row" aria-label={`${item.parameter.name} 提交摘要`}>
                      <span>DTS / 多行参数</span>
                      <span>当前 {getSubmissionLineCount(item.parameter.currentValue)} 行</span>
                      <span>目标 {getSubmissionLineCount(item.targetValue)} 行</span>
                    </div>
                    <SubmissionPreviewDiff baseValue={item.parameter.currentValue || "-"} targetValue={item.targetValue || "-"} />
                  </>
                ) : (
                  <>
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
                  </>
                )}
                {item.reason ? <p>{item.reason}</p> : null}
              </article>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="button subtle" type="button" disabled={submitting} onClick={onCancel}>
            返回修改
          </button>
          <button className="button primary" type="button" disabled={!canSubmit || submitting} onClick={submitWithAssignees}>
            {submitting ? "提交中" : "确认提交"}
          </button>
        </div>
      </div>
    </div>
  );
}
