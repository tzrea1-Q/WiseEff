import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DtsReleaseReadinessIssue,
  DtsSearchHit,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import {
  GovernanceToast,
  useGovernanceToast
} from "@/components/parameter-admin-next/useGovernanceToast";
import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";
import {
  presentWorkbenchActivity,
  workbenchActivityApps
} from "./workbenchActivityModel";
import { WorkbenchCommandBar } from "./WorkbenchCommandBar";
import { WorkbenchBaselineDialogs } from "./WorkbenchBaselineDialogs";
import { WorkbenchCandidateActivateDialog } from "./WorkbenchCandidateActivateDialog";
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
import { WorkbenchSourceCanvas } from "./WorkbenchSourceCanvas";
import { WorkbenchSourceTree } from "./WorkbenchSourceTree";
import { WorkbenchSetupGate } from "./WorkbenchSetupGate";
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
  /** Optional org override; prefer selectedConfigSet.organizationId at runtime. */
  organizationId?: string;
  /** Injectable storage for recoverable session drafts (tests / non-DOM). */
  draftStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
};

export function ProjectConfigurationWorkbench({
  project,
  search,
  onNavigate,
  dtsRepository,
  fileRepository,
  canEdit = true,
  canEditCritical = true,
  canAdmin = true,
  listAuditEvents,
  currentUserId = "local-user",
  organizationId,
  draftStorage
}: ProjectConfigurationWorkbenchProps) {
  const { message: toastMessage, showToast } = useGovernanceToast();
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
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPersistent, setInspectorPersistent] = useState(false);
  const [inspectorLevelOverride, setInspectorLevelOverride] = useState<InspectorLevel | null>(null);
  const [fileVersions, setFileVersions] = useState<ProjectParameterFileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const {
    flow: candidateFlow,
    candidate: activeCandidate,
    sourceText: candidateSource,
    loading: candidateLoading,
    uploading: uploadingCandidate,
    activating: activatingCandidate,
    error: candidateError,
    activateError,
    activateRole,
    canActivate,
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
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const {
    facade: conflictLocateFacade,
    conflicts: syncConflicts
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
    compareSource,
    modeSourceLoading,
    modeSourceError,
    workingSnapshot
  } = useWorkbenchCanvasHistorySession();
  const sourceRegionRef = useRef<HTMLElement | null>(null);
  const workbenchBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 768px)");
    const syncViewport = () => {
      const narrow = media.matches;
      setNarrowViewport(narrow);
      setTreeOpen(!narrow);
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
    const measure = () => {
      const body = workbenchBodyRef.current;
      if (!body) return;
      const treeWidth = treeOpen
        ? treeRegionRef.current?.getBoundingClientRect().width || 260
        : 34;
      const workbenchWidth = body.getBoundingClientRect().width;
      setInspectorPersistent(shouldPersistInspector({ workbenchWidth, treeWidth }));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver !== "undefined" && workbenchBodyRef.current
        ? new ResizeObserver(measure)
        : null;
    if (workbenchBodyRef.current && observer) observer.observe(workbenchBodyRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [treeOpen, inspectorOpen, narrowViewport, selectedConfigSet?.id]);

  useEffect(() => {
    if (!selectedMember || !inspectorOpen) {
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
          setVersionsError(error instanceof Error ? error.message : "版本历史加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRepository, inspectorOpen, project.id, selectedMember]);

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
    (fileId: string, nodePath: string | null, propertyName: string | null = null) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride(null);
      onNavigate(
        navigationSession.selectStructureTarget(project.id, search, {
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
      onNavigate(
        navigationSession.selectSearchHit(project.id, search, {
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
        const nearest = nearestNodeForLine(structureNodes, line);
        if (!nearest || nearest.nodePath === selectedNodePath) return;
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

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    try {
      await action();
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
    search,
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
    search,
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
    search,
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
      setTasksOpen(true);
      if (issue.target?.fileId) {
        selectStructureTarget(
          issue.target.fileId,
          issue.target.nodePath ?? null,
          issue.target.propertyName ?? null
        );
        if (issue.target.source?.startLine) {
          setFocusLineOverride(issue.target.source.startLine);
        }
      }
    },
    [selectStructureTarget]
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
    onNavigate("/parameter-admin/projects");
  }, [onNavigate, sessionDraftsDirty]);

  const handleDiscardAndLeave = useCallback(() => {
    structuredEditSession.discard();
    setLeaveConfirmOpen(false);
    onNavigate("/parameter-admin/projects");
  }, [onNavigate, structuredEditSession]);

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
        dtsRepository
      });
      workspaceLoadSession.retryMembers();
      workspaceLoadSession.retryStructure();
      workspaceLoadSession.retrySource();
      workspaceLoadSession.retryFiles();
    } catch {
      // submitError is projected from the session snapshot
    }
  }, [canEdit, dtsRepository, project.id, selectedMember, structuredEditSession, submittingEdits, workspaceLoadSession]);

  const unifiedDiffText = useMemo(() => {
    if (canvasMode !== "unified-diff" || !historySource) return "";
    return buildUnifiedDiff(
      compareSource || source,
      historySource,
      "working",
      historyVersionId ?? "history"
    );
  }, [canvasMode, compareSource, historySource, historyVersionId, source]);

  return (
    <section className="configuration-workbench" aria-label="项目配置工作台">
      <WorkbenchCommandBar
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
        uploadingCandidate={uploadingCandidate}
        onCandidateFileChange={handleCandidateFileChange}
        downloadingDts={downloadingDts}
        onDownloadActiveDts={downloadActiveDts}
        pendingAction={pendingAction}
        onOpenActivity={openActivityInspector}
        onExportConfigSet={() => void runAction("export-config-set", exportSelectedConfigSet)}
        onOpenCreateBaseline={handleOpenCreateBaseline}
        onCreateConfigSet={submitCreateConfigSet}
      />

      <WorkbenchShellChrome
        opsError={opsError}
        opsMessage={opsMessage}
        canAdmin={canAdmin}
        narrowViewport={narrowViewport}
        treeOpen={treeOpen}
        onTreeToggle={() => setTreeOpen((open) => !open)}
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

      {selectedConfigSet ? (
        <div className="configuration-workbench__body" ref={workbenchBodyRef} aria-label="工作台主体">
          <WorkbenchSourceTree
            treeOpen={treeOpen}
            onTreeOpenChange={setTreeOpen}
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
            selectedMembers={selectedMembers}
            selectedMember={selectedMember ?? null}
            onSelectMember={selectMember}
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
          />

          <WorkbenchSourceCanvas
            sourceRegionRef={sourceRegionRef}
            selectedConfigSetName={selectedConfigSet.name}
            selectedMember={selectedMember ?? null}
            canvasMode={canvasMode}
            historyVersionId={historyVersionId}
            candidateId={candidateId}
            activeCandidate={activeCandidate}
            fileVersions={fileVersions}
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
          />

          {inspectorOpen ? (
            <WorkbenchInspectorPanel
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
              canRecompute={canRecompute}
              canActivate={canActivate}
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
              onRequestRemoveMember={requestRemoveMember}
              onSyncFile={() => void runAction("sync-file", syncSelectedFile)}
              fileVersions={fileVersions}
              versionsLoading={versionsLoading}
              versionsError={versionsError}
              onEnterCanvasMode={enterCanvasMode}
              onDownloadVersion={(version) => void handleDownloadVersion(version)}
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
            />
          ) : null}
        </div>
      ) : null}

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

      <WorkbenchTaskDock
        tasksOpen={tasksOpen}
        onTasksOpenChange={setTasksOpen}
        sessionDraftRows={sessionDraftRows}
        syncEvidence={syncEvidence}
        exportEvidence={exportEvidence}
        syncConflicts={syncConflicts}
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
        submitError={submitError}
        projectId={project.id}
        fileRepository={fileRepository}
        onConflictsChange={(next) => conflictLocateFacade.setOpenConflicts(next)}
        onLocateConflict={(conflict) => {
          const target = conflictLocateFacade.locate(conflict);
          if (!target) return;
          selectStructureTarget(target.fileId, target.nodePath, target.propertyName);
        }}
        canAdmin={canAdmin}
        acknowledgedWarningIds={acknowledgedWarningIds}
        onAcknowledgeWarning={(issueId) => {
          releaseBaselineSession.acknowledgeWarning(issueId);
        }}
        onSelectReadinessIssue={handleSelectReadinessIssue}
        onReadinessRetry={() => setReadinessRetry((value) => value + 1)}
      />

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
      />

      <GovernanceToast message={toastMessage} />
    </section>
  );
}
