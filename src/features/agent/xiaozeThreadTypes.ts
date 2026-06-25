export const XIAOZE_THREAD_STORAGE_KEY = "wiseeff.xiaoze.threads.v1";
export const XIAOZE_ACTIVE_THREAD_SESSION_KEY = "wiseeff.xiaoze.activeThreadId.v1";
export const XIAOZE_THREAD_MAX_COUNT = 30;

export type XiaozeStoredMessage = {
  id: string;
  role: "user" | "assistant" | "reasoning";
  content: string;
};

export type XiaozeThreadRecord = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messages: XiaozeStoredMessage[];
  /** Populated for API list items before messages are hydrated. */
  messageCount?: number;
};

export type XiaozeThreadStoreSnapshot = {
  activeThreadId: string;
  threads: XiaozeThreadRecord[];
};
