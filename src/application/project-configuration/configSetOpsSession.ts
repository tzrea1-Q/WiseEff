import type {
  AddConfigSetFileInput,
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsExportConfigSetResult,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  FileSyncSummary,
  ParameterFileRepository,
  ParameterFileSyncConflict,
  ProjectParameterFile
} from "@/application/ports/ParameterFileRepository";

export type ConfigSetOpsStructuredRepository = Pick<
  DtsStructuredRepository,
  "createConfigSet" | "addConfigSetFile" | "removeConfigSetFile" | "exportConfigSet"
>;

export type ConfigSetOpsFileRepository = Pick<
  ParameterFileRepository,
  "syncFile" | "listFiles" | "listConflicts"
>;

export type ConfigSetOpsSnapshot = {
  lastError: string;
  lastMessage: string;
};

export type CreateConfigSetResult =
  | { ok: true; item: DtsConfigSet; message: string }
  | { ok: false; kind: "validation" | "error"; message: string };

export type AddMemberResult =
  | {
      ok: true;
      membership: DtsConfigSetFile;
      fileName: string;
      format: ProjectParameterFile["format"];
      currentVersionId?: string;
      currentVersionNumber?: number;
      message: string;
    }
  | { ok: false; message: string };

export type RemoveMemberResult = { ok: true; message: string } | { ok: false; message: string };

export type SyncFileResult =
  | {
      ok: true;
      summary: FileSyncSummary;
      evidence: string;
      files: ProjectParameterFile[];
      conflicts: ParameterFileSyncConflict[];
    }
  | { ok: false; message: string };

export type ExportConfigSetResult =
  | { ok: true; export: DtsExportConfigSetResult; evidence: string }
  | { ok: false; message: string };

export type ConfigSetOpsSession = ConfigSetOpsSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConfigSetOpsSnapshot;
  clearFeedback(): void;
  create(
    projectId: string,
    input: { name: string; existingNames: string[] },
    repo: Pick<DtsStructuredRepository, "createConfigSet">
  ): Promise<CreateConfigSetResult>;
  addMember(
    projectId: string,
    configSetId: string,
    input: AddConfigSetFileInput & { file?: ProjectParameterFile },
    repo: Pick<DtsStructuredRepository, "addConfigSetFile">
  ): Promise<AddMemberResult>;
  removeMember(
    projectId: string,
    configSetId: string,
    fileId: string,
    repo: Pick<DtsStructuredRepository, "removeConfigSetFile">
  ): Promise<RemoveMemberResult>;
  syncFile(
    projectId: string,
    input: { fileId: string; fileName: string },
    repo: ConfigSetOpsFileRepository
  ): Promise<SyncFileResult>;
  exportConfigSet(
    projectId: string,
    configSetId: string,
    configSetName: string,
    repo: Pick<DtsStructuredRepository, "exportConfigSet">
  ): Promise<ExportConfigSetResult>;
};

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

export function formatSyncSummary(result: FileSyncSummary): string {
  if (result.skipped) return "已跳过（无活跃版本）";
  if (typeof result.draftsCreated === "number") {
    return `同步成功，已创建 ${result.draftsCreated} 条草稿。`;
  }
  return "同步成功。";
}

function emptySnapshot(): ConfigSetOpsSnapshot {
  return { lastError: "", lastMessage: "" };
}

export function createConfigSetOpsSession(): ConfigSetOpsSession {
  const listeners = new Set<() => void>();
  let lastError = "";
  let lastMessage = "";
  let emitScheduled = false;
  let cached = emptySnapshot();

  function rebuild(): ConfigSetOpsSnapshot {
    return { lastError, lastMessage };
  }

  function emit(): void {
    cached = rebuild();
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      cached = rebuild();
      for (const listener of listeners) listener();
    });
  }

  const session: ConfigSetOpsSession = {
    get lastError() {
      return cached.lastError;
    },
    get lastMessage() {
      return cached.lastMessage;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cached;
    },

    clearFeedback() {
      if (!lastError && !lastMessage) return;
      lastError = "";
      lastMessage = "";
      emit();
    },

    async create(projectId, input, repo) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        const message = "请先填写配置集名称。";
        lastError = "";
        lastMessage = "";
        emit();
        return { ok: false, kind: "validation", message };
      }
      if (input.existingNames.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
        const message = `已存在名为「${trimmed}」的配置集。`;
        lastError = "";
        lastMessage = "";
        emit();
        return { ok: false, kind: "validation", message };
      }
      lastError = "";
      emit();
      try {
        const item = await repo.createConfigSet(projectId, { name: trimmed });
        const message = `已创建配置集「${item.name}」。`;
        lastMessage = message;
        emit();
        return { ok: true, item, message };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "创建配置集失败。";
        lastError = message;
        lastMessage = "";
        emit();
        return { ok: false, kind: "error", message };
      }
    },

    async addMember(projectId, configSetId, input, repo) {
      lastError = "";
      emit();
      try {
        const membership = await repo.addConfigSetFile(projectId, configSetId, {
          fileId: input.fileId,
          role: input.role,
          sortOrder: input.sortOrder
        });
        const fileName = input.file?.fileName ?? membership.fileId;
        const message = `已将「${fileName}」编入配置集（${ROLE_LABELS[input.role]} · 顺序 ${input.sortOrder ?? 0}）。`;
        lastMessage = message;
        emit();
        return {
          ok: true,
          membership,
          fileName,
          format: input.file?.format ?? "dts",
          currentVersionId: input.file?.currentVersionId,
          currentVersionNumber: input.file?.currentVersionNumber,
          message
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "添加成员失败。";
        lastError = message;
        lastMessage = "";
        emit();
        return { ok: false, message };
      }
    },

    async removeMember(projectId, configSetId, fileId, repo) {
      lastError = "";
      emit();
      try {
        await repo.removeConfigSetFile(projectId, configSetId, fileId);
        const message = "已从配置集移除成员文件。";
        lastMessage = message;
        emit();
        return { ok: true, message };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "移除成员失败。";
        lastError = message;
        lastMessage = "";
        emit();
        return { ok: false, message };
      }
    },

    async syncFile(projectId, input, repo) {
      lastError = "";
      emit();
      try {
        const summary = await repo.syncFile(projectId, input.fileId);
        const evidence = `${input.fileName}：${formatSyncSummary(summary)}`;
        const [files, conflicts] = await Promise.all([
          repo.listFiles(projectId),
          repo.listConflicts(projectId)
        ]);
        lastMessage = evidence;
        emit();
        return { ok: true, summary, evidence, files, conflicts };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "手动同步失败。";
        lastError = message;
        lastMessage = "";
        emit();
        return { ok: false, message };
      }
    },

    async exportConfigSet(projectId, configSetId, configSetName, repo) {
      lastError = "";
      emit();
      try {
        const exported = await repo.exportConfigSet(projectId, configSetId);
        const memberCount = exported.manifest.members.length;
        const validation = exported.manifest.validation
          ? `校验 ${exported.manifest.validation.ok ? "通过" : "未通过"}（${exported.manifest.validation.mode}）`
          : "无校验元数据";
        const evidence = `已导出配置集「${configSetName}」：${memberCount} 个成员，含角色/顺序；${validation}。`;
        lastMessage = evidence;
        emit();
        return { ok: true, export: exported, evidence };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "导出配置集失败。";
        lastError = message;
        lastMessage = "";
        emit();
        return { ok: false, message };
      }
    }
  };

  cached = rebuild();
  return session;
}
