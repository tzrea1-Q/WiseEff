import type {
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsStructuralNode,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ProjectParameterFile
} from "@/application/ports/ParameterFileRepository";

export type WorkspaceLoadDtsRepository = Pick<
  DtsStructuredRepository,
  "listConfigSets" | "listConfigSetFiles" | "getStructure"
>;

export type WorkspaceLoadFileRepository = Pick<
  ParameterFileRepository,
  "listFiles" | "downloadVersion"
>;

export type WorkbenchWorkspaceLoadSnapshot = {
  configSets: DtsConfigSet[];
  configSetsLoading: boolean;
  configSetsError: string;
  configRetry: number;
  projectFiles: ProjectParameterFile[];
  filesLoading: boolean;
  filesError: string;
  filesRetry: number;
  members: DtsConfigSetMemberFile[];
  /** Config set id that `members` currently correspond to; null while unbound/cleared. */
  membersBoundConfigSetId: string | null;
  membersLoading: boolean;
  membersError: string;
  membersRetry: number;
  source: string;
  sourceLoading: boolean;
  sourceError: string;
  sourceRetry: number;
  structureNodes: DtsStructuralNode[];
  structureLoading: boolean;
  structureError: string;
  structureRetry: number;
};

export type WorkbenchWorkspaceLoadSession = WorkbenchWorkspaceLoadSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkbenchWorkspaceLoadSnapshot;
  loadConfigSets(projectId: string, repo: Pick<DtsStructuredRepository, "listConfigSets">): Promise<void>;
  loadProjectFiles(projectId: string, repo: Pick<ParameterFileRepository, "listFiles">): Promise<void>;
  loadMembers(
    projectId: string,
    configSetId: string | null,
    repo: Pick<DtsStructuredRepository, "listConfigSetFiles">
  ): Promise<void>;
  loadSource(
    projectId: string,
    fileId: string | null,
    versionId: string | null,
    repo: Pick<ParameterFileRepository, "downloadVersion">
  ): Promise<void>;
  loadStructure(
    projectId: string,
    fileId: string | null,
    versionId: string | null,
    repo: Pick<DtsStructuredRepository, "getStructure">
  ): Promise<void>;
  retryConfigSets(): void;
  retryFiles(): void;
  retryMembers(): void;
  retrySource(): void;
  retryStructure(): void;
  setConfigSets(items: DtsConfigSet[]): void;
  setMembers(items: DtsConfigSetMemberFile[], boundConfigSetId?: string | null): void;
  setProjectFiles(items: ProjectParameterFile[]): void;
};

function decodeSourceBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function emptySnapshot(): WorkbenchWorkspaceLoadSnapshot {
  return {
    configSets: [],
    configSetsLoading: true,
    configSetsError: "",
    configRetry: 0,
    projectFiles: [],
    filesLoading: true,
    filesError: "",
    filesRetry: 0,
    members: [],
    membersBoundConfigSetId: null,
    membersLoading: false,
    membersError: "",
    membersRetry: 0,
    source: "",
    sourceLoading: false,
    sourceError: "",
    sourceRetry: 0,
    structureNodes: [],
    structureLoading: false,
    structureError: "",
    structureRetry: 0
  };
}

export function createWorkbenchWorkspaceLoadSession(): WorkbenchWorkspaceLoadSession {
  const listeners = new Set<() => void>();
  let configSets: DtsConfigSet[] = [];
  let configSetsLoading = true;
  let configSetsError = "";
  let configRetry = 0;
  let projectFiles: ProjectParameterFile[] = [];
  let filesLoading = true;
  let filesError = "";
  let filesRetry = 0;
  let members: DtsConfigSetMemberFile[] = [];
  let membersBoundConfigSetId: string | null = null;
  let membersLoading = false;
  let membersError = "";
  let membersRetry = 0;
  let source = "";
  let sourceLoading = false;
  let sourceError = "";
  let sourceRetry = 0;
  let structureNodes: DtsStructuralNode[] = [];
  let structureLoading = false;
  let structureError = "";
  let structureRetry = 0;
  let configGeneration = 0;
  let filesGeneration = 0;
  let membersGeneration = 0;
  let sourceGeneration = 0;
  let structureGeneration = 0;
  let snapshot = emptySnapshot();
  let emitScheduled = false;

  function rebuild(): WorkbenchWorkspaceLoadSnapshot {
    return {
      configSets,
      configSetsLoading,
      configSetsError,
      configRetry,
      projectFiles,
      filesLoading,
      filesError,
      filesRetry,
      members,
      membersBoundConfigSetId,
      membersLoading,
      membersError,
      membersRetry,
      source,
      sourceLoading,
      sourceError,
      sourceRetry,
      structureNodes,
      structureLoading,
      structureError,
      structureRetry
    };
  }

  function emit(): void {
    snapshot = rebuild();
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      snapshot = rebuild();
      for (const listener of listeners) listener();
    });
  }

  const api: WorkbenchWorkspaceLoadSession = {
    get configSets() {
      return snapshot.configSets;
    },
    get configSetsLoading() {
      return snapshot.configSetsLoading;
    },
    get configSetsError() {
      return snapshot.configSetsError;
    },
    get configRetry() {
      return snapshot.configRetry;
    },
    get projectFiles() {
      return snapshot.projectFiles;
    },
    get filesLoading() {
      return snapshot.filesLoading;
    },
    get filesError() {
      return snapshot.filesError;
    },
    get filesRetry() {
      return snapshot.filesRetry;
    },
    get members() {
      return snapshot.members;
    },
    get membersBoundConfigSetId() {
      return snapshot.membersBoundConfigSetId;
    },
    get membersLoading() {
      return snapshot.membersLoading;
    },
    get membersError() {
      return snapshot.membersError;
    },
    get membersRetry() {
      return snapshot.membersRetry;
    },
    get source() {
      return snapshot.source;
    },
    get sourceLoading() {
      return snapshot.sourceLoading;
    },
    get sourceError() {
      return snapshot.sourceError;
    },
    get sourceRetry() {
      return snapshot.sourceRetry;
    },
    get structureNodes() {
      return snapshot.structureNodes;
    },
    get structureLoading() {
      return snapshot.structureLoading;
    },
    get structureError() {
      return snapshot.structureError;
    },
    get structureRetry() {
      return snapshot.structureRetry;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    async loadConfigSets(projectId, repo) {
      const generation = ++configGeneration;
      configSetsLoading = true;
      configSetsError = "";
      emit();
      try {
        const items = await repo.listConfigSets(projectId);
        if (generation !== configGeneration) return;
        configSets = items;
      } catch (error: unknown) {
        if (generation !== configGeneration) return;
        configSets = [];
        configSetsError = error instanceof Error ? error.message : "配置集加载失败。";
      } finally {
        if (generation === configGeneration) {
          configSetsLoading = false;
          emit();
        }
      }
    },
    async loadProjectFiles(projectId, repo) {
      const generation = ++filesGeneration;
      filesLoading = true;
      filesError = "";
      emit();
      try {
        const items = await repo.listFiles(projectId);
        if (generation !== filesGeneration) return;
        projectFiles = items;
      } catch (error: unknown) {
        if (generation !== filesGeneration) return;
        projectFiles = [];
        filesError = error instanceof Error ? error.message : "项目文件加载失败。";
      } finally {
        if (generation === filesGeneration) {
          filesLoading = false;
          emit();
        }
      }
    },
    async loadMembers(projectId, configSetId, repo) {
      if (!configSetId) {
        membersGeneration += 1;
        members = [];
        membersBoundConfigSetId = null;
        membersLoading = false;
        membersError = "";
        emit();
        return;
      }
      const generation = ++membersGeneration;
      membersLoading = true;
      membersBoundConfigSetId = null;
      membersError = "";
      emit();
      try {
        const items = await repo.listConfigSetFiles(projectId, configSetId);
        if (generation !== membersGeneration) return;
        members = items;
        membersBoundConfigSetId = configSetId;
      } catch (error: unknown) {
        if (generation !== membersGeneration) return;
        members = [];
        membersBoundConfigSetId = configSetId;
        membersError = error instanceof Error ? error.message : "配置集成员加载失败。";
      } finally {
        if (generation === membersGeneration) {
          membersLoading = false;
          emit();
        }
      }
    },
    async loadSource(projectId, fileId, versionId, repo) {
      if (!fileId || !versionId) {
        sourceGeneration += 1;
        source = "";
        sourceError = "";
        sourceLoading = false;
        emit();
        return;
      }
      const generation = ++sourceGeneration;
      sourceLoading = true;
      sourceError = "";
      emit();
      try {
        const result = await repo.downloadVersion(projectId, fileId, versionId);
        if (generation !== sourceGeneration) return;
        source = decodeSourceBytes(result.bytes);
      } catch (error: unknown) {
        if (generation !== sourceGeneration) return;
        source = "";
        sourceError = error instanceof Error ? error.message : "源码加载失败。";
      } finally {
        if (generation === sourceGeneration) {
          sourceLoading = false;
          emit();
        }
      }
    },
    async loadStructure(projectId, fileId, versionId, repo) {
      if (!fileId || !versionId) {
        structureGeneration += 1;
        structureNodes = [];
        structureError = "";
        structureLoading = false;
        emit();
        return;
      }
      const generation = ++structureGeneration;
      structureLoading = true;
      structureError = "";
      emit();
      try {
        const result = await repo.getStructure(projectId, fileId, versionId);
        if (generation !== structureGeneration) return;
        structureNodes = result.nodes;
      } catch (error: unknown) {
        if (generation !== structureGeneration) return;
        structureNodes = [];
        structureError = error instanceof Error ? error.message : "结构树加载失败。";
      } finally {
        if (generation === structureGeneration) {
          structureLoading = false;
          emit();
        }
      }
    },
    retryConfigSets() {
      configRetry += 1;
      emit();
    },
    retryFiles() {
      filesRetry += 1;
      emit();
    },
    retryMembers() {
      membersRetry += 1;
      emit();
    },
    retrySource() {
      sourceRetry += 1;
      emit();
    },
    retryStructure() {
      structureRetry += 1;
      emit();
    },
    setConfigSets(items) {
      configSets = items;
      emit();
    },
    setMembers(items, boundConfigSetId) {
      members = items;
      if (boundConfigSetId !== undefined) {
        membersBoundConfigSetId = boundConfigSetId;
      } else if (items[0]?.configSetId) {
        membersBoundConfigSetId = items[0].configSetId;
      }
      emit();
    },
    setProjectFiles(items) {
      projectFiles = items;
      emit();
    }
  };

  emit();
  return api;
}
