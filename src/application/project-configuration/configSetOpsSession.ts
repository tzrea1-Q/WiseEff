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
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

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

const CANONICAL_SYNC_CONFLICT_COPY = new Map([
  ["source-membership-drift", "配置集成员、文件版本或参数绑定的来源记录与固定修订不一致，校验已停止。请刷新并核对成员、版本和来源记录；可从页面顶部「上传候选」查看差异，仅在来源证明完整且基版本有效时提交人工审核。"],
  ["mixed-source-revisions", "同一配置集的参数绑定指向不同的来源修订，无法证明统一来源，校验已停止。请刷新并让配置管理员核对各绑定的当前值与来源固定记录，通过受审来源修复统一修订后再校验；上传候选不能直接解除此冲突。"],
  ["source-pin-missing", "当前配置集缺少可验证的活动来源固定记录，校验已停止。请刷新并核对参数绑定、当前值和来源固定记录；仍缺失时请配置管理员先修复来源，再重新校验，不要直接提交候选审核。"],
  ["source-proof-busy", "校验期间来源记录正在变化，暂时无法取得稳定证明。请等待相关操作完成后刷新重试；若持续出现，请配置管理员检查并发来源事务。"]
]);

export function formatSyncSummary(result: FileSyncSummary): string {
  if (result.sourceWorkflow === "canonical") {
    return "来源一致性校验：已检查当前文件版本；存在可用固定来源时，已与其中一份来源修订核对配置集成员及文件版本。未逐项证明全部参数绑定一致，也未同步参数、创建草稿或审核请求。";
  }
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
        const reason = err instanceof WiseEffApiError && err.code === "CONFLICT"
          && typeof err.details.reason === "string" ? err.details.reason : "";
        const conflictCopy = CANONICAL_SYNC_CONFLICT_COPY.get(reason);
        const message = conflictCopy
          ? `${conflictCopy}本次未同步参数或创建审核请求。`
          : err instanceof Error ? err.message : "手动同步失败。";
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
