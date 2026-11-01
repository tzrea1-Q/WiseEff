import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  DtsReleaseReadinessIssue,
  DtsConfigSetMemberFile,
  DtsSearchHit,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { TopologyTree } from "@/domain/parameter-topology/types";
import { effectiveStructureNodes, WorkbenchEffectiveConfiguration } from "./WorkbenchEffectiveConfiguration";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WorkbenchMemberRemovalDialog } from "./WorkbenchMemberRemovalDialog";
import { SharedMemberPendingOperations } from "./SharedMemberPendingOperations";
import { createMemberAdditionIntentClient, type MemberAdditionIntent } from "@/infrastructure/http/memberAdditionIntentClient";
import { WorkbenchSetRootDialog } from "./WorkbenchSetRootDialog";
import { CanonicalMemberRemovalSubmitDialog } from "@/features/parameter-review/CanonicalMemberRemovalSubmitDialog";
import { CanonicalBatchSubmitDialog } from "@/features/parameter-review/CanonicalBatchSubmitDialog";
import { permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";
import type {
  ParameterFileRepository,
  ProjectLocalOverrideInput,
  ProjectLocalOverrideDraft,
  ParameterFileSourceReviewStatus,
  ParameterFileSourceWorkflow,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { WorkbenchCandidateList, useWorkbenchCandidates } from "./WorkbenchCandidateList";
import { WorkbenchPropertyDefinitionContent, useWorkbenchPropertyDefinition } from "./WorkbenchPropertyDefinition";
import { validateDtsValueAgainstSchema } from "@/domain/dts/dtsValueSchema";
import { validateDtsValue } from "@/domain/dts/dtsValueClient";
import { useToast } from "@/components/common/toast/ToastProvider";
import { presentError } from "@/infrastructure/http/presentError";
import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";
import {
  presentWorkbenchActivity,
  workbenchActivityApps
} from "./workbenchActivityModel";
import { WorkbenchCommandBar } from "./WorkbenchCommandBar";
import { WorkbenchReleaseReadinessIssues, WorkbenchReleaseReadinessSummary } from "./WorkbenchReleaseReadiness";
import { WorkbenchBaselineDialogs } from "./WorkbenchBaselineDialogs";
import { WorkbenchCandidateActivateDialog } from "./WorkbenchCandidateActivateDialog";
import { WorkbenchCanonicalConflictDecision } from "./WorkbenchCanonicalConflictDecision";
import { WorkbenchSourceRollbackDialog } from "./WorkbenchSourceRollbackDialog";
import type { createCanonicalBatchRollbackClient } from "@/infrastructure/http/canonicalBatchRollbackClient";
import { WorkbenchShellChrome } from "./WorkbenchShellChrome";
import { isCriticalDtsNodePath } from "@/components/parameters/dtsCriticalPath";
import type { StructuredValueChange } from "@/components/parameters/StructuredValueEditor";
import {
  buildUnifiedDiff,
  canvasModeQueryValue,
  parseCanvasMode,
  resolveInspectorLevel,
  type InspectorLevel,
  type WorkbenchCanvasMode
} from "./workbenchInspectorModel";
import { WorkbenchInspectorPanel } from "./WorkbenchInspectorPanel";
import { WorkbenchConfigurationFilesDialog } from "./WorkbenchConfigurationFilesDialog";
import { WorkbenchMemberAdditionDialog } from "./WorkbenchMemberAdditionDialog";
import type { SharedSwitchConflict } from "@wiseeff/dto-schemas";
import { WorkbenchRevisionGate } from "./WorkbenchRevisionGate";
import { WorkbenchSourceCanvas } from "./WorkbenchSourceCanvas";
import { WorkbenchSourceEditingPane } from "./WorkbenchSourceEditingPane";
import { createSourceEditSession } from "@/application/project-configuration/sourceEditSession";
import { sourceDraftKey } from "@/application/project-configuration/sourceDraftStorage";
import type { WorkbenchDtsEditorSessions } from "./WorkbenchDtsEditor";
import { WorkbenchSourceTree } from "./WorkbenchSourceTree";
import { WorkbenchSetupGate } from "./WorkbenchSetupGate";
import { WorkbenchPackageImportDialog } from "./WorkbenchPackageImportDialog";
import { createConfigSetPackageClient } from "@/infrastructure/http/configSetPackageClient";
import { resolveParamAdminProjectsReturnPath, resolveSharedDtsiUsageReturnPath } from "@/hooks/useParamAdminProjectsSearch";
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
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { createCanonicalConflictClient } from "@/infrastructure/http/canonicalConflictClient";
import { createCanonicalMemberAdditionClient } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { createSharedDtsiClient } from "@/infrastructure/http/sharedDtsiClient";
import { createAdministratorMemberRemovalClient } from "@/infrastructure/http/administratorMemberRemovalClient";

export type ProjectConfigurationWorkbenchProject = {
  id: string;
  name: string;
  code: string;
  statusLabel: string;
};

export type ProjectConfigurationWorkbenchProps = {
  apiClient?: ApiClient;
  project: ProjectConfigurationWorkbenchProject;
  search: string;
  onNavigate: (path: string) => void;
  dtsRepository: DtsStructuredRepository;
  fileRepository: ParameterFileRepository;
  batchRollbackClient?: ReturnType<typeof createCanonicalBatchRollbackClient>;
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
    "listConfigRevisions" | "validateRevision" | "listBindings" | "createBindingDraft" | "getTopology"
  >;
};

export function ProjectConfigurationWorkbench({
  apiClient,
  project,
  search,
  onNavigate,
  dtsRepository,
  fileRepository,
  batchRollbackClient,
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
  const governanceClient = useMemo(() => createUserGovernanceClient(apiClient), [apiClient]);
  const conflictClient = useMemo(() => createCanonicalConflictClient(apiClient), [apiClient]);
  const additionClient = useMemo(() => createCanonicalMemberAdditionClient(apiClient), [apiClient]);
  const sharedDtsiClient = useMemo(() => apiClient ? createSharedDtsiClient(apiClient) : undefined, [apiClient]);
  const packageClient = useMemo(() => createConfigSetPackageClient(apiClient), [apiClient]);
  const [packageImportOpen, setPackageImportOpen] = useState(false);
  const sharedImportScope = useMemo(() => ({currentUserId, organizationId, projectId:project.id, search, sharedDtsiClient}), [currentUserId, organizationId, project.id, search, sharedDtsiClient]);
  const currentSharedImport = useRef<object | null>(sharedImportScope);
  currentSharedImport.current = sharedImportScope;
  useEffect(() => {
    currentSharedImport.current = sharedImportScope;
    return () => { if(currentSharedImport.current === sharedImportScope) currentSharedImport.current = null; };
  },[sharedImportScope]);
  const removalClient = useMemo(() => createAdministratorMemberRemovalClient(apiClient), [apiClient]);
  const { toast } = useToast();
  const [memberRemovalTarget, setMemberRemovalTarget] = useState<DtsConfigSetMemberFile | null>(null);
  const [setRootTarget, setSetRootTarget] = useState<DtsConfigSetMemberFile | null>(null);
  const [reviewedMemberRemovalTarget, setReviewedMemberRemovalTarget] = useState<DtsConfigSetMemberFile | null>(null);
  const [sourceUpdateReviewTarget, setSourceUpdateReviewTarget] = useState<HTMLDivElement | null>(null);
  const [singleConflictReview, setSingleConflictReview] = useState<{ candidateId: string; active: boolean } | null>(null);
  const showToast = useCallback((message: string) => toast({ tone: "success", message }), [toast]);
  const {
    session: workspaceLoadSession,
    configSets,
    projectFiles,
    members,
    membersBoundConfigSetId,
    source,
    sourceIdentity,
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
    structureNavigation,
    structureNavigationError,
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
    pinnedMembersLoading: baselinePinnedMembersLoading,
    pinnedMembersError: baselinePinnedMembersError,
    compareResult: baselineCompare,
    compareAgainst: baselineCompareAgainst,
    restorePreview,
    actionError: baselineActionError,
    releasedTip: releasedBaseline
  } = useReleaseBaselineSession();
  const revisionGate = useConfigRevisionGateSession();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const sourceDiscarding = useRef(false);
  const sourceEditSession = useMemo(() => {
    const session = createSourceEditSession();
    return { ...session, change: (...args: Parameters<typeof session.change>) => {
      if (!sourceDiscarding.current) session.change(...args);
    } };
  }, []);
  const sourceEditorSessions = useMemo<WorkbenchDtsEditorSessions>(() => new Map(), []);
  const sourceFlushRef = useRef<(() => void) | null>(null);
  const sourceEditSnapshot = useSyncExternalStore(sourceEditSession.subscribe, sourceEditSession.getSnapshot, sourceEditSession.getSnapshot);
  const [sourceBufferDirty, setSourceBufferDirty] = useState(false);
  const sourceDraftsDirty = sourceBufferDirty || Object.values(sourceEditSnapshot.files).some((file) => file.dirty);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!sourceDraftsDirty) return;
      void sourceEditSession.flush();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); void sourceEditSession.flush(); };
  }, [sourceDraftsDirty, sourceEditSession]);
  const [createConfigSetOpen, setCreateConfigSetOpen] = useState(false);
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
    sourceReviewResult,
    activateRole,
    canActivate,
    canSubmitSourceReview,
    canRecompute,
    canAbandon
  } = useCandidateVersionFlow();
  const candidateRecords = useWorkbenchCandidates({ projectId: project.id, repository: fileRepository,
    reviewRepository: memberRemovalRepository,
    reloadToken: activeCandidate ? `${activeCandidate.id}:${activeCandidate.status}:${activeCandidate.updatedAt}` : "" });
  const [reviewStatusById, setReviewStatusById] = useState<Record<string, ParameterFileSourceReviewStatus>>({});
  useEffect(() => {
    if (!sourcePreview) return;
    const { candidateId: id, request } = sourcePreview;
    setReviewStatusById((current) => {
      if (current[id] === request?.status) return current;
      const next = { ...current };
      if (request) next[id] = request.status;
      else delete next[id];
      return next;
    });
  }, [sourcePreview]);
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
    () => {
      const names = new Map([...projectFiles.map((file) => [file.id, file.fileName] as const),
        ...configSets.map((set) => [set.id, set.name === "default" ? "默认配置" : set.name] as const),
        ...baselines.map((baseline) => [baseline.id, baseline.name] as const)]);
      return activityEvents.map((event) => presentWorkbenchActivity(event, names));
    },
    [activityEvents, baselines, configSets, projectFiles]
  );
  const candidateFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastVisibleLine, setLastVisibleLine] = useState<number | null>(null);
  const [restoredScrollLine, setRestoredScrollLine] = useState<number | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [leavePending, setLeavePending] = useState(false);
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
    storageError,
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
    sourceFocusTarget,
    searchDraft,
    searchQuery,
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
  const sharedImportRevisionId = revisionGate.loading || revisionGate.error ? null : revisionGate.revisions
    .filter(revision => revision.configSetId === selectedConfigSet?.id && ["resolved","validated","compiled","pending_approval"].includes(revision.status))
    .sort((left,right) => right.revisionNumber-left.revisionNumber)[0]?.id ?? null;
  const configBaselines = useMemo(
    () => baselines.filter((item) => item.configSetId === selectedConfigSet?.id),
    [baselines, selectedConfigSet?.id]
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
  const contentTab = requestedTab === "conflicts" ? "conflicts"
    : requestedTab === "effective" ? "effective"
    : requestedTab === "source" || requestedTab === "structure" ? "source"
    : queryValue(search, "tasks") === "conflicts" || queryValue(search, "dock") === "conflicts" ? "conflicts"
    : apiMode && topologyRepository && !queryValue(search, "file") && !queryValue(search, "sourceMode")
      && !["file", "versions", "candidates"].includes(queryValue(search, "inspector") ?? "") ? "effective" : "source";
  const showContentTabs = Boolean(topologyRepository) || contentTab === "conflicts" || syncConflicts.length > 0 || Boolean(conflictsError);
  const effectiveRevision = queryValue(search, "revision") ?? "current";
  const currentEffective = ["current", "latest", "head"].includes(effectiveRevision);
  const currentEffectiveRevisionId = revisionGate.revisions.filter(revision => revision.configSetId === selectedConfigSet?.id && revision.status !== "resolving")
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0]?.id ?? null;
  const effectiveKey = `${project.id}/${selectedConfigSet?.id}/${effectiveRevision}/${currentEffective ? currentEffectiveRevisionId : ""}`;
  const [effectiveRetry, setEffectiveRetry] = useState(0);
  const [effectiveResult, setEffectiveResult] = useState<{ key: string; tree?: Extract<TopologyTree, { view: "effective" }>; error?: string } | null>(null);
  useEffect(() => {
    if (contentTab !== "effective" || !selectedConfigSet || !topologyRepository) return;
    setEffectiveResult(null);
    if (currentEffective && (membersListLoading || membersError || selectedMembers.length === 0
      || revisionGate.loading || revisionGate.error || !currentEffectiveRevisionId)) return;
    let cancelled = false;
    void topologyRepository.getTopology(project.id, selectedConfigSet.id, effectiveRevision, "effective").then(tree => {
      if (tree.view !== "effective") throw new Error("生效配置返回了错误的视图，请重试。");
      if (!cancelled) setEffectiveResult({ key: effectiveKey, tree });
    }).catch(error => { if (!cancelled) setEffectiveResult({ key: effectiveKey, error: presentError(error, "生效配置加载失败。") }); });
    return () => { cancelled = true; };
  }, [contentTab, currentEffective, currentEffectiveRevisionId, effectiveKey, effectiveRetry, effectiveRevision, membersError, membersListLoading, project.id, revisionGate.error, revisionGate.loading, selectedConfigSet, selectedMembers.length, topologyRepository]);
  const effectiveTree = effectiveResult?.key === effectiveKey ? effectiveResult.tree : undefined;
  const effectiveError = effectiveResult?.key === effectiveKey ? effectiveResult.error : undefined;
  const effectiveNodes = useMemo(() => effectiveStructureNodes(effectiveTree?.nodes ?? []), [effectiveTree]);
  const effectiveNodePath = queryValue(search, "node") ?? effectiveTree?.nodes.find(node => node.locator !== "/")?.locator ?? "/";
  const effectiveNode = effectiveTree?.nodes.find(node => node.locator === effectiveNodePath) ?? null;
  const [localOverrideDraft, setLocalOverrideDraft] = useState<(ProjectLocalOverrideDraft & { input: ProjectLocalOverrideInput }) | null>(null);
  const selectedSourceOverride = Object.values(sourceEditSnapshot.files).find(file => file.scope.projectId === project.id
    && file.scope.configSetId === selectedConfigSet?.id && file.scope.fileId === selectedMember?.fileId)?.base.localOverride;
  const describeLocalChange = (action: ProjectLocalOverrideInput["action"], value: string | null) => {
    const label = { set: "本项目覆盖后", "remove-override": "撤销本项目覆盖后", "delete-property": "显式删除属性后",
      "enable-node": "在本项目启用后", "disable-node": "在本项目禁用后", "remove-status-override": "撤销本项目状态覆盖后", "delete-node": "显式删除节点后" }[action];
    return `${label}：${action === "delete-node" ? "节点及子节点不存在" : value ?? (action === "delete-property" ? "属性缺失，继承值不生效" : "属性缺失")}。保存时将重新验证完整配置。`;
  };
  const overrideContext = useRef("");
  overrideContext.current = `${effectiveKey}/${effectiveTree?.revisionId ?? ""}/${contentTab}/${effectiveNodePath}`;
  const prepareLocalOverride = async (input: ProjectLocalOverrideInput) => {
    if (!fileRepository.prepareProjectLocalOverride || !selectedConfigSet || !resolvedOrganizationId) return;
    sourceFlushRef.current?.();
    if (sessionDraftsDirty || Object.values(sourceEditSession.getSnapshot().files).some(file => file.dirty)) throw new Error("请先保存或放弃现有草稿，再准备本项目覆盖。");
    const context = overrideContext.current;
    const draft = await fileRepository.prepareProjectLocalOverride(project.id, selectedConfigSet.id, input);
    if (overrideContext.current !== context) return;
    if (draft.before === draft.after) throw new Error("此值与当前本项目声明相同，没有需要保存的修改。");
    const scope = { userId: currentUserId, organizationId: resolvedOrganizationId, projectId: project.id,
      configSetId: selectedConfigSet.id, fileId: draft.fileId };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(draft.before));
    if (overrideContext.current !== context) return;
    await sourceEditSession.open({ scope, sourceText: draft.before, base: { fileVersionId: draft.baseVersionId,
      configRevisionId: draft.configRevisionId, sourceDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
      ...(draft.localOverride ? { localOverride: { input: draft.localOverride, afterValue: draft.afterValue } } : {}) } });
    if (overrideContext.current !== context) return;
    if (sourceEditSession.getFile(scope)?.dirty) throw new Error("此文件已有恢复草稿，请先在项目源码中处理。");
    sourceEditorSessions.delete(sourceDraftKey(scope));
    sourceEditSession.change(scope, draft.after);
    if (!await sourceEditSession.flush(scope)) throw new Error("无法保存本地恢复草稿，请重试后再提交。");
    if (overrideContext.current !== context) return;
    setLocalOverrideDraft({ ...draft, input });
    const params = new URLSearchParams(search); params.set("tab", "source");
    onNavigate(formatWorkbenchPath(project.id, params.toString(), { configSet: selectedConfigSet.id, file: draft.fileId,
      sourceMode: "working", version: null, inspector: null }));
  };
  const selectEffectiveNode = (node: string, property: string | null = null) => {
    const params = new URLSearchParams(search);
    params.set("tab", "effective"); params.set("node", node);
    params.delete("inspector"); setInspectorOpen(false);
    if (property) params.set("property", property); else params.delete("property");
    onNavigate(`/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${params}`);
  };
  const contentTabsWereVisible = useRef(showContentTabs);
  useEffect(() => {
    if (contentTabsWereVisible.current && !showContentTabs && document.activeElement === document.body) {
      sourceRegionRef.current?.focus();
    }
    contentTabsWereVisible.current = showContentTabs;
  }, [showContentTabs]);
  const canvasSearchParams = new URLSearchParams(search);
  if (contentTab !== "source") canvasSearchParams.set("tab", "source");
  const canvasSearch = canvasSearchParams.toString();
  const selectContentTab = (tab: string) => {
    const params = new URLSearchParams(search);
    params.set("tab", tab);
    if (tab === "effective") { setInspectorOpen(false); params.delete("inspector"); }
    onNavigate(`/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${params.toString()}`);
  };

  const candidateId = queryValue(search, "candidate");
  const historyVersionId = queryValue(search, "version");

  const derivedInspectorLevel = resolveInspectorLevel({
    fileSelected: Boolean(selectedMember),
    nodePath: selectedNodePath,
    propertyName: selectedPropertyName
  });
  const requestedInspectorLevel: InspectorLevel = canvasMode === "candidate" && (!inspectorLevelOverride || inspectorLevelOverride === "file")
    ? "candidates" : inspectorLevelOverride ?? derivedInspectorLevel;
  const inspectorLevel = requestedInspectorLevel === "file" ? "versions" : requestedInspectorLevel;
  const openInspector = useCallback((level: InspectorLevel, fileId?: string) => {
    setInspectorLevelOverride(level);
    setInspectorOpen(true);
    if (!selectedConfigSet) return;
    const switchingFile = fileId && fileId !== selectedMember?.fileId;
    const targetPath = formatWorkbenchPath(project.id, ["file", "versions", "candidates"].includes(level) ? canvasSearch : search, { configSet: selectedConfigSet.id, inspector: level,
      ...(switchingFile ? { file: fileId, node: null, property: null, sourceMode: null, version: null, candidate: null } : {}) });
    if (targetPath !== `/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${search.replace(/^\?/, "")}`) onNavigate(targetPath);
  }, [onNavigate, project.id, search, canvasSearch, selectedConfigSet, selectedMember?.fileId]);
  const closeInspector = () => {
    setInspectorOpen(false);
    if (selectedConfigSet && queryValue(search, "inspector")) onNavigate(formatWorkbenchPath(project.id, search, {
      configSet: selectedConfigSet.id, inspector: null
    }));
  };

  useEffect(() => {
    setInspectorLevelOverride(null);
  }, [selectedMember?.fileId, selectedNodePath, selectedPropertyName]);

  useEffect(() => {
    const inspector = queryValue(search, "inspector");
    if (inspector === "selection") {
      setInspectorLevelOverride(null);
      setInspectorOpen(true);
    } else if (["activity", "file", "config-set", "release", "versions", "candidates"].includes(inspector ?? "")) {
      setInspectorLevelOverride(inspector as InspectorLevel);
      setInspectorOpen(true);
    }
    // Re-apply when the default member appears; the clear-override effect above would
    // otherwise drop cutover `inspector=` before assertions/navigation settle.
  }, [search, selectedMember?.fileId, selectedNodePath, selectedPropertyName]);

  useEffect(() => {
    const tasks = queryValue(search, "tasks");
    const dock = queryValue(search, "dock");
    if (tasks === "conflicts" || dock === "conflicts") {
      setTasksOpen(true);
    }
  }, [search]);

  useEffect(() => {
    if (!selectedMember || (!inspectorOpen && canvasMode !== "unified-diff")) {
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
  const [memberAdditionOpen, setMemberAdditionOpen] = useState(false);
  const [switchSharedMember,setSwitchSharedMember]=useState<DtsConfigSetMemberFile|null>(null);
  const [conversionSource,setConversionSource]=useState<{configRevisionId:string;fileId:string;fileVersionId:string;sourceName:string}|undefined>();
  const resolvedOrganizationId = organizationId ?? selectedConfigSet?.organizationId ?? null;
  const intentClient=useMemo(()=>apiClient&&resolvedOrganizationId&&apiMode?createMemberAdditionIntentClient(apiClient,resolvedOrganizationId):null,[apiClient,resolvedOrganizationId,apiMode]);
  const [intentRefresh,setIntentRefresh]=useState(0);
  const currentIntent=useRef<MemberAdditionIntent|null>(null);
  const switchTaskKey=`wiseeff.shared-switch:${currentUserId}:${resolvedOrganizationId}:${project.id}:${selectedConfigSet?.id}`;
  const [memberAdditionScope,setMemberAdditionScope]=useState("");
  const currentMemberAdditionScope=useRef("");
  currentMemberAdditionScope.current=canAdmin?switchTaskKey:"";
  const openMemberAddition=()=>{setMemberAdditionScope(switchTaskKey);setMemberAdditionOpen(true);};
  type SwitchTask={scope:string;operation?:"remove";reference:{resourceId:string;versionId:string;version:number};draft:{versionId:string;reason:string}};
  const [switchTask,setSwitchTask]=useState<SwitchTask|null>(null);
  const activeSwitchTask=switchTask?.scope===switchTaskKey?switchTask:null;
  useEffect(()=>{
    currentIntent.current=null;setMemberAdditionOpen(false);setConversionSource(undefined);setSwitchSharedMember(null);
    try {
      const saved=JSON.parse(sessionStorage.getItem(switchTaskKey)??"null") as SwitchTask|null;
      if(saved?.scope===switchTaskKey && typeof saved.reference?.resourceId==="string" && typeof saved.reference.versionId==="string"
        && typeof saved.reference.version==="number" && typeof saved.draft?.versionId==="string" && typeof saved.draft.reason==="string")setSwitchTask(saved);
    }catch{/* A missing recovery draft never supplies a preview proof. */}
  },[switchTaskKey]);
  const saveSwitchTask=useCallback((task:SwitchTask)=>{
    sessionStorage.setItem(switchTaskKey,JSON.stringify(task));setSwitchTask(task);
  },[switchTaskKey]);
  const updateSwitchDraft=useCallback((draft:SwitchTask["draft"])=>{
    setSwitchTask(current=>{
      if(!current || current.scope!==switchTaskKey || current.draft.versionId===draft.versionId && current.draft.reason===draft.reason)return current;
      const next={...current,draft};try{sessionStorage.setItem(switchTaskKey,JSON.stringify(next));}catch{/* Keep the in-page task when browser storage is unavailable. */}return next;
    });
  },[switchTaskKey]);
  const dismissSwitchTask=()=>{setMemberAdditionOpen(false);setConversionSource(undefined);setSwitchSharedMember(null);setSwitchTask(null);try{sessionStorage.removeItem(switchTaskKey);}catch{/* Cancellation remains available when browser storage is unavailable. */}};
  const resumedSwitch=useRef("");
  useEffect(()=>{
    if(queryValue(search,"sharedSwitch")==="resume" && activeSwitchTask && canAdmin && resumedSwitch.current!==switchTaskKey){
      resumedSwitch.current=switchTaskKey;openMemberAddition();
    }
  },[search,activeSwitchTask,canAdmin,switchTaskKey]);
  const recoverSwitch=(location:SharedSwitchConflict,draft:SwitchTask["draft"])=>{
    const reference=activeSwitchTask?.reference??switchSharedMember?.sharedReference;
    if(!reference || !selectedConfigSet)return;
    try{saveSwitchTask({scope:switchTaskKey,...(activeSwitchTask?.operation?{operation:activeSwitchTask.operation}:{}),reference,draft});}catch{toast({tone:"danger",message:"无法保存引用变更任务，请检查浏览器存储后重试。"});return;}
    setMemberAdditionOpen(false);resumedSwitch.current="";
    const params=new URLSearchParams({organizationId:resolvedOrganizationId??"",configSet:selectedConfigSet.id,tab:"source",sourceMode:"working",sharedSwitch:"paused"});
    const usageReturn=resolveSharedDtsiUsageReturnPath(search);if(usageReturn)params.set("returnTo",usageReturn);
    if(location.fileId&&!location.resourceId)params.set("file",location.fileId);
    if(location.node)params.set("node",location.node);
    if(location.property)params.set("property",location.property);
    if(location.line){params.set("line",String(location.line));setFocusLineOverride(location.line);}
    const returnPath=`/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${params}`;
    if(location.resourceId && location.versionId){
      params.set("sharedSwitch","resume");
      const sharedParams=new URLSearchParams({organization:resolvedOrganizationId??"",resource:location.resourceId,version:location.versionId,
        tab:location.identity?"recognition":"source",projectContext:`/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${params}`});
      if(location.memberId)sharedParams.set("member",location.memberId);
      if(location.line)sharedParams.set("line",String(location.line));
      onNavigate(`/parameter-admin/sources?${sharedParams}`);
    }else onNavigate(returnPath);
  };
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
        ? "此文件的配置归属变更需要审核，不能直接加入配置。"
        : "正在校验文件来源，请稍候。")
  ]));
  const sourceWorkflowSetLoading =
    sourceWorkflowLoading || filesLoading || membersListLoading;
  const updateFile = projectFiles.find((file) => file.id === activeCandidate?.fileId);
  const updateWorkflow = activeCandidate?.fileId ? sourceWorkflowsByFileId[activeCandidate.fileId] : null;
  const updateWorkflowError = activeCandidate?.fileId ? sourceWorkflowErrorsByFileId[activeCandidate.fileId] : "";
  const sourceUpdateBlockedReason = !apiMode || !activeCandidate?.fileId ? ""
    : sourceWorkflowSetLoading ? "正在重新核对文件版本与来源证明；已暂时阻止提交，选择会保留。"
    : updateWorkflowError || filesError || membersError
      ? `当前来源核对失败，已阻止提交：${updateWorkflowError || filesError || membersError}`
      : !updateFile || updateFile.currentVersionId !== activeCandidate.baseVersionId
        || sourcePreview?.cohortProofToken && updateWorkflow?.proofToken !== sourcePreview.cohortProofToken
        ? "文件版本或来源证明已变化，旧更新不能继续提交；请刷新工作台后重新核对。"
        : "";
  const canRequestReviewedMemberRemoval = apiMode && sourceWorkflowSetCanonical;
  const canRequestLegacyMemberRemoval = apiMode && selectedMembers.length >= 2 && selectedMembers.every((member) => member.format === "json"
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

  const reloadModeSource = useCallback(() =>
    canvasHistorySession.loadModeSource({
      canvasMode,
      projectId: project.id,
      fileId: selectedMember?.fileId ?? null,
      versionId: historyVersionId,
      currentVersionId: selectedMember?.currentVersionId ?? null,
      workingSource: source,
      repo: fileRepository
    }), [
    canvasHistorySession,
    canvasMode,
    fileRepository,
    historyVersionId,
    project.id,
    selectedMember,
    source
  ]);
  useEffect(() => { void reloadModeSource(); }, [reloadModeSource]);

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
    if (path) onNavigate(contentTab === "effective" && !queryValue(search, "tab") ? `${path}&tab=effective` : path);
  }, [
    contentTab,
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
      canvasMode === "history" && historyVersionId ? historyVersionId : selectedMemberVersionId,
      dtsRepository,
      apiMode ? { navigationScope: "organization" } : undefined
    );
  }, [
    apiMode,
    canvasMode,
    dtsRepository,
    project.id,
    historyVersionId,
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
    if (!sourceFocusTarget) return null;
    const node = structureNodes.find((item) => item.nodePath === sourceFocusTarget.nodePath);
    if (!node) return null;
    if (sourceFocusTarget.propertyName) {
      const property = node.properties.find((item) => item.name === sourceFocusTarget.propertyName);
      return locatorToFocusSpan(property?.source ?? node.source);
    }
    return locatorToFocusSpan(node.source);
  }, [sourceFocusTarget, structureNodes]);

  const selectStructureTarget = useCallback(
    (fileId: string, nodePath: string | null, propertyName: string | null = null, showSource = false) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride(null);
      setInspectorOpen(true);
      releaseBaselineSession.clearCompare();
      const params = new URLSearchParams(search);
      params.set("inspector", "selection");
      params.delete("candidate");
      if (showSource) params.set("tab", "source");
      const targetPath = navigationSession.selectStructureTarget(project.id, params.toString(), {
          configSetId: selectedConfigSet.id,
          fileId,
          nodePath,
          propertyName,
          sourceMode: null,
          versionId: null
        });
      if (targetPath !== `/parameter-admin/projects/${encodeURIComponent(project.id)}/configuration?${search.replace(/^\?/, "")}`) onNavigate(targetPath);
    },
    [navigationSession, onNavigate, project.id, releaseBaselineSession, search, selectedConfigSet]
  );

  const runUnifiedSearch = useCallback(async () => {
    await navigationSession.runSearch(project.id, dtsRepository, apiMode ? { navigationScope: "organization" } : undefined);
  }, [apiMode, dtsRepository, navigationSession, project.id]);

  const handleSearchHit = useCallback(
    (hit: DtsSearchHit) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride(null);
      setInspectorOpen(true);
      releaseBaselineSession.clearCompare();
      const params = new URLSearchParams(search);
      params.set("inspector", "selection");
      params.delete("candidate");
      params.set("tab", "source");
      onNavigate(
        navigationSession.selectSearchHit(project.id, params.toString(), {
          configSetId: selectedConfigSet.id,
          hit,
          sourceMode: null,
          versionId: null
        })
      );
    },
    [navigationSession, onNavigate, project.id, releaseBaselineSession, search, selectedConfigSet]
  );

  const handleVisibleLineChange = useCallback(
    (line: number) => {
      setLastVisibleLine(line);
      if (suppressScrollSync || !selectedMember || canvasMode !== "working") return;
      if (scrollSyncTimerRef.current != null) {
        window.clearTimeout(scrollSyncTimerRef.current);
      }
      scrollSyncTimerRef.current = window.setTimeout(() => {
        // Keep the editing target stable when focusing or scrolling its source.
        if (navigationSession.suppressScrollSync || navigationSession.selectedPropertyName) return;
        const nearest = nearestNodeForLine(structureNodes, line);
        if (!nearest || nearest.nodePath === navigationSession.selectedNodePath) return;
        navigationSession.setStructureSelection(nearest.nodePath, null, false);
      }, 80);
    },
    [canvasMode, navigationSession, selectedMember, selectedNodePath, structureNodes, suppressScrollSync]
  );

  const memberIds = useMemo(
    () => new Set(selectedMembers.map((item) => item.fileId)),
    [selectedMembers]
  );
  const ungroupedFiles = projectFiles.filter((item) => !memberIds.has(item.id)
    && !sourceWorkflowsByFileId[item.id]?.configSetId);

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
      if (!canAdmin || !selectedMember || selectedMember.sharedReference) return;
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
        onNavigate(`/parameter-review?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(result.requestId)}`);
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
    apiMode,
    search: canvasSearch,
    onNavigate,
    canAdmin,
    dtsRepository,
    releaseBaselineSession,
    workspaceLoadSession,
    selectedConfigSet,
    selectedMemberFileId,
    selectedBaselineId,
    baselines: configBaselines,
    acknowledgedWarningIds,
    canvasMode,
    historyVersionId,
    candidateId,
    selectedNodePath,
    selectedPropertyName,
    sessionDraftsDirty: sessionDraftsDirty || sourceDraftsDirty,
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
    onDismissOperationResults,
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
    enterCanvasMode,
    exitSpecialCanvasMode,
    handleDownloadVersion
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

  const canSubmitBatchReview = Boolean(apiMode && canEdit && canAdmin && !selectedMember?.sharedReference && activeCandidate?.status === "ready"
    && sourcePreview?.kind === "canonical" && sourcePreview.candidateId === activeCandidate.id
    && ["json", "dts"].includes(sourcePreview.format.toLowerCase()) && sourcePreview.proofToken
    && sourcePreview.bindings && sourcePreview.bindings.length >= 2
    && sourcePreview.bindings.every((binding) => binding.bindingId && binding.sourcePinId
      && (binding.action === "delete" || binding.afterText !== undefined))
    && new Set(sourcePreview.bindings.map((binding) => binding.bindingId)).size === sourcePreview.bindings.length
    && permitsFreshBatchRequest(sourcePreview.request) && !sourcePreviewLoading && !sourcePreviewError
    && memberRemovalRepository?.submitProjectValueBatchChangeRequest);
  const singleConflictOpened = Boolean(activeCandidate && singleConflictReview?.candidateId === activeCandidate.id);
  const singleConflictActive = singleConflictOpened && singleConflictReview?.active;
  const handleConfirmSourceReview = useCallback(
    async (reason: string, reviewerId: string) => {
      const result = await candidateFlow.submitSourceReview(project.id, reason, fileRepository, reviewerId);
      notifyMutation(`来源变更审核已提交（${result.status}）。审核通过前当前配置不变。`);
      setSourceWorkflowReloadToken((value) => value + 1);
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

  const criticalLocked =
    Boolean(selectedStructureNode) &&
    !canEditCritical &&
    isCriticalDtsNodePath(selectedStructureNode!.nodePath);
  const editorLocked = !canEdit || Boolean(selectedMember?.sharedReference) || criticalLocked || staleDraftLocked;

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

  const propertyDefinition = useWorkbenchPropertyDefinition({
    projectId: project.id, revisionId: revisionGate.selectedRevisionId,
    fileId: selectedMember?.fileId ?? null, nodePath: selectedStructureNode?.nodePath ?? null,
    propertyName: selectedStructureProperty?.name ?? null,
    topologyRepository, catalogRepository: memberRemovalRepository
  });
  const valueShape = propertyDefinition.detail?.valueShape;
  const propertyValueSchema = valueShape && typeof valueShape === "object" && "schema" in valueShape ? valueShape.schema : undefined;

  // A late definition response revalidates the same draft, never replaces its input.
  useEffect(() => {
    if (propertyDefinition.status !== "ready" || !activePropertyDraft || !selectedMember || !selectedStructureNode || !selectedStructureProperty || activePropertyDraft.editorState || activePropertyDraft.present === false) return;
    const syntax = validateDtsValue(activePropertyDraft.rawText, selectedStructureProperty.name);
    const error = syntax.error ?? validateDtsValueAgainstSchema(selectedStructureProperty.name, activePropertyDraft.rawText, propertyValueSchema);
    const valid = syntax.valid && !error;
    if (activePropertyDraft.valid === valid && activePropertyDraft.error === error) return;
    structuredEditSession.change({ fileId: selectedMember.fileId, nodePath: selectedStructureNode.nodePath, propertyName: selectedStructureProperty.name }, {
      ...activePropertyDraft, valid, error
    });
  }, [activePropertyDraft, propertyDefinition.status, propertyValueSchema, selectedMember, selectedStructureNode, selectedStructureProperty, structuredEditSession]);

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

  const sharedUsageReturnPath=resolveSharedDtsiUsageReturnPath(search);
  const workbenchReturnPath = sharedUsageReturnPath ?? (canAdmin ? resolveParamAdminProjectsReturnPath(search) : `/parameters?project=${encodeURIComponent(project.id)}`);
  const handleLeaveWorkbench = useCallback(() => {
    sourceFlushRef.current?.();
    if (sessionDraftsDirty || sourceDraftsDirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    onNavigate(workbenchReturnPath);
  }, [onNavigate, workbenchReturnPath, sessionDraftsDirty, sourceDraftsDirty]);

  const handleKeepDraftsAndLeave = useCallback(() => {
    if (sourceDiscarding.current) return;
    sourceFlushRef.current?.();
    sourceDiscarding.current = true;
    setLeavePending(true); setLeaveError("");
    void sourceEditSession.flush().then((ok) => {
      if (!ok) throw new Error("无法保存本地恢复草稿，请重试或先下载草稿。");
      if (structuredEditSession.getSnapshot().storageError) throw new Error("参数恢复草稿保存失败，请留在本页重试或复制草稿。");
      setLeaveConfirmOpen(false);
      onNavigate(workbenchReturnPath);
    }).catch((cause) => {
      sourceDiscarding.current = false;
      setLeaveError(presentError(cause, "保留草稿失败，请重试。"));
    }).finally(() => setLeavePending(false));
  }, [onNavigate, workbenchReturnPath, sourceEditSession, structuredEditSession]);

  const handleDiscardAndLeave = useCallback(() => {
    if (sourceDiscarding.current) return;
    sourceDiscarding.current = true;
    setLeavePending(true);
    setLeaveError("");
    void (async () => {
      try {
        const results = await Promise.all(Object.values(sourceEditSession.getSnapshot().files).map((file) => sourceEditSession.discard(file.scope)));
        if (results.some((ok) => !ok)) throw new Error("无法清除本地恢复副本，请重试或先下载草稿。");
        sourceEditorSessions.clear();
        structuredEditSession.discard();
        setSourceBufferDirty(false);
        setLeaveConfirmOpen(false);
        onNavigate(workbenchReturnPath);
      } catch (cause) {
        sourceDiscarding.current = false;
        setLeaveError(presentError(cause, "放弃本地修改失败，请重试。"));
      } finally { setLeavePending(false); }
    })();
  }, [onNavigate, workbenchReturnPath, sourceEditSession, sourceEditorSessions, structuredEditSession]);

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
          ...(typeof next.present === "boolean" ? { present: next.present } : {}),
          ...(next.editorState ? { editorState: next.editorState } : {})
        }
      );
    },
    [
      editorLocked,
      selectedMember,
      selectedStructureNode,
      selectedStructureProperty,
      structuredEditSession
    ]
  );

  const handleSubmitSelected = useCallback(async () => {
    if (!selectedMember || selectedMember.sharedReference || !canEdit || submittingEdits) return;
    try {
      await structuredEditSession.submit({
        projectId: project.id,
        fileId: selectedMember.fileId,
        fileName: selectedMember.fileName,
        dtsRepository,
        catalogRepository: topologyRepository,
        definitionRepository: memberRemovalRepository,
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
    memberRemovalRepository,
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
      "工作配置",
      fileVersions.find((version) => version.id === historyVersionId)?.versionNumber
        ? `历史版本 v${fileVersions.find((version) => version.id === historyVersionId)?.versionNumber}` : "历史版本"
    );
  }, [canvasMode, compareSource, fileVersions, historySource, historySourceAvailable, historyVersionId]);

  const taskDock = (
      <WorkbenchTaskDock
        tasksOpen={tasksOpen}
        onTasksOpenChange={(open) => {
          setTasksOpen(open);
        }}
        sessionDraftRows={sessionDraftRows}
        storageError={storageError}
        onLocateDraft={(row) => {
          setTasksOpen(false);
          selectStructureTarget(row.fileId, row.nodePath, row.propertyName, true);
        }}
        syncEvidence={syncEvidence}
        canonicalSyncCheck={canonicalSyncCheck}
        exportEvidence={exportEvidence}
        onDismissOperationResults={onDismissOperationResults}
        syncConflicts={syncConflicts}
        showConflictArbitration={false}
        autoLocateConflicts={contentTab !== "conflicts"}
        draftRecoveryStatus={draftRecoveryStatus}
        draftCopyFallbackRef={draftCopyFallbackRef}
        draftCopyStatus={draftCopyStatus}
        onCopySessionDrafts={handleCopySessionDrafts}
        onDiscardDraft={(key) => structuredEditSession.discard(key)}
        onDiscardAllDrafts={() => structuredEditSession.discard()}
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
      />
  );

  const inspectorPanel = inspectorOpen && inspectorLevel !== "config-set" && selectedConfigSet ? <WorkbenchInspectorPanel
              inspectorPersistent={!narrowViewport}
              narrowViewport={narrowViewport}
              inspectorLevel={inspectorLevel}
              configSetName={selectedConfigSet.name === "default" ? "默认配置" : selectedConfigSet.name}
              onClose={closeInspector}
              selectedMember={selectedMember}
              selectedPropertyName={selectedPropertyName}
              selectedNodePath={selectedNodePath}
              sourceUpdateUpload={<div className="configuration-workbench__source-update-upload">
                {selectedMember?.sharedReference ? <p>共享引用版本 {selectedMember.sharedReference.version} 的来源只读；可查看来源和历史。</p>
                  : selectedMember ? <p>更新「{selectedMember.fileName}」，上传后先核对差异。</p> : null}
                {canAdmin && !selectedMember?.sharedReference ? <Button type="button" size="sm" variant="outline" disabled={uploadingCandidate}
                  onClick={() => candidateFileInputRef.current?.click()}>
                  {uploadingCandidate ? "上传中…" : selectedMember ? "上传新文件" : "添加来源文件"}
                </Button> : !canAdmin ? <p role="note">仅项目管理员可上传文件，已有更新记录可查看。</p> : null}
                {candidateError && canvasMode !== "candidate" ? <p role="alert">{candidateError}</p> : null}
                {candidateRecords.reviewStatusError && candidateRecords.items.length > 0
                  ? <p role="status">审核状态暂不可用，可打开记录核对。</p> : null}
              </div>}
              sourceUpdateReview={<div ref={setSourceUpdateReviewTarget} />}
              batchReviewInline={canSubmitBatchReview && !singleConflictActive}
              candidateList={<WorkbenchCandidateList state={candidateRecords} selectedId={candidateId} currentFileId={selectedMember?.fileId}
                reviewStatusById={{ ...reviewStatusById, ...candidateRecords.reviewStatusById,
                  ...(sourcePreview?.candidateId === activeCandidate?.id && sourcePreview?.request
                    ? { [sourcePreview.candidateId]: sourcePreview.request.status } : {}) }}
                onSelect={(candidate) => {
                  setInspectorLevelOverride("candidates");
                  onNavigate(formatWorkbenchPath(project.id, canvasSearch, { configSet: selectedConfigSet.id,
                    file: candidate.fileId ?? null, candidate: candidate.id, sourceMode: "candidate", version: null, node: null, property: null, inspector: "candidates" }));
                }} />}
              propertyDefinition={selectedStructureProperty ? <WorkbenchPropertyDefinitionContent state={propertyDefinition} propertyName={selectedStructureProperty.name} /> : null}
              propertyValueSchema={propertyValueSchema}
              draftStorageError={storageError}
              onDiscardPropertyDraft={() => { if (activePropertyDraftKey) structuredEditSession.discard(activePropertyDraftKey); }}
              onOpenDrafts={() => setTasksOpen(true)}
              onRetryVersions={() => setVersionsReloadToken((value) => value + 1)}
              baselines={configBaselines}
              releasedBaseline={releasedBaseline}
              selectedBaselineId={selectedBaselineId}
              baselinesLoading={baselinesLoading}
              baselinesError={baselinesError}
              baselineActionError={baselineActionError}
              baselineCompare={baselineCompare}
              baselineCompareAgainst={baselineCompareAgainst}
              baselinePinnedMembers={baselinePinnedMembers}
              baselinePinnedMembersLoading={baselinePinnedMembersLoading}
              baselinePinnedMembersError={baselinePinnedMembersError}
              onRetryBaselineMembers={() => { void releaseBaselineSession.loadPinnedMembers(project.id, dtsRepository); }}
              canAdmin={canAdmin && (inspectorLevel === "release" || !selectedMember?.sharedReference)}
              releaseReadiness={readinessError ? null : releaseReadiness}
              sessionDraftsDirty={sessionDraftsDirty || sourceDraftsDirty}
              sourceEditing={selectedMember?.format === "dts"}
              readinessLoading={readinessLoading}
              onOpenCreateBaseline={handleOpenCreateBaseline}
              releaseIssues={readinessLoading ? <SectionSkeleton label="正在检查配置版本…" />
                : readinessError ? <SectionError message={readinessError} onRetry={() => setReadinessRetry((value) => value + 1)} />
                : <WorkbenchReleaseReadinessIssues readiness={releaseReadiness}
                acknowledgedWarningIds={acknowledgedWarningIds}
                onAcknowledgeWarning={(issueId) => releaseBaselineSession.acknowledgeWarning(issueId)}
                onSelectIssue={handleSelectReadinessIssue} onRetry={() => setReadinessRetry((value) => value + 1)} />}
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
              onSelectBaselineCompareMember={selectBaselineCompareMember}
              activeCandidate={activeCandidate}
              sourcePreview={sourcePreview}
              sourcePreviewLoading={sourcePreviewLoading}
              sourcePreviewError={sourcePreviewError}
              onRetrySourceUpdate={() => { if (candidateId) void candidateFlow.load(project.id, candidateId, fileRepository); }}
              sourceReviewResult={sourceReviewResult}
              onOpenReview={() => {
                const requestId = sourcePreview?.request?.id ?? sourceReviewResult?.requestId;
                onNavigate(requestId
                  ? `/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`
                  : `/parameter-review?project=${encodeURIComponent(project.id)}`);
              }}
              canRecompute={canAdmin && canRecompute}
              canActivate={canAdmin && !selectedMember?.sharedReference && canActivate && (activeCandidate?.fileId ? legacySourceWorkflowConfirmed : sourceWorkflowSetReady && !sourceWorkflowSetCanonical && sourcePreview?.kind === "legacy" && !sourcePreviewLoading && !sourcePreviewError)}
              canAbandon={canAdmin && canAbandon}
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
              sourceWorkflow={sourceWorkflow}
              sourceWorkflowLoading={sourceWorkflowLoading}
              sourceWorkflowError={sourceWorkflowError}
              sourceWorkflowSetReady={sourceWorkflowSetReady}
              sourceWorkflowSetCanonical={sourceWorkflowSetCanonical}
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
              editorLocked={editorLocked}
              criticalLocked={criticalLocked}
              staleDraftLocked={staleDraftLocked}
              onStructuredValueChange={handleStructuredValueChange}
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
            /> : null;

  return (
    <section className="configuration-workbench" aria-label="项目配置工作台" ref={workbenchBodyRef}>
      {intentClient&&canAdmin?<SharedMemberPendingOperations client={intentClient} scope={JSON.stringify([currentUserId,resolvedOrganizationId])} refresh={intentRefresh} onResolved={()=>{workspaceLoadSession.retryFiles();workspaceLoadSession.retryMembers();}}/>:null}
      {activeSwitchTask && !memberAdditionOpen && canAdmin?<div role="group" aria-label="待重新预览的版本切换">
        <Button type="button" variant="outline" onClick={openMemberAddition}>{activeSwitchTask.operation==="remove"?"返回移除引用":"返回版本切换"}</Button>
        <Button type="button" variant="outline" onClick={dismissSwitchTask}>{activeSwitchTask.operation==="remove"?"取消移除引用":"取消版本切换"}</Button>
        <span>{activeSwitchTask.operation==="remove"?"待移除引用与变更说明已保留；修正生效后重新预览。":"目标版本与变更说明已保留；修正生效后重新预览。"}</span>
      </div>:null}
      <NavigatorWorkbench
        pageKey={`project-configuration:${project.id}`}
        navigatorLabel={contentTab === "effective" ? "设备树" : "配置导航"}
        taskLabel="配置内容"
        panelId={showContentTabs ? `project-configuration-${contentTab}-panel` : undefined}
        tabId={showContentTabs ? `project-configuration-${contentTab}-tab` : undefined}
        inspectorLabel="检查器面板"
        inspectorOverlay={narrowViewport}
        primaryAction={<WorkbenchReleaseReadinessSummary readiness={releaseReadiness} loading={readinessLoading} error={readinessError} localSessionDirty={sessionDraftsDirty || sourceDraftsDirty}
              readOnly={!canAdmin}
              pressed={inspectorOpen && inspectorLevel === "release"} disabled={!selectedConfigSet}
              onRetry={() => setReadinessRetry((value) => value + 1)} onOpenIssues={() => openInspector("release")} />}
        toolbar={(primaryAction) => <div className="configuration-workbench__toolbar-content">
          <WorkbenchCommandBar primaryAction={primaryAction}
        project={project}
        onLeave={handleLeaveWorkbench}
        returnLabel={sharedUsageReturnPath?"项目使用":undefined}
        configSets={configSets}
        selectedConfigSet={selectedConfigSet ?? null}
        configSetsLoading={configSetsLoading}
        configSetsError={configSetsError}
        onSelectConfigSet={selectConfigSet}
        canAdmin={canAdmin}
        canSyncFile={canAdmin && Boolean(selectedMember) && !selectedMember?.sharedReference && sourceWorkflow?.canonical === false}
        onInspectorToggle={() => { if (inspectorOpen) closeInspector(); else openInspector("file"); }}
        candidateFileInputRef={candidateFileInputRef}
        onOpenInspector={openInspector}
        createConfigSetOpen={createConfigSetOpen}
        onCreateConfigSetOpenChange={setCreateConfigSetOpen}
        onCandidateFileChange={handleCandidateFileChange}
        onSyncFile={() => void runAction("sync-file", syncSelectedFile)}
        syncLabel={pendingAction === "sync-file" ? "同步中…" : "手动同步"}
        syncBlocked={pendingAction !== null || sourceWorkflowLoading || Boolean(sourceWorkflowError) || !sourceWorkflow}
        pendingAction={pendingAction}
        onOpenActivity={openActivityInspector}
        onExportConfigSet={() => void runAction("export-config-set", exportSelectedConfigSet)}
        onImportPackage={apiMode && !filesLoading && !filesError && !configSetsLoading && !configSetsError && !projectFiles.length ? () => setPackageImportOpen(true) : undefined}
        onCreateConfigSet={submitCreateConfigSet}
      />
          {showContentTabs ? <div className="configuration-workbench__viewbar"><ViewSwitch variant="tabs" ariaLabel="项目配置内容" value={contentTab}
            onValueChange={selectContentTab}
            items={[...(topologyRepository ? [{ value: "effective", label: "生效配置" }] : []), { value: "source", label: "源码" },
              ...(contentTab === "conflicts" || syncConflicts.length || conflictsError ? [{ value: "conflicts", label: syncConflicts.length ? `冲突（${syncConflicts.length}）` : "冲突" }] : [])]
              .map((item) => ({ ...item, id: `project-configuration-${item.value}-tab`, panelId: `project-configuration-${item.value}-panel` }))} />
          </div> : null}
        </div>}
        context={<>
          <WorkbenchShellChrome
        opsError={actionError || opsError}
        opsMessage={opsMessage === syncEvidence || opsMessage === exportEvidence ? "" : opsMessage}
        canAdmin={canAdmin}
        narrowViewport={narrowViewport}
        inspectorOpen={inspectorOpen}
        inspectorLevel={inspectorLevel}
        onOpenActivity={openActivityInspector}
        onInspectorToggle={() => { if (inspectorOpen) closeInspector(); else openInspector("file"); }}
        tasksOpen={tasksOpen}
        onTasksToggle={() => setTasksOpen((open) => !open)}
      />
          <WorkbenchSetupGate
        configSetsLoading={configSetsLoading}
        configSetsError={configSetsError}
        onConfigSetsRetry={() => workspaceLoadSession.retryConfigSets()}
        selectedConfigSet={selectedConfigSet ?? null}
        canAdmin={canAdmin}
        onCreateConfigSet={() => setCreateConfigSetOpen(true)}
        onImportPackage={apiMode && !filesLoading && !filesError && !configSetsLoading && !configSetsError && !projectFiles.length ? () => setPackageImportOpen(true) : undefined}
      />
        </>}
        navigator={<>
          {contentTab === "effective" ? <>
            <p className="configuration-workbench__effective-tree-note">完整合成设备树 · 包含未纳入业务导航的节点</p>
            {effectiveTree ? <div role="tree" aria-label="生效设备树"><WorkbenchStructureTree nodes={effectiveNodes} fileId="effective"
              selectedNodePath={effectiveNodePath} selectedPropertyName={queryValue(search, "property")} sessionDrafts={{}} ariaLabel="生效节点"
              onSelectNode={selectEffectiveNode} onSelectProperty={selectEffectiveNode} showValues includeRoot defaultExpandDepth={3} /></div> : null}
          </> : selectedConfigSet ? <WorkbenchSourceTree
            showStructure={contentTab === "source"}
            treeRegionRef={treeRegionRef}
            selectedConfigSet={selectedConfigSet}
            searchInputRef={searchInputRef}
            searchDraft={searchDraft}
            searchQuery={searchQuery}
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
            onSelectMember={selectMember}
            structureLoading={structureLoading}
            structureError={structureError}
            onStructureRetry={() => workspaceLoadSession.retryStructure()}
            structureNodes={structureNodes}
            organizationNavigation={apiMode}
            structureNavigation={structureNavigation}
            structureNavigationError={structureNavigationError}
            selectedNodePath={selectedNodePath}
            selectedPropertyName={selectedPropertyName}
            sessionDrafts={sessionDrafts}
            onSelectStructureTarget={selectStructureTarget}
            canAdmin={canAdmin}
            filesLoading={filesLoading}
            filesError={filesError}
            onFilesRetry={() => workspaceLoadSession.retryFiles()}
            ungroupedFiles={ungroupedFiles}
            pendingAction={pendingAction}
            onAssignUngroupedFile={(item) => void runAction(`assign-${item.id}`, () => assignUngroupedFile(item))}
          /> : null}
        </>}
        inspector={inspectorLevel === "release" ? null : inspectorPanel}
      >
        {!selectedConfigSet ? <SectionEmpty message="选择或新建配置以查看项目配置。" /> : null}
        {contentTab === "effective" && selectedConfigSet ? !topologyRepository
          ? <SectionEmpty message="生效配置需要 API 模式。" />
          : currentEffective && membersError ? <SectionError message={membersError} onRetry={() => workspaceLoadSession.retryMembers()} />
          : currentEffective && membersListLoading ? <SectionSkeleton label="正在加载生效配置…" />
          : currentEffective && selectedMembers.length === 0 ? <SectionEmpty message={canAdmin ? "此配置尚无来源文件。请通过「配置」菜单添加来源或导入完整配置。" : "此配置尚无来源文件，请联系项目管理员。"} />
          : currentEffective && revisionGate.error ? <SectionError message={revisionGate.error} onRetry={() => void revisionGate.session.load(project.id, selectedConfigSet.id, topologyRepository)} />
          : currentEffective && revisionGate.loading ? <SectionSkeleton label="正在加载生效配置…" />
          : currentEffective && !currentEffectiveRevisionId ? <SectionEmpty message={canAdmin ? "此配置尚无已解析的修订。请在源码中同步来源文件。" : "此配置尚无已解析的修订，请联系项目管理员。"} />
          : effectiveError ? <SectionError message={effectiveError} onRetry={() => setEffectiveRetry(value => value + 1)} />
          : !effectiveTree ? <SectionSkeleton label="正在加载生效配置…" />
          : effectiveTree.nodes.length === 0 ? <SectionEmpty message="当前配置修订没有生效设备树节点。" />
          : <WorkbenchEffectiveConfiguration key={`${effectiveTree.revisionId}/${effectiveNode?.logicalNodeId}`} node={effectiveNode}
            blockingAncestorPath={effectiveTree.nodes.find(node => node.logicalNodeId === effectiveNode?.enablement?.blockingAncestorId)?.locator}
            projectId={project.id} configSetId={selectedConfigSet.id} revisionId={effectiveTree.revisionId} search={search} onNavigate={onNavigate}
            overrideTargets={selectedMembers.filter(member => member.format === "dts" && !member.sharedReference && !/\.(h|hpp)$/u.test(member.fileName))
              .sort((a,b) => (a.role === "overlay" ? -1 : 0) - (b.role === "overlay" ? -1 : 0)).map(member => ({fileId:member.fileId,fileName:member.fileName}))}
            onPrepareOverride={apiMode && canEdit && effectiveRevision === "current" && fileRepository.prepareProjectLocalOverride ? prepareLocalOverride : undefined} /> : null}
        {contentTab === "source" && selectedConfigSet ? <WorkbenchSourceCanvas
            workingEditor={selectedMember?.format === "dts" && !selectedMember.sharedReference && selectedMember.currentVersionId && source && resolvedOrganizationId
              && !sourceLoading && !sourceError && sourceIdentity?.projectId === project.id
              && sourceIdentity.fileId === selectedMember.fileId && sourceIdentity.versionId === selectedMember.currentVersionId ? <WorkbenchSourceEditingPane
              scope={{ userId: currentUserId, organizationId: resolvedOrganizationId, projectId: project.id, configSetId: selectedConfigSet.id, fileId: selectedMember.fileId }}
              session={sourceEditSession} editorSessions={sourceEditorSessions} flushRef={sourceFlushRef} fileName={selectedMember.fileName} baseVersionId={selectedMember.currentVersionId}
              configRevisionId={revisionGate.loading || revisionGate.error ? null : revisionGate.revisions
                .filter((revision) => revision.configSetId === selectedConfigSet.id && ["resolved", "validated", "compiled", "pending_approval"].includes(revision.status))
                .sort((left, right) => right.revisionNumber - left.revisionNumber)[0]?.id ?? null}
              source={source} repository={fileRepository} canEdit={apiMode && canEdit && (canAdmin || Boolean(selectedSourceOverride)) && !selectedMember.sharedReference}
              canEditSource={apiMode && canEdit && canAdmin && !selectedSourceOverride} canDirectApply={apiMode && canEdit && canAdmin}
              localOverrideIntent={selectedSourceOverride?.input}
              changeSummary={selectedSourceOverride
                ? describeLocalChange(selectedSourceOverride.input.action, selectedSourceOverride.afterValue)
                : localOverrideDraft?.fileId === selectedMember.fileId && localOverrideDraft.baseVersionId === selectedMember.currentVersionId
                  ? describeLocalChange(localOverrideDraft.action, localOverrideDraft.afterValue) : undefined}
              visible={canvasMode === "working"} legacyDraftsDirty={sessionDraftsDirty} onOpenLegacyDrafts={() => setTasksOpen(true)}
              onDirtyChange={setSourceBufferDirty} onRefresh={() => {
                setLocalOverrideDraft(null);
                workspaceLoadSession.retryFiles(); workspaceLoadSession.retryMembers(); workspaceLoadSession.retrySource();
                workspaceLoadSession.retryStructure(); setSourceWorkflowReloadToken((value) => value + 1); setVersionsReloadToken((value) => value + 1);
                if (topologyRepository) void revisionGate.session.load(project.id, selectedConfigSet.id, topologyRepository);
              }} focusSpan={focusSpan} focusLine={focusLineOverride ?? restoredScrollLine}
              findQuery={findQuery} findNextToken={findNextToken} onVisibleLineChange={handleVisibleLineChange}
            /> : undefined}
            sourceRegionRef={sourceRegionRef}
            selectedConfigSetName={selectedConfigSet.name === "default" ? "默认配置" : selectedConfigSet.name}
            selectedMember={selectedMember ?? null}
            canvasMode={canvasMode}
            historyVersionId={historyVersionId}
            candidateId={candidateId}
            activeCandidate={activeCandidate}
            fileVersions={fileVersions}
            onSelectVersion={() => openInspector("versions")}
            onEnterCanvasMode={enterCanvasMode}
            onExitSpecialCanvasMode={() => { if (baselineCompare) exitBaselineCompare(); else exitSpecialCanvasMode(); }}
            candidateError={candidateError}
            sourceLoading={sourceLoading}
            modeSourceLoading={modeSourceLoading}
            sourceError={sourceError}
            modeSourceError={modeSourceError}
            onSourceRetry={() => workspaceLoadSession.retrySource()}
            onClearModeSourceError={() => { void reloadModeSource(); }}
            source={source}
            historySource={historySource}
            historySourceAvailable={historySourceAvailable}
            candidateSource={candidateSource}
            candidateBaseSource={sourcePreview?.candidateId === candidateId ? sourcePreview.before : undefined}
            candidateLoading={candidateLoading}
            compareSource={compareSource}
            unifiedDiffText={unifiedDiffText}
            focusSpan={queryValue(search, "line") ? null : focusSpan}
            focusLineOverride={/^[1-9]\d*$/.test(queryValue(search, "line") ?? "") ? Number(queryValue(search, "line")) : focusLineOverride}
            restoredScrollLine={restoredScrollLine}
            findQuery={findQuery}
            findNextToken={findNextToken}
            onVisibleLineChange={handleVisibleLineChange}
            sessionChangeMarkers={sessionChangeMarkers}
          /> : null}
        {contentTab === "conflicts" ? (
          <div className="configuration-workbench__conflicts" aria-label="冲突处理">
            <h2>冲突处理</h2>
            {syncConflicts.length > 0 ? <p>核对冲突值与变更来源，再选择处理方式。</p> : null}
            {conflictsLoading ? <SectionSkeleton label="正在加载冲突…" />
              : conflictsError ? <SectionError message="冲突加载失败，请重试。" onRetry={() => void conflictLocateFacade.load(project.id, fileRepository)} />
              : syncConflicts.length === 0 ? <SectionEmpty message="当前没有待处理同步冲突。来源冲突请在候选记录中查看。" /> : (
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
      {inspectorLevel === "release" ? inspectorPanel : null}

      {selectedConfigSet ? <WorkbenchConfigurationFilesDialog
        open={inspectorOpen && inspectorLevel === "config-set" && !createConfigSetOpen && !memberAdditionOpen}
        onClose={closeInspector}
        configSet={selectedConfigSet}
        members={selectedMembers}
        canAdmin={canAdmin}
        pendingAction={pendingAction}
        loading={sourceWorkflowSetLoading}
        error={membersError || filesError || sourceWorkflowSetError}
        operationError={actionError || opsError}
        ready={sourceWorkflowSetReady && !membersError && !filesError}
        canonical={sourceWorkflowSetCanonical}
        onRetry={() => {
          workspaceLoadSession.retryMembers();
          workspaceLoadSession.retryFiles();
          setSourceWorkflowReloadToken((value) => value + 1);
        }}
        availableFiles={ungroupedFiles}
        addErrors={memberAddErrorsByFileId}
        memberFileId={memberFileId}
        memberRole={memberRole}
        memberSortOrder={memberSortOrder}
        onMemberFileIdChange={setMemberFileId}
        onMemberRoleChange={setMemberRole}
        onMemberSortOrderChange={setMemberSortOrder}
        onAddMember={() => void runAction("add-member", () => addMemberToConfigSet(memberFileId, memberRole, memberSortOrder))}
        onRemoveMember={(member) => {
          if (canRequestReviewedMemberRemoval) setMemberRemovalTarget(member);
          else requestRemoveMember(member);
        }}
        canRequestReviewedMemberRemoval={canRequestReviewedMemberRemoval}
        onReviewedMemberRemoval={canRequestLegacyMemberRemoval ? setReviewedMemberRemovalTarget : undefined}
        onOpenFile={(fileId) => {
          setInspectorOpen(false);
          setInspectorLevelOverride(null);
          onNavigate(formatWorkbenchPath(project.id, canvasSearch, { configSet: selectedConfigSet.id,
            file: fileId, inspector: null, sourceMode: null, version: null, candidate: null, baseline: null,
            node: null, property: null }));
        }}
        onUpdateFile={(fileId) => openInspector("candidates", fileId)}
        onOpenVersions={(fileId) => openInspector("versions", fileId)}
        onAddSourceFile={() => openInspector("candidates")}
        onCanonicalAdd={apiMode ? () => {dismissSwitchTask();openMemberAddition();} : undefined}
        onSwitchSharedVersion={apiMode?member=>{setSwitchSharedMember(member);if(member.sharedReference){const task={scope:switchTaskKey,reference:member.sharedReference,draft:{versionId:"",reason:""}};try{saveSwitchTask(task);}catch{setSwitchTask(task);}}openMemberAddition();}:undefined}
        onRemoveSharedReference={apiMode?member=>{if(member.sharedReference){const task:SwitchTask={scope:switchTaskKey,operation:"remove",reference:member.sharedReference,draft:{versionId:"",reason:""}};try{saveSwitchTask(task);}catch{setSwitchTask(task);}openMemberAddition();}}:undefined}
        onSetRoot={apiMode ? setSetRootTarget : undefined}
        onConvertShared={apiMode&&sharedImportRevisionId?member=>{if(!member.currentVersionId)return;dismissSwitchTask();setConversionSource({configRevisionId:sharedImportRevisionId,fileId:member.fileId,fileVersionId:member.currentVersionId,sourceName:member.fileName});openMemberAddition();}:undefined}
        onCreateShared={apiMode && sharedDtsiClient && sharedImportRevisionId ? member => {
          void runAction("create-shared",async () => {
            if(!member.currentVersionId) throw new Error("请先重新核对配置修订与文件版本。");
            let draft;
            try { draft = await sharedDtsiClient.importProject(project.id,selectedConfigSet.id,{name:member.fileName,
              configRevisionId:sharedImportRevisionId,fileId:member.fileId,fileVersionId:member.currentVersionId}); }
            catch(error) { if(currentSharedImport.current === sharedImportScope) throw error;return; }
            if(currentSharedImport.current !== sharedImportScope) return;
            const params = new URLSearchParams({resource:draft.resourceId,version:"draft"});
            if(resolvedOrganizationId) params.set("organization",resolvedOrganizationId);
            onNavigate(`/parameter-admin/sources?${params}`);
          });
        } : undefined}
      /> : null}
      {memberAdditionOpen && memberAdditionScope===switchTaskKey && canAdmin && selectedConfigSet ? <WorkbenchMemberAdditionDialog key={switchTaskKey} projectId={project.id} configSets={configSets}
        client={additionClient} sharedClient={sharedDtsiClient}
        canContinueOperation={()=>currentMemberAdditionScope.current===switchTaskKey}
        switchReference={activeSwitchTask?.operation==="remove"?undefined:activeSwitchTask?.reference??switchSharedMember?.sharedReference}
        removeReference={activeSwitchTask?.operation==="remove"?activeSwitchTask.reference:undefined}
        conversionSource={conversionSource}
        preserveUncertain={Boolean(activeSwitchTask||switchSharedMember)} onUncertainDismiss={()=>{dismissSwitchTask();setIntentRefresh(value=>value+1);workspaceLoadSession.retryFiles();workspaceLoadSession.retryMembers();workspaceLoadSession.retrySource();workspaceLoadSession.retryStructure();toast({tone:"danger",message:"应用结果尚未确认，请核对项目配置后再操作。"});}}
        onOperationStart={activeSwitchTask||switchSharedMember?async(_operation,registrationId)=>{if(!intentClient)throw new Error("Missing operation scope");const registered=await intentClient.register(project.id,selectedConfigSet.id,registrationId);if(registered.status==="stopped"||registered.status==="applied"&&!registered.result){setIntentRefresh(value=>value+1);return {resolved:registered.status};}if(currentMemberAdditionScope.current===switchTaskKey)currentIntent.current=registered;return registered.clientMutationId;}:undefined}
        onOperationResolved={()=>{const done=currentIntent.current;if(done&&intentClient&&currentMemberAdditionScope.current===switchTaskKey)void intentClient.acknowledge(done).catch(()=>{}).finally(()=>setIntentRefresh(value=>value+1));}}
        switchDraft={activeSwitchTask?.draft} onSwitchDraftChange={updateSwitchDraft} onRecoverSwitch={recoverSwitch}
        projectRoot={selectedMembers.find(member=>member.role==="base")?{fileId:selectedMembers.find(member=>member.role==="base")!.fileId,sourceName:selectedMembers.find(member=>member.role==="base")!.fileName}:undefined}
        catalogRepository={memberRemovalRepository} fileRepository={fileRepository}
        initialConfigSetId={selectedConfigSet.id} availableFiles={ungroupedFiles} onDismiss={()=>{if(activeSwitchTask?.operation==="remove"){workspaceLoadSession.retryFiles();workspaceLoadSession.retryMembers();}dismissSwitchTask();}}
        onApplied={(configSetId, fileId) => {
          if(currentMemberAdditionScope.current!==switchTaskKey)return;
          dismissSwitchTask(); setInspectorOpen(false); workspaceLoadSession.retryFiles(); workspaceLoadSession.retryMembers();
          workspaceLoadSession.retrySource(); workspaceLoadSession.retryStructure(); setSourceWorkflowReloadToken((value) => value + 1);
          setVersionsReloadToken((value) => value + 1);
          if (topologyRepository) void revisionGate.session.load(project.id, configSetId, topologyRepository);
          onNavigate(formatWorkbenchPath(project.id, canvasSearch, { configSet: configSetId, file: fileId, inspector: null,
            sourceMode: null, version: null, candidate: null, baseline: null, node: null, property: null }));
        }} /> : null}

      {packageImportOpen && apiMode && canAdmin ? <WorkbenchPackageImportDialog key={`${resolvedOrganizationId}:${project.id}`} projectId={project.id} client={packageClient}
        onDismiss={() => setPackageImportOpen(false)} onApplied={async result => {
          workspaceLoadSession.setConfigSets(await dtsRepository.listConfigSets(project.id));
          setPackageImportOpen(false); workspaceLoadSession.retryConfigSets(); workspaceLoadSession.retryFiles(); workspaceLoadSession.retryMembers();
          workspaceLoadSession.retrySource(); workspaceLoadSession.retryStructure();
          if (topologyRepository) void revisionGate.session.load(project.id, result.configSetId, topologyRepository);
          onNavigate(formatWorkbenchPath(project.id, canvasSearch, { configSet: result.configSetId, file: result.fileIds[0]??null,
            inspector: null, sourceMode: null, version: null, candidate: null, baseline: null, node: null, property: null }));
        }} /> : null}

      <WorkbenchCandidateActivateDialog
        open={activateConfirmOpen}
        activeCandidate={activeCandidate}
        configSetName={selectedConfigSet?.name === "default" ? "默认配置" : selectedConfigSet?.name ?? null}
        activateRole={activateRole}
        onActivateRoleChange={(role) => candidateFlow.setActivateRole(role)}
        activating={activatingCandidate}
        activateError={activateError}
        onCancel={handleCancelActivateCandidate}
        onConfirm={handleConfirmActivateCandidate}
      />

      {activeCandidate?.status === "ready" && sourcePreview?.kind === "canonical"
        && sourcePreview.proofToken && !sourcePreview.request
        && ((sourcePreview.bindings?.length ?? 0) <= 1 || singleConflictOpened) && canAdmin && canEdit ? (
        <WorkbenchCanonicalConflictDecision key={`single-conflict:${activeCandidate.id}`}
          repository={conflictClient} governanceClient={governanceClient}
          inlineTarget={!canSubmitBatchReview || singleConflictActive ? sourceUpdateReviewTarget : null}
          projectId={project.id} currentUserId={currentUserId} candidate={activeCandidate} preview={sourcePreview}
          allowed={(canSubmitSourceReview || canSubmitBatchReview) && !sourceUpdateBlockedReason} blockedReason={sourceUpdateBlockedReason}
          onSubmitWithoutConflict={canSubmitSourceReview ? handleConfirmSourceReview : undefined}
          onReturnToBatch={canSubmitBatchReview
            ? () => setSingleConflictReview((value) => value ? { ...value, active: false } : null) : undefined}
          onSubmitted={(requestId) => onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&request=${encodeURIComponent(requestId)}`)} />
      ) : null}
      {canSubmitBatchReview && sourcePreview && activeCandidate ? (
        <CanonicalBatchSubmitDialog key={`batch-review:${activeCandidate.id}`} inlineTarget={singleConflictActive ? null : sourceUpdateReviewTarget}
          conflictClient={conflictClient} governanceClient={governanceClient}
          submissionBlockedReason={sourceUpdateBlockedReason}
          onSelectSingleConflict={() => setSingleConflictReview({ candidateId: activeCandidate.id, active: true })}
          projectId={project.id} currentUserId={currentUserId}
          candidate={activeCandidate} preview={sourcePreview} repository={memberRemovalRepository}
          fileRepository={fileRepository}
          onDismiss={closeInspector}
          onSubmitted={(requestId) => {
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
          conflictClient, governanceClient,
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

      {taskDock}

      {setRootTarget && selectedConfigSet ? <WorkbenchSetRootDialog projectId={project.id} configSetId={selectedConfigSet.id}
        client={additionClient}
        fileId={setRootTarget.fileId} fileName={setRootTarget.fileName} onDismiss={() => setSetRootTarget(null)}
        onApplied={() => {
          setSetRootTarget(null); workspaceLoadSession.retryMembers(); workspaceLoadSession.retryFiles();
          workspaceLoadSession.retrySource(); workspaceLoadSession.retryStructure();
          setSourceWorkflowReloadToken((value) => value + 1); setVersionsReloadToken((value) => value + 1);
          if (topologyRepository) void revisionGate.session.load(project.id, selectedConfigSet.id, topologyRepository);
        }} /> : null}
      {memberRemovalTarget && selectedConfigSet ? <WorkbenchMemberRemovalDialog
        client={removalClient}
        projectId={project.id}
        configSetId={selectedConfigSet.id}
        fileId={memberRemovalTarget.fileId}
        fileName={memberRemovalTarget.fileName}
        onDismiss={() => setMemberRemovalTarget(null)}
        onApplied={() => {
          setMemberRemovalTarget(null);
          workspaceLoadSession.retryMembers();
          workspaceLoadSession.retryFiles();
          setSourceWorkflowReloadToken((value) => value + 1);
          workspaceLoadSession.retrySource();
          workspaceLoadSession.retryStructure();
        }}
      /> : null}
      {reviewedMemberRemovalTarget && selectedConfigSet ? <CanonicalMemberRemovalSubmitDialog projectId={project.id}
        governanceClient={governanceClient}
        configSetId={selectedConfigSet.id} configSetName={selectedConfigSet.name === "default" ? "默认配置" : selectedConfigSet.name}
        member={reviewedMemberRemovalTarget} members={selectedMembers} currentUserId={currentUserId} repository={memberRemovalRepository}
        onReloadMembers={() => dtsRepository.listConfigSetFiles(project.id, selectedConfigSet.id)}
        onDismiss={() => setReviewedMemberRemovalTarget(null)} onSubmitted={(requestId) => {
          setReviewedMemberRemovalTarget(null);
          onNavigate(`/parameter-submissions?project=${encodeURIComponent(project.id)}&memberRequest=${encodeURIComponent(requestId)}`);
        }} /> : null}
      <WorkbenchBaselineDialogs
        createOpen={createBaselineOpen}
        releaseOpen={releaseBaselineOpen}
        restoreOpen={restoreBaselineOpen}
        leaveOpen={leaveConfirmOpen}
        leaveError={leaveError}
        leavePending={leavePending}
        sessionDraftsDirty={sessionDraftsDirty || sourceDraftsDirty}
        baselineActionError={baselineActionError}
        newBaselineName={newBaselineName}
        onNewBaselineNameChange={setNewBaselineName}
        pendingAction={pendingAction}
        releaseReadiness={releaseReadiness}
        acknowledgedWarningIds={acknowledgedWarningIds}
        restorePreview={restorePreview}
        selectedBaselineId={selectedBaselineId}
        baselines={configBaselines}
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
        onConfirmRestore={(input) => {
          void runAction("restore-baseline", () => restoreWorkbenchBaseline(input));
        }}
        onRefreshRestorePreview={(id) => {
          void runAction("restore-preview", async () => { await releaseBaselineSession.previewRestore(project.id,dtsRepository,id ? { sourceConfigRevisionId: id } : undefined); });
        }}
        onCancelLeave={() => setLeaveConfirmOpen(false)}
        onConfirmLeave={handleDiscardAndLeave}
        onKeepDraftsAndLeave={handleKeepDraftsAndLeave}
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
