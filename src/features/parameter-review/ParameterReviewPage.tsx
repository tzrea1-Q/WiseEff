import { ColumnFilter } from "@/components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues } from "@/components/tableFilterUtils";
import { canPerform } from "@/app/permissions";
import { type PageProps } from "@/app/routes";
import { toLegacyInitializationReview } from "@/application/parameters/initializationUiMappers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { isValidMergeLink } from "@/domain/parameters/mergeLink";
import { canActOnReviewRequest, isReviewHistoryForRole, splitChangeRequestsForReviewQueue } from "@/domain/parameters/reviewQueue";
import { type ProjectParameterInitializationDraft, type ProjectParameterInitializationReview } from "@/domain/parameters/types";
import { type ChangeRequest, type ParameterSubmissionRound } from "@/domain/prototype/types";
import { migrateLegacyRoleId } from "@/domain/users/types";
import {
  StatusBadge,
  VerticalTimeline,
  WorkbenchLayout,
  formatWorkflowDisplayText,
  getParameterInitializationReviewStatusLabel,
  getUserName,
  type VerticalTimelineItem
} from "@/features/parameter-review/reviewUi";
import {
  ReviewChangeValueSummary,
  ReviewDetailSummary,
  SubmissionHistoryDiffCard,
  isComplexSubmissionHistoryItem,
  shouldShowSubmissionRoundSummary
} from "@/features/parameter-review/submissionHistoryDiff";
import { shouldSummarizeReviewChange } from "@/parameterValueKind";
import { EmptyStateCard, PanelHeader, SectionLabel, getContextQuery } from "@/workbenchUi";
import { ArrowRight, CheckCircle2, CircleOff, FileText, History, Link2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type ParameterReviewMode = "pending" | "history";
type ParameterInitializationReviewRow = {
  kind: "initialization";
  review: ProjectParameterInitializationReview;
  draft: ProjectParameterInitializationDraft;
};
type ParameterReviewRow =
  | ParameterInitializationReviewRow
  | { kind: "change"; request: ChangeRequest };

export function ParameterReviewPage({
  state,
  dispatch,
  search,
  parameterActions,
  parameterInitializationRepository,
  runtimeMode
}: PageProps) {
  const [selectedId, setSelectedId] = useState(
    state.parameterInitializationReviews[0]?.id ?? state.changeRequests[0]?.id ?? ""
  );
  const [rejectOpen, setRejectOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mergeLink, setMergeLink] = useState("");
  const [reviewMode, setReviewMode] = useState<ParameterReviewMode>("pending");
  const [filterModules, setFilterModules] = useState<string[]>([]);
  const [filterSubmitters, setFilterSubmitters] = useState<string[]>([]);
  const [filterProjects, setFilterProjects] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const contextQuery = useMemo(() => getContextQuery(search), [search]);
  const reviewerRoleId = migrateLegacyRoleId(state.activeRoleId);
  const canReviewInitialization = canPerform(reviewerRoleId, "parameter.review");
  const { pending: pendingRequests, history: historyRequests } = useMemo(
    () => splitChangeRequestsForReviewQueue(reviewerRoleId, state.changeRequests),
    [reviewerRoleId, state.changeRequests]
  );
  const pendingInitializationRows = useMemo(
    () =>
      canReviewInitialization
        ? state.parameterInitializationReviews
            .filter((review) => review.status === "pending")
            .flatMap((review): ParameterInitializationReviewRow[] => {
              const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
              return draft ? [{ kind: "initialization", review, draft }] : [];
            })
        : [],
    [canReviewInitialization, state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const historyInitializationRows = useMemo(
    () =>
      canReviewInitialization
        ? state.parameterInitializationReviews
            .filter((review) => review.status !== "pending")
            .flatMap((review): ParameterInitializationReviewRow[] => {
              const draft = state.parameterInitializationDrafts.find((item) => item.id === review.draftId);
              return draft ? [{ kind: "initialization", review, draft }] : [];
            })
        : [],
    [canReviewInitialization, state.parameterInitializationDrafts, state.parameterInitializationReviews]
  );
  const visibleRequests = reviewMode === "history" ? historyRequests : pendingRequests;
  const visibleInitializationRows = reviewMode === "history" ? historyInitializationRows : pendingInitializationRows;

  const unfilteredReviewRows = useMemo<ParameterReviewRow[]>(
    () => [...visibleInitializationRows, ...visibleRequests.map((request) => ({ kind: "change" as const, request }))],
    [visibleInitializationRows, visibleRequests]
  );
  const getReviewRowField = useCallback((row: ParameterReviewRow, field: "id" | "project" | "module" | "submitter" | "change" | "status") => {
    if (row.kind === "initialization") {
      const submitter = state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy;
      const modules = row.draft.parameterSnapshots.map((snapshot) => snapshot.module);
      const primaryModule = modules[0] ?? "参数初始化";
      const moduleText = modules.length > 1 ? `${primaryModule} 等 ${modules.length} 个模块` : primaryModule;
      const values = {
        id: row.review.id,
        project: row.draft.projectName,
        module: moduleText,
        submitter,
        change: `${row.draft.projectName} → ${row.draft.parameterSnapshots.length} 项参数`,
        status: getParameterInitializationReviewStatusLabel(row.review.status)
      };
      return values[field];
    }

    const { request } = row;
    const parameter = state.parameters.find((item) => item.id === request.parameterId);
    const project = state.configDraft.projects.find((item) => item.id === (request.projectId ?? parameter?.projectId));
    const values = {
      id: request.id,
      project: project?.name ?? request.projectId ?? parameter?.projectId ?? "未关联项目",
      module: request.module,
      submitter: request.submitter,
      change: `${request.currentValue} → ${request.targetValue}`,
      status: request.status
    };
    return values[field];
  }, [state.configDraft.projects, state.parameters, state.users]);
  const reviewRows = useMemo<ParameterReviewRow[]>(
    () =>
      unfilteredReviewRows.filter((row) => {
        if (filterProjects.length && !filterProjects.includes(getReviewRowField(row, "project"))) return false;
        if (filterModules.length) {
          if (row.kind === "initialization") {
            if (!row.draft.parameterSnapshots.some((snapshot) => filterModules.includes(snapshot.module))) return false;
          } else if (!filterModules.includes(getReviewRowField(row, "module"))) {
            return false;
          }
        }
        if (filterSubmitters.length && !filterSubmitters.includes(getReviewRowField(row, "submitter"))) return false;
        if (filterStatuses.length && !filterStatuses.includes(getReviewRowField(row, "status"))) return false;
        return true;
      }),
    [filterModules, filterProjects, filterStatuses, filterSubmitters, getReviewRowField, unfilteredReviewRows]
  );
  const selectedRow = reviewRows.find((row) => (row.kind === "initialization" ? row.review.id : row.request.id) === selectedId) ?? reviewRows[0] ?? null;
  const selected = selectedRow?.kind === "change" ? selectedRow.request : null;
  const selectedInitialization = selectedRow?.kind === "initialization" ? selectedRow : null;

  const modules = useMemo(
    () =>
      Array.from(
        new Set([
          ...visibleInitializationRows.flatMap((row) => row.draft.parameterSnapshots.map((snapshot) => snapshot.module)),
          ...visibleRequests.map((r) => r.module)
        ])
      ),
    [visibleInitializationRows, visibleRequests]
  );
  const submitters = useMemo(
    () =>
      Array.from(
        new Set([
          ...visibleInitializationRows.map((row) => state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy),
          ...visibleRequests.map((r) => r.submitter)
        ])
      ),
    [visibleInitializationRows, visibleRequests, state.users]
  );
  const projectOptions = useMemo(() => {
    const ids = new Set(visibleRequests.map((r) => state.parameters.find((p) => p.id === r.parameterId)?.projectId).filter(Boolean));
    const changeProjects = state.configDraft.projects.filter((p) => ids.has(p.id));
    const initializationProjects = visibleInitializationRows.map((row) => ({ id: row.draft.projectId, name: row.draft.projectName, code: row.draft.projectCode }));
    return [...initializationProjects, ...changeProjects].filter(
      (project, index, allProjects) => allProjects.findIndex((item) => item.name === project.name) === index
    );
  }, [visibleInitializationRows, visibleRequests, state.parameters, state.configDraft.projects]);
  const statusOptions = useMemo(() => uniqueFilterValues(unfilteredReviewRows, (row) => getReviewRowField(row, "status")), [getReviewRowField, unfilteredReviewRows]);

  const selectedRound = useMemo(() => {
    if (!selected?.submissionRoundId) return null;
    return state.parameterSubmissionRounds.find((r) => r.id === selected.submissionRoundId) ?? null;
  }, [selected, state.parameterSubmissionRounds]);
  const selectedDetailRound = useMemo((): ParameterSubmissionRound | null => {
    if (!selected) return null;
    if (selectedRound) return selectedRound;

    const parameter = state.parameters.find((item) => item.id === selected.parameterId);
    const project = state.configDraft.projects.find((item) => item.id === (selected.projectId ?? parameter?.projectId));

    return {
      id: selected.submissionRoundId ?? selected.id,
      projectId: selected.projectId ?? parameter?.projectId ?? "unknown",
      projectName: project?.name ?? selected.projectId ?? "未关联项目",
      submitter: selected.submitter,
      createdAt: selected.createdAt,
      status: selected.status,
      summary: selected.title,
      items: [
        {
          requestId: selected.id,
          parameterId: selected.parameterId,
          name: parameter?.name ?? selected.title,
          module: selected.module,
          currentValue: selected.currentValue,
          targetValue: selected.targetValue,
          unit: parameter?.unit ?? "",
          risk: parameter?.risk ?? "Medium",
          valueKind: selected.valueKind ?? parameter?.valueKind ?? "scalar",
          reason: selected.aiSummary
        }
      ]
    };
  }, [selected, selectedRound, state.parameters, state.configDraft.projects]);
  const selectedReviewParameter = useMemo(
    () => (selected ? state.parameters.find((item) => item.id === selected.parameterId) : undefined),
    [selected, state.parameters]
  );
  const selectedModuleDescription = selected?.moduleDescription?.trim() || "";
  const selectedParameterDescription =
    selected?.parameterDescription?.trim() ||
    selectedReviewParameter?.description?.trim() ||
    selectedReviewParameter?.explanation?.trim() ||
    "";
  const selectedInitializationSubmitter = selectedInitialization
    ? state.users.find((user) => user.id === selectedInitialization.review.submittedBy)?.name ?? selectedInitialization.review.submittedBy
    : "";
  const selectedProjectName = selected
    ? getReviewRowField({ kind: "change", request: selected }, "project")
    : "";
  const selectedInitializationPrimarySource = selectedInitialization
    ? state.configDraft.projects.find((project) => project.id === selectedInitialization.draft.primarySourceProjectId)
    : null;
  const selectedInitializationSupplementCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.sourceRole === "supplement").length ?? 0;
  const selectedInitializationConfirmationCount =
    selectedInitialization?.draft.parameterSnapshots.filter((snapshot) => snapshot.needsRecommendedValueConfirmation).length ?? 0;

  useEffect(() => {
    setMergeLink("");
  }, [selectedId]);

  useEffect(() => {
    if (!contextQuery.module && !contextQuery.projectId) {
      return;
    }

    const matchingRequest = state.changeRequests.find((request) => {
      const parameter = state.parameters.find((item) => item.id === request.parameterId);
      const projectMatches = !contextQuery.projectId || parameter?.projectId === contextQuery.projectId;
      const moduleMatches = !contextQuery.module || request.module === contextQuery.module;

      return projectMatches && moduleMatches;
    });

    if (matchingRequest) {
      setReviewMode(
        matchingRequest.status === "已合入" || isReviewHistoryForRole(reviewerRoleId, matchingRequest)
          ? "history"
          : "pending"
      );
      setSelectedId(matchingRequest.id);
    }
  }, [contextQuery.module, contextQuery.projectId, reviewerRoleId, state.changeRequests, state.parameters]);

  useEffect(() => {
    if (!selectedId || reviewMode !== "pending") {
      return;
    }

    const request = state.changeRequests.find((item) => item.id === selectedId);
    if (request && isReviewHistoryForRole(reviewerRoleId, request)) {
      setReviewMode("history");
    }
  }, [reviewMode, reviewerRoleId, selectedId, state.changeRequests]);

  useEffect(() => {
    if (reviewRows.length && !reviewRows.some((row) => (row.kind === "initialization" ? row.review.id : row.request.id) === selectedId)) {
      const firstRow = reviewRows[0];
      setSelectedId(firstRow.kind === "initialization" ? firstRow.review.id : firstRow.request.id);
    }
  }, [reviewRows, selectedId]);

  const dispatchParameterActionFailure = (result: Awaited<ReturnType<NonNullable<PageProps["parameterActions"]>["reviewChange"]>>) => {
    if (result && "notification" in result) {
      if (!result.alreadyNotified) {
        dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
      }
      return true;
    }
    return false;
  };

  const rejectSelected = async (reason: string) => {
    if (selectedInitialization) {
      if (runtimeMode === "api" && parameterInitializationRepository) {
        try {
          const review = await parameterInitializationRepository.reject(
            selectedInitialization.review.id,
            reason
          );
          dispatch({
            type: "HYDRATE_PARAMETER_INITIALIZATION",
            reviews: state.parameterInitializationReviews.map((item) =>
              item.id === review.id ? toLegacyInitializationReview(review) : item
            ),
            statuses: { [review.projectId]: "initialization_rejected" }
          });
          dispatch({ type: "ADD_NOTIFICATION", message: `参数初始化已驳回：${reason}` });
        } catch (error) {
          const message = error instanceof Error ? error.message : "参数初始化驳回失败";
          dispatch({ type: "ADD_NOTIFICATION", message });
          return;
        }
      } else {
        dispatch({ type: "REJECT_PARAMETER_INITIALIZATION", reviewId: selectedInitialization.review.id, reason });
      }
      setRejectOpen(false);
      return;
    }
    if (!selected) {
      return;
    }
    const result = parameterActions
      ? await parameterActions.reviewChange({ requestId: selected.id, decision: "reject", note: reason })
      : await Promise.resolve(dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason }));
    if (dispatchParameterActionFailure(result)) {
      return;
    }
    setRejectOpen(false);
  };
  const advanceSelected = async () => {
    if (!selected) {
      return;
    }
    const requiresMergeLink = selected.status === "软件User合入";
    const trimmedMergeLink = mergeLink.trim();
    if (requiresMergeLink && !isValidMergeLink(trimmedMergeLink)) {
      return;
    }
    const input = {
      requestId: selected.id,
      decision: "advance" as const,
      ...(selected.baseVersion !== undefined ? { expectedVersion: selected.baseVersion } : {}),
      ...(requiresMergeLink ? { note: trimmedMergeLink } : {})
    };
    const result = parameterActions
      ? await parameterActions.reviewChange(input)
      : await Promise.resolve(
          dispatch({
            type: "ADVANCE_REVIEW",
            requestId: selected.id,
            ...(requiresMergeLink ? { note: trimmedMergeLink } : {})
          })
        );
    dispatchParameterActionFailure(result);
  };
  const openSubmissionDetail = (request: ChangeRequest) => {
    setSelectedId(request.id);
    setDetailOpen(true);
  };
  const selectReviewMode = (mode: ParameterReviewMode) => {
    setReviewMode(mode);
    setFilterModules([]);
    setFilterSubmitters([]);
    setFilterProjects([]);
    setFilterStatuses([]);
    setDetailOpen(false);
    setSelectedId("");
  };
  const reviewMeta = reviewMode === "history" ? `${reviewRows.length} 项历史审阅` : `${reviewRows.length} 项待处理`;
  const canActOnSelectedReview = selected ? canActOnReviewRequest(reviewerRoleId, selected) : false;
  const canRejectSelectedReview = canPerform(reviewerRoleId, "parameter.review");
  const reviewPageTitle = canPerform(reviewerRoleId, "parameter.review") ? "参数管理员工作台" : "参数合入工作台";
  const mergeUrl =
    selected?.status === "已合入" && selected.reviewerNote && isValidMergeLink(selected.reviewerNote)
      ? selected.reviewerNote.trim()
      : null;
  const selectedWorkflowItems: VerticalTimelineItem[] = selected
    ? (() => {
        const softwareUserBody: ReactNode = mergeUrl ? (
          <>
            {formatWorkflowDisplayText(
              `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。合入链接：`
            )}
            <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
              {mergeUrl}
            </a>
          </>
        ) : (
          `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。`
        );
        const workflowItems: VerticalTimelineItem[] = [
          {
            time: "流程 1",
            title: "硬件Committer检视",
            body: `硬件 MDE：${getUserName(state.users, selected.workflowAssignees?.hardwareCommitterId)}。`
          },
          {
            time: "流程 2",
            title: "软件Committer检视",
            body: `软件 MDE：${getUserName(state.users, selected.workflowAssignees?.softwareCommitterId)}。`
          },
          {
            time: "流程 3",
            title: "软件User合入",
            body: softwareUserBody
          }
        ];
        const currentWorkflowIndex = workflowItems.findIndex((item) => item.title === selected.status);
        if (currentWorkflowIndex === -1) {
          return [
            {
              time: "当前",
              title: selected.status,
              body: selected.rejectReason ?? `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
              isCurrent: true,
              marker: "当前流程"
            },
            ...workflowItems
          ];
        }

        return workflowItems.map((item, index) =>
          index === currentWorkflowIndex
            ? {
                ...item,
                body: `当前处理人：${getUserName(state.users, selected.assignedTo)}。`,
                isCurrent: true,
                marker: "当前流程"
              }
            : item
        );
      })()
    : [];

  return (
    <WorkbenchLayout
      title={reviewPageTitle}
      hideHeader
    >
      <section className="review-queue">
        <div className="review-queue-header">
          <PanelHeader
            title={
              <div className="review-view-tabs" role="tablist" aria-label="审阅视角">
                {[
                  { mode: "pending" as const, label: "待审阅", count: pendingRequests.length + pendingInitializationRows.length },
                  { mode: "history" as const, label: "历史审阅", count: historyRequests.length + historyInitializationRows.length }
                ].map((item) => (
                  <button
                    className={reviewMode === item.mode ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-label={item.label}
                    aria-selected={reviewMode === item.mode}
                    key={item.mode}
                    onClick={() => selectReviewMode(item.mode)}
                  >
                    {item.label}
                    <span>{item.count}</span>
                  </button>
                ))}
              </div>
            }
            meta={reviewMeta}
          />
        </div>
        <div className="table-wrap review-table-wrap">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>项目</span>
                    <ColumnFilter
                      label="项目"
                      groupLabel="项目筛选"
                      values={projectOptions.map((project) => project.name)}
                      selectedValues={filterProjects}
                      onToggle={(project) => setFilterProjects((current) => toggleFilterValue(current, project))}
                      onClear={() => setFilterProjects([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>模块</span>
                    <ColumnFilter
                      label="模块"
                      groupLabel="模块筛选"
                      values={modules}
                      selectedValues={filterModules}
                      onToggle={(module) => setFilterModules((current) => toggleFilterValue(current, module))}
                      onClear={() => setFilterModules([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>提交人</span>
                    <ColumnFilter
                      label="提交人"
                      groupLabel="提交人筛选"
                      values={submitters}
                      selectedValues={filterSubmitters}
                      onToggle={(submitter) => setFilterSubmitters((current) => toggleFilterValue(current, submitter))}
                      onClear={() => setFilterSubmitters([])}
                    />
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>变更</span>
                  </div>
                </TableHead>
                <TableHead className="review-filter-header">
                  <div className="review-column-filter-head">
                    <span>状态</span>
                    <ColumnFilter
                      label="状态"
                      groupLabel="状态筛选"
                      values={statusOptions}
                      selectedValues={filterStatuses}
                      onToggle={(status) => setFilterStatuses((current) => toggleFilterValue(current, status))}
                      onClear={() => setFilterStatuses([])}
                    />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewRows.map((row) => {
                if (row.kind === "initialization") {
                  return (
                    <TableRow
                      className={row.review.id === selectedInitialization?.review.id ? "selected-row" : ""}
                      key={row.review.id}
                      onClick={() => setSelectedId(row.review.id)}
                    >
                      <TableCell>{row.draft.projectName}</TableCell>
                      <TableCell>参数初始化</TableCell>
                      <TableCell>{state.users.find((user) => user.id === row.review.submittedBy)?.name ?? row.review.submittedBy}</TableCell>
                      <TableCell className="change-cell">
                        <button
                          className="value-change value-change-button"
                          type="button"
                          aria-label={`查看 ${row.draft.projectName} 初始化详情`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(row.review.id);
                          }}
                        >
                          <strong>{row.draft.projectName}</strong>
                          <ArrowRight size={14} />
                          <span>{row.draft.parameterSnapshots.length} 项参数</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={getParameterInitializationReviewStatusLabel(row.review.status)} />
                      </TableCell>
                    </TableRow>
                  );
                }

                const { request } = row;
                const parameter = state.parameters.find((item) => item.id === request.parameterId);
                const project = state.configDraft.projects.find((item) => item.id === (request.projectId ?? parameter?.projectId));
                const isComplexReviewChange = shouldSummarizeReviewChange(request, parameter);

                return (
                  <TableRow
                    className={request.id === selected?.id ? "selected-row" : ""}
                    key={request.id}
                    onClick={() => setSelectedId(request.id)}
                  >
                    <TableCell>{project?.name ?? request.projectId ?? parameter?.projectId ?? "未关联项目"}</TableCell>
                    <TableCell>{request.module}</TableCell>
                    <TableCell>{request.submitter}</TableCell>
                    <TableCell className="change-cell">
                      <button
                        className={[
                          "value-change",
                          "value-change-button",
                          isComplexReviewChange ? "value-change-button--complex" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        aria-label={`查看 ${request.title} 提交详情`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openSubmissionDetail(request);
                        }}
                      >
                        {isComplexReviewChange ? (
                          <ReviewChangeValueSummary layout="complex" parameter={parameter} request={request} />
                        ) : (
                          <>
                            <span className="value-change__title">{request.title}</span>
                            <ReviewChangeValueSummary parameter={parameter} request={request} />
                          </>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={request.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {reviewRows.length === 0 ? <EmptyStateCard text="当前筛选条件下没有数据。" /> : null}
        </div>
      </section>
      <aside className="review-detail" aria-label="审阅详情">
        {selectedInitialization ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">参数初始化</span>
              <h2>参数初始化</h2>
              <p>
                {selectedInitialization.draft.projectName} 初始化由 {selectedInitializationSubmitter} 提交。
              </p>
            </div>
            <div className="ai-summary-card">
              <SectionLabel icon={<Sparkles size={16} />} label="初始化摘要" />
              <p>项目：{selectedInitialization.draft.projectName}</p>
              <p>
                主来源：{selectedInitializationPrimarySource?.name ?? selectedInitialization.draft.primarySourceProjectId}
              </p>
              <p>已选参数：{selectedInitialization.draft.parameterSnapshots.length}</p>
              <p>补充来源填充：{selectedInitializationSupplementCount}</p>
              <p>需确认推荐值：{selectedInitializationConfirmationCount}</p>
            </div>
            {selectedInitialization.review.rejectionReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="驳回原因" />
                <p>{selectedInitialization.review.rejectionReason}</p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="初始化状态" />
              <VerticalTimeline
                items={[
                  {
                    time: "当前",
                    title: getParameterInitializationReviewStatusLabel(selectedInitialization.review.status),
                    body: selectedInitialization.review.rejectionReason ?? "等待参数管理员处理。",
                    isCurrent: selectedInitialization.review.status === "pending",
                    marker: selectedInitialization.review.status === "pending" ? "当前流程" : undefined
                  },
                  {
                    time: "已提交",
                    title: selectedInitialization.review.submittedAt,
                    body: selectedInitialization.draft.notes || "已从来源项目推荐值生成初始化快照。"
                  }
                ]}
              />
            </div>
            {selectedInitialization.review.status === "pending" ? (
              <div className="action-panel">
                <Button
                  className="full"
                  type="button"
                  onClick={() => {
                    void (async () => {
                      if (!selectedInitialization) {
                        return;
                      }
                      if (runtimeMode === "api" && parameterInitializationRepository) {
                        try {
                          const review = await parameterInitializationRepository.approve(
                            selectedInitialization.review.id
                          );
                          dispatch({
                            type: "APPROVE_PARAMETER_INITIALIZATION",
                            reviewId: review.id
                          });
                          dispatch({
                            type: "HYDRATE_PROJECT_INITIALIZATION_STATUS",
                            projectId: review.projectId,
                            status: "initialized"
                          });
                        } catch (error) {
                          const message = error instanceof Error ? error.message : "参数初始化通过失败";
                          dispatch({ type: "ADD_NOTIFICATION", message });
                        }
                        return;
                      }
                      dispatch({
                        type: "APPROVE_PARAMETER_INITIALIZATION",
                        reviewId: selectedInitialization.review.id
                      });
                    })();
                  }}
                >
                  <CheckCircle2 size={17} />
                  通过初始化
                </Button>
                <Button className="full" type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                  <CircleOff size={17} />
                  驳回初始化
                </Button>
              </div>
            ) : null}
          </>
        ) : selected ? (
          <>
            <div className="ai-summary-card review-detail-hero">
              <div className="review-detail-hero__header">
                <span className="eyebrow">{selectedProjectName}</span>
                <h2>{selected.title}</h2>
                <p className="review-detail-hero__meta">
                  目标模块 <strong>{selected.module}</strong>
                  <span aria-hidden="true"> · </span>
                  {selected.submitter} 提交
                </p>
              </div>
              <SectionLabel icon={<Sparkles size={16} />} label="审阅摘要" />
              <ReviewDetailSummary
                onOpenSubmissionDetail={() => openSubmissionDetail(selected)}
                parameter={selectedReviewParameter}
                request={selected}
                moduleName={selected.module}
                moduleDescription={selectedModuleDescription}
                parameterDescription={selectedParameterDescription}
              />
              {selectedDetailRound ? (
                <Button
                  variant="outline"
                  type="button"
                  className="full review-detail-hero__detail-action"
                  onClick={() => openSubmissionDetail(selected)}
                >
                  <FileText size={16} />
                  查看提交详情（{selectedDetailRound.items.length} 项变更）
                </Button>
              ) : null}
            </div>
            {selected.rejectReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="打回原因" />
                <p>{selected.rejectReason}</p>
              </div>
            ) : null}
            {mergeUrl ? (
              <div className="merge-link-card">
                <SectionLabel icon={<Link2 size={16} />} label="合入链接" />
                <p>
                  <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
                    {mergeUrl}
                  </a>
                </p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="变更历史" />
              <VerticalTimeline items={selectedWorkflowItems} />
            </div>
            {reviewMode === "pending" && canActOnSelectedReview ? (
              <div className="action-panel">
                {selected.status === "软件User合入" ? (
                  <div className="review-merge-link">
                    <label htmlFor="review-merge-link">合入链接</label>
                    <input
                      id="review-merge-link"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://"
                      value={mergeLink}
                      onChange={(event) => setMergeLink(event.target.value)}
                      aria-invalid={mergeLink.trim().length > 0 && !isValidMergeLink(mergeLink)}
                    />
                    {mergeLink.trim().length > 0 && !isValidMergeLink(mergeLink) ? (
                      <span className="review-merge-link__hint" role="status">
                        请输入有效的 http(s) 合入链接
                      </span>
                    ) : (
                      <span className="review-merge-link__hint">确认合入前必须填写可访问的合入链接</span>
                    )}
                  </div>
                ) : null}
                <Button
                  className="full"
                  type="button"
                  disabled={selected.status === "软件User合入" && !isValidMergeLink(mergeLink)}
                  onClick={() => void advanceSelected()}
                >
                  <CheckCircle2 size={17} />
                  {canPerform(reviewerRoleId, "parameter.merge") && !canPerform(reviewerRoleId, "parameter.review")
                    ? "确认合入"
                    : "推进流程"}
                </Button>
                {canRejectSelectedReview ? (
                  <Button className="full" type="button" variant="destructive" onClick={() => setRejectOpen(true)}>
                    <CircleOff size={17} />
                    打回修改
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyStateCard text={reviewMode === "history" ? "当前没有历史审阅。" : "当前没有待审阅请求。"} />
        )}
      </aside>
      {rejectOpen && (selected || selectedInitialization) ? (
        <RejectReviewDialog
          onCancel={() => setRejectOpen(false)}
          onSubmit={rejectSelected}
        />
      ) : null}
      {detailOpen && selectedDetailRound ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submission-detail-title">
          <div
            className={[
              "submission-dialog",
              selectedDetailRound.items.some(isComplexSubmissionHistoryItem) ? "submission-dialog--wide" : "",
              "submission-detail-dialog"
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="submission-dialog-head">
              <div>
                <span className="eyebrow">{selectedDetailRound.projectName}</span>
                <h2 id="submission-detail-title">提交详情</h2>
                <p>本轮提交包含 {selectedDetailRound.items.length} 个参数修改，由 {selectedDetailRound.submitter} 提交。</p>
                {shouldShowSubmissionRoundSummary(selectedDetailRound) ? <p>{selectedDetailRound.summary}</p> : null}
              </div>
            </div>
            <div className="submission-diff-list">
              {selectedDetailRound.items.map((item) => <SubmissionHistoryDiffCard item={item} key={item.requestId} />)}
            </div>
            <div className="dialog-actions">
              <button className="button subtle" type="button" onClick={() => setDetailOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  onCancel,
  onSubmit
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();
  const submitRejection = () => {
    if (trimmedReason) {
      onSubmit(trimmedReason);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent className="rejection-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>打回修改</AlertDialogTitle>
          <AlertDialogDescription>
            将这项修改打回给提交人，管理员需要填写明确原因，方便项目侧补充测试数据或重新调整目标值。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Label htmlFor="reject-reason">打回原因</Label>
        <Textarea
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          placeholder="说明需要补充的测试数据、风险依据或参数调整方向"
        />
        <AlertDialogFooter className="dialog-actions">
          <AlertDialogCancel type="button" onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={!trimmedReason} onClick={submitRejection}>
            提交打回
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
