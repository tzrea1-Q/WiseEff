import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DtsReleaseReadinessIssue,
  DtsConfigSetMemberFile,
  DtsSearchHit,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { CanonicalMemberRemovalSubmitDialog } from "@/features/parameter-review/CanonicalMemberRemovalSubmitDialog";
import { CanonicalBatchSubmitDialog } from "@/features/parameter-review/CanonicalBatchSubmitDialog";
import { permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";
import type {
  ParameterFileRepository,
  ParameterFileSourceWorkflow,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";
import { useToast } from "@/components/common/toast/ToastProvider";
import { presentError } from "@/infrastructure/http/presentError";
import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";
import {
  presentWorkbenchActivity,
  workbenchActivityApps
} from "./workbenchActivityModel";
import { WorkbenchCommandBar } from "./WorkbenchCommandBar";
import { WorkbenchBaselineDialogs } from "./WorkbenchBaselineDialogs";
import { WorkbenchCandidateActivateDialog } from "./WorkbenchCandidateActivateDialog";
import { WorkbenchCandidateSourceReviewDialog } from "./WorkbenchCandidateSourceReviewDialog";
import { WorkbenchSourceRollbackDialog } from "./WorkbenchSourceRollbackDialog";
import { WorkbenchCanonicalManualSyncDialog } from "./WorkbenchCanonicalManualSyncDialog";
import type { createCanonicalBatchRollbackClient } from "@/infrastructure/http/canonicalBatchRollbackClient";
import type { createCanonicalManualSyncClient } from "@/infrastructure/http/canonicalManualSyncClient";
import { WorkbenchShellChrome } from "./WorkbenchShellChrome";
import { isCriticalDtsNodePath } from "@/components/parameters/dtsCriticalPath";
import type { StructuredValueChange } from "@/components/parameters/StructuredValueEditor";
import {
  buildUnifiedDiff,
  canvasModeQueryValue,
  parseCanvasMode,
  resolveInspectorLevel,
  shouldPersistInspector,
  type InspectorLevel,
  type WorkbenchCanvasMode
} from "./workbenchInspectorModel";
import { WorkbenchInspectorPanel } from "./WorkbenchInspectorPanel";
import { WorkbenchRevisionGate } from "./WorkbenchRevisionGate";
import { WorkbenchSourceCanvas } from "./WorkbenchSourceCanvas";
import { WorkbenchSourceTree } from "./WorkbenchSourceTree";
import { WorkbenchSetupGate } from "./WorkbenchSetupGate";
import { resolveParamAdminProjectsReturnPath } from "@/hooks/useParamAdminProjectsSearch";
import { WorkbenchConflictArbitrationDock } from "./WorkbenchConflictArbitrationDock";
import { WorkbenchTaskDock } from "./WorkbenchTaskDock";
import {
  formatWorkbenchPath,
  locatorToFocusSpan,
  nearestNodeForLine,
  queryValue,
  type PendingConfirmation
} from "./workbenchShellHelpers";
import {
  sessionDraftKey
} from "@/application/project-configuration/sessionDrafts";
import {
  type SessionDraftScope
} from "@/application/project-configuration/sessionDraftStorage";
import { useStructuredEditSession } from "@/application/project-configuration/useStructuredEditSession";
import { useCandidateVersionFlow } from "@/application/project-configuration/useCandidateVersionFlow";
import { useReleaseBaselineSession } from "@/application/project-configuration/useReleaseBaselineSession";
import { useConfigRevisionGateSession } from "@/application/project-configuration/useConfigRevisionGateSession";
import { useConflictLocateFacade } from "@/application/project-configuration/useConflictLocateFacade";
import { useConfigSetOpsSession } from "@/application/project-configuration/useConfigSetOpsSession";
import { useWorkbenchNavigationSession } from "@/application/project-configuration/useWorkbenchNavigationSession";
import { useWorkbenchWorkspaceLoadSession } from "@/application/project-configuration/useWorkbenchWorkspaceLoadSession";
import { useWorkbenchCanvasHistorySession } from "@/application/project-configuration/useWorkbenchCanvasHistorySession";
import { useWorkbenchActivitySession } from "@/application/project-configuration/useWorkbenchActivitySession";
import {
  buildWorkbenchActivityCatalog,
  navigateWorkbenchActivityEvent
} from "@/application/project-configuration/workbenchActivityNavigation";
import { useWorkbenchBaselineOrchestration } from "@/application/project-configuration/useWorkbenchBaselineOrchestration";
import { useWorkbenchCanvasOps } from "@/application/project-configuration/useWorkbenchCanvasOps";
import { useWorkbenchCandidateOrchestration } from "@/application/project-configuration/useWorkbenchCandidateOrchestration";
import { useWorkbenchConfigSetOrchestration } from "@/application/project-configuration/useWorkbenchConfigSetOrchestration";
import { useWorkbenchKeyboardShortcuts } from "@/application/project-configuration/useWorkbenchKeyboardShortcuts";
import "./configuration-workbench.css";

export type ProjectConfigurationWorkbenchProject = {
  id: string;
  name: string;
  code: string;
  statusLabel: string;
};

export type ProjectConfigurationWorkbenchProps = {
  project: ProjectConfigurationWorkbenchProject;
  search: string;
  onNavigate: (path: string) => void;
  dtsRepository: DtsStructuredRepository;
  fileRepository: ParameterFileRepository;
  batchRollbackClient?: ReturnType<typeof createCanonicalBatchRollbackClient>;
  manualSyncClient?: ReturnType<typeof createCanonicalManualSyncClient>;
  /** When false, typed editors stay readable but write/submit stay locked. Defaults to true for tests. */
  canEdit?: boolean;
  /** When false, regulator/thermal critical nodes stay readable but write stays locked. Defaults to true. */
  canEditCritical?: boolean;
  /** When false, mutations are denied but read context stays visible. Defaults true for back-compat. */
  canAdmin?: boolean;
  /** Required AuditQuery.listAuditEvents — workbench must not construct audit HTTP clients. */
  listAuditEvents: (params?: ListAuditEventsParams) => Promise<AuditEventListResponse>;
  /** Authenticated user for draft scoping. Defaults to "local-user" for back-compat tests. */
  currentUserId?: string;
  memberRemovalRepository?: ParameterCatalogRepository;
  apiMode?: boolean;
  /** Optional org override; prefer selectedConfigSet.organizationId at runtime. */
  organizationId?: string;
  /** Injectable storage for recoverable session drafts (tests / non-DOM). */
  draftStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /**
   * Optional topology seam for config-set revision list/select/validate.
   * Omit in unit tests that do not exercise the gate; the operations surface must pass it.
   */
  topologyRepository?: Pick<
    ParameterTopologyRepository,
    "listConfigRevisions" | "validateRevision" | "listBindings" | "createBindingDraft"
  >;
};

export function ProjectConfigurationWorkbench({
  project,
  search,
  onNavigate,
  dtsRepository,
  fileRepository,
  batchRollbackClient,
  manualSyncClient,
  canEdit = true,
  canEditCritical = true,
  canAdmin = true,
  listAuditEvents,
  currentUserId = "local-user",
  memberRemovalRepository,
  apiMode = false,
  organizationId,
  draftStorage,
  topologyRepository
}: ProjectConfigurationWorkbenchProps) {
  const { toast } = useToast();
  const [memberRemovalTarget, setMemberRemovalTarget] = useState<DtsConfigSetMemberFile | null>(null);
  const [manualSyncTarget, setManualSyncTarget] = useState<{
    member: DtsConfigSetMemberFile; currentVersionId: string; workflowProofToken: string
  } | null>(null);
  const showToast = useCallback((message: string) => toast({ tone: "success", message }), [toast]);
  const {
    session: workspaceLoadSession,
    configSets,
    projectFiles,
    members,
    membersBoundConfigSetId,
    source,
    configSetsLoading,
    filesLoading,
    membersLoading,
    sourceLoading,
    configSetsError,
    filesError,
    membersError,
    sourceError,
    configRetry,
    filesRetry,
    membersRetry,
    sourceRetry,
    structureNodes,
    structureLoading,
    structureError,
    structureRetry
  } = useWorkbenchWorkspaceLoadSession();
  const {
    session: releaseBaselineSession,
    baselines,
    baselinesLoading,
    baselinesError,
    readiness: releaseReadiness,
    readinessLoading,
    readinessError,
    acknowledgedWarningIds,
    selectedBaselineId,
    pinnedMembers: baselinePinnedMembers,
    compareResult: baselineCompare,
    compareAgainst: baselineCompareAgainst,
    restorePreview,
    actionError: baselineActionError,
    releasedTip: releasedBaseline
  } = useReleaseBaselineSession();
  const revisionGate = useConfigRevisionGateSession();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPersistent, setInspectorPersistent] = useState(false);
  const [inspectorLevelOverride, setInspectorLevelOverride] = useState<InspectorLevel | null>(null);
  const [fileVersions, setFileVersions] = useState<ProjectParameterFileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [versionsReloadToken, setVersionsReloadToken] = useState(0);
  const [sourceWorkflowsByFileId, setSourceWorkflowsByFileId] = useState<
    Record<string, ParameterFileSourceWorkflow>
  >({});
  const [sourceWorkflowErrorsByFileId, setSourceWorkflowErrorsByFileId] = useState<
    Record<string, string>
  >({});
  const [sourceWorkflowLoading, setSourceWorkflowLoading] = useState(false);
  const [sourceWorkflowReloadToken, setSourceWorkflowReloadToken] = useState(0);
  const [rollbackReviewVersion, setRollbackReviewVersion] = useState<ProjectParameterFileVersion | null>(null);
  const [rollbackBatchContext, setRollbackBatchContext] = useState<{
    fileId: string; currentVersionId: string; workflowProofToken: string
  } | null>(null);
  const [rollbackReviewPending, setRollbackReviewPending] = useState(false);
  const [rollbackReviewError, setRollbackReviewError] = useState("");
  const {
    flow: candidateFlow,
    candidate: activeCandidate,
    sourceText: candidateSource,
    loading: candidateLoading,
    uploading: uploadingCandidate,
    activating: activatingCandidate,
    error: candidateError,
    activateError,
    sourcePreview,
    sourcePreviewLoading,
    sourcePreviewError,
    submittingSourceReview,
    sourceReviewError,
    sourceReviewResult,
    activateRole,
    canActivate,
    canSubmitSourceReview,
    canRecompute,
    canAbandon
  } = useCandidateVersionFlow();
  const {
    session: activitySession,
    activityEvents,
    activityLoading,
    activityError,
    activityMissingNotice,
    activityRefreshToken,
    knownCandidateIds
  } = useWorkbenchActivitySession();
  const activityRows = useMemo(
    () => activityEvents.map(presentWorkbenchActivity),
    [activityEvents]
  );
  const candidateFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastVisibleLine, setLastVisibleLine] = useState<number | null>(null);
  const [restoredScrollLine, setRestoredScrollLine] = useState<number | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [draftCopyStatus, setDraftCopyStatus] = useState("");
  const draftCopyFallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionDraftStorage = draftStorage ?? localStorage;
  const {
    session: structuredEditSession,
    drafts: sessionDrafts,
    selectedKeys: selectedDraftKeys,
    reason: submitReason,
    recoveryStatus: draftRecoveryStatus,
    validateStatus,
    submitError,
    submitStatus,
    stagedDrafts,
    submitting: submittingEdits,
    rows: sessionDraftRows,
    isDirty: sessionDraftsDirty,
    isStaleBase: staleDraftLocked
  } = useStructuredEditSession({
    storage: sessionDraftStorage,
    onDraftsRecovered: () => setTasksOpen(true)
  });
  const [narrowViewport, setNarrowViewport] = useState(false);
  const [findNextToken, setFindNextToken] = useState(0);
  const [focusLineOverride, setFocusLineOverride] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const treeRegionRef = useRef<HTMLElement | null>(null);
  const workbenchBodyRef = useRef<HTMLElement | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const {
    facade: conflictLocateFacade,
    conflicts: syncConflicts,
    loading: conflictsLoading,
    error: conflictsError
  } = useConflictLocateFacade();
  const {
    session: configSetOpsSession,
    lastError: opsError,
    lastMessage: opsMessage
  } = useConfigSetOpsSession();
  const {
    session: navigationSession,
    selectedNodePath,
    selectedPropertyName,
    searchDraft,
    searchHits,
    searchError,
    searchLoading,
    findQuery,
    pendingFocusLine,
    suppressScrollSync
  } = useWorkbenchNavigationSession();
  const {
    session: canvasHistorySession,
    historySource,
    historySourceAvailable,
    compareSource,
    modeSourceLoading,
    modeSourceError,
    workingSnapshot
  } = useWorkbenchCanvasHistorySession();
  const sourceRegionRef = useRef<HTMLElement | null>(null);
  const scrollSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 768px)");
    const syncViewport = () => {
      const narrow = media.matches;
      setNarrowViewport(narrow);
    };
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    void workspaceLoadSession.loadConfigSets(project.id, dtsRepository);
  }, [configRetry, dtsRepository, project.id, workspaceLoadSession]);

  useEffect(() => {
    void workspaceLoadSession.loadProjectFiles(project.id, fileRepository);
  }, [fileRepository, filesRetry, project.id, workspaceLoadSession]);

  useEffect(() => {
    void conflictLocateFacade.load(project.id, fileRepository);
  }, [conflictLocateFacade, fileRepository, filesRetry, project.id]);

  const selectedConfigSet = useMemo(
    () => navigationSession.resolveSelectedConfigSet({ search, configSets }),
    [configSets, navigationSession, search]
  );

  useEffect(() => {
    void workspaceLoadSession.loadMembers(project.id, selectedConfigSet?.id ?? null, dtsRepository);
  }, [dtsRepository, membersRetry, project.id, selectedConfigSet, workspaceLoadSession]);

  useEffect(() => {
    if (!topologyRepository) return;
    void revisionGate.session.load(project.id, selectedConfigSet?.id ?? null, topologyRepository);
  }, [project.id, revisionGate.session, selectedConfigSet?.id, topologyRepository]);

  const selectedMembers = useMemo(() => {
    if (!selectedConfigSet) return [];
    const filesById = new Map(projectFiles.map((file) => [file.id, file]));

    return members
      .filter((item) => item.configSetId === selectedConfigSet.id)
      .map((item) => {
        const file = filesById.get(item.fileId);
        return {
          ...item,
          fileName: file?.fileName ?? item.fileName,
          format: file?.format ?? item.format,
          currentVersionId: item.currentVersionId ?? file?.currentVersionId,
          currentVersionNumber: item.currentVersionNumber ?? file?.currentVersionNumber
        };
      });
  }, [members, projectFiles, selectedConfigSet]);

  const membersListLoading =
    membersLoading ||
    (selectedConfigSet != null && membersBoundConfigSetId !== selectedConfigSet.id);

  const sourceWorkflowMemberVersionKey = selectedMembers
    .map((member) => `${member.fileId}:${member.currentVersionId ?? ""}`)
    .join("|");

  const selectedMember = useMemo(
    () =>
      navigationSession.resolveSelectedMember(
        {
          search,
          projectId: project.id,
          configSets,
          selectedMembers,
          projectFiles,
          membersLoading: membersListLoading,
          membersError
        },
        selectedConfigSet
      ),
    [
      configSets,
      membersError,
      membersListLoading,
      navigationSession,
      project.id,
      projectFiles,
      search,
      selectedConfigSet,
      selectedMembers
    ]
  );

  const selectedMemberFileId = selectedMember?.fileId ?? null;
  const selectedMemberVersionId = selectedMember?.currentVersionId ?? null;

  const canvasMode: WorkbenchCanvasMode = parseCanvasMode(queryValue(search, "sourceMode"));
  const requestedTab = queryValue(search, "tab");
  const contentTab = requestedTab === "structure" || requestedTab === "conflicts" ? requestedTab
    : requestedTab === "source" ? "source"
    : queryValue(search, "tasks") === "conflicts" || queryValue(search, "dock") === "conflicts" ? "conflicts" : "source";
  const canvasSearchParams = new URLSearchParams(search);
  if (contentTab !== "source") canvasSearchParams.set("tab", "source");
  const canvasSearch = canvasSearchParams.toString();
  const selectContentTab = (tab: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", tab);
    onNavigate(`/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${params.toString()}`);
  };

  useEffect(() => {
    const body = workbenchBodyRef.current?.querySelector(".navigator-workbench__body");
    const navigator = body?.querySelector(".navigator-workbench__navigator");
    if (!body || !navigator) return;
    const measure = () => setInspectorPersistent(shouldPersistInspector({
      workbenchWidth: body.getBoundingClientRect().width,
      treeWidth: navigator.getBoundingClientRect().width + 2 * (Number.parseFloat(getComputedStyle(body).columnGap) || 0)
    }));
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(body);
    observer?.observe(navigator);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [selectedConfigSet?.id]);
  const candidateId = queryValue(search, "candidate");
  const historyVersionId = queryValue(search, "version");

  const derivedInspectorLevel = resolveInspectorLevel({
    fileSelected: Boolean(selectedMember),
    nodePath: selectedNodePath,
    propertyName: selectedPropertyName
  });
  const inspectorLevel: InspectorLevel =
    inspectorLevelOverride === "activity"
      ? "activity"
      : inspectorLevelOverride &&
          // Allow temporary config-set focus while a file remains selected in the source canvas.
          (inspectorLevelOverride === "config-set" ||
            inspectorLevelOverride === derivedInspectorLevel ||
            (inspectorLevelOverride === "file" && derivedInspectorLevel !== "config-set") ||
            (inspectorLevelOverride === "node" &&
              (derivedInspectorLevel === "node" || derivedInspectorLevel === "property")))
        ? inspectorLevelOverride
        : derivedInspectorLevel;

  useEffect(() => {
    setInspectorLevelOverride(null);
  }, [selectedMember?.fileId, selectedNodePath, selectedPropertyName]);

  useEffect(() => {
    const inspector = queryValue(search, "inspector");
    if (inspector === "activity") {
      setInspectorLevelOverride("activity");
      setInspectorOpen(true);
      return;
    }
    if (inspector === "file") {
      setInspectorLevelOverride("file");
      setInspectorOpen(true);
      return;
    }
    if (inspector === "config-set") {
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
    }
    // Re-apply when the default member appears; the clear-override effect above would
    // otherwise drop cutover `inspector=` before assertions/navigation settle.
  }, [search, selectedMember?.fileId]);

  useEffect(() => {
    const tasks = queryValue(search, "tasks");
    const dock = queryValue(search, "dock");
    if (tasks === "conflicts" || dock === "conflicts") {
      setTasksOpen(true);
    }
  }, [search]);

  useEffect(() => {
    if (!selectedMember || (!inspectorOpen && canvasMode !== "unified-diff" && canvasMode !== "side-by-side")) {
      setFileVersions([]);
      setVersionsError("");
      setVersionsLoading(false);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError("");
    void fileRepository
      .listVersions(project.id, selectedMember.fileId)
      .then((items) => {
        if (!cancelled) {
          setFileVersions(
            [...items].sort((left, right) => right.versionNumber - left.versionNumber)
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFileVersions([]);
          setVersionsError(presentError(error, "版本历史加载失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canvasMode, fileRepository, inspectorOpen, project.id, selectedMember, versionsReloadToken]);

  useEffect(() => {
    if (filesLoading) {
      setSourceWorkflowsByFileId({});
      setSourceWorkflowErrorsByFileId({});
      setSourceWorkflowLoading(true);
      return;
    }
    const fileIds = projectFiles.map((file) => file.id);
    if (fileIds.length === 0) {
      setSourceWorkflowsByFileId({});
      setSourceWorkflowErrorsByFileId({});
      setSourceWorkflowLoading(false);
      return;
    }
    let cancelled = false;
    setSourceWorkflowsByFileId({});
    setSourceWorkflowErrorsByFileId({});
    setSourceWorkflowLoading(true);
    void (async () => {
      const workflows: Record<string, ParameterFileSourceWorkflow> = {};
      const errors: Record<string, string> = {};
      // Keep the refresh deterministic so every project file gets one proof snapshot.
      for (const fileId of fileIds) {
        try {
          workflows[fileId] = await fileRepository.getSourceWorkflow(project.id, fileId);
        } catch (error: unknown) {
          errors[fileId] = presentError(error, "来源工作流加载失败，已禁用受保护操作。");
        }
      }
      if (cancelled) return;
      setSourceWorkflowsByFileId(workflows);
      setSourceWorkflowErrorsByFileId(errors);
      setSourceWorkflowLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    fileRepository,
    filesLoading,
    membersRetry,
    project.id,
    projectFiles,
    selectedConfigSet?.id,
    sourceWorkflowMemberVersionKey,
    sourceWorkflowReloadToken
  ]);

  const sourceWorkflow = selectedMember
    ? sourceWorkflowsByFileId[selectedMember.fileId] ?? null
    : null;
  const sourceWorkflowError = selectedMember
    ? sourceWorkflowErrorsByFileId[selectedMember.fileId] ?? ""
    : "";
  const legacySourceWorkflowConfirmed =
    Boolean(sourceWorkflow) &&
    sourceWorkflow?.canonical === false &&
    !sourceWorkflowLoading &&
    !sourceWorkflowError;
  const sourceWorkflowByFileId = useMemo(() => {
    const result: Record<string, ParameterFileSourceWorkflow | null> = {};
    for (const file of projectFiles) {
      result[file.id] = sourceWorkflowsByFileId[file.id] ?? null;
    }
    return result;
  }, [projectFiles, sourceWorkflowsByFileId]);
  const sourceWorkflowSetCanonical = selectedMembers.some(
    (member) => sourceWorkflowsByFileId[member.fileId]?.canonical === true
  );
  const sourceWorkflowSetError = selectedMembers
    .map((member) => sourceWorkflowErrorsByFileId[member.fileId])
    .find(Boolean) ?? "";
  const sourceWorkflowSetReady =
    !membersListLoading &&
    !filesLoading &&
    !sourceWorkflowLoading &&
    selectedMembers.every(
      (member) =>
        Boolean(sourceWorkflowsByFileId[member.fileId]) ||
        Boolean(sourceWorkflowErrorsByFileId[member.fileId])
    ) &&
    !sourceWorkflowSetError;
  const memberAddErrorsByFileId = Object.fromEntries(projectFiles.map((file) => [file.id,
    sourceWorkflowErrorsByFileId[file.id] || (sourceWorkflowsByFileId[file.id]?.canonical === false
      ? "" : sourceWorkflowsByFileId[file.id]?.canonical
        ? "此文件的成员变更需要审核，不能直接编入配置集。"
        : "正在校验文件来源，请稍候。")
  ]));
  const sourceWorkflowSetLoading =
    sourceWorkflowLoading || filesLoading || membersListLoading;
  const canRequestReviewedMemberRemoval = apiMode && selectedMembers.length >= 2
    && selectedMembers.every((member) => member.format === "json"
      && sourceWorkflowsByFileId[member.fileId]?.canonical === true);
  useEffect(() => {
    if (
      canvasMode !== "working" &&
      canvasMode !== "candidate" &&
      selectedMember &&
      historyVersionId &&
      !workingSnapshot
    ) {
      canvasHistorySession.rememberWorkingSnapshot({
        fileId: selectedMember.fileId,
        nodePath: selectedNodePath,
        propertyName: selectedPropertyName,
        scrollLine: lastVisibleLine,
        sourceMode: null
      });
    }
  }, [
    canvasHistorySession,
    canvasMode,
    historyVersionId,
    lastVisibleLine,
    selectedMember,
    selectedNodePath,
    selectedPropertyName,
    workingSnapshot
  ]);

  useEffect(() => {
    void canvasHistorySession.loadModeSource({
      canvasMode,
      projectId: project.id,
      fileId: selectedMember?.fileId ?? null,
      versionId: historyVersionId,
      currentVersionId: selectedMember?.currentVersionId ?? null,
      workingSource: source,
      repo: fileRepository
    });
  }, [
    canvasHistorySession,
    canvasMode,
    fileRepository,
    historyVersionId,
    project.id,
    selectedMember,
    source
  ]);

  useEffect(() => {
    if (canvasMode !== "candidate" || !candidateId) {
      if (canvasMode !== "candidate") {
        candidateFlow.leaveCanvas();
      }
      return;
    }
    void candidateFlow.load(project.id, candidateId, fileRepository);
  }, [candidateFlow, candidateId, canvasMode, fileRepository, project.id]);

  useEffect(() => {
    const path = navigationSession.applyConfigSetUrl({
      projectId: project.id,
      search,
      configSetsLoading,
      selectedConfigSet
    });
    if (path) onNavigate(path);
  }, [configSetsLoading, navigationSession, onNavigate, project.id, search, selectedConfigSet]);

  useEffect(() => {
    const path = navigationSession.applyFileUrl({
      projectId: project.id,
      search,
      membersLoading: membersListLoading,
      filesLoading,
      selectedConfigSet,
      selectedMemberFileId,
      selectedMembers,
      projectFiles
    });
    if (path) onNavigate(path);
  }, [
    filesLoading,
    membersListLoading,
    navigationSession,
    onNavigate,
    project.id,
    projectFiles,
    search,
    selectedConfigSet,
    selectedMemberFileId,
    selectedMembers
  ]);

  useEffect(() => {
    void workspaceLoadSession.loadSource(
      project.id,
      selectedMemberFileId,
      selectedMemberVersionId,
      fileRepository
    );
  }, [
    fileRepository,
    project.id,
    selectedMemberFileId,
    selectedMemberVersionId,
    sourceRetry,
    workspaceLoadSession
  ]);

  useEffect(() => {
    void workspaceLoadSession.loadStructure(
      project.id,
      selectedMemberFileId,
      selectedMemberVersionId,
      dtsRepository
    );
  }, [
    dtsRepository,
    project.id,
    selectedMemberFileId,
    selectedMemberVersionId,
    structureRetry,
    workspaceLoadSession
  ]);

  useEffect(() => {
    navigationSession.applyNodePropertyFromUrl({
      search,
      structureNodes,
      structureLoading,
      structureError
    });
  }, [navigationSession, search, structureError, structureLoading, structureNodes]);

  useEffect(() => {
    const line = navigationSession.consumePendingFocusLine();
    if (line != null) setFocusLineOverride(line);
  }, [navigationSession, pendingFocusLine]);

  useEffect(() => {
    const consumed = conflictLocateFacade.consumeLocateTargetIfMatched({
      fileId: selectedMember?.fileId ?? null,
      nodePath: selectedNodePath,
      propertyName: selectedPropertyName
    });
    if (consumed?.focusLine != null) {
      setFocusLineOverride(consumed.focusLine);
      return;
    }
    if (!conflictLocateFacade.locateTarget) {
      setFocusLineOverride(null);
    }
  }, [
    conflictLocateFacade,
    selectedNodePath,
    selectedPropertyName,
    selectedMember?.fileId
  ]);

  const focusSpan = useMemo(() => {
    if (!selectedNodePath) return null;
    const node = structureNodes.find((item) => item.nodePath === selectedNodePath);
    if (!node) return null;
    if (selectedPropertyName) {
      const property = node.properties.find((item) => item.name === selectedPropertyName);
      return locatorToFocusSpan(property?.source ?? node.source);
    }
    return locatorToFocusSpan(node.source);
  }, [selectedNodePath, selectedPropertyName, structureNodes]);

  const selectStructureTarget = useCallback(
    (fileId: string, nodePath: string | null, propertyName: string | null = null, showSource = false) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride(null);
      const params = new URLSearchParams(search);
      if (showSource) params.set("tab", "source");
      onNavigate(
        navigationSession.selectStructureTarget(project.id, params.toString(), {
          configSetId: selectedConfigSet.id,
          fileId,
          nodePath,
          propertyName,
          sourceMode: canvasModeQueryValue(canvasMode),
          versionId: historyVersionId
        })
      );
    },
    [canvasMode, historyVersionId, navigationSession, onNavigate, project.id, search, selectedConfigSet]
  );

  const runUnifiedSearch = useCallback(async () => {
    await navigationSession.runSearch(project.id, dtsRepository);
  }, [dtsRepository, navigationSession, project.id]);

  const handleSearchHit = useCallback(
    (hit: DtsSearchHit) => {
      if (!selectedConfigSet) return;
      const params = new URLSearchParams(search);
      params.set("tab", "source");
      onNavigate(
        navigationSession.selectSearchHit(project.id, params.toString(), {
          configSetId: selectedConfigSet.id,
          hit,
          sourceMode: canvasModeQueryValue(canvasMode),
          versionId: historyVersionId
        })
      );
    },
    [canvasMode, historyVersionId, navigationSession, onNavigate, project.id, search, selectedConfigSet]
  );

  const handleVisibleLineChange = useCallback(
    (line: number) => {
      setLastVisibleLine(line);
      if (suppressScrollSync || !selectedMember || canvasMode !== "working") return;
      if (scrollSyncTimerRef.current != null) {
        window.clearTimeout(scrollSyncTimerRef.current);
      }
      scrollSyncTimerRef.current = window.setTimeout(() => {
        if (navigationSession.suppressScrollSync) return;
        const nearest = nearestNodeForLine(structureNodes, line);
        if (!nearest || nearest.nodePath === navigationSession.selectedNodePath) return;
        navigationSession.setStructureSelection(nearest.nodePath, null);
      }, 80);
    },
    [canvasMode, navigationSession, selectedMember, selectedNodePath, structureNodes, suppressScrollSync]
  );

  const memberIds = useMemo(
    () => new Set(selectedMembers.map((item) => item.fileId)),
    [selectedMembers]
  );
  const ungroupedFiles = projectFiles.filter((item) => !memberIds.has(item.id));

  const [actionError, setActionError] = useState("");
  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    setActionError("");
    try {
      await action();
    } catch (error: unknown) {
      setActionError(presentError(error, "操作未完成，请刷新来源状态后重试。"));
    } finally {
      setPendingAction(null);
    }
  }, []);

  const notifyMutation = useCallback(
    (message: string) => {
      showToast(message);
      activitySession.bumpRefresh();
    },
    [activitySession, showToast]
  );

  const handleRequestRollbackVersion = useCallback(
    (version: ProjectParameterFileVersion) => {
      if (!canAdmin || !selectedMember) return;
      if (sourceWorkflowLoading || sourceWorkflowError || !sourceWorkflow) {
        showToast(sourceWorkflowError || "来源工作流仍在加载，暂不能执行版本回滚。");
        return;
      }
      const fileId = selectedMember.fileId;
      if (sourceWorkflow.canonical) {
        if (!sourceWorkflow.proofToken) {
          showToast("来源一致性证明缺失，暂不能提交来源回滚审核。");
          return;
        }
        setRollbackReviewError("");
        if (sourceWorkflow.bindingCount >= 2) {
          if (!batchRollbackClient || !selectedMember.currentVersionId) {
            showToast("多目标历史回滚接口或当前版本不可用，已阻止提交。");
            return;
          }
          setRollbackBatchContext({ fileId, currentVersionId: selectedMember.currentVersionId,
            workflowProofToken: sourceWorkflow.proofToken });
        } else {
          setRollbackBatchContext(null);
        }
        setRollbackReviewVersion(version);
        return;
      }
      setConfirmation({
        key: "rollback-file-version",
        title: "恢复为当前版本",
        description: (
          <>
            <p>将插入新的当前版本，内容与版本 {version.versionNumber} 相同。</p>
            <p>历史版本全部保留，不会倒带。当前工作副本会被替换为该内容。</p>
          </>
        ),
        confirmLabel: "恢复为当前",
        pendingLabel: "正在恢复…",
        tone: "danger",
        run: async () => {
          await fileRepository.rollbackVersion(project.id, fileId, version.id);
          workspaceLoadSession.retryFiles();
          workspaceLoadSession.retryMembers();
          workspaceLoadSession.retrySource();
          workspaceLoadSession.retryStructure();
          setVersionsReloadToken((value) => value + 1);
          notifyMutation("已插入新的当前版本，历史记录仍保留。");
        }
      });
    },
    [
      canAdmin,
      batchRollbackClient,
      fileRepository,
      notifyMutation,
      project.id,
      selectedMember,
      setRollbackReviewVersion,
      showToast,
      sourceWorkflow,
      sourceWorkflowError,
      sourceWorkflowLoading,
      workspaceLoadSession
    ]
  );

  const handleConfirmSourceRollback = useCallback(
    async (reason: string) => {
      if (!selectedMember || !rollbackReviewVersion || !sourceWorkflow?.canonical) return;
      const currentVersionId = selectedMember.currentVersionId;
      const proofToken = sourceWorkflow.proofToken;
      if (!proofToken) {
        setRollbackReviewError("来源一致性证明缺失，请刷新后重试。");
        return;
      }
      if (!currentVersionId) {
        setRollbackReviewError("当前文件没有可校验的活跃版本。");
        return;
      }
      setRollbackReviewPending(true);
      setRollbackReviewError("");
      try {
        const result = await fileRepository.rollbackVersionThroughSourceReview(
          project.id,
          selectedMember.fileId,
          {
            versionId: rollbackReviewVersion.id,
            expectedCurrentVersionId: currentVersionId,
            expectedProofToken: proofToken,
            reason
          }
        );
        setRollbackReviewVersion(null);
        notifyMutation(
          `来源回滚审核已提交（${result.status}）。审核通过前活跃版本不变。`
        );
        setSourceWorkflowReloadToken((value) => value + 1);
        setVersionsReloadToken((value) => value + 1);
        onNavigate(`/parameter-review?projectId=${encodeURIComponent(project.id)}`);
      } catch (error: unknown) {
        setRollbackReviewError(presentError(error, "提交来源回滚审核失败。"));
      } finally {
        setRollbackReviewPending(false);
      }
    },
    [
      fileRepository,
      notifyMutation,
      onNavigate,
      project.id,
      rollbackReviewVersion,
      selectedMember,
      sourceWorkflow
    ]
  );

  const {
    createBaselineOpen,
    setCreateBaselineOpen,
    newBaselineName,
    setNewBaselineName,
    releaseBaselineOpen,
    setReleaseBaselineOpen,
    restoreBaselineOpen,
    setRestoreBaselineOpen,
    setBaselinesRetry,
    setReadinessRetry,
    handleOpenCreateBaseline,
    createWorkbenchBaseline,
    selectWorkbenchBaseline,
    compareWorkbenchBaseline,
    exitBaselineCompare,
    selectBaselineCompareMember,
    releaseWorkbenchBaseline,
    openRestoreWorkbenchBaseline,
    restoreWorkbenchBaseline
  } = useWorkbenchBaselineOrchestration({
    projectId: project.id,
    search: canvasSearch,
    onNavigate,
    canAdmin,
    dtsRepository,
    releaseBaselineSession,
    workspaceLoadSession,
    selectedConfigSet,
    selectedMemberFileId,
    selectedBaselineId,
    baselines,
    acknowledgedWarningIds,
    canvasMode,
    historyVersionId,
    candidateId,
    selectedNodePath,
    selectedPropertyName,
    sessionDraftsDirty,
    notifyMutation,
    setInspectorOpen,
    setTasksOpen
  });

  const {
    memberFileId,
    memberRole,
    memberSortOrder,
    syncEvidence,
    canonicalSyncCheck,
    exportEvidence,
    setMemberFileId,
    setMemberRole,
    setMemberSortOrder,
    submitCreateConfigSet,
    addMemberToConfigSet,
    assignUngroupedFile,
    requestRemoveMember,
    syncSelectedFile,
    exportSelectedConfigSet,
    selectConfigSet,
    selectMember
  } = useWorkbenchConfigSetOrchestration({
    projectId: project.id,
    search,
    onNavigate,
    canAdmin,
    dtsRepository,
    fileRepository,
    configSetOpsSession,
    workspaceLoadSession,
    navigationSession,
    conflictLocateFacade,
    configSets,
    members,
    projectFiles,
    selectedConfigSet,
    selectedMember,
    selectedMembers,
    ungroupedFiles,
    canvasMode,
    historyVersionId,
    runAction,
    setInspectorLevelOverride: (level) => setInspectorLevelOverride(level),
    setInspectorOpen,
    setTasksOpen,
    setConfirmation
  });

  const {
    downloadMessage,
    downloadingDts,
    enterCanvasMode,
    exitSpecialCanvasMode,
    handleDownloadVersion,
    downloadActiveDts
  } = useWorkbenchCanvasOps({
    projectId: project.id,
    search: canvasSearch,
    onNavigate,
    fileRepository,
    canvasHistorySession,
    navigationSession,
    selectedConfigSet,
    selectedMember,
    canvasMode,
    historyVersionId,
    selectedNodePath,
    selectedPropertyName,
    lastVisibleLine,
    workingSnapshot,
    fileVersions,
    setFocusLineOverride,
    setRestoredScrollLine
  });

  const {
    activateConfirmOpen,
    handleCandidateFileChange,
    handleRecomputeCandidate,
    handleOpenActivateCandidate,
    handleAbandonCandidate,
    handleConfirmActivateCandidate,
    handleCancelActivateCandidate
  } = useWorkbenchCandidateOrchestration({
    projectId: project.id,
    search: canvasSearch,
    onNavigate,
    fileRepository,
    candidateFlow,
    workspaceLoadSession,
    selectedConfigSet,
    selectedMemberFileId,
    activeCandidate,
    activatingCandidate,
    notifyMutation,
    setInspectorOpen,
    setBaselinesRetry
  });

  const [sourceReviewDialogOpen, setSourceReviewDialogOpen] = useState(false);
  const canSubmitBatchReview = Boolean(apiMode && canEdit && canAdmin && activeCandidate?.status === "ready"
    && sourcePreview?.kind === "canonical" && sourcePreview.candidateId === activeCandidate.id
    && ["json", "dts"].includes(sourcePreview.format.toLowerCase()) && sourcePreview.proofToken
    && sourcePreview.bindings && sourcePreview.bindings.length >= 2
    && sourcePreview.bindings.every((binding) => binding.bindingId && binding.sourcePinId
      && (binding.action === "delete" || binding.afterText !== undefined))
    && new Set(sourcePreview.bindings.map((binding) => binding.bindingId)).size === sourcePreview.bindings.length
    && permitsFreshBatchRequest(sourcePreview.request) && !sourcePreviewLoading && !sourcePreviewError
    && memberRemovalRepository?.submitProjectValueBatchChangeRequest);
  const handleOpenSourceReview = useCallback(() => {
    if (canSubmitSourceReview || canSubmitBatchReview) setSourceReviewDialogOpen(true);
  }, [canSubmitSourceReview, canSubmitBatchReview]);
  const handleConfirmSourceReview = useCallback(
    async (reason: string) => {
      try {
        const result = await candidateFlow.submitSourceReview(project.id, reason, fileRepository);
        setSourceReviewDialogOpen(false);
        notifyMutation(
          `来源变更审核已提交（${result.status}）。审核通过前候选不会成为活跃版本。`
        );
        setSourceWorkflowReloadToken((value) => value + 1);
      } catch {
        // candidateFlow.sourceReviewError is projected in the dialog.
      }
    },
    [candidateFlow, fileRepository, notifyMutation, project.id]
  );

  useWorkbenchKeyboardShortcuts({
    searchInputRef,
    treeRegionRef,
    sourceRegionRef,
    onFindNext: () => setFindNextToken((value) => value + 1),
    onGotoLine: (line) => setFocusLineOverride(line)
  });

  const refreshActivityTimeline = useCallback(async () => {
    await activitySession.refresh(
      project.id,
      workbenchActivityApps(),
      listAuditEvents,
      fileRepository
    );
  }, [activitySession, fileRepository, listAuditEvents, project.id]);

  useEffect(() => {
    if (inspectorLevel !== "activity" || !inspectorOpen) return;
    void refreshActivityTimeline();
  }, [inspectorLevel, inspectorOpen, refreshActivityTimeline, activityRefreshToken]);

  const openActivityInspector = useCallback(() => {
    if (!selectedConfigSet) return;
    activitySession.setMissingNotice("");
    setInspectorLevelOverride("activity");
    setInspectorOpen(true);
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: selectedMember?.fileId ?? queryValue(search, "file"),
        node: selectedNodePath,
        property: selectedPropertyName,
        sourceMode: canvasModeQueryValue(canvasMode),
        version: historyVersionId,
        candidate: candidateId,
        inspector: "activity"
      })
    );
  }, [
    activitySession,
    canvasMode,
    candidateId,
    historyVersionId,
    onNavigate,
    project.id,
    search,
    selectedConfigSet,
    selectedMember?.fileId,
    selectedNodePath,
    selectedPropertyName
  ]);

  const handleActivityEventSelect = useCallback(
    (eventId: string) => {
      if (!selectedConfigSet) return;
      const event = activityEvents.find((item) => item.id === eventId);
      if (!event) return;
      navigateWorkbenchActivityEvent({
        event,
        catalog: buildWorkbenchActivityCatalog({
          configSetIds: configSets.map((item) => item.id),
          fileIds: projectFiles.map((item) => item.id),
          candidateIds: [
            ...knownCandidateIds,
            activeCandidate?.id,
            candidateId
          ].filter((value): value is string => Boolean(value)),
          baselineIds: baselines.map((item) => item.id),
          selectedMemberFileId,
          structureNodePaths: structureNodes.map((node) => node.nodePath)
        }),
        projectId: project.id,
        search,
        selectedConfigSetId: selectedConfigSet.id,
        selectedMemberFileId,
        onNavigate,
        activitySession,
        releaseBaselineSession,
        navigationSession,
        conflictLocateFacade,
        fileRepository,
        selectStructureTarget,
        setInspectorLevelOverride: (level) => setInspectorLevelOverride(level),
        setInspectorOpen,
        setTasksOpen
      });
    },
    [
      activeCandidate?.id,
      activityEvents,
      activitySession,
      baselines,
      candidateId,
      conflictLocateFacade,
      fileRepository,
      knownCandidateIds,
      navigationSession,
      configSets,
      onNavigate,
      project.id,
      projectFiles,
      releaseBaselineSession,
      search,
      selectStructureTarget,
      selectedConfigSet,
      selectedMemberFileId,
      structureNodes
    ]
  );

  const selectedStructureNode = useMemo(
    () => structureNodes.find((item) => item.nodePath === selectedNodePath) ?? null,
    [selectedNodePath, structureNodes]
  );
  const selectedStructureProperty = useMemo(() => {
    if (!selectedStructureNode || !selectedPropertyName) return null;
    return selectedStructureNode.properties.find((item) => item.name === selectedPropertyName) ?? null;
  }, [selectedPropertyName, selectedStructureNode]);

  useEffect(() => {
    if (selectedMember?.fileId) {
      structuredEditSession.setStructure(structureNodes, selectedMember.fileId);
      return;
    }
    structuredEditSession.setStructure([], "");
  }, [selectedMember?.fileId, structureNodes, structuredEditSession]);

  const sessionChangeMarkers = useMemo(
    () =>
      sessionDraftRows
        .filter((row) => row.startLine != null)
        .map((row) => ({
          propertyIdentity: row.identity,
          startLine: row.startLine as number
        })),
    [sessionDraftRows]
  );

  const availableLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const node of structureNodes) {
      for (const label of node.labels) labels.add(label);
    }
    return Array.from(labels);
  }, [structureNodes]);

  const criticalLocked =
    Boolean(selectedStructureNode) &&
    !canEditCritical &&
    isCriticalDtsNodePath(selectedStructureNode!.nodePath);
  const editorLocked = !canEdit || criticalLocked || staleDraftLocked;

  const activePropertyDraftKey =
    selectedMember && selectedStructureNode && selectedStructureProperty
      ? sessionDraftKey({
          fileId: selectedMember.fileId,
          nodePath: selectedStructureNode.nodePath,
          propertyName: selectedStructureProperty.name
        })
      : null;
  const activePropertyDraft = activePropertyDraftKey
    ? sessionDrafts[activePropertyDraftKey]
    : undefined;

  const resolvedOrganizationId = organizationId ?? selectedConfigSet?.organizationId ?? null;
  const sessionDraftScope = useMemo<SessionDraftScope | null>(() => {
    if (
      !currentUserId ||
      !resolvedOrganizationId ||
      !selectedConfigSet?.id ||
      !selectedMember?.fileId ||
      !selectedMember.currentVersionId
    ) {
      return null;
    }
    return {
      userId: currentUserId,
      organizationId: resolvedOrganizationId,
      projectId: project.id,
      configSetId: selectedConfigSet.id,
      fileId: selectedMember.fileId,
      baseVersionId: selectedMember.currentVersionId
    };
  }, [
    currentUserId,
    project.id,
    resolvedOrganizationId,
    selectedConfigSet?.id,
    selectedMember?.currentVersionId,
    selectedMember?.fileId
  ]);

  useEffect(() => {
    void structuredEditSession.hydrate(sessionDraftScope);
  }, [sessionDraftScope, structuredEditSession]);

  const handleSelectReadinessIssue = useCallback(
    (issue: DtsReleaseReadinessIssue) => {
      if (issue.remediation.kind === "complete-pending-change" && issue.remediation.href) {
        onNavigate(issue.remediation.href);
        return;
      }
      setTasksOpen(true);
      if (issue.target?.fileId) {
        selectStructureTarget(
          issue.target.fileId,
          issue.target.nodePath ?? null,
          issue.target.propertyName ?? null,
          true
        );
        if (issue.target.source?.startLine) {
          setFocusLineOverride(issue.target.source.startLine);
        }
      }
    },
    [onNavigate, selectStructureTarget]
  );

  const handleCopySessionDrafts = useCallback(async () => {
    const text = structuredEditSession.copyText();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setDraftCopyStatus("草稿已复制到剪贴板。");
        return;
      }
    } catch {
      // fall through to textarea selection
    }
    const fallback = draftCopyFallbackRef.current;
    if (fallback) {
      fallback.value = text;
      fallback.focus();
      fallback.select();
      setDraftCopyStatus("请使用系统复制快捷键复制已选中的草稿文本。");
    } else {
      setDraftCopyStatus("无法自动复制，请手动记录草稿内容。");
    }
  }, [structuredEditSession]);

  const handleReconfirmStaleDrafts = useCallback(() => {
    structuredEditSession.recover();
    setTasksOpen(true);
  }, [structuredEditSession]);

  const handleLeaveWorkbench = useCallback(() => {
    if (sessionDraftsDirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    onNavigate(resolveParamAdminProjectsReturnPath(search));
  }, [onNavigate, search, sessionDraftsDirty]);

  const handleDiscardAndLeave = useCallback(() => {
    structuredEditSession.discard();
    setLeaveConfirmOpen(false);
    onNavigate(resolveParamAdminProjectsReturnPath(search));
  }, [onNavigate, search, structuredEditSession]);

  const handleStructuredValueChange = useCallback(
    (next: StructuredValueChange) => {
      if (
        !selectedMember ||
        !selectedStructureNode ||
        !selectedStructureProperty ||
        editorLocked
      ) {
        return;
      }
      structuredEditSession.change(
        {
          fileId: selectedMember.fileId,
          nodePath: selectedStructureNode.nodePath,
          propertyName: selectedStructureProperty.name
        },
        {
          rawText: next.rawText,
          normalizedValue: next.normalizedValue,
          valid: next.valid,
          ...(next.error ? { error: next.error } : {}),
          ...(typeof next.present === "boolean" ? { present: next.present } : {})
        }
      );
      setTasksOpen(true);
    },
    [
      editorLocked,
      selectedMember,
      selectedStructureNode,
      selectedStructureProperty,
      structuredEditSession
    ]
  );

  const handleValidateSelected = useCallback(() => {
    structuredEditSession.validate();
  }, [structuredEditSession]);

  const handleSubmitSelected = useCallback(async () => {
    if (!selectedMember || !canEdit || submittingEdits) return;
    try {
      await structuredEditSession.submit({
        projectId: project.id,
        fileId: selectedMember.fileId,
        fileName: selectedMember.fileName,
        dtsRepository,
        catalogRepository: topologyRepository,
        revisionId: revisionGate.selectedRevisionId,
        configSetId: selectedConfigSet?.id
      });
      workspaceLoadSession.retryMembers();
      workspaceLoadSession.retryStructure();
      workspaceLoadSession.retrySource();
      workspaceLoadSession.retryFiles();
    } catch {
      // submitError is projected from the session snapshot
    }
  }, [
    canEdit,
    dtsRepository,
    project.id,
    revisionGate.selectedRevisionId,
    selectedConfigSet,
    selectedMember,
    structuredEditSession,
    submittingEdits,
    topologyRepository,
    workspaceLoadSession
  ]);

  const unifiedDiffText = useMemo(() => {
    if (canvasMode !== "unified-diff" || !historySourceAvailable) return "";
    return buildUnifiedDiff(
      compareSource,
      historySource,
      "working",
      historyVersionId ?? "history"
    );
  }, [canvasMode, compareSource, historySource, historySourceAvailable, historyVersionId]);

  const taskDock = (
      <WorkbenchTaskDock
        tasksOpen={tasksOpen}
        onTasksOpenChange={(open) => {
          setTasksOpen(open);
        }}
        sessionDraftRows={sessionDraftRows}
        syncEvidence={syncEvidence}
        canonicalSyncCheck={canonicalSyncCheck}
        exportEvidence={exportEvidence}
        syncConflicts={syncConflicts}
        showConflictArbitration={contentTab !== "conflicts"}
        autoLocateConflicts={contentTab !== "conflicts"}
        releaseReadiness={releaseReadiness}
        draftRecoveryStatus={draftRecoveryStatus}
        draftCopyFallbackRef={draftCopyFallbackRef}
        draftCopyStatus={draftCopyStatus}
        onCopySessionDrafts={handleCopySessionDrafts}
        onReconfirmStaleDrafts={handleReconfirmStaleDrafts}
        selectedDraftKeys={selectedDraftKeys}
        onToggleDraftKey={(key) => {
          const next = new Set(selectedDraftKeys);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          structuredEditSession.selectSubset(next);
        }}
        submitReason={submitReason}
        onSubmitReasonChange={(value) => structuredEditSession.setReason(value)}
        canEdit={canEdit}
        onValidateSelected={handleValidateSelected}
        onSubmitSelected={handleSubmitSelected}
        submittingEdits={submittingEdits}
        validateStatus={validateStatus}
        submitStatus={submitStatus}
        stagedDrafts={stagedDrafts}
        onSubmitReview={() => onNavigate(`/parameters?project=${encodeURIComponent(project.id)}`)}
        submitError={submitError}
        projectId={project.id}
        fileRepository={fileRepository}
        sourceWorkflowByFileId={sourceWorkflowByFileId}
        sourceWorkflowLoading={sourceWorkflowLoading || filesLoading}
        onConflictsChange={(next) => conflictLocateFacade.setOpenConflicts(next)}
        onLocateConflict={(conflict) => {
          const target = conflictLocateFacade.locate(conflict);
          if (!target) return;
          selectStructureTarget(target.fileId, target.nodePath, target.propertyName, true);
        }}
        canAdmin={canAdmin}
        acknowledgedWarningIds={acknowledgedWarningIds}
        onAcknowledgeWarning={(issueId) => {
          releaseBaselineSession.acknowledgeWarning(issueId);
        }}
        onSelectReadinessIssue={handleSelectReadinessIssue}
        onReadinessRetry={() => setReadinessRetry((value) => value + 1)}
      />
  );

  return (
    <section className="configuration-workbench" aria-label="项目配置工作台" ref={workbenchBodyRef}>
      <NavigatorWorkbench
        pageKey={`project-configuration:${project.id}`}
        navigatorLabel="文件与配置集"
        taskLabel="配置内容"
        panelId={`project-configuration-${contentTab}-panel`}
        tabId={`project-configuration-${contentTab}-tab`}
        inspectorLabel="检查器面板"
        inspectorOverlay={!inspectorPersistent}
        primaryAction={<Button type="button" size="sm"
          disabled={uploadingCandidate || !selectedConfigSet || !canAdmin}
          title="上传创建候选文件版本，不会激活工作配置"
          onClick={() => candidateFileInputRef.current?.click()}>
          {uploadingCandidate ? "上传中…" : "上传候选"}
        </Button>}
        toolbar={(primaryAction) => <div className="configuration-workbench__toolbar-content">
          <WorkbenchCommandBar
        primaryAction={primaryAction}
        project={project}
        onLeave={handleLeaveWorkbench}
        configSets={configSets}
        selectedConfigSet={selectedConfigSet ?? null}
        configSetsLoading={configSetsLoading}
        configSetsError={configSetsError}
        onSelectConfigSet={selectConfigSet}
        canAdmin={canAdmin}
        selectedMember={selectedMember ?? null}
        activeCandidate={activeCandidate}
        baselinesLoading={baselinesLoading}
        baselinesError={baselinesError}
        releasedBaseline={releasedBaseline}
        onBaselinesRetry={() => setBaselinesRetry((value) => value + 1)}
        releaseReadiness={releaseReadiness}
        readinessLoading={readinessLoading}
        readinessError={readinessError}
        sessionDraftsDirty={sessionDraftsDirty}
        onReadinessRetry={() => setReadinessRetry((value) => value + 1)}
        onOpenIssues={() => setTasksOpen(true)}
        narrowViewport={narrowViewport}
        inspectorOpen={inspectorOpen}
        onInspectorToggle={() => setInspectorOpen((open) => !open)}
        candidateFileInputRef={candidateFileInputRef}
        onCandidateFileChange={handleCandidateFileChange}
        downloadingDts={downloadingDts}
        onDownloadActiveDts={downloadActiveDts}
        pendingAction={pendingAction}
        onOpenActivity={openActivityInspector}
        onExportConfigSet={() => void runAction("export-config-set", exportSelectedConfigSet)}
        onOpenCreateBaseline={handleOpenCreateBaseline}
        onCreateConfigSet={submitCreateConfigSet}
      />
          <ViewSwitch variant="tabs" ariaLabel="项目配置内容" value={contentTab}
            onValueChange={selectContentTab}
            items={[{ value: "source", label: "源码" }, { value: "structure", label: "结构" }, { value: "conflicts", label: "冲突" }]
              .map((item) => ({ ...item, id: `project-configuration-${item.value}-tab`, panelId: `project-configuration-${item.value}-panel` }))} />
        </div>}
        context={<>
          <WorkbenchShellChrome
        opsError={actionError || opsError}
        opsMessage={opsMessage}
        canAdmin={canAdmin}
        narrowViewport={narrowViewport}
        inspectorOpen={inspectorOpen}
        inspectorLevel={inspectorLevel}
        onOpenActivity={openActivityInspector}
        onInspectorToggle={() => setInspectorOpen((open) => !open)}
        tasksOpen={tasksOpen}
        onTasksToggle={() => setTasksOpen((open) => !open)}
      />
          <WorkbenchSetupGate
        configSetsLoading={configSetsLoading}
        configSetsError={configSetsError}
        onConfigSetsRetry={() => workspaceLoadSession.retryConfigSets()}
        selectedConfigSet={selectedConfigSet ?? null}
        canAdmin={canAdmin}
      />
        </>}
        navigator={<>
          {selectedConfigSet ? <WorkbenchSourceTree
            showStructure={contentTab !== "structure"}
            treeRegionRef={treeRegionRef}
            selectedConfigSet={selectedConfigSet}
            searchInputRef={searchInputRef}
            searchDraft={searchDraft}
            onSearchDraftChange={(value) => navigationSession.setSearchDraft(value)}
            onSearchSubmit={() => void runUnifiedSearch()}
            searchLoading={searchLoading}
            searchError={searchError}
            searchHits={searchHits}
            onSearchHit={handleSearchHit}
            membersLoading={membersListLoading}
            membersError={membersError}
            onMembersRetry={() => workspaceLoadSession.retryMembers()}
            sourceWorkflowSetLoading={sourceWorkflowSetLoading}
            sourceWorkflowSetReady={sourceWorkflowSetReady}
            memberAddErrorsByFileId={memberAddErrorsByFileId}
            sourceWorkflowSetCanonical={sourceWorkflowSetCanonical}
            sourceWorkflowSetError={sourceWorkflowSetError}
            selectedMembers={selectedMembers}
            selectedMember={selectedMember ?? null}
            onSelectMember={(fileId) => {
              setManualSyncTarget(null);
              selectMember(fileId);
            }}
            onInspectMember={(fileId) => {
              setManualSyncTarget(null);
              if (selectedMember?.fileId !== fileId) selectMember(fileId);
              setInspectorLevelOverride("file");
              setInspectorOpen(true);
            }}
            structureLoading={structureLoading}
            structureError={structureError}
            onStructureRetry={() => workspaceLoadSession.retryStructure()}
            structureNodes={structureNodes}
            selectedNodePath={selectedNodePath}
            selectedPropertyName={selectedPropertyName}
            sessionDrafts={sessionDrafts}
            onSelectStructureTarget={selectStructureTarget}
            canAdmin={canAdmin}
            uploadingCandidate={uploadingCandidate}
            onUploadCandidate={() => candidateFileInputRef.current?.click()}
            filesLoading={filesLoading}
            filesError={filesError}
            onFilesRetry={() => workspaceLoadSession.retryFiles()}
            ungroupedFiles={ungroupedFiles}
            pendingAction={pendingAction}
            onAssignUngroupedFile={(item) => void runAction(`assign-${item.id}`, () => assignUngroupedFile(item))}
          /> : null}
        </>}
        inspector={inspectorOpen && selectedConfigSet ? <WorkbenchInspectorPanel
              inspectorPersistent={inspectorPersistent}
              narrowViewport={narrowViewport}
              inspectorLevel={inspectorLevel}
              onClose={() => setInspectorOpen(false)}
              selectedConfigSet={selectedConfigSet}
              selectedMember={selectedMember}
              selectedPropertyName={selectedPropertyName}
              selectedNodePath={selectedNodePath}
              baselines={baselines}
              releasedBaseline={releasedBaseline}
              selectedBaselineId={selectedBaselineId}
              baselinesLoading={baselinesLoading}
              baselinesError={baselinesError}
              baselineActionError={baselineActionError}
              baselineCompare={baselineCompare}
              baselineCompareAgainst={baselineCompareAgainst}
              baselinePinnedMembers={baselinePinnedMembers}
              canAdmin={canAdmin}
              releaseReadiness={releaseReadiness}
              sessionDraftsDirty={sessionDraftsDirty}
              canvasMode={canvasMode}
              onSelectBaseline={selectWorkbenchBaseline}
              onBaselinesRetry={() => setBaselinesRetry((value) => value + 1)}
              onCompareBaseline={(against) => {
                void runAction("compare-baseline", () => compareWorkbenchBaseline(against));
              }}
              onOpenRelease={() => {
                releaseBaselineSession.clearActionError();
                setReleaseBaselineOpen(true);
              }}
              onOpenRestoreBaseline={() => {
                void runAction("preview-restore-baseline", openRestoreWorkbenchBaseline);
              }}
              onExitBaselineCompare={exitBaselineCompare}
              onSelectBaselineCompareMember={selectBaselineCompareMember}
              activeCandidate={activeCandidate}
              projectId={project.id}
              currentUserId={currentUserId}
              onConflictSubmitted={(requestId) => onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`)}
              sourcePreview={sourcePreview}
              sourcePreviewLoading={sourcePreviewLoading}
              sourcePreviewError={sourcePreviewError}
              canSubmitSourceReview={canSubmitSourceReview}
              canSubmitBatchReview={canSubmitBatchReview}
              submittingSourceReview={submittingSourceReview}
              sourceReviewError={sourceReviewError}
              sourceReviewResult={sourceReviewResult}
              onSubmitSourceReview={handleOpenSourceReview}
              onOpenReview={() => {
                const requestId = sourcePreview?.request?.id ?? sourceReviewResult?.requestId;
                onNavigate(requestId
                  ? `/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`
                  : `/parameter-review?projectId=${encodeURIComponent(project.id)}`);
              }}
              canRecompute={canRecompute}
              canActivate={canActivate && legacySourceWorkflowConfirmed}
              canAbandon={canAbandon}
              onRecomputeCandidate={handleRecomputeCandidate}
              onActivateCandidate={handleOpenActivateCandidate}
              onAbandonCandidate={handleAbandonCandidate}
              activityMissingNotice={activityMissingNotice}
              activityLoading={activityLoading}
              activityError={activityError}
              activityRows={activityRows}
              onActivityRetry={() => activitySession.bumpRefresh()}
              onActivityEventSelect={handleActivityEventSelect}
              selectedMembers={selectedMembers}
              pendingAction={pendingAction}
              ungroupedFiles={ungroupedFiles}
              memberFileId={memberFileId}
              memberRole={memberRole}
              memberSortOrder={memberSortOrder}
              onMemberFileIdChange={setMemberFileId}
              onMemberRoleChange={setMemberRole}
              onMemberSortOrderChange={setMemberSortOrder}
              onAddMember={() =>
                void runAction("add-member", () =>
                  addMemberToConfigSet(memberFileId, memberRole, memberSortOrder)
                )
              }
              onRequestRemoveMember={(member) => {
                if (canRequestReviewedMemberRemoval && member.format === "json") setMemberRemovalTarget(member);
                else requestRemoveMember(member);
              }}
              canRequestReviewedMemberRemoval={canRequestReviewedMemberRemoval}
              onSyncFile={() => void runAction("sync-file", syncSelectedFile)}
              onOpenManualSync={manualSyncClient && apiMode && canAdmin && sourceWorkflow?.canonical
                && sourceWorkflow.bindingCount >= 2 && sourceWorkflow.proofToken
                && selectedMember?.currentVersionId
                ? () => setManualSyncTarget({ member: selectedMember,
                  currentVersionId: selectedMember.currentVersionId!,
                  workflowProofToken: sourceWorkflow.proofToken! }) : undefined}
              sourceWorkflow={sourceWorkflow}
              sourceWorkflowLoading={sourceWorkflowLoading}
              sourceWorkflowError={sourceWorkflowError}
              sourceWorkflowSetLoading={sourceWorkflowSetLoading}
              sourceWorkflowSetReady={sourceWorkflowSetReady}
            memberAddErrorsByFileId={memberAddErrorsByFileId}
              sourceWorkflowSetCanonical={sourceWorkflowSetCanonical}
              sourceWorkflowSetError={sourceWorkflowSetError}
              onRetrySourceWorkflow={() => setSourceWorkflowReloadToken((value) => value + 1)}
              fileVersions={fileVersions}
              versionsLoading={versionsLoading}
              versionsError={versionsError}
              onEnterCanvasMode={enterCanvasMode}
              onDownloadVersion={(version) => void handleDownloadVersion(version)}
              onRequestRollbackVersion={handleRequestRollbackVersion}
              downloadMessage={downloadMessage}
              selectedStructureNode={selectedStructureNode}
              selectedStructureProperty={selectedStructureProperty}
              activePropertyDraft={activePropertyDraft}
              availableLabels={availableLabels}
              editorLocked={editorLocked}
              criticalLocked={criticalLocked}
              staleDraftLocked={staleDraftLocked}
              onStructuredValueChange={handleStructuredValueChange}
              canEdit={canEdit}
              revisionGate={
                topologyRepository ? (
                  <WorkbenchRevisionGate
                    snapshot={revisionGate}
                    canAdmin={canAdmin}
                    onSelect={(revisionId) => revisionGate.session.select(revisionId)}
                    onValidate={() => {
                      // The session already surfaces the failure as its actionError.
                      revisionGate.session.validate(project.id, topologyRepository).catch(() => undefined);
                    }}
                    onRetry={() => {
                      void revisionGate.session.load(
                        project.id,
                        selectedConfigSet.id,
                        topologyRepository
                      );
                    }}
                  />
                ) : undefined
              }
            /> : null}
      >
        {selectedConfigSet ? <div className="configuration-workbench__selection-row" data-row-action-row>
          <span className="configuration-workbench__selection-label" title={selectedMember?.fileName ?? selectedConfigSet.name}>
            {selectedMember?.fileName ?? selectedConfigSet.name}
          </span>
          <span data-row-action-status>{selectedMember
            ? selectedMember.currentVersionNumber ? `活跃 v${selectedMember.currentVersionNumber}` : "无活跃版本"
            : membersListLoading ? "正在加载成员…" : `${selectedMembers.length} 个成员`}</span>
          <RowActionMenu label="当前配置项操作" triggerText="操作" triggerLabel={`配置项操作：${selectedMember?.fileName ?? selectedConfigSet.name}`} primaryAction={{ id: "details", label: "详情", onSelect: () => {
            setInspectorLevelOverride(selectedMember ? "file" : "config-set");
            setInspectorOpen(true);
          } }} items={selectedMember ? [{ id: "config-set", label: "配置集详情", onSelect: () => {
            setInspectorLevelOverride("config-set");
            setInspectorOpen(true);
          } }] : []} />
        </div> : null}
        {!selectedConfigSet ? <SectionEmpty message="选择或新建配置集以查看项目配置。" /> : null}
        {contentTab === "source" && selectedConfigSet ? <WorkbenchSourceCanvas
            sourceRegionRef={sourceRegionRef}
            selectedConfigSetName={selectedConfigSet.name}
            selectedMember={selectedMember ?? null}
            canvasMode={canvasMode}
            historyVersionId={historyVersionId}
            candidateId={candidateId}
            activeCandidate={activeCandidate}
            fileVersions={fileVersions}
            onSelectVersion={() => {
              setInspectorLevelOverride("file");
              setInspectorOpen(true);
            }}
            onUploadCandidate={canAdmin && !uploadingCandidate ? () => candidateFileInputRef.current?.click() : undefined}
            onEnterCanvasMode={enterCanvasMode}
            onExitSpecialCanvasMode={exitSpecialCanvasMode}
            candidateError={candidateError}
            sourceLoading={sourceLoading}
            modeSourceLoading={modeSourceLoading}
            sourceError={sourceError}
            modeSourceError={modeSourceError}
            onSourceRetry={() => workspaceLoadSession.retrySource()}
            onClearModeSourceError={() => canvasHistorySession.clearModeSource()}
            source={source}
            historySource={historySource}
            historySourceAvailable={historySourceAvailable}
            candidateSource={candidateSource}
            candidateLoading={candidateLoading}
            compareSource={compareSource}
            unifiedDiffText={unifiedDiffText}
            focusSpan={focusSpan}
            focusLineOverride={focusLineOverride}
            restoredScrollLine={restoredScrollLine}
            findQuery={findQuery}
            findNextToken={findNextToken}
            onVisibleLineChange={handleVisibleLineChange}
            sessionChangeMarkers={sessionChangeMarkers}
          /> : null}
        {contentTab === "structure" ? (
          !selectedMember ? <SectionEmpty message="选择文件以查看结构。" />
            : structureLoading ? <SectionSkeleton label="正在加载结构树…" />
            : structureError ? <SectionError message={structureError} onRetry={() => workspaceLoadSession.retryStructure()} />
            : <div role="tree" aria-label="DTS 结构树">
              <WorkbenchStructureTree nodes={structureNodes} fileId={selectedMember.fileId}
                ariaLabel={`${selectedMember.fileName} 节点树`} selectedNodePath={selectedNodePath}
                selectedPropertyName={selectedPropertyName} sessionDrafts={sessionDrafts}
                onSelectNode={(nodePath) => selectStructureTarget(selectedMember.fileId, nodePath, null)}
                onSelectProperty={(nodePath, propertyName) => selectStructureTarget(selectedMember.fileId, nodePath, propertyName)} />
            </div>
        ) : null}
        {contentTab === "conflicts" ? (
          <div className="configuration-workbench__conflicts" aria-label="冲突处理">
            <h2>冲突处理</h2>
            <p>比较文件值与界面值，确认取值后提交裁决。</p>
            {conflictsLoading ? <SectionSkeleton label="正在加载冲突…" />
              : conflictsError ? <SectionError message="冲突加载失败，请重试。" onRetry={() => void conflictLocateFacade.load(project.id, fileRepository)} />
              : syncConflicts.length === 0 ? <SectionEmpty message="当前没有待处理冲突。" /> : (
              <WorkbenchConflictArbitrationDock projectId={project.id} repository={fileRepository}
                conflicts={syncConflicts} autoLocate={false}
                sourceWorkflowByFileId={sourceWorkflowByFileId}
                sourceWorkflowLoading={sourceWorkflowLoading || filesLoading}
                onConflictsChange={(next) => conflictLocateFacade.setOpenConflicts(next)}
                onLocateConflict={(conflict) => {
                  const target = conflictLocateFacade.locate(conflict);
                  if (target) selectStructureTarget(target.fileId, target.nodePath, target.propertyName, true);
                }} />
            )}
          </div>
        ) : null}
      </NavigatorWorkbench>

      <WorkbenchCandidateActivateDialog
        open={activateConfirmOpen}
        activeCandidate={activeCandidate}
        configSetName={selectedConfigSet?.name ?? null}
        activateRole={activateRole}
        onActivateRoleChange={(role) => candidateFlow.setActivateRole(role)}
        activating={activatingCandidate}
        activateError={activateError}
        onCancel={handleCancelActivateCandidate}
        onConfirm={handleConfirmActivateCandidate}
      />

      <WorkbenchCandidateSourceReviewDialog
        open={sourceReviewDialogOpen && !canSubmitBatchReview}
        activeCandidate={activeCandidate}
        sourcePreview={sourcePreview}
        submitting={submittingSourceReview}
        error={sourceReviewError}
        onCancel={() => {
          if (!submittingSourceReview) setSourceReviewDialogOpen(false);
        }}
        onConfirm={(reason) => void handleConfirmSourceReview(reason)}
      />
      {sourceReviewDialogOpen && canSubmitBatchReview && sourcePreview && activeCandidate ? (
        <CanonicalBatchSubmitDialog projectId={project.id} currentUserId={currentUserId}
          candidate={activeCandidate} preview={sourcePreview} repository={memberRemovalRepository}
          fileRepository={fileRepository}
          onDismiss={() => setSourceReviewDialogOpen(false)}
          onSubmitted={(requestId) => {
            setSourceReviewDialogOpen(false);
            setSourceWorkflowReloadToken((value) => value + 1);
            onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`);
          }} />
      ) : null}

      {rollbackReviewVersion ? <WorkbenchSourceRollbackDialog
        key={`${rollbackReviewVersion.id}:${rollbackBatchContext?.fileId ?? "single"}`}
        open={Boolean(rollbackReviewVersion)}
        version={rollbackReviewVersion}
        currentVersionId={rollbackBatchContext?.currentVersionId ?? selectedMember?.currentVersionId}
        pending={rollbackReviewPending}
        error={rollbackReviewError}
        onCancel={() => {
          if (!rollbackReviewPending) setRollbackReviewVersion(null);
        }}
        onConfirm={(reason) => void handleConfirmSourceRollback(reason)}
        batch={rollbackBatchContext && batchRollbackClient ? {
          projectId: project.id, fileId: rollbackBatchContext.fileId, currentUserId,
          workflowProofToken: rollbackBatchContext.workflowProofToken, client: batchRollbackClient,
          onSubmitted: (requestId) => {
            setRollbackReviewVersion(null);
            setSourceWorkflowReloadToken((value) => value + 1);
            setVersionsReloadToken((value) => value + 1);
            notifyMutation("多目标历史回滚审核已提交；审核通过前当前 Value、来源 pin 和活跃文件版本不变。");
            onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`);
          },
          onOpenExisting: (requestId) => onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`)
        } : undefined}
      /> : null}

      {manualSyncTarget && manualSyncClient ? <WorkbenchCanonicalManualSyncDialog
          context={{ projectId: project.id, fileId: manualSyncTarget.member.fileId,
            fileName: manualSyncTarget.member.fileName, format: manualSyncTarget.member.format,
            currentVersionId: manualSyncTarget.currentVersionId,
            workflowProofToken: manualSyncTarget.workflowProofToken, currentUserId,
            client: manualSyncClient,
            onOpenExisting: (requestId) => onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`),
            onSubmitted: (requestId) => {
              setManualSyncTarget(null);
              setSourceWorkflowReloadToken((value) => value + 1);
              setVersionsReloadToken((value) => value + 1);
              onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`);
            } }} sourceState={{
            currentVersionId: selectedMembers.find((member) => member.fileId === manualSyncTarget.member.fileId)?.currentVersionId ?? null,
            workflowProofToken: sourceWorkflowsByFileId[manualSyncTarget.member.fileId]?.proofToken ?? null,
            loading: sourceWorkflowSetLoading,
            error: sourceWorkflowErrorsByFileId[manualSyncTarget.member.fileId] || membersError || "",
            canonical: sourceWorkflowsByFileId[manualSyncTarget.member.fileId]?.canonical ?? null
          }} onDismiss={() => setManualSyncTarget(null)} /> : null}

      {taskDock}

      {memberRemovalTarget && selectedConfigSet ? <CanonicalMemberRemovalSubmitDialog
        projectId={project.id}
        configSetId={selectedConfigSet.id}
        configSetName={selectedConfigSet.name}
        member={memberRemovalTarget}
        members={selectedMembers}
        currentUserId={currentUserId}
        repository={memberRemovalRepository}
        onDismiss={() => setMemberRemovalTarget(null)}
        onSubmitted={(requestId) => {
          setMemberRemovalTarget(null);
          onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&memberRequest=${encodeURIComponent(requestId)}`);
        }}
      /> : null}
      <WorkbenchBaselineDialogs
        createOpen={createBaselineOpen}
        releaseOpen={releaseBaselineOpen}
        restoreOpen={restoreBaselineOpen}
        leaveOpen={leaveConfirmOpen}
        sessionDraftsDirty={sessionDraftsDirty}
        baselineActionError={baselineActionError}
        newBaselineName={newBaselineName}
        onNewBaselineNameChange={setNewBaselineName}
        pendingAction={pendingAction}
        releaseReadiness={releaseReadiness}
        acknowledgedWarningIds={acknowledgedWarningIds}
        restorePreview={restorePreview}
        selectedBaselineId={selectedBaselineId}
        baselines={baselines}
        onCancelCreate={() => {
          if (pendingAction) return;
          setCreateBaselineOpen(false);
          releaseBaselineSession.clearActionError();
        }}
        onConfirmCreate={() => {
          void runAction("create-baseline", createWorkbenchBaseline);
        }}
        onCancelRelease={() => {
          if (pendingAction) return;
          setReleaseBaselineOpen(false);
          releaseBaselineSession.clearActionError();
        }}
        onConfirmRelease={() => {
          void runAction("release-baseline", releaseWorkbenchBaseline);
        }}
        onCancelRestore={() => {
          if (pendingAction) return;
          setRestoreBaselineOpen(false);
          releaseBaselineSession.clearRestorePreview();
          releaseBaselineSession.clearActionError();
        }}
        onConfirmRestore={() => {
          void runAction("restore-baseline", restoreWorkbenchBaseline);
        }}
        onCancelLeave={() => setLeaveConfirmOpen(false)}
        onConfirmLeave={handleDiscardAndLeave}
        confirmation={confirmation}
        onCancelConfirmation={() => {
          if (pendingAction) return;
          setConfirmation(null);
        }}
        onConfirmConfirmation={() => {
          if (!confirmation) return;
          void runAction(confirmation.key, async () => {
            await confirmation.run();
            setConfirmation(null);
          });
        }}
        releaseRequiresConfirmation={Boolean(topologyRepository) && revisionGate.requiresConfirmation}
      />
    </section>
  );
}
