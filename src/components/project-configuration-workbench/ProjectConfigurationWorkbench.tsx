import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronLeft, ChevronRight, FileCode2, FolderTree, Info, PanelRight, Rows3, Search } from "lucide-react";

import type {
  ConfigSetRole,
  DtsBaselineMemberComparison,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsExportConfigSetResult,
  DtsReleaseReadinessIssue,
  DtsSearchHit,
  DtsSourceLocator,
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ProjectParameterFile,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  ProjectPrimaryDtsViewer,
  type DtsViewerFocusSpan
} from "@/components/parameter-topology/ProjectPrimaryDtsViewer";
import {
  GovernanceToast,
  useGovernanceToast
} from "@/components/parameter-admin-next/useGovernanceToast";
import { mapApiAuditEventToView } from "@/domain/audit/mapAuditEventView";
import type { AuditEventListResponse, AuditEventView, ListAuditEventsParams } from "@/domain/audit/types";
import {
  presentWorkbenchActivity,
  resolveWorkbenchActivityTarget,
  workbenchActivityApps,
  type WorkbenchActivityRow
} from "./workbenchActivityModel";
import { WorkbenchConflictArbitrationDock } from "./WorkbenchConflictArbitrationDock";
import { WorkbenchCommandBar } from "./WorkbenchCommandBar";
import {
  WorkbenchReleaseReadinessIssues
} from "./WorkbenchReleaseReadiness";
import { formatRestorePreviewDescription } from "./WorkbenchBaselineDock";
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
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";

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

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

type PendingConfirmation = {
  key: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  tone: "primary" | "danger";
  run: () => Promise<void>;
};

function downloadExportBundle(
  configSetName: string,
  result: Pick<DtsExportConfigSetResult, "manifest" | "files">
) {
  const filesPayload = result.files.map((file) => `// ${file.name}\n${file.content}`).join("\n\n");
  const payload = [
    "// wiseeff-config-set-export-manifest.json",
    JSON.stringify(result.manifest, null, 2),
    "",
    "// wiseeff-config-set-export-files",
    filesPayload
  ].join("\n");
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${configSetName || "config-set"}-export.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function defaultRoleForFile(file: ProjectParameterFile, hasMembers: boolean): ConfigSetRole {
  if (file.format === "json") return "misc";
  return hasMembers ? "overlay" : "base";
}

function queryValue(search: string, name: string) {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(name);
}

function defaultConfigSet(configSets: DtsConfigSet[]) {
  const namedDefault = configSets.find((item) => item.name.trim().toLowerCase() === "default");
  if (namedDefault) return namedDefault;
  return [...configSets].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  )[0] ?? null;
}

type WorkbenchPathPatch = {
  configSet: string;
  file?: string | null;
  node?: string | null;
  property?: string | null;
  sourceMode?: string | null;
  version?: string | null;
  candidate?: string | null;
  baseline?: string | null;
  inspector?: string | null;
};

function formatWorkbenchPath(projectId: string, search: string, patch: WorkbenchPathPatch) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("configSet", patch.configSet);
  const setOrDelete = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value) params.set(key, value);
    else params.delete(key);
  };
  setOrDelete("file", patch.file);
  setOrDelete("node", patch.node);
  setOrDelete("property", patch.property);
  setOrDelete("sourceMode", patch.sourceMode);
  setOrDelete("version", patch.version);
  setOrDelete("candidate", patch.candidate);
  setOrDelete("baseline", patch.baseline);
  if (patch.inspector === null) {
    params.delete("inspector");
  } else if (patch.inspector !== undefined) {
    params.set("inspector", patch.inspector);
  }
  return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration?${params.toString()}`;
}

function decodeSourceBytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

async function triggerVersionDownload(
  fileRepository: ParameterFileRepository,
  projectId: string,
  fileId: string,
  version: ProjectParameterFileVersion,
  fileName: string
) {
  const result = await fileRepository.downloadVersion(projectId, fileId, version.id);
  const blob = new Blob([Uint8Array.from(result.bytes)], {
    type: result.contentType || "application/octet-stream"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.fileName || `${fileName}.v${version.versionNumber}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function locatorToFocusSpan(source?: DtsSourceLocator): DtsViewerFocusSpan | null {
  if (!source) return null;
  return {
    startLine: source.startLine,
    endLine: source.endLine,
    startColumn: source.startColumn,
    endColumn: source.endColumn
  };
}

function groupHitsByFile(hits: DtsSearchHit[]): Array<{ fileId: string; fileName: string; hits: DtsSearchHit[] }> {
  const groups = new Map<string, { fileId: string; fileName: string; hits: DtsSearchHit[] }>();
  for (const hit of hits) {
    const existing = groups.get(hit.fileId);
    if (existing) {
      existing.hits.push(hit);
    } else {
      groups.set(hit.fileId, { fileId: hit.fileId, fileName: hit.fileName, hits: [hit] });
    }
  }
  return [...groups.values()];
}

function nearestNodeForLine(nodes: DtsStructuralNode[], line: number): DtsStructuralNode | null {
  let best: DtsStructuralNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!node.source) continue;
    if (line < node.source.startLine) continue;
    const distance = line - node.source.startLine;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

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
  const [configSets, setConfigSets] = useState<DtsConfigSet[]>([]);
  const [projectFiles, setProjectFiles] = useState<ProjectParameterFile[]>([]);
  const [members, setMembers] = useState<DtsConfigSetMemberFile[]>([]);
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
  const [createBaselineOpen, setCreateBaselineOpen] = useState(false);
  const [newBaselineName, setNewBaselineName] = useState("");
  const [releaseBaselineOpen, setReleaseBaselineOpen] = useState(false);
  const [restoreBaselineOpen, setRestoreBaselineOpen] = useState(false);
  const [workingReturnPath, setWorkingReturnPath] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [configSetsLoading, setConfigSetsLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [configSetsError, setConfigSetsError] = useState("");
  const [filesError, setFilesError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [configRetry, setConfigRetry] = useState(0);
  const [filesRetry, setFilesRetry] = useState(0);
  const [membersRetry, setMembersRetry] = useState(0);
  const [baselinesRetry, setBaselinesRetry] = useState(0);
  const [readinessRetry, setReadinessRetry] = useState(0);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPersistent, setInspectorPersistent] = useState(false);
  const [inspectorLevelOverride, setInspectorLevelOverride] = useState<InspectorLevel | null>(null);
  const [fileVersions, setFileVersions] = useState<ProjectParameterFileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [historySource, setHistorySource] = useState("");
  const [compareSource, setCompareSource] = useState("");
  const [modeSourceLoading, setModeSourceLoading] = useState(false);
  const [modeSourceError, setModeSourceError] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadingDts, setDownloadingDts] = useState(false);
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
  const [activityEvents, setActivityEvents] = useState<AuditEventView[]>([]);
  const [activityRows, setActivityRows] = useState<WorkbenchActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityMissingNotice, setActivityMissingNotice] = useState("");
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);
  const [knownCandidateIds, setKnownCandidateIds] = useState<string[]>([]);
  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false);
  const candidateFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastVisibleLine, setLastVisibleLine] = useState<number | null>(null);
  const [restoredScrollLine, setRestoredScrollLine] = useState<number | null>(null);
  const workingSnapshotRef = useRef<{
    fileId: string | null;
    nodePath: string | null;
    propertyName: string | null;
    scrollLine: number | null;
    sourceMode: string | null;
  } | null>(null);
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
  const [structureNodes, setStructureNodes] = useState<DtsStructuralNode[]>([]);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [structureRetry, setStructureRetry] = useState(0);
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [selectedPropertyName, setSelectedPropertyName] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchHits, setSearchHits] = useState<DtsSearchHit[]>([]);
  const [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findNextToken, setFindNextToken] = useState(0);
  const [focusLineOverride, setFocusLineOverride] = useState<number | null>(null);
  const [suppressScrollSync, setSuppressScrollSync] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const treeRegionRef = useRef<HTMLElement | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [memberFileId, setMemberFileId] = useState("");
  const [memberRole, setMemberRole] = useState<ConfigSetRole>("base");
  const [memberSortOrder, setMemberSortOrder] = useState(0);
  const [syncEvidence, setSyncEvidence] = useState("");
  const {
    facade: conflictLocateFacade,
    conflicts: syncConflicts
  } = useConflictLocateFacade();
  const {
    session: configSetOpsSession,
    lastError: opsError,
    lastMessage: opsMessage
  } = useConfigSetOpsSession();
  const [exportEvidence, setExportEvidence] = useState("");
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
    let cancelled = false;
    setConfigSetsLoading(true);
    setConfigSetsError("");
    void dtsRepository
      .listConfigSets(project.id)
      .then((items) => {
        if (!cancelled) setConfigSets(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConfigSets([]);
          setConfigSetsError(error instanceof Error ? error.message : "配置集加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setConfigSetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configRetry, dtsRepository, project.id]);

  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    setFilesError("");
    void fileRepository
      .listFiles(project.id)
      .then((items) => {
        if (!cancelled) setProjectFiles(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProjectFiles([]);
          setFilesError(error instanceof Error ? error.message : "项目文件加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRepository, filesRetry, project.id]);

  useEffect(() => {
    void conflictLocateFacade.load(project.id, fileRepository);
  }, [conflictLocateFacade, fileRepository, filesRetry, project.id]);

  const selectedConfigSet = useMemo(() => {
    const requested = queryValue(search, "configSet");
    return configSets.find((item) => item.id === requested) ?? defaultConfigSet(configSets);
  }, [configSets, search]);

  useEffect(() => {
    if (!selectedConfigSet) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    setMembersError("");
    void dtsRepository
      .listConfigSetFiles(project.id, selectedConfigSet.id)
      .then((items) => {
        if (!cancelled) setMembers(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMembers([]);
          setMembersError(error instanceof Error ? error.message : "配置集成员加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dtsRepository, membersRetry, project.id, selectedConfigSet]);

  useEffect(() => {
    void releaseBaselineSession.loadBaselines(
      project.id,
      selectedConfigSet?.id ?? null,
      dtsRepository
    );
  }, [baselinesRetry, dtsRepository, project.id, releaseBaselineSession, selectedConfigSet]);

  useEffect(() => {
    void releaseBaselineSession.refreshReadiness(
      project.id,
      selectedConfigSet?.id ?? null,
      { canAdmin },
      dtsRepository
    );
  }, [
    acknowledgedWarningIds,
    canAdmin,
    dtsRepository,
    project.id,
    readinessRetry,
    releaseBaselineSession,
    selectedConfigSet
  ]);

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

  const selectedMember = useMemo((): DtsConfigSetMemberFile | null => {
    const requested = queryValue(search, "file");
    if (requested) {
      const memberHit = selectedMembers.find((item) => item.fileId === requested);
      if (memberHit) return memberHit;
      // Wait for Config set members before synthesizing a non-member locate target,
      // otherwise the canvas heading appears while the member tree is still empty.
      if (!membersLoading && !membersError) {
        const projectHit = projectFiles.find((file) => file.id === requested);
        if (projectHit) {
          return {
            configSetId: selectedConfigSet?.id ?? "",
            fileId: projectHit.id,
            fileName: projectHit.fileName,
            format: projectHit.format,
            role: "misc",
            sortOrder: -1,
            currentVersionId: projectHit.currentVersionId,
            currentVersionNumber: projectHit.currentVersionNumber
          };
        }
      }
    }
    return (
      selectedMembers.find((item) => item.format === "dts" && item.currentVersionId) ??
      selectedMembers.find((item) => item.currentVersionId) ??
      selectedMembers[0] ??
      null
    );
  }, [membersError, membersLoading, projectFiles, search, selectedConfigSet?.id, selectedMembers]);

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
    if (canvasMode === "working" || !selectedMember || !historyVersionId) {
      setHistorySource("");
      setCompareSource("");
      setModeSourceError("");
      setModeSourceLoading(false);
      return;
    }
    if (!workingSnapshotRef.current) {
      workingSnapshotRef.current = {
        fileId: selectedMember.fileId,
        nodePath: selectedNodePath,
        propertyName: selectedPropertyName,
        scrollLine: lastVisibleLine,
        sourceMode: null
      };
    }
    let cancelled = false;
    setModeSourceLoading(true);
    setModeSourceError("");
    const load = async () => {
      try {
        const historical = await fileRepository.downloadVersion(
          project.id,
          selectedMember.fileId,
          historyVersionId
        );
        if (cancelled) return;
        const historicalText = decodeSourceBytes(historical.bytes);
        setHistorySource(historicalText);
        if (canvasMode === "unified-diff" || canvasMode === "side-by-side") {
          if (selectedMember.currentVersionId) {
            const working = await fileRepository.downloadVersion(
              project.id,
              selectedMember.fileId,
              selectedMember.currentVersionId
            );
            if (cancelled) return;
            setCompareSource(decodeSourceBytes(working.bytes));
          } else {
            setCompareSource(source);
          }
        } else {
          setCompareSource("");
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setHistorySource("");
          setCompareSource("");
          setModeSourceError(error instanceof Error ? error.message : "历史源码加载失败。");
        }
      } finally {
        if (!cancelled) setModeSourceLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canvasMode, fileRepository, historyVersionId, project.id, selectedMember, source]);

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
    if (configSetsLoading || !selectedConfigSet) return;
    if (queryValue(search, "configSet") !== selectedConfigSet.id) {
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: null,
          node: null,
          property: null
        })
      );
    }
  }, [configSetsLoading, onNavigate, project.id, search, selectedConfigSet]);

  useEffect(() => {
    if (membersLoading || filesLoading || !selectedConfigSet || !selectedMemberFileId) return;
    const requested = queryValue(search, "file");
    if (requested) {
      const knownMember = selectedMembers.some((item) => item.fileId === requested);
      const knownProjectFile = projectFiles.some((file) => file.id === requested);
      // Preserve explicit file= targets that exist in the project, even when they are
      // not Config set members (conflict locate / activity deep links).
      if (knownMember || knownProjectFile) return;
    }
    if (requested === selectedMemberFileId) return;
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: selectedMemberFileId,
        node: null,
        property: null
      })
    );
  }, [
    filesLoading,
    membersLoading,
    onNavigate,
    project.id,
    projectFiles,
    search,
    selectedConfigSet,
    selectedMemberFileId,
    selectedMembers
  ]);

  useEffect(() => {
    if (!selectedMemberFileId || !selectedMemberVersionId) {
      setSource("");
      setSourceError("");
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    setSourceError("");
    void fileRepository
      .downloadVersion(project.id, selectedMemberFileId, selectedMemberVersionId)
      .then((result) => {
        if (!cancelled) setSource(new TextDecoder().decode(result.bytes));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSource("");
          setSourceError(error instanceof Error ? error.message : "源码加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRepository, project.id, selectedMemberFileId, selectedMemberVersionId, sourceRetry]);

  useEffect(() => {
    if (!selectedMemberFileId || !selectedMemberVersionId) {
      setStructureNodes([]);
      setStructureError("");
      setStructureLoading(false);
      return;
    }
    let cancelled = false;
    setStructureLoading(true);
    setStructureError("");
    void dtsRepository
      .getStructure(project.id, selectedMemberFileId, selectedMemberVersionId)
      .then((result) => {
        if (!cancelled) setStructureNodes(result.nodes);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStructureNodes([]);
          setStructureError(error instanceof Error ? error.message : "结构树加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setStructureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dtsRepository, project.id, selectedMemberFileId, selectedMemberVersionId, structureRetry]);

  useEffect(() => {
    const requestedNode = queryValue(search, "node");
    const requestedProperty = queryValue(search, "property");
    if (!requestedNode) {
      setSelectedNodePath(null);
      setSelectedPropertyName(null);
      return;
    }
    // Wait for structure before invalidating URL node/property so deep links survive loading.
    if (structureLoading || (structureNodes.length === 0 && !structureError)) {
      setSelectedNodePath(requestedNode);
      setSelectedPropertyName(requestedProperty);
      return;
    }
    const exists = structureNodes.some((node) => node.nodePath === requestedNode);
    if (!exists) {
      setSelectedNodePath(null);
      setSelectedPropertyName(null);
      return;
    }
    setSelectedNodePath(requestedNode);
    if (requestedProperty) {
      const node = structureNodes.find((item) => item.nodePath === requestedNode);
      const propertyExists = node?.properties.some((property) => property.name === requestedProperty);
      setSelectedPropertyName(propertyExists ? requestedProperty : null);
    } else {
      setSelectedPropertyName(null);
    }
  }, [search, structureError, structureLoading, structureNodes]);

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

  const rememberWorkingSnapshot = useCallback(() => {
    workingSnapshotRef.current = {
      fileId: selectedMember?.fileId ?? null,
      nodePath: selectedNodePath,
      propertyName: selectedPropertyName,
      scrollLine: lastVisibleLine,
      sourceMode: canvasModeQueryValue(canvasMode)
    };
  }, [canvasMode, lastVisibleLine, selectedMember?.fileId, selectedNodePath, selectedPropertyName]);

  const selectStructureTarget = useCallback(
    (fileId: string, nodePath: string | null, propertyName: string | null = null) => {
      if (!selectedConfigSet) return;
      setSuppressScrollSync(true);
      setSelectedNodePath(nodePath);
      setSelectedPropertyName(propertyName);
      setInspectorLevelOverride(null);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: fileId,
          node: nodePath,
          property: propertyName,
          sourceMode: canvasModeQueryValue(canvasMode),
          version: historyVersionId
        })
      );
      window.setTimeout(() => setSuppressScrollSync(false), 250);
    },
    [canvasMode, historyVersionId, onNavigate, project.id, search, selectedConfigSet]
  );

  const runUnifiedSearch = useCallback(async () => {
    const q = searchDraft.trim();
    if (!q) {
      setSearchHits([]);
      setSearchError("");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const result = await dtsRepository.search(project.id, { q });
      setSearchHits(result.hits);
      setFindQuery(q);
    } catch (error: unknown) {
      setSearchHits([]);
      setSearchError(error instanceof Error ? error.message : "搜索失败。");
    } finally {
      setSearchLoading(false);
    }
  }, [dtsRepository, project.id, searchDraft]);

  const handleSearchHit = useCallback(
    (hit: DtsSearchHit) => {
      if (!selectedConfigSet) return;
      setSuppressScrollSync(true);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: hit.fileId,
          node: hit.nodePath,
          property: hit.propertyName ?? null,
          sourceMode: canvasModeQueryValue(canvasMode),
          version: historyVersionId
        })
      );
      if (hit.source) {
        setFocusLineOverride(hit.source.startLine);
      }
      window.setTimeout(() => setSuppressScrollSync(false), 250);
    },
    [canvasMode, historyVersionId, onNavigate, project.id, search, selectedConfigSet]
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
        // Update tree selection without stealing focus or rewriting URL on every scroll tick.
        setSelectedNodePath(nearest.nodePath);
        setSelectedPropertyName(null);
      }, 80);
    },
    [canvasMode, selectedMember, selectedNodePath, structureNodes, suppressScrollSync]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || target?.isContentEditable;

      // Never override browser/system shortcuts (meta/ctrl combinations).
      if (event.metaKey || event.ctrlKey) return;

      if (event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setFindNextToken((value) => value + 1);
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        const line = Number(window.prompt("跳转到行号") || "");
        if (Number.isFinite(line) && line >= 1) {
          setFocusLineOverride(line);
        }
        return;
      }
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        treeRegionRef.current?.focus();
        return;
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        sourceRegionRef.current?.querySelector<HTMLElement>('[aria-label="DTS 源码"]')?.focus();
        return;
      }
      if (!typing && event.key === "/" ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const memberIds = useMemo(
    () => new Set(selectedMembers.map((item) => item.fileId)),
    [selectedMembers]
  );
  const ungroupedFiles = projectFiles.filter((item) => !memberIds.has(item.id));

  useEffect(() => {
    const requested = queryValue(search, "baseline");
    if (requested && baselines.some((item) => item.id === requested)) {
      releaseBaselineSession.selectBaseline(requested);
      return;
    }
    if (!requested) {
      if (selectedBaselineId && baselines.some((item) => item.id === selectedBaselineId)) {
        return;
      }
      releaseBaselineSession.selectBaseline(null);
    }
  }, [baselines, releaseBaselineSession, search, selectedBaselineId]);

  useEffect(() => {
    void releaseBaselineSession.loadPinnedMembers(project.id, dtsRepository);
  }, [dtsRepository, project.id, releaseBaselineSession, selectedBaselineId, selectedConfigSet]);

  useEffect(() => {
    const available = ungroupedFiles[0]?.id ?? "";
    setMemberFileId((current) => (current && ungroupedFiles.some((item) => item.id === current) ? current : available));
  }, [ungroupedFiles]);

  useEffect(() => {
    setMemberSortOrder(selectedMembers.length);
  }, [selectedMembers.length]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  }, []);

  const handleCreateConfigSet = useCallback(
    async (name: string): Promise<string | null | undefined> => {
      if (!canAdmin) return undefined;
      const result = await configSetOpsSession.create(
        project.id,
        { name, existingNames: configSets.map((item) => item.name) },
        dtsRepository
      );
      if (!result.ok) {
        return result.kind === "validation" ? result.message : undefined;
      }
      setConfigSets((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setMembers([]);
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: result.item.id,
          file: null,
          node: null,
          property: null,
          sourceMode: null,
          version: null,
          candidate: null
        })
      );
      return null;
    },
    [canAdmin, configSetOpsSession, configSets, dtsRepository, onNavigate, project.id, search]
  );

  const submitCreateConfigSet = useCallback(
    async (name: string): Promise<string | null | undefined> => {
      let result: string | null | undefined = undefined;
      await runAction("create-config-set", async () => {
        result = await handleCreateConfigSet(name);
      });
      return result;
    },
    [handleCreateConfigSet, runAction]
  );

  const addMemberToConfigSet = useCallback(
    async (fileId: string, role: ConfigSetRole, sortOrder: number) => {
      if (!canAdmin || !selectedConfigSet) return;
      const file = projectFiles.find((item) => item.id === fileId);
      const result = await configSetOpsSession.addMember(
        project.id,
        selectedConfigSet.id,
        { fileId, role, sortOrder, file },
        dtsRepository
      );
      if (!result.ok) return;
      setMembers((current) => [
        ...current.filter((item) => item.fileId !== result.membership.fileId),
        {
          ...result.membership,
          fileName: result.fileName,
          format: result.format,
          currentVersionId: result.currentVersionId,
          currentVersionNumber: result.currentVersionNumber
        }
      ]);
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      setMembersRetry((value) => value + 1);
    },
    [canAdmin, configSetOpsSession, dtsRepository, project.id, projectFiles, selectedConfigSet]
  );

  const assignUngroupedFile = useCallback(
    async (file: ProjectParameterFile) => {
      const role = defaultRoleForFile(file, selectedMembers.length > 0);
      await addMemberToConfigSet(file.id, role, selectedMembers.length);
    },
    [addMemberToConfigSet, selectedMembers.length]
  );

  const removeMemberFromConfigSet = useCallback(
    async (fileId: string) => {
      if (!canAdmin || !selectedConfigSet) return;
      const result = await configSetOpsSession.removeMember(
        project.id,
        selectedConfigSet.id,
        fileId,
        dtsRepository
      );
      if (!result.ok) return;
      setMembers((current) => current.filter((item) => item.fileId !== fileId));
      if (selectedMember?.fileId === fileId) {
        onNavigate(
          formatWorkbenchPath(project.id, search, {
            configSet: selectedConfigSet.id,
            file: null,
            node: null,
            property: null,
            sourceMode: null,
            version: null
          })
        );
      }
      setMembersRetry((value) => value + 1);
    },
    [
      canAdmin,
      configSetOpsSession,
      dtsRepository,
      onNavigate,
      project.id,
      search,
      selectedConfigSet,
      selectedMember?.fileId
    ]
  );

  const requestRemoveMember = useCallback(
    (member: DtsConfigSetMemberFile) => {
      if (!canAdmin || !selectedConfigSet) return;
      setConfirmation({
        key: `remove-member-${member.fileId}`,
        title: "移除配置集成员",
        description: (
          <p>
            将把 <code>{member.fileName}</code>（角色：
            {ROLE_LABELS[member.role] ?? member.role}）从配置集「{selectedConfigSet.name}」中移除。该文件本身不会被删除，但基于此配置集的后续基线与导出将不再包含它。
          </p>
        ),
        confirmLabel: "确认移除",
        pendingLabel: "移除中…",
        tone: "danger",
        run: () => removeMemberFromConfigSet(member.fileId)
      });
    },
    [canAdmin, removeMemberFromConfigSet, selectedConfigSet]
  );

  const syncSelectedFile = useCallback(async () => {
    if (!canAdmin || !selectedMember) return;
    const result = await configSetOpsSession.syncFile(
      project.id,
      { fileId: selectedMember.fileId, fileName: selectedMember.fileName },
      fileRepository
    );
    if (!result.ok) return;
    setSyncEvidence(result.evidence);
    setTasksOpen(true);
    setProjectFiles(result.files);
    conflictLocateFacade.setOpenConflicts(result.conflicts);
    setMembersRetry((value) => value + 1);
    setFilesRetry((value) => value + 1);
  }, [canAdmin, configSetOpsSession, conflictLocateFacade, fileRepository, project.id, selectedMember]);

  const exportSelectedConfigSet = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet) return;
    const result = await configSetOpsSession.exportConfigSet(
      project.id,
      selectedConfigSet.id,
      selectedConfigSet.name,
      dtsRepository
    );
    if (!result.ok) return;
    downloadExportBundle(selectedConfigSet.name, result.export);
    setExportEvidence(result.evidence);
    setTasksOpen(true);
  }, [canAdmin, configSetOpsSession, dtsRepository, project.id, selectedConfigSet]);

  const selectConfigSet = useCallback(
    (configSetId: string) => {
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: configSetId,
          file: null,
          node: null,
          property: null,
          sourceMode: null,
          version: null
        })
      );
    },
    [onNavigate, project.id, search]
  );

  const selectMember = useCallback(
    (fileId: string) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride("file");
      const switchingFile = selectedMember?.fileId !== fileId;
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: fileId,
          node: null,
          property: null,
          sourceMode: switchingFile ? null : canvasModeQueryValue(canvasMode),
          version: switchingFile || canvasMode === "working" ? null : historyVersionId
        })
      );
    },
    [canvasMode, historyVersionId, onNavigate, project.id, search, selectedConfigSet, selectedMember?.fileId]
  );

  const refreshActivityTimeline = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const [response, candidates] = await Promise.all([
        listAuditEvents({
          projectId: project.id,
          apps: workbenchActivityApps(),
          limit: 40
        }),
        fileRepository.listCandidates(project.id, { includeAbandoned: false }).catch(() => [])
      ]);
      const views = response.items.map(mapApiAuditEventToView);
      setActivityEvents(views);
      setActivityRows(views.map(presentWorkbenchActivity));
      setKnownCandidateIds(candidates.map((item) => item.id));
    } catch (error: unknown) {
      setActivityError(error instanceof Error ? error.message : "加载项目活动失败");
      setActivityEvents([]);
      setActivityRows([]);
    } finally {
      setActivityLoading(false);
    }
  }, [fileRepository, listAuditEvents, project.id]);

  useEffect(() => {
    if (inspectorLevel !== "activity" || !inspectorOpen) return;
    void refreshActivityTimeline();
  }, [inspectorLevel, inspectorOpen, refreshActivityTimeline, activityRefreshToken]);

  const openActivityInspector = useCallback(() => {
    if (!selectedConfigSet) return;
    setActivityMissingNotice("");
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
      const catalog = {
        configSetIds: new Set(configSets.map((item) => item.id)),
        fileIds: new Set(projectFiles.map((item) => item.id)),
        candidateIds: new Set(
          [
            ...knownCandidateIds,
            activeCandidate?.id,
            candidateId
          ].filter((value): value is string => Boolean(value))
        ),
        baselineIds: new Set(baselines.map((item) => item.id)),
        knownNodePathsByFileId: new Map([
          [selectedMember?.fileId ?? "", new Set(structureNodes.map((node) => node.nodePath))]
        ])
      };
      const resolved = resolveWorkbenchActivityTarget(event, catalog);
      if (resolved.missing) {
        setActivityMissingNotice(resolved.missingReason ?? "该活动目标已不可用。");
        return;
      }
      setActivityMissingNotice("");
      setInspectorLevelOverride(null);
      setInspectorOpen(true);

      if (resolved.kind === "config-set" && resolved.configSetId) {
        onNavigate(
          formatWorkbenchPath(project.id, search, {
            configSet: resolved.configSetId,
            file: null,
            node: null,
            property: null,
            sourceMode: null,
            version: null,
            candidate: null,
            inspector: null
          })
        );
        setInspectorLevelOverride("config-set");
        return;
      }

      if (resolved.kind === "candidate" && resolved.candidateId) {
        onNavigate(
          formatWorkbenchPath(project.id, search, {
            configSet: selectedConfigSet.id,
            file: resolved.fileId ?? selectedMember?.fileId ?? null,
            node: null,
            property: null,
            sourceMode: "candidate",
            version: null,
            candidate: resolved.candidateId,
            inspector: null
          })
        );
        return;
      }

      if (resolved.kind === "baseline") {
        if (resolved.missing) {
          setActivityMissingNotice(resolved.missingReason ?? "发布基线已不存在；事件仍可作为只读证据。");
          return;
        }
        if (resolved.baselineId && selectedConfigSet) {
          setActivityMissingNotice("");
          releaseBaselineSession.selectBaseline(resolved.baselineId);
          setInspectorOpen(true);
          onNavigate(
            formatWorkbenchPath(project.id, search, {
              configSet: selectedConfigSet.id,
              file: selectedMember?.fileId ?? null,
              baseline: resolved.baselineId,
              inspector: null
            })
          );
        }
        return;
      }

      if (resolved.kind === "conflict") {
        setTasksOpen(true);
        setActivityMissingNotice("");
        void conflictLocateFacade.openArbitration(project.id, fileRepository, {
          fileId: resolved.fileId,
          nodePath: resolved.nodePath ?? null,
          propertyName: resolved.propertyName ?? null
        });
        if (resolved.fileId) {
          selectStructureTarget(
            resolved.fileId,
            resolved.nodePath ?? null,
            resolved.propertyName ?? null
          );
        }
        return;
      }

      if (resolved.fileId) {
        if (resolved.nodePath) setSelectedNodePath(resolved.nodePath);
        else setSelectedNodePath(null);
        if (resolved.propertyName) setSelectedPropertyName(resolved.propertyName);
        else setSelectedPropertyName(null);
        onNavigate(
          formatWorkbenchPath(project.id, search, {
            configSet: selectedConfigSet.id,
            file: resolved.fileId,
            node: resolved.nodePath ?? null,
            property: resolved.propertyName ?? null,
            sourceMode: null,
            version: null,
            candidate: null,
            inspector: null
          })
        );
      }
    },
    [
      activeCandidate?.id,
      activityEvents,
      baselines,
      candidateId,
      conflictLocateFacade,
      fileRepository,
      knownCandidateIds,
      configSets,
      onNavigate,
      project.id,
      projectFiles,
      releaseBaselineSession,
      search,
      selectStructureTarget,
      selectedConfigSet,
      selectedMember?.fileId,
      structureNodes
    ]
  );

  const notifyMutation = useCallback(
    (message: string) => {
      showToast(message);
      setActivityRefreshToken((value) => value + 1);
    },
    [showToast]
  );

  const handleCandidateFileChange = useCallback(
    (file: File) => {
      if (!selectedConfigSet) return;
      void (async () => {
        try {
          const created = await candidateFlow.create(
            project.id,
            { file, fileId: selectedMember?.fileId },
            fileRepository
          );
          setInspectorOpen(true);
          onNavigate(
            formatWorkbenchPath(project.id, search, {
              configSet: selectedConfigSet.id,
              file: selectedMember?.fileId ?? null,
              sourceMode: "candidate",
              candidate: created.id,
              version: null,
              node: null,
              property: null
            })
          );
          notifyMutation(
            created.status === "failed"
              ? "候选解析失败，活跃源码未改动；可查看诊断后放弃。"
              : "候选已创建，工作配置与活跃版本未改动。"
          );
        } catch {
          // candidateFlow.error already set
        }
      })();
    },
    [
      candidateFlow,
      fileRepository,
      notifyMutation,
      onNavigate,
      project.id,
      search,
      selectedConfigSet,
      selectedMember?.fileId
    ]
  );

  const handleOpenCreateBaseline = useCallback(() => {
    releaseBaselineSession.clearActionError();
    setCreateBaselineOpen(true);
  }, [releaseBaselineSession]);

  const enterCanvasMode = useCallback(
    (mode: WorkbenchCanvasMode, versionId: string | null) => {
      if (!selectedConfigSet || !selectedMember) return;
      if (canvasMode === "working") {
        rememberWorkingSnapshot();
      }
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: selectedMember.fileId,
          node: selectedNodePath,
          property: selectedPropertyName,
          sourceMode: canvasModeQueryValue(mode),
          version: versionId,
          candidate: null
        })
      );
    },
    [
      canvasMode,
      onNavigate,
      project.id,
      rememberWorkingSnapshot,
      search,
      selectedConfigSet,
      selectedMember,
      selectedNodePath,
      selectedPropertyName
    ]
  );

  const exitSpecialCanvasMode = useCallback(() => {
    if (!selectedConfigSet) return;
    const snapshot = workingSnapshotRef.current;
    const restoreLine = snapshot?.scrollLine ?? lastVisibleLine;
    setRestoredScrollLine(restoreLine);
    if (restoreLine != null) setFocusLineOverride(restoreLine);
    setSuppressScrollSync(true);
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: snapshot?.fileId ?? selectedMember?.fileId ?? null,
        node: snapshot?.nodePath ?? selectedNodePath,
        property: snapshot?.propertyName ?? selectedPropertyName,
        sourceMode: null,
        version: null,
        candidate: null
      })
    );
    window.setTimeout(() => {
      if (restoreLine != null) setFocusLineOverride(restoreLine);
      setSuppressScrollSync(false);
      setRestoredScrollLine(null);
    }, 300);
  }, [
    lastVisibleLine,
    onNavigate,
    project.id,
    search,
    selectedConfigSet,
    selectedMember?.fileId,
    selectedNodePath,
    selectedPropertyName
  ]);

  const handleDownloadVersion = useCallback(
    async (version: ProjectParameterFileVersion) => {
      if (!selectedMember) return;
      setDownloadMessage("");
      try {
        await triggerVersionDownload(
          fileRepository,
          project.id,
          selectedMember.fileId,
          version,
          selectedMember.fileName
        );
        setDownloadMessage(`已下载 ${selectedMember.fileName} 的版本 ${version.versionNumber}`);
      } catch (error: unknown) {
        setDownloadMessage(error instanceof Error ? error.message : "下载失败。");
      }
    },
    [fileRepository, project.id, selectedMember]
  );

  const downloadActiveDts = useCallback(async () => {
    if (!selectedMember?.currentVersionId || downloadingDts) return;
    const activeVersion =
      fileVersions.find((item) => item.id === selectedMember.currentVersionId) ??
      ({
        id: selectedMember.currentVersionId,
        fileId: selectedMember.fileId,
        versionNumber: 0,
        checksum: "",
        sizeBytes: 0,
        parsedIndex: {},
        origin: "upload",
        createdAt: ""
      } satisfies ProjectParameterFileVersion);
    setDownloadingDts(true);
    try {
      await handleDownloadVersion(activeVersion);
    } finally {
      setDownloadingDts(false);
    }
  }, [downloadingDts, fileVersions, handleDownloadVersion, selectedMember]);

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

  const createWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet) return;
    try {
      const created = await releaseBaselineSession.create(
        project.id,
        selectedConfigSet.id,
        { name: newBaselineName, localSessionDirty: sessionDraftsDirty },
        dtsRepository
      );
      setNewBaselineName("");
      setCreateBaselineOpen(false);
      setReadinessRetry((value) => value + 1);
      setBaselinesRetry((value) => value + 1);
      notifyMutation(`已创建基线「${created.name}」。`);
    } catch {
      // actionError is owned by ReleaseBaselineSession
    }
  }, [
    canAdmin,
    dtsRepository,
    newBaselineName,
    notifyMutation,
    project.id,
    releaseBaselineSession,
    selectedConfigSet,
    sessionDraftsDirty
  ]);

  const selectWorkbenchBaseline = useCallback(
    (baselineId: string) => {
      if (!selectedConfigSet) return;
      releaseBaselineSession.selectBaseline(baselineId);
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: selectedMember?.fileId ?? null,
          baseline: baselineId,
          sourceMode: canvasModeQueryValue(canvasMode),
          version: historyVersionId,
          candidate: candidateId
        })
      );
    },
    [
      candidateId,
      canvasMode,
      historyVersionId,
      onNavigate,
      project.id,
      releaseBaselineSession,
      search,
      selectedConfigSet,
      selectedMember?.fileId
    ]
  );

  const compareWorkbenchBaseline = useCallback(
    async (against: "working" | "released") => {
      if (!selectedConfigSet || !selectedBaselineId) return;
      releaseBaselineSession.clearActionError();
      setWorkingReturnPath(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: selectedMember?.fileId ?? null,
          node: selectedNodePath,
          property: selectedPropertyName,
          sourceMode: null,
          version: null,
          candidate: null,
          baseline: selectedBaselineId
        })
      );
      const result = await releaseBaselineSession.compare(project.id, against, dtsRepository);
      const firstDrift = result.members.find(
        (member) => member.status === "version_changed" && member.baselineVersionId
      );
      if (firstDrift?.baselineVersionId && firstDrift.fileId) {
        onNavigate(
          formatWorkbenchPath(project.id, search, {
            configSet: selectedConfigSet.id,
            file: firstDrift.fileId,
            sourceMode: "unified-diff",
            version: firstDrift.baselineVersionId,
            baseline: selectedBaselineId,
            node: null,
            property: null,
            candidate: null
          })
        );
      }
      notifyMutation(
        against === "released" ? "已对比基线与已发布 tip。" : "已对比基线与 Working 配置。"
      );
    },
    [
      dtsRepository,
      notifyMutation,
      onNavigate,
      project.id,
      releaseBaselineSession,
      search,
      selectedBaselineId,
      selectedConfigSet,
      selectedMember?.fileId,
      selectedNodePath,
      selectedPropertyName
    ]
  );

  const exitBaselineCompare = useCallback(() => {
    releaseBaselineSession.clearCompare();
    if (workingReturnPath) {
      onNavigate(workingReturnPath);
      setWorkingReturnPath(null);
      return;
    }
    if (!selectedConfigSet) return;
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: selectedMember?.fileId ?? null,
        sourceMode: null,
        version: null,
        baseline: selectedBaselineId,
        candidate: null
      })
    );
  }, [
    onNavigate,
    project.id,
    releaseBaselineSession,
    search,
    selectedBaselineId,
    selectedConfigSet,
    selectedMember?.fileId,
    workingReturnPath
  ]);

  const selectBaselineCompareMember = useCallback(
    (member: DtsBaselineMemberComparison) => {
      if (!selectedConfigSet || !member.baselineVersionId) return;
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: member.fileId,
          sourceMode: canvasMode === "side-by-side" ? "side-by-side" : "unified-diff",
          version: member.baselineVersionId,
          baseline: selectedBaselineId,
          node: null,
          property: null,
          candidate: null
        })
      );
    },
    [canvasMode, onNavigate, project.id, search, selectedBaselineId, selectedConfigSet]
  );

  const releaseWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet || !selectedBaselineId) return;
    try {
      const result = await releaseBaselineSession.release(
        project.id,
        selectedConfigSet.id,
        { localSessionDirty: sessionDraftsDirty },
        dtsRepository
      );
      setReleaseBaselineOpen(false);
      setReadinessRetry((value) => value + 1);
      setBaselinesRetry((value) => value + 1);
      notifyMutation(`已发布基线「${result.item.name}」。`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("确认策略允许的警告")) {
        setTasksOpen(true);
      }
    }
  }, [
    canAdmin,
    dtsRepository,
    notifyMutation,
    project.id,
    releaseBaselineSession,
    selectedBaselineId,
    selectedConfigSet,
    sessionDraftsDirty
  ]);

  const openRestoreWorkbenchBaseline = useCallback(async () => {
    if (!selectedBaselineId) return;
    releaseBaselineSession.clearActionError();
    await releaseBaselineSession.previewRestore(project.id, dtsRepository);
    setRestoreBaselineOpen(true);
  }, [dtsRepository, project.id, releaseBaselineSession, selectedBaselineId]);

  const restoreWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet || !selectedBaselineId) return;
    releaseBaselineSession.clearActionError();
    const { result, tipUnchanged } = await releaseBaselineSession.restore(
      project.id,
      selectedConfigSet.id,
      dtsRepository
    );
    setRestoreBaselineOpen(false);
    setMembersRetry((value) => value + 1);
    setBaselinesRetry((value) => value + 1);
    setReadinessRetry((value) => value + 1);
    setSourceRetry((value) => value + 1);
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: selectedMember?.fileId ?? null,
        sourceMode: null,
        version: null,
        baseline: selectedBaselineId,
        candidate: null
      })
    );
    notifyMutation(
      tipUnchanged
        ? `已恢复基线成员（${result.restored} 项）；已发布 tip 未变。`
        : `已恢复基线成员（${result.restored} 项）。`
    );
  }, [
    canAdmin,
    dtsRepository,
    notifyMutation,
    onNavigate,
    project.id,
    releaseBaselineSession,
    search,
    selectedBaselineId,
    selectedConfigSet,
    selectedMember?.fileId
  ]);

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
      setMembersRetry((value) => value + 1);
      setStructureRetry((value) => value + 1);
      setSourceRetry((value) => value + 1);
      setFilesRetry((value) => value + 1);
    } catch {
      // submitError is projected from the session snapshot
    }
  }, [canEdit, dtsRepository, project.id, selectedMember, structuredEditSession, submittingEdits]);

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

      {opsError ? (
        <p className="configuration-workbench__ops-banner" role="alert">
          {opsError}
        </p>
      ) : null}
      {opsMessage ? (
        <p className="configuration-workbench__ops-banner" role="status">
          {opsMessage}
        </p>
      ) : null}
      {!canAdmin ? (
        <p className="configuration-workbench__ops-banner" role="note">
          仅管理员可变更配置集成员、同步或导出。只读上下文仍可查看。
        </p>
      ) : null}

      {narrowViewport ? (
        <nav className="configuration-workbench__mobile-tools" aria-label="工作台区域">
          <button className="button subtle configuration-workbench__mobile-tool" type="button" aria-label="源结构" aria-expanded={treeOpen} onClick={() => setTreeOpen((open) => !open)}>
            <FolderTree size={16} aria-hidden="true" />
            源结构
          </button>
          <button className="button subtle configuration-workbench__mobile-tool" type="button" aria-label="活动" aria-pressed={inspectorOpen && inspectorLevel === "activity"} onClick={openActivityInspector}>
            <Activity size={16} aria-hidden="true" />
            活动
          </button>
          <button className="button subtle configuration-workbench__mobile-tool" type="button" aria-label="检查器" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}>
            <PanelRight size={16} aria-hidden="true" />
            检查器
          </button>
          <button className="button subtle configuration-workbench__mobile-tool" type="button" aria-label="任务面板" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)}>
            <Rows3 size={16} aria-hidden="true" />
            任务
          </button>
        </nav>
      ) : null}

      {configSetsLoading ? (
        <div className="configuration-workbench__setup-state" role="status">
          正在加载配置集…
        </div>
      ) : configSetsError ? (
        <div className="configuration-workbench__setup-state" role="alert">
          <strong>配置集加载失败</strong>
          <p>{configSetsError}</p>
          <button className="button subtle" type="button" onClick={() => setConfigRetry((value) => value + 1)}>
            重试配置集
          </button>
        </div>
      ) : !selectedConfigSet ? (
        <div className="configuration-workbench__setup-state" role="status">
          <strong>项目还没有配置集</strong>
          {canAdmin ? (
            <>
              <p>
                从配置集下拉框选择「+ 新建配置集…」即可创建。上传文件或候选不会自动激活工作配置；创建后需明确把文件编入成员。
              </p>
              <p className="configuration-workbench__empty-hint">上传不会自动激活工作配置。</p>
            </>
          ) : (
            <>
              <p>当前账号无法创建配置集。只读上下文仍可查看；请联系管理员完成初始化。</p>
            </>
          )}
        </div>
      ) : (
        <div className="configuration-workbench__body" ref={workbenchBodyRef} aria-label="工作台主体">
          {treeOpen ? (
            <aside className="configuration-workbench__tree" aria-label="源结构" tabIndex={-1} ref={treeRegionRef}>
              <div className="configuration-workbench__region-head">
                <div>
                  <span>源结构</span>
                  <strong>{selectedConfigSet.name}</strong>
                </div>
                <button className="button subtle configuration-workbench__icon-button" type="button" aria-label="折叠源结构" onClick={() => setTreeOpen(false)}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
              </div>
              <form
                className="configuration-workbench__search"
                aria-label="统一结构搜索"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runUnifiedSearch();
                }}
              >
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="文件名 / 路径 / 属性…"
                  aria-label="统一搜索查询"
                />
                <div className="configuration-workbench__search-actions">
                  <button className="button subtle" type="submit" disabled={searchLoading}>
                    <Search size={14} aria-hidden="true" />
                    {searchLoading ? "搜索中…" : "搜索"}
                  </button>
                </div>
              </form>
              {searchError ? (
                <div role="alert" className="configuration-workbench__scoped-error">
                  <p>{searchError}</p>
                </div>
              ) : null}
              {searchHits.length > 0 ? (
                <div className="configuration-workbench__search-results" aria-label="搜索结果">
                  {groupHitsByFile(searchHits).map((group) => (
                    <div key={group.fileId} className="configuration-workbench__search-group">
                      <strong>{group.fileName}</strong>
                      <ul>
                        {group.hits.map((hit, index) => (
                          <li key={`${hit.fileId}-${hit.nodePath}-${hit.propertyName ?? ""}-${index}`}>
                            <button
                              type="button"
                              className="button subtle"
                              onClick={() => handleSearchHit(hit)}
                            >
                              <code>{hit.nodePath}</code>
                              {hit.propertyName ? <span> · {hit.propertyName}</span> : null}
                              {hit.snippet ? <small>{hit.snippet}</small> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
              {membersLoading ? <p role="status">正在加载成员文件…</p> : null}
              {membersError ? (
                <div role="alert" className="configuration-workbench__scoped-error">
                  <p>{membersError}</p>
                  <button className="button subtle" type="button" onClick={() => setMembersRetry((value) => value + 1)}>
                    重试成员
                  </button>
                </div>
              ) : null}
              {!membersLoading && !membersError && selectedMembers.length === 0 ? (
                <div className="configuration-workbench__empty">
                  <strong>当前配置集没有成员文件</strong>
                  <p>
                    从下方未编组文件编入成员，或上传候选后再明确分配。上传候选不会自动激活工作配置。
                  </p>
                  {canAdmin ? (
                    <button
                      className="button subtle"
                      type="button"
                      disabled={uploadingCandidate}
                      onClick={() => candidateFileInputRef.current?.click()}
                    >
                      {uploadingCandidate ? "上传中…" : "上传候选"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div role="tree" aria-label={`${selectedConfigSet.name} 成员文件`} className="configuration-workbench__member-tree">
                {selectedMembers.map((item) => {
                  const roleLabel = ROLE_LABELS[item.role];
                  const versionLabel = item.currentVersionNumber ? `v${item.currentVersionNumber}` : "无活跃版本";
                  const selected = item.fileId === selectedMember?.fileId;
                  return (
                    <div key={item.fileId} className="configuration-workbench__member-block">
                      <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected}
                        aria-expanded={selected ? true : undefined}
                        aria-label={`${item.fileName} ${roleLabel} ${versionLabel}`}
                        className={`button subtle configuration-workbench__member${selected ? " is-selected" : ""}`}
                        onClick={() => selectMember(item.fileId)}
                      >
                        <FileCode2 size={15} aria-hidden="true" />
                        <span>
                          <strong title={item.fileName}>{item.fileName}</strong>
                          <small className="mono" title={item.currentVersionId ?? undefined}>
                            {item.currentVersionId ?? "版本身份缺失"}
                          </small>
                        </span>
                        <span className="configuration-workbench__member-meta" aria-hidden="true">
                          <span>{roleLabel}</span>
                          <span>{versionLabel}</span>
                        </span>
                      </button>
                      {selected ? (
                        <div className="configuration-workbench__node-tree-wrap">
                          {structureLoading ? <p role="status">正在加载结构树…</p> : null}
                          {structureError ? (
                            <div role="alert" className="configuration-workbench__scoped-error">
                              <p>{structureError}</p>
                              <button className="button subtle" type="button" onClick={() => setStructureRetry((value) => value + 1)}>
                                重试结构树
                              </button>
                            </div>
                          ) : null}
                          {!structureLoading && !structureError ? (
                            <WorkbenchStructureTree
                              nodes={structureNodes}
                              fileId={item.fileId}
                              selectedNodePath={selectedNodePath}
                              selectedPropertyName={selectedPropertyName}
                              sessionDrafts={sessionDrafts}
                              ariaLabel={`${item.fileName} 节点树`}
                              onSelectNode={(nodePath) => selectStructureTarget(item.fileId, nodePath, null)}
                              onSelectProperty={(nodePath, propertyName) =>
                                selectStructureTarget(item.fileId, nodePath, propertyName)
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div role="group" aria-label="未编组项目文件" className="configuration-workbench__ungrouped">
                <div className="configuration-workbench__ungrouped-title">
                  <span>未编组项目文件</span>
                  <small>{filesLoading ? "…" : ungroupedFiles.length}</small>
                </div>
                {filesError ? (
                  <div role="alert" className="configuration-workbench__scoped-error">
                    <p>{filesError}</p>
                    <button className="button subtle" type="button" onClick={() => setFilesRetry((value) => value + 1)}>
                      重试项目文件
                    </button>
                  </div>
                ) : null}
                {!filesError && !filesLoading && ungroupedFiles.length === 0 ? <p>没有未编组文件。</p> : null}
                {ungroupedFiles.map((item) => (
                  <div key={item.id} className="configuration-workbench__ungrouped-file">
                    <span>{item.fileName}</span>
                    <small>不参与当前工作配置与发布就绪度</small>
                    {canAdmin && selectedConfigSet ? (
                      <button
                        className="button subtle"
                        type="button"
                        aria-label={`编入 ${item.fileName}`}
                        disabled={pendingAction !== null}
                        onClick={() => void runAction(`assign-${item.id}`, () => assignUngroupedFile(item))}
                      >
                        编入当前配置集
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </aside>
          ) : (
            <button
              type="button"
              className="button subtle configuration-workbench__tree-collapsed"
              aria-label="展开源结构"
              onClick={() => setTreeOpen(true)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}

          <main className="configuration-workbench__source" aria-label="只读 DTS 源码" ref={sourceRegionRef}>
            {selectedMember ? (
              <header className="configuration-workbench__source-head">
                <div>
                  <span>
                    {selectedConfigSet.name} /{" "}
                    {canvasMode === "working"
                      ? "工作配置"
                      : canvasMode === "history"
                        ? "历史只读源码"
                        : canvasMode === "candidate"
                          ? "候选只读源码"
                          : "只读对比"}
                  </span>
                  <h2>{selectedMember.fileName}</h2>
                </div>
                <div className="configuration-workbench__version-identity">
                  <span>
                    {canvasMode === "working"
                      ? "活跃文件版本"
                      : canvasMode === "candidate"
                        ? "候选文件版本"
                        : "对照文件版本"}
                  </span>
                  <strong className="mono">
                    {canvasMode === "working"
                      ? selectedMember.currentVersionId ?? "缺失"
                      : canvasMode === "candidate"
                        ? activeCandidate?.id ?? candidateId ?? "缺失"
                        : historyVersionId ?? "缺失"}
                  </strong>
                </div>
                {canvasMode !== "working" ? (
                  <div className="configuration-workbench__mode-actions">
                    {canvasMode !== "candidate" && canvasMode !== "side-by-side" ? (
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => enterCanvasMode("side-by-side", historyVersionId)}
                      >
                        并排对比
                      </button>
                    ) : null}
                    {canvasMode !== "candidate" && canvasMode !== "unified-diff" ? (
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => enterCanvasMode("unified-diff", historyVersionId)}
                      >
                        统一差异
                      </button>
                    ) : null}
                    <button
                      className="button subtle"
                      type="button"
                      onClick={exitSpecialCanvasMode}
                      aria-label={
                        canvasMode === "history"
                          ? "退出历史源码"
                          : canvasMode === "candidate"
                            ? "退出候选源码"
                            : "退出对比"
                      }
                    >
                      {canvasMode === "history"
                        ? "退出历史源码"
                        : canvasMode === "candidate"
                          ? "退出候选源码"
                          : "退出对比"}
                    </button>
                  </div>
                ) : null}
              </header>
            ) : null}
            {canvasMode !== "working" ? (
              <p
                className="configuration-workbench__mode-banner"
                role="status"
                aria-label={
                  canvasMode === "history"
                    ? "历史只读源码模式"
                    : canvasMode === "candidate"
                      ? "候选只读源码模式"
                      : "只读对比模式"
                }
              >
                当前为
                {canvasMode === "history"
                  ? "历史只读源码"
                  : canvasMode === "candidate"
                    ? "候选只读源码"
                    : "只读对比"}
                模式，不能编辑，也不会改变工作配置。
              </p>
            ) : null}
            {candidateError ? (
              <div className="configuration-workbench__setup-state" role="alert">
                {candidateError}
              </div>
            ) : null}
            {sourceLoading || modeSourceLoading ? (
              <div className="configuration-workbench__source-state" role="status">
                {canvasMode === "working" ? "正在加载活跃源码…" : "正在加载对照源码…"}
              </div>
            ) : null}
            {!sourceLoading && !modeSourceLoading && (sourceError || modeSourceError) ? (
              <div className="configuration-workbench__source-state" role="alert">
                <Info size={20} aria-hidden="true" />
                <strong>源码读取失败</strong>
                <p>{sourceError || modeSourceError}</p>
                <button
                  className="button subtle configuration-workbench__retry"
                  type="button"
                  onClick={() =>
                    canvasMode === "working"
                      ? setSourceRetry((value) => value + 1)
                      : setModeSourceError("")
                  }
                >
                  重试源码
                </button>
              </div>
            ) : null}
            {!sourceLoading && !modeSourceLoading && !sourceError && !modeSourceError && !selectedMember ? (
              <div className="configuration-workbench__source-state" role="status">
                <strong>没有可读取的成员源码</strong>
                <p>选择含成员文件的配置集后，活跃源码会显示在这里。</p>
              </div>
            ) : null}
            {!sourceLoading &&
            !modeSourceLoading &&
            !sourceError &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "working" &&
            !selectedMember.currentVersionId ? (
              <div className="configuration-workbench__source-state" role="status">
                <strong>成员文件没有活跃版本</strong>
                <p>文件身份仍保留在树中；请在旧项目运营入口检查版本历史。</p>
              </div>
            ) : null}
            {!sourceLoading &&
            !modeSourceLoading &&
            !sourceError &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "working" &&
            selectedMember.currentVersionId &&
            !source ? (
              <div className="configuration-workbench__source-state" role="status">
                <strong>源码内容为空</strong>
                <p>当前活跃版本没有可显示的源码内容；可重试或回到旧项目运营入口检查版本历史。</p>
                <button className="button subtle configuration-workbench__retry" type="button" onClick={() => setSourceRetry((value) => value + 1)}>
                  重试源码
                </button>
              </div>
            ) : null}
            {!sourceLoading &&
            !modeSourceLoading &&
            !sourceError &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "working" &&
            source ? (
              <ProjectPrimaryDtsViewer
                className="configuration-workbench__code"
                fileName={selectedMember.fileName}
                versionNumber={selectedMember.currentVersionNumber ?? 0}
                text={source}
                focusSpan={restoredScrollLine != null ? null : focusSpan}
                focusLine={focusLineOverride ?? restoredScrollLine}
                findQuery={findQuery}
                findNextToken={findNextToken}
                onVisibleLineChange={handleVisibleLineChange}
                sessionChangeMarkers={sessionChangeMarkers}
              />
            ) : null}
            {!modeSourceLoading &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "history" &&
            historySource ? (
              <ProjectPrimaryDtsViewer
                className="configuration-workbench__code"
                fileName={selectedMember.fileName}
                versionNumber={
                  fileVersions.find((item) => item.id === historyVersionId)?.versionNumber ?? 0
                }
                text={historySource}
                focusLine={focusLineOverride}
                onVisibleLineChange={handleVisibleLineChange}
              />
            ) : null}
            {!candidateLoading &&
            canvasMode === "candidate" &&
            candidateSource ? (
              <ProjectPrimaryDtsViewer
                className="configuration-workbench__code"
                fileName={activeCandidate?.fileName ?? selectedMember?.fileName ?? "candidate.dts"}
                versionNumber={0}
                text={candidateSource}
                focusLine={focusLineOverride}
                onVisibleLineChange={handleVisibleLineChange}
              />
            ) : null}
            {canvasMode === "candidate" && candidateLoading ? (
              <div className="configuration-workbench__source-state" role="status">
                正在加载候选源码…
              </div>
            ) : null}
            {!modeSourceLoading &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "unified-diff" &&
            unifiedDiffText ? (
              <pre className="configuration-workbench__diff" aria-label="统一差异对比">
                {unifiedDiffText}
              </pre>
            ) : null}
            {!modeSourceLoading &&
            !modeSourceError &&
            selectedMember &&
            canvasMode === "side-by-side" &&
            historySource ? (
              <div className="configuration-workbench__side-by-side" aria-label="并排差异对比">
                <ProjectPrimaryDtsViewer
                  className="configuration-workbench__code"
                  fileName={`${selectedMember.fileName} · 工作配置`}
                  versionNumber={selectedMember.currentVersionNumber ?? 0}
                  text={compareSource || source}
                  onVisibleLineChange={handleVisibleLineChange}
                />
                <ProjectPrimaryDtsViewer
                  className="configuration-workbench__code"
                  fileName={`${selectedMember.fileName} · 历史`}
                  versionNumber={
                    fileVersions.find((item) => item.id === historyVersionId)?.versionNumber ?? 0
                  }
                  text={historySource}
                />
              </div>
            ) : null}
          </main>

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
              onRecomputeCandidate={() => {
                void (async () => {
                  try {
                    const updated = await candidateFlow.recompute(project.id, fileRepository);
                    notifyMutation(
                      updated.status === "ready"
                        ? "已按当前基重算候选影响，可再次审查后激活。"
                        : "已按当前阻断条件重算候选影响。"
                    );
                  } catch {
                    // candidateFlow.error already set
                  }
                })();
              }}
              onActivateCandidate={() => {
                candidateFlow.setActivateRole("overlay");
                setActivateConfirmOpen(true);
              }}
              onAbandonCandidate={() => {
                void (async () => {
                  try {
                    await candidateFlow.abandon(project.id, fileRepository);
                    notifyMutation("候选已放弃；工作配置与配置集成员未改动。");
                    if (selectedConfigSet) {
                      onNavigate(
                        formatWorkbenchPath(project.id, search, {
                          configSet: selectedConfigSet.id,
                          file: selectedMember?.fileId ?? null,
                          sourceMode: null,
                          candidate: null,
                          version: null
                        })
                      );
                    }
                  } catch {
                    // candidateFlow.error already set
                  }
                })();
              }}
              activityMissingNotice={activityMissingNotice}
              activityLoading={activityLoading}
              activityError={activityError}
              activityRows={activityRows}
              onActivityRetry={() => setActivityRefreshToken((value) => value + 1)}
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
      )}

      <ConfirmDialog
        open={activateConfirmOpen && activeCandidate?.status === "ready"}
        title="确认激活候选"
        description={
          <div>
            <p>
              将把候选 <code>{activeCandidate?.fileName}</code> 晋升为工作配置的活跃版本。此操作会改变后续基线可发布内容。
            </p>
            <ul>
              <li>
                对照活跃版本：{" "}
                <code className="mono">{activeCandidate?.baseVersionId ?? "新文件（无基）"}</code>
              </li>
              <li>结构差异：{(activeCandidate?.impact.structuralDiff?.length ?? 0) || 0} 项</li>
              <li>
                覆盖/映射：
                {activeCandidate?.impact.coverage
                  ? `已注册 ${activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 ${activeCandidate.impact.coverage.newUnregisteredCount}`
                  : "不适用"}
              </li>
              <li>阻断：{(activeCandidate?.blockers?.length ?? 0) === 0 ? "无" : activeCandidate?.blockers.length}</li>
            </ul>
            {activeCandidate?.impact.textDiff ? (
              <pre className="configuration-workbench__diff-view mono" tabIndex={0}>
                {activeCandidate.impact.textDiff}
              </pre>
            ) : null}
          </div>
        }
        confirmLabel="确认激活"
        tone="primary"
        pending={activatingCandidate}
        pendingLabel="激活中…"
        error={activateError}
        acknowledgement="我已审查影响范围，并确认对照的是当前活跃基版本。"
        extra={
          !activeCandidate?.fileId ? (
            <label className="configuration-workbench__activate-role">
              <span>新文件成员角色</span>
              <select
                value={activateRole}
                disabled={activatingCandidate}
                onChange={(event) => candidateFlow.setActivateRole(event.target.value as ConfigSetRole)}
              >
                {(Object.keys(ROLE_LABELS) as ConfigSetRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <small>将加入配置集 {selectedConfigSet?.name ?? "（未选择）"}，不会隐式创建其他成员关系。</small>
            </label>
          ) : null
        }
        onCancel={() => {
          if (!activatingCandidate) {
            setActivateConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          if (!activeCandidate || activeCandidate.status !== "ready") return;
          void (async () => {
            try {
              const result = await candidateFlow.activate(
                project.id,
                { configSetId: selectedConfigSet?.id },
                fileRepository
              );
              notifyMutation("候选已激活；工作源码、成员与历史已刷新。");
              setActivateConfirmOpen(false);
              setFilesRetry((value) => value + 1);
              setMembersRetry((value) => value + 1);
              setSourceRetry((value) => value + 1);
              setBaselinesRetry((value) => value + 1);
              if (selectedConfigSet) {
                onNavigate(
                  formatWorkbenchPath(project.id, search, {
                    configSet: selectedConfigSet.id,
                    file: result.file.id,
                    sourceMode: null,
                    candidate: null,
                    version: null
                  })
                );
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : "激活候选失败。";
              if (/stale/i.test(message)) {
                setActivateConfirmOpen(false);
                notifyMutation("基版本已变更，候选已标为过期；请重算影响后再激活。");
              }
            }
          })();
        }}
      />

      <footer className={tasksOpen ? "configuration-workbench__tasks is-open" : "configuration-workbench__tasks"}>
        <button className="button subtle configuration-workbench__task-toggle" type="button" aria-label="任务" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)}>
          <span>本轮更改 <strong>{sessionDraftRows.length + (syncEvidence || exportEvidence ? 1 : 0)}</strong></span>
          <span>校验问题 <strong>{sessionDraftRows.filter((row) => row.valid === false).length}</strong></span>
          <span>冲突 <strong>{syncConflicts.length}</strong></span>
          <span>
            就绪问题{" "}
            <strong>{(releaseReadiness?.blockers.length ?? 0) + (releaseReadiness?.warnings.length ?? 0)}</strong>
          </span>
          <span>{tasksOpen ? "收起" : "展开任务"}</span>
        </button>
        {tasksOpen ? (
          <div role="region" aria-label="配置任务" className="configuration-workbench__task-panel">
            <strong>会话变更</strong>
            {sessionDraftRows.length === 0 ? (
              <p>没有本轮更改。从结构树或源码定位选中属性后，用类型化编辑器写入本地会话变更。</p>
            ) : (
              <>
                {draftRecoveryStatus === "stale-base" ? (
                  <div className="configuration-workbench__stale-draft" role="status">
                    <p>
                      基线版本已变更。这些会话草稿仍可检查与复制，但在基于当前基线继续编辑之前不能校验或提交。
                    </p>
                    <div className="configuration-workbench__task-actions">
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => void handleCopySessionDrafts()}
                      >
                        复制草稿
                      </button>
                      <button
                        className="button primary"
                        type="button"
                        onClick={handleReconfirmStaleDrafts}
                      >
                        基于当前基线继续编辑
                      </button>
                    </div>
                    <textarea
                      ref={draftCopyFallbackRef}
                      aria-hidden="true"
                      tabIndex={-1}
                      readOnly
                      className="configuration-workbench__draft-copy-fallback"
                      style={{ position: "absolute", left: "-9999px", height: 1, width: 1, opacity: 0 }}
                    />
                    {draftCopyStatus ? <p role="status">{draftCopyStatus}</p> : null}
                  </div>
                ) : null}
                <ul className="configuration-workbench__session-changes" aria-label="会话变更列表">
                  {sessionDraftRows.map((row) => {
                    const checked = selectedDraftKeys.has(row.key);
                    return (
                      <li key={row.key}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            data-property-identity={row.identity}
                            aria-label={`${row.nodePath}/${row.propertyName}`}
                            onChange={() => {
                              const next = new Set(selectedDraftKeys);
                              if (next.has(row.key)) next.delete(row.key);
                              else next.add(row.key);
                              structuredEditSession.selectSubset(next);
                            }}
                          />
                          <span>
                            <code>{row.nodePath}/{row.propertyName}</code>
                            <small>
                              {row.beforeRawText} → {row.rawText}
                            </small>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <label className="configuration-workbench__reason">
                  <span>变更原因</span>
                  <textarea
                    aria-label="变更原因"
                    value={submitReason}
                    onChange={(event) => structuredEditSession.setReason(event.target.value)}
                    rows={2}
                    disabled={!canEdit}
                  />
                </label>
                <div className="configuration-workbench__task-actions">
                  <button
                    className="button subtle"
                    type="button"
                    onClick={handleValidateSelected}
                    disabled={!canEdit || sessionDraftRows.length === 0 || draftRecoveryStatus === "stale-base"}
                  >
                    校验所选
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void handleSubmitSelected()}
                    disabled={
                      !canEdit ||
                      submittingEdits ||
                      selectedDraftKeys.size === 0 ||
                      draftRecoveryStatus === "stale-base"
                    }
                  >
                    {submittingEdits ? "提交中…" : `提交所选（${selectedDraftKeys.size}）`}
                  </button>
                </div>
              </>
            )}
            {validateStatus ? (
              <p role="status">{validateStatus}</p>
            ) : null}
            {submitStatus ? (
              <p role="status">{submitStatus}</p>
            ) : null}
            {submitError ? (
              <p role="alert">{submitError}</p>
            ) : null}
            <strong>任务证据</strong>
            {syncEvidence ? <p role="status">{syncEvidence}</p> : null}
            {exportEvidence ? <p role="status">{exportEvidence}</p> : null}
            {syncConflicts.length > 0 ? (
              <WorkbenchConflictArbitrationDock
                projectId={project.id}
                repository={fileRepository}
                conflicts={syncConflicts}
                onConflictsChange={(next) => conflictLocateFacade.setOpenConflicts(next)}
                onQueueEmpty={() => setTasksOpen(false)}
                onLocateConflict={(conflict) => {
                  const target = conflictLocateFacade.locate(conflict);
                  if (!target) return;
                  selectStructureTarget(target.fileId, target.nodePath, target.propertyName);
                }}
              />
            ) : null}
            {canAdmin ? (
              <WorkbenchReleaseReadinessIssues
                readiness={releaseReadiness}
                acknowledgedWarningIds={acknowledgedWarningIds}
                onAcknowledgeWarning={(issueId) => {
                  releaseBaselineSession.acknowledgeWarning(issueId);
                }}
                onSelectIssue={handleSelectReadinessIssue}
                onRetry={() => setReadinessRetry((value) => value + 1)}
              />
            ) : null}
            {!syncEvidence && !exportEvidence && syncConflicts.length === 0 ? (
              <p>暂无同步或导出证据。手动同步与配置集导出结果会显示在这里。</p>
            ) : null}
          </div>
        ) : null}
      </footer>

      <ConfirmDialog
        open={createBaselineOpen}
        title="创建发布基线"
        description={
          <div>
            <p>将按当前配置集成员版本创建快照。创建不上传文件，也不改变工作配置。</p>
            {sessionDraftsDirty ? (
              <p role="alert">还有未保存的本机会话变更；请先提交或丢弃后再创建基线。</p>
            ) : null}
            {baselineActionError ? <p role="alert">{baselineActionError}</p> : null}
            <label>
              <span>基线名称</span>
              <input
                aria-label="基线名称"
                value={newBaselineName}
                onChange={(event) => setNewBaselineName(event.target.value)}
              />
            </label>
          </div>
        }
        confirmLabel="创建基线"
        cancelLabel="取消"
        pending={pendingAction === "create-baseline"}
        pendingLabel="创建中…"
        tone="primary"
        onCancel={() => {
          if (pendingAction) return;
          setCreateBaselineOpen(false);
          releaseBaselineSession.clearActionError();
        }}
        onConfirm={() => {
          void runAction("create-baseline", createWorkbenchBaseline);
        }}
      />

      <ConfirmDialog
        open={releaseBaselineOpen}
        title="发布基线确认"
        description={
          <div>
            <p>
              将把选中草稿发布为配置集当前 tip，并把先前 tip 标记为历史。发布会写入审计并刷新
              working-versus-released drift。
            </p>
            {releaseReadiness?.warnings
              .filter((item) => item.acknowledgementRequired)
              .map((item) => (
                <p key={item.id} role="note">
                  警告：{item.message}
                  {acknowledgedWarningIds.has(item.id) ? "（已确认）" : "（待确认）"}
                </p>
              ))}
            {baselineActionError ? <p role="alert">{baselineActionError}</p> : null}
          </div>
        }
        confirmLabel="确认发布"
        cancelLabel="取消"
        pending={pendingAction === "release-baseline"}
        pendingLabel="发布中…"
        tone="danger"
        onCancel={() => {
          if (pendingAction) return;
          setReleaseBaselineOpen(false);
          releaseBaselineSession.clearActionError();
        }}
        onConfirm={() => {
          void runAction("release-baseline", releaseWorkbenchBaseline);
        }}
      />

      <ConfirmDialog
        open={restoreBaselineOpen}
        title="恢复基线确认"
        description={
          restorePreview && selectedBaselineId
            ? formatRestorePreviewDescription(
                baselines.find((item) => item.id === selectedBaselineId)?.name ?? selectedBaselineId,
                restorePreview.members,
                restorePreview.releasedBaselineUnchanged
              )
            : "正在准备恢复预览…"
        }
        confirmLabel="确认恢复"
        cancelLabel="取消"
        pending={pendingAction === "restore-baseline"}
        pendingLabel="恢复中…"
        tone="danger"
        onCancel={() => {
          if (pendingAction) return;
          setRestoreBaselineOpen(false);
          releaseBaselineSession.clearRestorePreview();
          releaseBaselineSession.clearActionError();
        }}
        onConfirm={() => {
          void runAction("restore-baseline", restoreWorkbenchBaseline);
        }}
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="离开配置工作台"
        description={
          <p>
            还有未提交的会话变更。离开将丢弃本机可恢复草稿；若仅想稍后继续，请留在本页或先复制草稿。
          </p>
        }
        confirmLabel="丢弃并离开"
        cancelLabel="留在本页"
        tone="danger"
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={handleDiscardAndLeave}
      />

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? null}
        confirmLabel={confirmation?.confirmLabel ?? "确认"}
        pending={pendingAction === confirmation?.key}
        pendingLabel={confirmation?.pendingLabel}
        tone={confirmation?.tone ?? "primary"}
        onCancel={() => {
          if (pendingAction) return;
          setConfirmation(null);
        }}
        onConfirm={() => {
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
