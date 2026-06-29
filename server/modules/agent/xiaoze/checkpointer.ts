import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { getSharedPostgresCheckpointerSaver } from "./durableCheckpointer";

export type XiaozeCheckpointSnapshot = Record<string, unknown>;

export type XiaozeCheckpointerMode = "memory" | "postgres";

export type XiaozeCheckpointerOptions = {
  mode?: XiaozeCheckpointerMode;
  connectionString?: string;
  saver?: BaseCheckpointSaver;
};

export type XiaozeCheckpointer = {
  put(threadId: string, state: XiaozeCheckpointSnapshot): Promise<void>;
  get(threadId: string): Promise<XiaozeCheckpointSnapshot | undefined>;
  saver: BaseCheckpointSaver;
};

export function createXiaozeCheckpointer(options?: XiaozeCheckpointerOptions): XiaozeCheckpointer {
  let saver: BaseCheckpointSaver;
  if (options?.saver) {
    saver = options.saver;
  } else if (options?.mode === "postgres" && options.connectionString?.trim()) {
    saver = getSharedPostgresCheckpointerSaver(options.connectionString.trim()).saver;
  } else {
    saver = new MemorySaver();
  }

  const auxiliary = new Map<string, XiaozeCheckpointSnapshot>();

  return {
    async put(threadId, state) {
      auxiliary.set(threadId, { ...state });
    },
    async get(threadId) {
      return auxiliary.get(threadId);
    },
    saver
  };
}

export function resolveXiaozeCheckpointerFromEnv(env: {
  XIAOZE_CHECKPOINTER?: XiaozeCheckpointerMode;
  DATABASE_URL?: string;
  XIAOZE_DETERMINISTIC?: boolean;
}): XiaozeCheckpointer {
  if (env.XIAOZE_DETERMINISTIC) {
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
