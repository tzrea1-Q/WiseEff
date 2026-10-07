import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { getSharedPostgresCheckpointerSaver, isPostgresNamespaceLeaseOwner, waitForInterruptCheckpointDurable, type NamespaceLease } from "./durableCheckpointer";
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
  saver: BaseCheckpointSaver;
  ensureReady(): Promise<void>;
  ensureInterruptCheckpointDurable(threadId: string): Promise<void>;
  withNamespaceLease: NamespaceLease;
};

const memoryLeases = new WeakMap<BaseCheckpointSaver, Set<string>>();

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

  return {
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
