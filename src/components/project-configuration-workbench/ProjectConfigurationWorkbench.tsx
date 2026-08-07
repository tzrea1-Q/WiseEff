import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronLeft, ChevronRight, FileCode2, FolderTree, Info, PanelRight, Rows3, Search } from "lucide-react";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsExportConfigSetResult,
  DtsReleaseBaseline,
  DtsSearchHit,
  DtsSourceLocator,
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  FileSyncSummary,
  ParameterFileCandidate,
  ParameterFileRepository,
  ParameterFileSyncConflict,
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
import { createAuditClient } from "@/infrastructure/http/auditClient";
import {
  presentWorkbenchActivity,
  resolveWorkbenchActivityTarget,
  workbenchActivityApps,
  type WorkbenchActivityRow
} from "./workbenchActivityModel";
import {
  buildUnifiedDiff,
  canvasModeQueryValue,
  classifyNodeRisk,
  formatSourceSpan,
  inspectorBackTarget,
  parseCanvasMode,
  resolveInspectorLevel,
  shouldPersistInspector,
  type InspectorLevel,
  type WorkbenchCanvasMode
} from "./workbenchInspectorModel";

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
  /** When false, mutations are denied but read context stays visible. Defaults true for back-compat. */
  canAdmin?: boolean;
  listAuditEvents?: (params?: ListAuditEventsParams) => Promise<AuditEventListResponse>;
};

const CONFIG_SET_ROLES: ConfigSetRole[] = ["base", "overlay", "charging", "thermal", "misc"];

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

function formatSyncSummary(result: FileSyncSummary): string {
  if (typeof result.draftsCreated === "number") {
    return `同步成功，已创建 ${result.draftsCreated} 条草稿。`;
  }
  return "同步成功。";
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
  if (patch.inspector === undefined) {
    params.delete("inspector");
  } else {
    setOrDelete("inspector", patch.inspector);
  }
  return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration?${params.toString()}`;
}

const ORIGIN_LABELS: Record<ProjectParameterFileVersion["origin"], string> = {
  upload: "手动上传",
  writeback: "参数回写"
};

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

function buildNestedTree(nodes: DtsStructuralNode[]): Array<DtsStructuralNode & { depth: number }> {
  return [...nodes]
    .sort((left, right) => left.nodePath.localeCompare(right.nodePath))
    .map((node) => ({
      ...node,
      depth: node.nodePath ? node.nodePath.split("/").filter(Boolean).length - 1 : 0
    }));
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
  canAdmin = true,
  listAuditEvents
}: ProjectConfigurationWorkbenchProps) {
  const listProjectActivity = useCallback(
    (params?: ListAuditEventsParams) =>
      listAuditEvents
        ? listAuditEvents(params)
        : createAuditClient().listAuditEvents(params),
    [listAuditEvents]
  );
  const { message: toastMessage, showToast } = useGovernanceToast();
  const [configSets, setConfigSets] = useState<DtsConfigSet[]>([]);
  const [projectFiles, setProjectFiles] = useState<ProjectParameterFile[]>([]);
  const [members, setMembers] = useState<DtsConfigSetMemberFile[]>([]);
  const [baselines, setBaselines] = useState<DtsReleaseBaseline[]>([]);
  const [source, setSource] = useState("");
  const [configSetsLoading, setConfigSetsLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [baselinesLoading, setBaselinesLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [configSetsError, setConfigSetsError] = useState("");
  const [filesError, setFilesError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [baselinesError, setBaselinesError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [configRetry, setConfigRetry] = useState(0);
  const [filesRetry, setFilesRetry] = useState(0);
  const [membersRetry, setMembersRetry] = useState(0);
  const [baselinesRetry, setBaselinesRetry] = useState(0);
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
  const [activeCandidate, setActiveCandidate] = useState<ParameterFileCandidate | null>(null);
  const [candidateSource, setCandidateSource] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [uploadingCandidate, setUploadingCandidate] = useState(false);
  const [activityEvents, setActivityEvents] = useState<AuditEventView[]>([]);
  const [activityRows, setActivityRows] = useState<WorkbenchActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityMissingNotice, setActivityMissingNotice] = useState("");
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);
  const [knownCandidateIds, setKnownCandidateIds] = useState<string[]>([]);
const [activateConfirmOpen, setActivateConfirmOpen] = useState(false);
  const [activatingCandidate, setActivatingCandidate] = useState(false);
  const [activateRole, setActivateRole] = useState<ConfigSetRole>("overlay");
  const [activateError, setActivateError] = useState("");
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
  const [lineJumpDraft, setLineJumpDraft] = useState("");
  const [focusLineOverride, setFocusLineOverride] = useState<number | null>(null);
  const [suppressScrollSync, setSuppressScrollSync] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const treeRegionRef = useRef<HTMLElement | null>(null);
  const [newConfigSetName, setNewConfigSetName] = useState("");
  const [configSetNameError, setConfigSetNameError] = useState("");
  const [opsError, setOpsError] = useState("");
  const [opsMessage, setOpsMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [memberFileId, setMemberFileId] = useState("");
  const [memberRole, setMemberRole] = useState<ConfigSetRole>("base");
  const [memberSortOrder, setMemberSortOrder] = useState(0);
  const [syncEvidence, setSyncEvidence] = useState("");
  const [syncConflicts, setSyncConflicts] = useState<ParameterFileSyncConflict[]>([]);
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
    if (!selectedConfigSet) {
      setBaselines([]);
      setBaselinesLoading(false);
      return;
    }
    let cancelled = false;
    setBaselinesLoading(true);
    setBaselinesError("");
    void dtsRepository
      .listBaselines(project.id, selectedConfigSet.id)
      .then((items) => {
        if (!cancelled) setBaselines(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBaselines([]);
          setBaselinesError(error instanceof Error ? error.message : "发布基线加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setBaselinesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baselinesRetry, dtsRepository, project.id, selectedConfigSet]);

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

  const selectedMember = useMemo(() => {
    const requested = queryValue(search, "file");
    return (
      selectedMembers.find((item) => item.fileId === requested) ??
      selectedMembers.find((item) => item.format === "dts" && item.currentVersionId) ??
      selectedMembers.find((item) => item.currentVersionId) ??
      selectedMembers[0] ??
      null
    );
  }, [search, selectedMembers]);

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
    if (queryValue(search, "inspector") === "activity") {
      setInspectorLevelOverride("activity");
      setInspectorOpen(true);
    }
  }, [search]);

  useEffect(() => {
    if (selectedNodePath || selectedPropertyName) {
      setInspectorOpen(true);
    }
  }, [selectedNodePath, selectedPropertyName]);

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
        setCandidateSource("");
        setCandidateLoading(false);
      }
      return;
    }
    let cancelled = false;
    setCandidateLoading(true);
    setCandidateError("");
    void (async () => {
      try {
        const [candidate, downloaded] = await Promise.all([
          fileRepository.getCandidate(project.id, candidateId),
          fileRepository.downloadCandidate(project.id, candidateId)
        ]);
        if (cancelled) return;
        setActiveCandidate(candidate);
        setCandidateSource(decodeSourceBytes(downloaded.bytes));
      } catch (error: unknown) {
        if (!cancelled) {
          setActiveCandidate(null);
          setCandidateSource("");
          setCandidateError(error instanceof Error ? error.message : "候选加载失败。");
        }
      } finally {
        if (!cancelled) setCandidateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId, canvasMode, fileRepository, project.id]);

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
    if (membersLoading || !selectedConfigSet || !selectedMember) return;
    if (queryValue(search, "file") !== selectedMember.fileId) {
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: selectedConfigSet.id,
          file: selectedMember.fileId,
          node: null,
          property: null
        })
      );
    }
  }, [membersLoading, onNavigate, project.id, search, selectedConfigSet, selectedMember]);

  useEffect(() => {
    if (!selectedMember?.currentVersionId) {
      setSource("");
      setSourceError("");
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    setSourceError("");
    void fileRepository
      .downloadVersion(project.id, selectedMember.fileId, selectedMember.currentVersionId)
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
  }, [fileRepository, project.id, selectedMember, sourceRetry]);

  useEffect(() => {
    if (!selectedMember?.currentVersionId) {
      setStructureNodes([]);
      setStructureError("");
      setStructureLoading(false);
      return;
    }
    let cancelled = false;
    setStructureLoading(true);
    setStructureError("");
    void dtsRepository
      .getStructure(project.id, selectedMember.fileId, selectedMember.currentVersionId)
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
  }, [dtsRepository, project.id, selectedMember, structureRetry]);

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
    setFocusLineOverride(null);
  }, [selectedNodePath, selectedPropertyName, selectedMember?.fileId]);

  const nestedNodes = useMemo(() => buildNestedTree(structureNodes), [structureNodes]);

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
      setInspectorOpen(true);
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
      setInspectorOpen(true);
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
        const line = Number(lineJumpDraft || window.prompt("跳转到行号") || "");
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
  }, [lineJumpDraft]);

  const memberIds = useMemo(
    () => new Set(selectedMembers.map((item) => item.fileId)),
    [selectedMembers]
  );
  const ungroupedFiles = projectFiles.filter((item) => !memberIds.has(item.id));
  const releasedBaseline = useMemo(() => {
    const released = baselines.filter((item) => item.status === "released");
    if (released.length === 0) return null;
    return [...released].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  }, [baselines]);

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

  const createConfigSet = useCallback(async () => {
    if (!canAdmin) return;
    const name = newConfigSetName.trim();
    if (!name) {
      setConfigSetNameError("请先填写配置集名称。");
      return;
    }
    if (configSets.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setConfigSetNameError(`已存在名为「${name}」的配置集。`);
      return;
    }
    setConfigSetNameError("");
    setOpsError("");
    try {
      const created = await dtsRepository.createConfigSet(project.id, { name });
      setConfigSets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNewConfigSetName("");
      setMembers([]);
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(project.id, search, {
          configSet: created.id,
          file: null,
          node: null,
          property: null,
          sourceMode: null,
          version: null,
          candidate: null
        })
      );
      setOpsMessage(`已创建配置集「${created.name}」。`);
    } catch (error: unknown) {
      setOpsError(error instanceof Error ? error.message : "创建配置集失败。");
    }
  }, [canAdmin, configSets, dtsRepository, newConfigSetName, onNavigate, project.id, search]);

  const addMemberToConfigSet = useCallback(
    async (fileId: string, role: ConfigSetRole, sortOrder: number) => {
      if (!canAdmin || !selectedConfigSet) return;
      setOpsError("");
      try {
        const membership = await dtsRepository.addConfigSetFile(project.id, selectedConfigSet.id, {
          fileId,
          role,
          sortOrder
        });
        const file = projectFiles.find((item) => item.id === fileId);
        setMembers((current) => [
          ...current.filter((item) => item.fileId !== membership.fileId),
          {
            ...membership,
            fileName: file?.fileName ?? membership.fileId,
            format: file?.format ?? "dts",
            currentVersionId: file?.currentVersionId,
            currentVersionNumber: file?.currentVersionNumber
          }
        ]);
        setOpsMessage(`已将「${file?.fileName ?? fileId}」编入配置集（${ROLE_LABELS[role]} · 顺序 ${sortOrder}）。`);
        setInspectorLevelOverride("config-set");
        setInspectorOpen(true);
        setMembersRetry((value) => value + 1);
      } catch (error: unknown) {
        setOpsError(error instanceof Error ? error.message : "添加成员失败。");
      }
    },
    [canAdmin, dtsRepository, project.id, projectFiles, selectedConfigSet]
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
      setOpsError("");
      try {
        await dtsRepository.removeConfigSetFile(project.id, selectedConfigSet.id, fileId);
        setMembers((current) => current.filter((item) => item.fileId !== fileId));
        setOpsMessage("已从配置集移除成员文件。");
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
      } catch (error: unknown) {
        setOpsError(error instanceof Error ? error.message : "移除成员失败。");
      }
    },
    [canAdmin, dtsRepository, onNavigate, project.id, search, selectedConfigSet, selectedMember?.fileId]
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
    setOpsError("");
    try {
      const summary = await fileRepository.syncFile(project.id, selectedMember.fileId);
      const evidence = `${selectedMember.fileName}：${formatSyncSummary(summary)}`;
      setSyncEvidence(evidence);
      setOpsMessage(evidence);
      setTasksOpen(true);
      const [files, conflicts] = await Promise.all([
        fileRepository.listFiles(project.id),
        fileRepository.listConflicts(project.id)
      ]);
      setProjectFiles(files);
      setSyncConflicts(conflicts.filter((item) => item.status === "open"));
      setMembersRetry((value) => value + 1);
      setFilesRetry((value) => value + 1);
    } catch (error: unknown) {
      setOpsError(error instanceof Error ? error.message : "手动同步失败。");
    }
  }, [canAdmin, fileRepository, project.id, selectedMember]);

  const exportSelectedConfigSet = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet) return;
    setOpsError("");
    try {
      const result = await dtsRepository.exportConfigSet(project.id, selectedConfigSet.id);
      downloadExportBundle(selectedConfigSet.name, result);
      const memberCount = result.manifest.members.length;
      const validation = result.manifest.validation
        ? `校验 ${result.manifest.validation.ok ? "通过" : "未通过"}（${result.manifest.validation.mode}）`
        : "无校验元数据";
      const evidence = `已导出配置集「${selectedConfigSet.name}」：${memberCount} 个成员，含角色/顺序；${validation}。`;
      setExportEvidence(evidence);
      setOpsMessage(evidence);
      setTasksOpen(true);
    } catch (error: unknown) {
      setOpsError(error instanceof Error ? error.message : "导出配置集失败。");
    }
  }, [canAdmin, dtsRepository, project.id, selectedConfigSet]);

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
      setInspectorOpen(true);
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

  const handleInspectorBack = useCallback(() => {
    if (!selectedConfigSet) return;
    const target = inspectorBackTarget(inspectorLevel);
    setActivityMissingNotice("");
    if (inspectorLevel === "activity") {
      setInspectorLevelOverride(derivedInspectorLevel === "config-set" ? null : derivedInspectorLevel);
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
          inspector: null
        })
      );
      return;
    }
    setInspectorLevelOverride(target.level);
    setInspectorOpen(true);
    const nextNode = target.clearNode ? null : selectedNodePath;
    const nextProperty = target.clearProperty ? null : selectedPropertyName;
    if (target.clearNode) setSelectedNodePath(null);
    if (target.clearProperty) setSelectedPropertyName(null);
    onNavigate(
      formatWorkbenchPath(project.id, search, {
        configSet: selectedConfigSet.id,
        file: selectedMember?.fileId ?? queryValue(search, "file"),
        node: nextNode,
        property: nextProperty,
        sourceMode: canvasModeQueryValue(canvasMode),
        version: historyVersionId
      })
    );
  }, [
    canvasMode,
    candidateId,
    derivedInspectorLevel,
    historyVersionId,
    inspectorLevel,
    onNavigate,
    project.id,
    search,
    selectedConfigSet,
    selectedMember?.fileId,
    selectedNodePath,
    selectedPropertyName
  ]);

  const refreshActivityTimeline = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const [response, candidates] = await Promise.all([
        listProjectActivity({
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
  }, [fileRepository, listProjectActivity, project.id]);

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
        setActivityMissingNotice(
          resolved.missing
            ? resolved.missingReason ?? "发布基线已不存在；事件仍可作为只读证据。"
            : "已定位到发布基线身份；基线对比入口尚未接入，事件仍可作为只读证据。"
        );
        return;
      }

      if (resolved.kind === "conflict") {
        setActivityMissingNotice(
          "已定位到冲突证据；冲突裁决面板尚未接入本工作台（#236），事件仍可读。"
        );
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
      knownCandidateIds,
      configSets,
      onNavigate,
      project.id,
      projectFiles,
      search,
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

  const selectedStructureNode = useMemo(
    () => structureNodes.find((item) => item.nodePath === selectedNodePath) ?? null,
    [selectedNodePath, structureNodes]
  );
  const selectedStructureProperty = useMemo(() => {
    if (!selectedStructureNode || !selectedPropertyName) return null;
    return selectedStructureNode.properties.find((item) => item.name === selectedPropertyName) ?? null;
  }, [selectedPropertyName, selectedStructureNode]);

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
      <header className="configuration-workbench__command" aria-label="配置命令栏">
        <button
          type="button"
          className="button subtle configuration-workbench__back"
          onClick={() => onNavigate("/parameter-admin/projects")}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          项目清单
        </button>
        <div className="configuration-workbench__project">
          <strong>{project.name}</strong>
          <span className="mono">{project.code}</span>
          <span>{project.statusLabel}</span>
        </div>
        <label className="configuration-workbench__config-select">
          <span>配置集</span>
          <select
            aria-label="配置集"
            value={selectedConfigSet?.id ?? ""}
            disabled={configSetsLoading || Boolean(configSetsError) || configSets.length === 0}
            onChange={(event) => selectConfigSet(event.target.value)}
          >
            {configSets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {canAdmin ? (
          <div className="configuration-workbench__create-config" aria-label="创建配置集">
            <label>
              配置集名称
              <input
                type="text"
                value={newConfigSetName}
                aria-invalid={configSetNameError ? "true" : "false"}
                aria-describedby={configSetNameError ? "workbench-config-set-name-error" : undefined}
                onChange={(event) => {
                  setNewConfigSetName(event.target.value);
                  setConfigSetNameError("");
                }}
                placeholder="board-a"
              />
            </label>
            <button
              className="button subtle"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction("create-config-set", createConfigSet)}
            >
              {pendingAction === "create-config-set" ? "创建中…" : "创建配置集"}
            </button>
          </div>
        ) : null}
        <div className="configuration-workbench__identities" aria-label="配置身份">
          <span className="configuration-workbench__working">工作配置</span>
          <span className="configuration-workbench__identity-chip" data-identity="file-version">
            文件版本：
            {selectedMember?.currentVersionNumber
              ? `v${selectedMember.currentVersionNumber}`
              : selectedMember?.currentVersionId ?? "无"}
          </span>
          <span className="configuration-workbench__identity-chip" data-identity="candidate">
            候选文件版本：
            {activeCandidate && activeCandidate.status !== "abandoned"
              ? `${activeCandidate.fileName} · ${activeCandidate.status}`
              : "尚未上传"}
          </span>
          <span className="configuration-workbench__identity-chip" data-identity="release-baseline">
            发布基线：{baselinesLoading ? "加载中…" : baselinesError ? "不可用" : releasedBaseline?.name ?? "尚未发布"}
          </span>
          {baselinesError ? (
            <button className="button subtle configuration-workbench__baseline-retry" type="button" onClick={() => setBaselinesRetry((value) => value + 1)}>
              重试发布基线
            </button>
          ) : null}
        </div>
        <div className="configuration-workbench__unavailable-actions" aria-label="后续阶段操作">
          {!narrowViewport ? (
            <>
              <button
                className="button subtle configuration-workbench__activity-toggle"
                type="button"
                aria-label="活动"
                aria-pressed={inspectorOpen && inspectorLevel === "activity"}
                onClick={openActivityInspector}
              >
                <Activity size={16} aria-hidden="true" />
                活动
              </button>
              <button
                className="button subtle configuration-workbench__inspector-toggle"
                type="button"
                aria-label="检查器"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((open) => !open)}
              >
                <PanelRight size={16} aria-hidden="true" />
                检查器
              </button>
            </>
          ) : null}
          <input
            ref={candidateFileInputRef}
            type="file"
            accept=".dts,.dtsi,.json,text/plain,application/json"
            hidden
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || !selectedConfigSet) return;
              setUploadingCandidate(true);
              setCandidateError("");
              void (async () => {
                try {
                  const contentBase64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(reader.error ?? new Error("Failed to read candidate file."));
                    reader.onload = () => {
                      const result = String(reader.result ?? "");
                      const marker = "base64,";
                      const index = result.indexOf(marker);
                      resolve(index >= 0 ? result.slice(index + marker.length) : result);
                    };
                    reader.readAsDataURL(file);
                  });
                  const candidate = await fileRepository.createCandidate(project.id, {
                    fileName: file.name,
                    contentBase64,
                    fileId: selectedMember?.fileId
                  });
                  setActiveCandidate(candidate);
                  setInspectorOpen(true);
                  onNavigate(
                    formatWorkbenchPath(project.id, search, {
                      configSet: selectedConfigSet.id,
                      file: selectedMember?.fileId ?? null,
                      sourceMode: "candidate",
                      candidate: candidate.id,
                      version: null,
                      node: null,
                      property: null
                    })
                  );
                  notifyMutation(
                    candidate.status === "failed"
                      ? "候选解析失败，活跃源码未改动；可查看诊断后放弃。"
                      : "候选已创建，工作配置与活跃版本未改动。"
                  );
                } catch (error: unknown) {
                  setCandidateError(error instanceof Error ? error.message : "候选上传失败。");
                } finally {
                  setUploadingCandidate(false);
                }
              })();
            }}
          />
          <button
            className="button subtle"
            type="button"
            disabled={uploadingCandidate || !selectedConfigSet || !canAdmin}
            title="上传创建候选文件版本，不会激活工作配置"
            onClick={() => candidateFileInputRef.current?.click()}
          >
            {uploadingCandidate ? "上传中…" : "上传候选"}
          </button>
          {canAdmin && selectedConfigSet ? (
            <button
              className="button subtle"
              type="button"
              disabled={pendingAction !== null}
              onClick={() => void runAction("export-config-set", exportSelectedConfigSet)}
            >
              {pendingAction === "export-config-set" ? "导出中…" : "导出配置集"}
            </button>
          ) : null}
          <button className="button subtle" type="button" disabled title="发布就绪度尚未接入，不能创建基线">
            创建基线
          </button>
        </div>
      </header>

      {configSetNameError ? (
        <p className="field-error configuration-workbench__ops-banner" id="workbench-config-set-name-error" role="alert">
          {configSetNameError}
        </p>
      ) : null}
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
                在命令栏填写名称即可创建配置集。上传文件或候选不会自动激活工作配置；创建后需明确把文件编入成员。
              </p>
              <p className="configuration-workbench__empty-hint">上传不会自动激活工作配置。</p>
            </>
          ) : (
            <>
              <p>当前账号无法创建配置集。只读上下文仍可查看；请联系管理员完成初始化。</p>
              <button className="button subtle" type="button" onClick={() => onNavigate(`/parameter-admin/projects/${encodeURIComponent(project.id)}/config-sets`)}>
                打开旧配置集管理
              </button>
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
                <label>
                  <span>搜索</span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="文件名 / 路径 / 属性…"
                    aria-label="统一搜索查询"
                  />
                </label>
                <button className="button subtle" type="submit" disabled={searchLoading}>
                  <Search size={14} aria-hidden="true" />
                  {searchLoading ? "搜索中…" : "搜索"}
                </button>
                <button
                  className="button subtle"
                  type="button"
                  aria-label="下一个匹配"
                  onClick={() => setFindNextToken((value) => value + 1)}
                >
                  下一个
                </button>
                <label>
                  <span>行</span>
                  <input
                    type="number"
                    min={1}
                    value={lineJumpDraft}
                    onChange={(event) => setLineJumpDraft(event.target.value)}
                    aria-label="跳转到行号"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const line = Number(lineJumpDraft);
                        if (Number.isFinite(line) && line >= 1) setFocusLineOverride(line);
                      }
                    }}
                  />
                </label>
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
                          <strong>{item.fileName}</strong>
                          <small>{roleLabel} · {versionLabel}</small>
                          <small className="mono">{item.currentVersionId ?? "版本身份缺失"}</small>
                        </span>
                      </button>
                      {selected ? (
                        <div className="configuration-workbench__node-tree" role="group" aria-label={`${item.fileName} 节点树`}>
                          {structureLoading ? <p role="status">正在加载结构树…</p> : null}
                          {structureError ? (
                            <div role="alert" className="configuration-workbench__scoped-error">
                              <p>{structureError}</p>
                              <button className="button subtle" type="button" onClick={() => setStructureRetry((value) => value + 1)}>
                                重试结构树
                              </button>
                            </div>
                          ) : null}
                          {!structureLoading && !structureError
                            ? nestedNodes.map((node) => {
                                const nodeSelected = selectedNodePath === node.nodePath && !selectedPropertyName;
                                return (
                                  <div key={node.nodePath} className="configuration-workbench__node-block">
                                    <button
                                      type="button"
                                      role="treeitem"
                                      aria-selected={nodeSelected}
                                      aria-label={`节点 ${node.nodePath || "/"}`}
                                      className={`button subtle configuration-workbench__node${nodeSelected ? " is-selected" : ""}`}
                                      style={{ paddingInlineStart: `${12 + Math.max(node.depth, 0) * 12}px` }}
                                      onClick={() => selectStructureTarget(item.fileId, node.nodePath, null)}
                                    >
                                      <code>{node.nodePath || "/"}</code>
                                    </button>
                                    {selectedNodePath === node.nodePath
                                      ? node.properties.map((property) => {
                                          const propertySelected = selectedPropertyName === property.name;
                                          return (
                                            <button
                                              key={`${node.nodePath}/${property.name}`}
                                              type="button"
                                              role="treeitem"
                                              aria-selected={propertySelected}
                                              aria-label={`属性 ${node.nodePath}/${property.name}`}
                                              className={`button subtle configuration-workbench__property${propertySelected ? " is-selected" : ""}`}
                                              style={{ paddingInlineStart: `${24 + Math.max(node.depth, 0) * 12}px` }}
                                              onClick={() => selectStructureTarget(item.fileId, node.nodePath, property.name)}
                                            >
                                              <code>{property.name}</code>
                                            </button>
                                          );
                                        })
                                      : null}
                                  </div>
                                );
                              })
                            : null}
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
            <aside
              className={
                inspectorPersistent && !narrowViewport
                  ? "configuration-workbench__inspector is-persistent"
                  : "configuration-workbench__inspector"
              }
              aria-label="配置检查器"
              data-layout={inspectorPersistent && !narrowViewport ? "persistent" : "overlay"}
            >
              <div className="configuration-workbench__region-head">
                <div>
                  <span>检查器</span>
                  <strong>
                    {inspectorLevel === "activity"
                      ? "项目活动"
                      : inspectorLevel === "property"
                        ? selectedPropertyName
                        : inspectorLevel === "node"
                          ? selectedNodePath
                          : inspectorLevel === "file"
                            ? selectedMember?.fileName
                            : selectedConfigSet.name}
                  </strong>
                </div>
                <div className="configuration-workbench__inspector-actions">
                  {inspectorLevel !== "config-set" ? (
                    <button
                      className="button subtle"
                      type="button"
                      aria-label="检查器返回"
                      onClick={handleInspectorBack}
                    >
                      返回
                    </button>
                  ) : null}
                  <button
                    className="button subtle configuration-workbench__icon-button"
                    type="button"
                    aria-label="关闭检查器"
                    onClick={() => setInspectorOpen(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <dl>
                <div>
                  <dt>检查层级</dt>
                  <dd>
                    {inspectorLevel === "config-set"
                      ? "配置集"
                      : inspectorLevel === "file"
                        ? "文件"
                        : inspectorLevel === "node"
                          ? "节点"
                          : inspectorLevel === "activity"
                            ? "活动"
                            : "属性"}
                  </dd>
                </div>
                <div>
                  <dt>工作配置</dt>
                  <dd>工作配置</dd>
                </div>
                <div>
                  <dt>发布基线</dt>
                  <dd>{releasedBaseline?.name ?? "尚未发布"}</dd>
                </div>
                <div>
                  <dt>候选文件版本</dt>
                  <dd>
                    {activeCandidate && activeCandidate.status !== "abandoned"
                      ? `${activeCandidate.fileName} · ${activeCandidate.status}`
                      : "尚未上传"}
                  </dd>
                </div>
                {activeCandidate && canvasMode === "candidate" ? (
                  <>
                    <div>
                      <dt>候选身份</dt>
                      <dd className="mono">{activeCandidate.id}</dd>
                    </div>
                    <div>
                      <dt>对照活跃版本</dt>
                      <dd className="mono">{activeCandidate.baseVersionId ?? "新文件候选"}</dd>
                    </div>
                    <div>
                      <dt>诊断</dt>
                      <dd>
                        {(activeCandidate.diagnostics?.length ?? 0) === 0
                          ? "无"
                          : activeCandidate.diagnostics.map((item) => (
                              <div key={`${item.code}-${item.message}`}>
                                [{item.severity}] {item.code}: {item.message}
                              </div>
                            ))}
                      </dd>
                    </div>
                    <div>
                      <dt>阻断</dt>
                      <dd>
                        {(activeCandidate.blockers?.length ?? 0) === 0
                          ? "无"
                          : activeCandidate.blockers.map((item) => (
                              <div key={`${item.code}-${item.message}`}>
                                {item.code}: {item.message}
                              </div>
                            ))}
                      </dd>
                    </div>
                    <div>
                      <dt>结构差异</dt>
                      <dd>
                        {(activeCandidate.impact.structuralDiff?.length ?? 0) === 0
                          ? "无"
                          : `${activeCandidate.impact.structuralDiff?.length} 项`}
                      </dd>
                    </div>
                    <div>
                      <dt>覆盖/映射</dt>
                      <dd>
                        {activeCandidate.impact.coverage
                          ? `已注册 ${activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 ${activeCandidate.impact.coverage.newUnregisteredCount}`
                          : "不适用"}
                      </dd>
                    </div>
                    <div>
                      <dt>冲突证据</dt>
                      <dd>
                        {(activeCandidate.impact.conflicts?.length ?? 0) === 0
                          ? "无开放冲突"
                          : activeCandidate.impact.conflicts?.map((item) => (
                              <div key={item.id} className="mono">
                                {item.id}
                                {item.parameterName ? ` · ${item.parameterName}` : ""}
                              </div>
                            ))}
                      </dd>
                    </div>
                    {activeCandidate.impact.textDiff ? (
                      <div>
                        <dt>文本差异</dt>
                        <dd>
                          <pre className="configuration-workbench__diff-view mono" tabIndex={0}>
                            {activeCandidate.impact.textDiff}
                          </pre>
                        </dd>
                      </div>
                    ) : null}
                    <div className="configuration-workbench__inspector-actions">
                      {activeCandidate.status === "blocked" || activeCandidate.status === "stale" ? (
                        <button
                          className="button subtle"
                          type="button"
                          onClick={() => {
                            void (async () => {
                              try {
                                const updated = await fileRepository.recomputeCandidate(
                                  project.id,
                                  activeCandidate.id
                                );
                                setActiveCandidate(updated);
                                notifyMutation(
                                  updated.status === "ready"
                                    ? "已按当前基重算候选影响，可再次审查后激活。"
                                    : "已按当前阻断条件重算候选影响。"
                                );
                              } catch (error: unknown) {
                                setCandidateError(
                                  error instanceof Error ? error.message : "候选重算失败。"
                                );
                              }
                            })();
                          }}
                        >
                          重算影响
                        </button>
                      ) : null}
                      {activeCandidate.status === "ready" ? (
                        <button
                          className="button primary"
                          type="button"
                          data-testid="activate-candidate"
                          onClick={() => {
                            setActivateError("");
                            setActivateRole("overlay");
                            setActivateConfirmOpen(true);
                          }}
                        >
                          激活候选
                        </button>
                      ) : null}
                      {["ready", "blocked", "failed", "stale"].includes(activeCandidate.status) ? (
                        <button
                          className="button subtle"
                          type="button"
                          onClick={() => {
                            void (async () => {
                              try {
                                const abandoned = await fileRepository.abandonCandidate(
                                  project.id,
                                  activeCandidate.id
                                );
                                setActiveCandidate(abandoned);
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
                              } catch (error: unknown) {
                                setCandidateError(
                                  error instanceof Error ? error.message : "放弃候选失败。"
                                );
                              }
                            })();
                          }}
                        >
                          放弃候选
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {inspectorLevel === "activity" ? (
                  <>
                    <div>
                      <dt>活动时间线</dt>
                      <dd>当前组织与项目范围内的服务器审计投影</dd>
                    </div>
                    {activityMissingNotice ? (
                      <div>
                        <dt>目标状态</dt>
                        <dd>
                          <p role="status" aria-label="活动目标不可用">
                            {activityMissingNotice}
                          </p>
                        </dd>
                      </div>
                    ) : null}
                    {activityLoading ? (
                      <div>
                        <dt>加载</dt>
                        <dd role="status">正在加载项目活动…</dd>
                      </div>
                    ) : null}
                    {activityError ? (
                      <div>
                        <dt>失败</dt>
                        <dd>
                          <p role="alert">{activityError}</p>
                          <button
                            className="button subtle"
                            type="button"
                            onClick={() => setActivityRefreshToken((value) => value + 1)}
                          >
                            重试活动
                          </button>
                        </dd>
                      </div>
                    ) : null}
                    {!activityLoading && !activityError && activityRows.length === 0 ? (
                      <div>
                        <dt>空态</dt>
                        <dd role="status">暂无项目活动记录</dd>
                      </div>
                    ) : null}
                    {!activityLoading && activityRows.length > 0 ? (
                      <div>
                        <dt>事件</dt>
                        <dd>
                          <ul className="configuration-workbench__activity-list" aria-label="项目活动事件">
                            {activityRows.map((row) => (
                              <li key={row.id}>
                                <button
                                  type="button"
                                  className="button subtle configuration-workbench__activity-item"
                                  aria-label={`${row.action} · ${row.targetLabel}`}
                                  onClick={() => handleActivityEventSelect(row.id)}
                                >
                                  <span className="configuration-workbench__activity-action">
                                    {row.action}
                                  </span>
                                  <span className="configuration-workbench__activity-meta">
                                    {row.actor} · {row.targetLabel} · {row.outcome} · {row.timeLabel}
                                  </span>
                                  <time dateTime={row.createdAtIso || undefined}>{row.absoluteTime}</time>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {inspectorLevel === "config-set" ? (
                  <>
                    <div>
                      <dt>配置集</dt>
                      <dd>{selectedConfigSet.name}</dd>
                    </div>
                    <div>
                      <dt>描述</dt>
                      <dd>{selectedConfigSet.description || "无描述"}</dd>
                    </div>
                    <div>
                      <dt>成员数</dt>
                      <dd>{selectedMembers.length}</dd>
                    </div>
                    <section className="configuration-workbench__member-ops" aria-label="成员管理">
                      <strong>成员管理</strong>
                      {selectedMembers.length === 0 ? (
                        <p>尚无成员。从下方未编组文件编入，或使用表单添加。</p>
                      ) : (
                        <ul>
                          {selectedMembers.map((member) => (
                            <li key={member.fileId}>
                              <span>
                                {member.fileName} · {ROLE_LABELS[member.role]} · 顺序 {member.sortOrder}
                              </span>
                              {canAdmin ? (
                                <button
                                  className="button subtle"
                                  type="button"
                                  aria-label={`移除 ${member.fileName}`}
                                  disabled={pendingAction !== null}
                                  onClick={() => requestRemoveMember(member)}
                                >
                                  移除
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canAdmin ? (
                        <div className="configuration-workbench__member-form">
                          <label>
                            文件
                            <select
                              aria-label="待编入文件"
                              value={memberFileId}
                              onChange={(event) => setMemberFileId(event.target.value)}
                            >
                              {ungroupedFiles.length === 0 ? (
                                <option value="">无未编组文件</option>
                              ) : (
                                ungroupedFiles.map((file) => (
                                  <option key={file.id} value={file.id}>
                                    {file.fileName}
                                  </option>
                                ))
                              )}
                            </select>
                          </label>
                          <label>
                            角色
                            <select
                              aria-label="成员角色"
                              value={memberRole}
                              onChange={(event) => setMemberRole(event.target.value as ConfigSetRole)}
                            >
                              {CONFIG_SET_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            顺序
                            <input
                              type="number"
                              aria-label="成员顺序"
                              value={memberSortOrder}
                              onChange={(event) => setMemberSortOrder(Number(event.target.value) || 0)}
                            />
                          </label>
                          <button
                            className="button subtle"
                            type="button"
                            disabled={!memberFileId || pendingAction !== null}
                            onClick={() =>
                              void runAction("add-member", () =>
                                addMemberToConfigSet(memberFileId, memberRole, memberSortOrder)
                              )
                            }
                          >
                            添加成员
                          </button>
                        </div>
                      ) : null}
                    </section>
                  </>
                ) : null}
                {inspectorLevel === "file" && selectedMember ? (
                  <>
                    <div>
                      <dt>文件格式</dt>
                      <dd>{selectedMember.format}</dd>
                    </div>
                    <div>
                      <dt>成员角色</dt>
                      <dd>{ROLE_LABELS[selectedMember.role]}</dd>
                    </div>
                    <div>
                      <dt>活跃文件版本</dt>
                      <dd className="mono">{selectedMember.currentVersionId ?? "缺失"}</dd>
                    </div>
                    {canAdmin ? (
                      <div className="configuration-workbench__inspector-actions">
                        <button
                          className="button subtle"
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => void runAction("sync-file", syncSelectedFile)}
                        >
                          {pendingAction === "sync-file" ? "同步中…" : "手动同步"}
                        </button>
                        <button
                          className="button subtle"
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => requestRemoveMember(selectedMember)}
                        >
                          从配置集移除
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {inspectorLevel === "node" && selectedStructureNode ? (
                  <>
                    <div>
                      <dt>节点路径</dt>
                      <dd>
                        <code>{selectedStructureNode.nodePath || "/"}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>源码位置</dt>
                      <dd>{formatSourceSpan(selectedStructureNode.source)}</dd>
                    </div>
                    <div>
                      <dt>labels</dt>
                      <dd>
                        {selectedStructureNode.labels.length
                          ? selectedStructureNode.labels.join(", ")
                          : "无"}
                      </dd>
                    </div>
                    <div>
                      <dt>compatible</dt>
                      <dd>{selectedStructureNode.compatible ?? "无"}</dd>
                    </div>
                    <div>
                      <dt>风险</dt>
                      <dd>{classifyNodeRisk(selectedStructureNode.status)}</dd>
                    </div>
                    <div>
                      <dt>来源</dt>
                      <dd>
                        工作配置 · 文件版本 {selectedMember?.currentVersionId ?? "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>读权限</dt>
                      <dd>只读</dd>
                    </div>
                  </>
                ) : null}
                {inspectorLevel === "property" && selectedStructureProperty && selectedStructureNode ? (
                  <>
                    <div>
                      <dt>属性名</dt>
                      <dd>{selectedStructureProperty.name}</dd>
                    </div>
                    <div>
                      <dt>节点路径</dt>
                      <dd>
                        <code>{selectedStructureNode.nodePath}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>源码位置</dt>
                      <dd>
                        {formatSourceSpan(
                          selectedStructureProperty.source ?? selectedStructureNode.source
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>类型</dt>
                      <dd>{selectedStructureProperty.valueType}</dd>
                    </div>
                    <div>
                      <dt>原始值</dt>
                      <dd>
                        <code>{selectedStructureProperty.rawText}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>规范化值</dt>
                      <dd>{selectedStructureProperty.normalizedValue}</dd>
                    </div>
                    <div>
                      <dt>风险</dt>
                      <dd>{classifyNodeRisk(selectedStructureNode.status)}</dd>
                    </div>
                    <div>
                      <dt>来源</dt>
                      <dd>
                        工作配置 · 文件版本 {selectedMember?.currentVersionId ?? "未知"}
                      </dd>
                    </div>
                    <div>
                      <dt>读权限</dt>
                      <dd>只读</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {inspectorLevel === "file" && selectedMember ? (
                <section className="configuration-workbench__version-history" aria-label="不可变版本历史">
                  <strong>不可变版本历史</strong>
                  {versionsLoading ? <p role="status">正在加载版本历史…</p> : null}
                  {versionsError ? (
                    <div role="alert">
                      <p>{versionsError}</p>
                    </div>
                  ) : null}
                  {!versionsLoading && !versionsError && fileVersions.length === 0 ? (
                    <p>暂无版本记录。</p>
                  ) : null}
                  <ul>
                    {fileVersions.map((version) => {
                      const active = version.id === selectedMember.currentVersionId;
                      return (
                        <li key={version.id}>
                          <div>
                            <strong>
                              版本 {version.versionNumber}
                              {active ? " · 活跃" : ""}
                            </strong>
                            <small className="mono">{version.id}</small>
                            <span>来源：{ORIGIN_LABELS[version.origin]}</span>
                            <span>创建时间：{version.createdAt}</span>
                            <span>操作人：{version.createdByUserId ?? "未记录"}</span>
                          </div>
                          <div className="configuration-workbench__version-actions">
                            <button
                              className="button subtle"
                              type="button"
                              aria-label={`查看版本 ${version.versionNumber} 历史源码`}
                              onClick={() => enterCanvasMode("history", version.id)}
                            >
                              查看历史
                            </button>
                            <button
                              className="button subtle"
                              type="button"
                              aria-label={`统一差异版本 ${version.versionNumber}`}
                              onClick={() => enterCanvasMode("unified-diff", version.id)}
                            >
                              统一差异
                            </button>
                            <button
                              className="button subtle"
                              type="button"
                              aria-label={`下载版本 ${version.versionNumber}`}
                              onClick={() => void handleDownloadVersion(version)}
                            >
                              下载
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {downloadMessage ? <p role="status">{downloadMessage}</p> : null}
                </section>
              ) : null}
              <p className="configuration-workbench__read-only-note">
                画布模式：{canvasMode}。候选激活需确认影响范围；本阶段同时支持配置集创建/成员管理、手动同步与导出；结构化编辑与发布动作将在后续阶段接入。
              </p>
            </aside>
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
                onChange={(event) => setActivateRole(event.target.value as ConfigSetRole)}
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
            setActivateError("");
          }
        }}
        onConfirm={() => {
          if (!activeCandidate || activeCandidate.status !== "ready") return;
          void (async () => {
            setActivatingCandidate(true);
            setActivateError("");
            setCandidateError("");
            try {
              if (!activeCandidate.fileId && !selectedConfigSet) {
                throw new Error("激活新文件需要已选择的配置集。");
              }
              const result = await fileRepository.activateCandidate(project.id, activeCandidate.id, {
                expectedCurrentVersionId: activeCandidate.baseVersionId ?? null,
                configSetId: activeCandidate.fileId ? undefined : selectedConfigSet?.id,
                role: activeCandidate.fileId ? undefined : activateRole
              });
              setActiveCandidate(result.item);
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
              setActivateError(message);
              setCandidateError(message);
              if (/stale/i.test(message)) {
                try {
                  const refreshed = await fileRepository.getCandidate(project.id, activeCandidate.id);
                  setActiveCandidate(refreshed);
                  setActivateConfirmOpen(false);
                  notifyMutation("基版本已变更，候选已标为过期；请重算影响后再激活。");
                } catch {
                  // keep prior candidate state
                }
              }
            } finally {
              setActivatingCandidate(false);
            }
          })();
        }}
      />

      <footer className={tasksOpen ? "configuration-workbench__tasks is-open" : "configuration-workbench__tasks"}>
        <button className="button subtle configuration-workbench__task-toggle" type="button" aria-label="任务" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)}>
          <span>本轮更改 <strong>{syncEvidence || exportEvidence ? 1 : 0}</strong></span>
          <span>校验问题 <strong>0</strong></span>
          <span>冲突 <strong>{syncConflicts.length}</strong></span>
          <span>{tasksOpen ? "收起" : "展开任务"}</span>
        </button>
        {tasksOpen ? (
          <div role="region" aria-label="配置任务" className="configuration-workbench__task-panel">
            <strong>任务证据</strong>
            {syncEvidence ? <p role="status">{syncEvidence}</p> : null}
            {exportEvidence ? <p role="status">{exportEvidence}</p> : null}
            {syncConflicts.length > 0 ? (
              <p role="status">冲突 {syncConflicts.length}：同步后已刷新冲突列表，可在旧冲突视图继续仲裁。</p>
            ) : null}
            {!syncEvidence && !exportEvidence && syncConflicts.length === 0 ? (
              <p>暂无同步或导出证据。手动同步与配置集导出结果会显示在这里。</p>
            ) : null}
          </div>
        ) : null}
      </footer>

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
