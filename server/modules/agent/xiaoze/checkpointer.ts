import { MemorySaver } from "@langchain/langgraph";

export type XiaozeCheckpointSnapshot = Record<string, unknown>;

export type XiaozeCheckpointer = {
  put(threadId: string, state: XiaozeCheckpointSnapshot): Promise<void>;
  get(threadId: string): Promise<XiaozeCheckpointSnapshot | undefined>;
  saver: MemorySaver;
};

export function createXiaozeCheckpointer(): XiaozeCheckpointer {
  const saver = new MemorySaver();
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
