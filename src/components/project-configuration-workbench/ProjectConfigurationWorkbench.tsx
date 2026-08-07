import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileCode2, FolderTree, Info, PanelRight, Rows3, Search } from "lucide-react";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsReleaseBaseline,
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
import {
  ProjectPrimaryDtsViewer,
  type DtsViewerFocusSpan
} from "@/components/parameter-topology/ProjectPrimaryDtsViewer";
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
};

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

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
  fileRepository
}: ProjectConfigurationWorkbenchProps) {
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
  const historyVersionId = queryValue(search, "version");

  const derivedInspectorLevel = resolveInspectorLevel({
    fileSelected: Boolean(selectedMember),
    nodePath: selectedNodePath,
    propertyName: selectedPropertyName
  });
  const inspectorLevel: InspectorLevel =
    inspectorLevelOverride &&
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
          version: versionId
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
        version: null
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
        <div className="configuration-workbench__identities" aria-label="配置身份">
          <span className="configuration-workbench__working">工作配置</span>
          <span className="configuration-workbench__identity-chip" data-identity="file-version">
            文件版本：
            {selectedMember?.currentVersionNumber
              ? `v${selectedMember.currentVersionNumber}`
              : selectedMember?.currentVersionId ?? "无"}
          </span>
          <span className="configuration-workbench__identity-chip" data-identity="candidate">
            候选文件版本：尚未上传
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
          ) : null}
          <button className="button subtle" type="button" disabled title="候选上传将在后续阶段提供">
            上传候选
          </button>
          <button className="button subtle" type="button" disabled title="发布就绪度尚未接入，不能创建基线">
            创建基线
          </button>
        </div>
      </header>

      {narrowViewport ? (
        <nav className="configuration-workbench__mobile-tools" aria-label="工作台区域">
          <button className="button subtle configuration-workbench__mobile-tool" type="button" aria-label="源结构" aria-expanded={treeOpen} onClick={() => setTreeOpen((open) => !open)}>
            <FolderTree size={16} aria-hidden="true" />
            源结构
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
          <p>请先回到旧项目运营入口完成项目配置初始化。上传文件不会在本阶段自动建立工作配置。</p>
          <button className="button subtle" type="button" onClick={() => onNavigate(`/parameter-admin/projects/${encodeURIComponent(project.id)}/config-sets`)}>
            打开旧配置集管理
          </button>
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
                  <p>候选上传与明确激活将在后续阶段提供；本阶段不会改变工作配置。</p>
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
                    <small>不参与当前工作配置</small>
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
                        : "只读对比"}
                  </span>
                  <h2>{selectedMember.fileName}</h2>
                </div>
                <div className="configuration-workbench__version-identity">
                  <span>{canvasMode === "working" ? "活跃文件版本" : "对照文件版本"}</span>
                  <strong className="mono">
                    {canvasMode === "working"
                      ? selectedMember.currentVersionId ?? "缺失"
                      : historyVersionId ?? "缺失"}
                  </strong>
                </div>
                {canvasMode !== "working" ? (
                  <div className="configuration-workbench__mode-actions">
                    {canvasMode !== "side-by-side" ? (
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => enterCanvasMode("side-by-side", historyVersionId)}
                      >
                        并排对比
                      </button>
                    ) : null}
                    {canvasMode !== "unified-diff" ? (
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
                      aria-label={canvasMode === "history" ? "退出历史源码" : "退出对比"}
                    >
                      {canvasMode === "history" ? "退出历史源码" : "退出对比"}
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
                  canvasMode === "history" ? "历史只读源码模式" : "只读对比模式"
                }
              >
                当前为{canvasMode === "history" ? "历史只读源码" : "只读对比"}模式，不能编辑，也不会改变工作配置。
              </p>
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
                    {inspectorLevel === "property"
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
                  <dd>尚未上传</dd>
                </div>
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
                当前检查器为只读上下文。画布模式：{canvasMode}。编辑、候选激活与发布动作将在后续阶段接入。
              </p>
            </aside>
          ) : null}
        </div>
      )}

      <footer className={tasksOpen ? "configuration-workbench__tasks is-open" : "configuration-workbench__tasks"}>
        <button className="button subtle configuration-workbench__task-toggle" type="button" aria-label="任务" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)}>
          <span>本轮更改 <strong>0</strong></span>
          <span>校验问题 <strong>0</strong></span>
          <span>冲突 <strong>0</strong></span>
          <span>{tasksOpen ? "收起" : "展开任务"}</span>
        </button>
        {tasksOpen ? (
          <div role="region" aria-label="配置任务" className="configuration-workbench__task-panel">
            <strong>本阶段为只读查看</strong>
            <p>没有本轮更改、校验问题或冲突。任务证据工作流将在后续 tracer 中接入。</p>
          </div>
        ) : null}
      </footer>
    </section>
  );
}
