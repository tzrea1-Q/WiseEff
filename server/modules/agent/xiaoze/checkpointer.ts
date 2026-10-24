import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { getSharedPostgresCheckpointerSaver, isPostgresNamespaceLeaseOwner, postgresCheckpointInspector, waitForInterruptCheckpointDurable, type NamespaceLease, type CheckpointStoreSnapshot } from "./durableCheckpointer";
import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../../../shared/http/errors";
import { isXiaozeDeterministicMode } from "./runtimeMode";

export type XiaozeCheckpointSnapshot = Record<string, unknown>;

export type XiaozeCheckpointerMode = "memory" | "postgres";

export type XiaozeCheckpointerOptions = {
  mode?: XiaozeCheckpointerMode;
  connectionString?: string;
  saver?: BaseCheckpointSaver;
  withNamespaceLease?: NamespaceLease;
  ensureReady?: () => Promise<void>;
};

export type XiaozeCheckpointer = {
  put(threadId: string, state: XiaozeCheckpointSnapshot): Promise<void>;
  get(threadId: string): Promise<XiaozeCheckpointSnapshot | undefined>;
  deleteThread(threadId: string): Promise<void>;
  saver: BaseCheckpointSaver;
  ensureReady(): Promise<void>;
  ensureInterruptCheckpointDurable(threadId: string): Promise<void>;
  withNamespaceLease: NamespaceLease;
  inspectStore(threadId?: string): Promise<CheckpointStoreSnapshot>;
};

const memoryLeases = new WeakMap<BaseCheckpointSaver, Set<string>>();
const memoryStoreIds = new WeakMap<BaseCheckpointSaver, string>();

export function createXiaozeCheckpointer(options?: XiaozeCheckpointerOptions): XiaozeCheckpointer {
  let saver: BaseCheckpointSaver;
  const connectionString =
    options?.mode === "postgres" && options.connectionString?.trim()
      ? options.connectionString.trim()
      : undefined;

  if (options?.saver) {
    saver = options.saver;
  } else if (connectionString) {
    saver = getSharedPostgresCheckpointerSaver(connectionString).saver;
  } else {
    saver = new MemorySaver();
  }

  const auxiliary = new Map<string, XiaozeCheckpointSnapshot>();
  const durable = options?.mode === "postgres" || Boolean(connectionString);
  const handle = !options?.saver && connectionString ? getSharedPostgresCheckpointerSaver(connectionString) : undefined;
  const lease = options?.withNamespaceLease ?? handle?.withNamespaceLease;
  const localLeases = memoryLeases.get(saver) ?? new Set<string>();
  memoryLeases.set(saver, localLeases);
  const storeId = memoryStoreIds.get(saver) ?? randomUUID();
  memoryStoreIds.set(saver, storeId);

  return {
    async inspectStore(threadId) {
      const inspect = postgresCheckpointInspector(saver);
      if (inspect) return inspect(threadId);
      if (!(saver instanceof MemorySaver)) throw new ApiError("CONFLICT", "Configured Agent checkpoint store cannot be inspected.");
      const entries: CheckpointStoreSnapshot["entries"] = [];
      for (const [key, value] of Object.entries(saver.storage)) {
        if (threadId === undefined || key === threadId) entries.push({ threadId: key, relation: "agent.memory-checkpoints", count: Object.values(value).reduce((sum, versions) => sum + Object.keys(versions).length, 0), digest: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
      }
      // The installed MemorySaver keys pending writes by [thread, namespace, checkpoint].
      for (const [key, value] of Object.entries(saver.writes)) {
        const tuple: unknown = JSON.parse(key);
        if (!Array.isArray(tuple) || typeof tuple[0] !== "string") throw new ApiError("CONFLICT", "Memory checkpoint ownership is unavailable.");
        if (threadId === undefined || tuple[0] === threadId) entries.push({ threadId: tuple[0], relation: "agent.memory-writes", count: Object.keys(value).length, digest: createHash("sha256").update(JSON.stringify(value)).digest("hex") });
      }
      return { id: storeId, kind: "memory", entries };
    },
    async ensureReady() {
      if (options?.saver) {
        if (durable && !isPostgresNamespaceLeaseOwner(saver, lease)) throw new ApiError("CONFLICT", "Xiaoze durable saver requires its owning writer lease.");
        await options.ensureReady?.();
      } else if (handle) await handle.ensureSetup();
    },
    async withNamespaceLease(threadId, work) {
      if (durable) {
        if (!isPostgresNamespaceLeaseOwner(saver, lease)) throw new ApiError("CONFLICT", "Xiaoze durable saver requires its owning writer lease.");
        return lease!(threadId, work);
      }
      if (localLeases.has(threadId)) throw new ApiError("CONFLICT", "Xiaoze thread is busy.", { reason: "xiaoze-thread-busy" });
      localLeases.add(threadId);
      try { return await work(); } finally { localLeases.delete(threadId); }
    },
    async put(threadId, state) {
      auxiliary.set(threadId, { ...state });
    },
    async get(threadId) {
      return auxiliary.get(threadId);
    },
    async deleteThread(threadId) {
      await this.ensureReady();
      await this.withNamespaceLease(threadId, async () => {
        await saver.deleteThread(threadId);
        auxiliary.delete(threadId);
      });
    },
    saver,
    async ensureInterruptCheckpointDurable(threadId) {
      await waitForInterruptCheckpointDurable({
        threadId,
        saver,
        connectionString
      });
    }
  };
}

export function resolveXiaozeCheckpointerFromEnv(env: {
  XIAOZE_CHECKPOINTER?: XiaozeCheckpointerMode;
  DATABASE_URL?: string;
}): XiaozeCheckpointer {
  if (isXiaozeDeterministicMode()) {
    return createXiaozeCheckpointer({ mode: "memory" });
  }
  if (env.XIAOZE_CHECKPOINTER === "postgres" && env.DATABASE_URL?.trim()) {
    return createXiaozeCheckpointer({
      mode: "postgres",
      connectionString: env.DATABASE_URL.trim()
    });
  }
  return createXiaozeCheckpointer({ mode: "memory" });
}
