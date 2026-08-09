import type {
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsSearchHit,
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import {
  defaultConfigSet,
  formatWorkbenchPath,
  queryValue
} from "./workbenchPath";

export type WorkbenchNavigationSnapshot = {
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  searchDraft: string;
  searchHits: DtsSearchHit[];
  searchError: string;
  searchLoading: boolean;
  findQuery: string;
  pendingFocusLine: number | null;
  suppressScrollSync: boolean;
};

export type WorkbenchNavigationResolveContext = {
  search: string;
  projectId: string;
  configSets: DtsConfigSet[];
  selectedMembers: DtsConfigSetMemberFile[];
  projectFiles: ProjectParameterFile[];
  membersLoading: boolean;
  membersError: string;
};

export type WorkbenchNavigationSession = WorkbenchNavigationSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkbenchNavigationSnapshot;
  setSearchDraft(value: string): void;
  consumePendingFocusLine(): number | null;
  beginSuppressScrollSync(durationMs?: number): void;
  setStructureSelection(nodePath: string | null, propertyName: string | null): void;
  applyNodePropertyFromUrl(input: {
    search: string;
    structureNodes: DtsStructuralNode[];
    structureLoading: boolean;
    structureError: string;
  }): void;
  resolveSelectedConfigSet(ctx: Pick<WorkbenchNavigationResolveContext, "search" | "configSets">): DtsConfigSet | null;
  resolveSelectedMember(
    ctx: WorkbenchNavigationResolveContext,
    selectedConfigSet: DtsConfigSet | null
  ): DtsConfigSetMemberFile | null;
  /** Returns a path when URL should write back the resolved config set. */
  applyConfigSetUrl(input: {
    projectId: string;
    search: string;
    configSetsLoading: boolean;
    selectedConfigSet: DtsConfigSet | null;
  }): string | null;
  /** Returns a path when URL should write back the resolved default file. */
  applyFileUrl(input: {
    projectId: string;
    search: string;
    membersLoading: boolean;
    filesLoading: boolean;
    selectedConfigSet: DtsConfigSet | null;
    selectedMemberFileId: string | null;
    selectedMembers: DtsConfigSetMemberFile[];
    projectFiles: ProjectParameterFile[];
  }): string | null;
  selectConfigSet(projectId: string, search: string, configSetId: string): string;
  selectMember(
    projectId: string,
    search: string,
    input: {
      configSetId: string;
      fileId: string;
      currentFileId: string | null;
      sourceMode: string | null;
      versionId: string | null;
      workingMode: boolean;
    }
  ): string;
  selectStructureTarget(
    projectId: string,
    search: string,
    input: {
      configSetId: string;
      fileId: string;
      nodePath: string | null;
      propertyName: string | null;
      sourceMode: string | null;
      versionId: string | null;
    }
  ): string;
  runSearch(
    projectId: string,
    repo: Pick<DtsStructuredRepository, "search">
  ): Promise<void>;
  selectSearchHit(
    projectId: string,
    search: string,
    input: {
      configSetId: string;
      hit: DtsSearchHit;
      sourceMode: string | null;
      versionId: string | null;
    }
  ): string;
};

function emptySnapshot(): WorkbenchNavigationSnapshot {
  return {
    selectedNodePath: null,
    selectedPropertyName: null,
    searchDraft: "",
    searchHits: [],
    searchError: "",
    searchLoading: false,
    findQuery: "",
    pendingFocusLine: null,
    suppressScrollSync: false
  };
}

export function createWorkbenchNavigationSession(): WorkbenchNavigationSession {
  const listeners = new Set<() => void>();
  let selectedNodePath: string | null = null;
  let selectedPropertyName: string | null = null;
  let searchDraft = "";
  let searchHits: DtsSearchHit[] = [];
  let searchError = "";
  let searchLoading = false;
  let findQuery = "";
  let pendingFocusLine: number | null = null;
  let suppressScrollSync = false;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshot = emptySnapshot();

  const emit = () => {
    snapshot = {
      selectedNodePath,
      selectedPropertyName,
      searchDraft,
      searchHits,
      searchError,
      searchLoading,
      findQuery,
      pendingFocusLine,
      suppressScrollSync
    };
    for (const listener of listeners) listener();
  };

  const scheduleEmit = () => {
    queueMicrotask(emit);
  };

  const api: WorkbenchNavigationSession = {
    get selectedNodePath() {
      return selectedNodePath;
    },
    get selectedPropertyName() {
      return selectedPropertyName;
    },
    get searchDraft() {
      return searchDraft;
    },
    get searchHits() {
      return searchHits;
    },
    get searchError() {
      return searchError;
    },
    get searchLoading() {
      return searchLoading;
    },
    get findQuery() {
      return findQuery;
    },
    get pendingFocusLine() {
      return pendingFocusLine;
    },
    get suppressScrollSync() {
      return suppressScrollSync;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    setSearchDraft(value) {
      searchDraft = value;
      scheduleEmit();
    },
    consumePendingFocusLine() {
      const line = pendingFocusLine;
      pendingFocusLine = null;
      scheduleEmit();
      return line;
    },
    beginSuppressScrollSync(durationMs = 250) {
      suppressScrollSync = true;
      if (suppressTimer) clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => {
        suppressScrollSync = false;
        suppressTimer = null;
        scheduleEmit();
      }, durationMs);
      scheduleEmit();
    },
    setStructureSelection(nodePath, propertyName) {
      selectedNodePath = nodePath;
      selectedPropertyName = propertyName;
      scheduleEmit();
    },
    applyNodePropertyFromUrl({ search, structureNodes, structureLoading, structureError }) {
      const requestedNode = queryValue(search, "node");
      const requestedProperty = queryValue(search, "property");
      if (!requestedNode) {
        selectedNodePath = null;
        selectedPropertyName = null;
        scheduleEmit();
        return;
      }
      if (structureLoading || (structureNodes.length === 0 && !structureError)) {
        selectedNodePath = requestedNode;
        selectedPropertyName = requestedProperty;
        scheduleEmit();
        return;
      }
      const exists = structureNodes.some((node) => node.nodePath === requestedNode);
      if (!exists) {
        selectedNodePath = null;
        selectedPropertyName = null;
        scheduleEmit();
        return;
      }
      selectedNodePath = requestedNode;
      if (requestedProperty) {
        const node = structureNodes.find((item) => item.nodePath === requestedNode);
        const propertyExists = node?.properties.some((property) => property.name === requestedProperty);
        selectedPropertyName = propertyExists ? requestedProperty : null;
      } else {
        selectedPropertyName = null;
      }
      scheduleEmit();
    },
    resolveSelectedConfigSet({ search, configSets }) {
      const requested = queryValue(search, "configSet");
      return configSets.find((item) => item.id === requested) ?? defaultConfigSet(configSets);
    },
    resolveSelectedMember(ctx, selectedConfigSet) {
      const requested = queryValue(ctx.search, "file");
      if (requested) {
        const memberHit = ctx.selectedMembers.find((item) => item.fileId === requested);
        if (memberHit) return memberHit;
        if (!ctx.membersLoading && !ctx.membersError) {
          const projectHit = ctx.projectFiles.find((file) => file.id === requested);
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
        ctx.selectedMembers.find((item) => item.format === "dts" && item.currentVersionId) ??
        ctx.selectedMembers.find((item) => item.currentVersionId) ??
        ctx.selectedMembers[0] ??
        null
      );
    },
    applyConfigSetUrl({ projectId, search, configSetsLoading, selectedConfigSet }) {
      if (configSetsLoading || !selectedConfigSet) return null;
      if (queryValue(search, "configSet") === selectedConfigSet.id) return null;
      return formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSet.id,
        file: null,
        node: null,
        property: null
      });
    },
    applyFileUrl({
      projectId,
      search,
      membersLoading,
      filesLoading,
      selectedConfigSet,
      selectedMemberFileId,
      selectedMembers,
      projectFiles
    }) {
      if (membersLoading || filesLoading || !selectedConfigSet || !selectedMemberFileId) return null;
      const requested = queryValue(search, "file");
      if (requested) {
        const knownMember = selectedMembers.some((item) => item.fileId === requested);
        const knownProjectFile = projectFiles.some((file) => file.id === requested);
        if (knownMember || knownProjectFile) return null;
      }
      if (requested === selectedMemberFileId) return null;
      return formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSet.id,
        file: selectedMemberFileId,
        node: null,
        property: null
      });
    },
    selectConfigSet(projectId, search, configSetId) {
      return formatWorkbenchPath(projectId, search, {
        configSet: configSetId,
        file: null,
        node: null,
        property: null,
        sourceMode: null,
        version: null
      });
    },
    selectMember(projectId, search, input) {
      const switchingFile = input.currentFileId !== input.fileId;
      return formatWorkbenchPath(projectId, search, {
        configSet: input.configSetId,
        file: input.fileId,
        node: null,
        property: null,
        sourceMode: switchingFile ? null : input.sourceMode,
        version: switchingFile || input.workingMode ? null : input.versionId
      });
    },
    selectStructureTarget(projectId, search, input) {
      selectedNodePath = input.nodePath;
      selectedPropertyName = input.propertyName;
      api.beginSuppressScrollSync();
      scheduleEmit();
      return formatWorkbenchPath(projectId, search, {
        configSet: input.configSetId,
        file: input.fileId,
        node: input.nodePath,
        property: input.propertyName,
        sourceMode: input.sourceMode,
        version: input.versionId
      });
    },
    async runSearch(projectId, repo) {
      const q = searchDraft.trim();
      if (!q) {
        searchHits = [];
        searchError = "";
        scheduleEmit();
        return;
      }
      searchLoading = true;
      searchError = "";
      scheduleEmit();
      try {
        const result = await repo.search(projectId, { q });
        searchHits = result.hits;
        findQuery = q;
      } catch (error: unknown) {
        searchHits = [];
        searchError = error instanceof Error ? error.message : "搜索失败。";
      } finally {
        searchLoading = false;
        scheduleEmit();
      }
    },
    selectSearchHit(projectId, search, input) {
      api.beginSuppressScrollSync();
      if (input.hit.source) {
        pendingFocusLine = input.hit.source.startLine;
      }
      scheduleEmit();
      return formatWorkbenchPath(projectId, search, {
        configSet: input.configSetId,
        file: input.hit.fileId,
        node: input.hit.nodePath,
        property: input.hit.propertyName ?? null,
        sourceMode: input.sourceMode,
        version: input.versionId
      });
    }
  };

  emit();
  return api;
}
