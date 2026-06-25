import type { Message } from "@ag-ui/core";
import {
  XIAOZE_ACTIVE_THREAD_SESSION_KEY,
  XIAOZE_THREAD_MAX_COUNT,
  XIAOZE_THREAD_STORAGE_KEY,
  type XiaozeStoredMessage,
  type XiaozeThreadRecord,
  type XiaozeThreadStoreSnapshot
} from "./xiaozeThreadTypes";

export type XiaozeApiThreadListItem = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

const PERSISTABLE_ROLES = new Set(["user", "assistant", "reasoning"]);

function readMessageText(content: Message["content"]) {
  return typeof content === "string" ? content : "";
}

export function createThreadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `xiaoze-thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function serializeXiaozeMessages(messages: Message[]): XiaozeStoredMessage[] {
  return messages
    .filter((message) => PERSISTABLE_ROLES.has(message.role))
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: readMessageText(message.content)
    }))
    .filter((message): message is XiaozeStoredMessage => {
      if (!message.content.trim()) {
        return false;
      }
      return message.role === "user" || message.role === "assistant" || message.role === "reasoning";
    });
}

export function deriveThreadTitle(messages: XiaozeStoredMessage[], fallback = "新对话") {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  if (!firstUser) {
    return fallback;
  }
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed;
}

export function areStoredMessagesEqual(left: XiaozeStoredMessage[], right: XiaozeStoredMessage[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((message, index) => {
    const other = right[index];
    return message.id === other?.id && message.role === other.role && message.content === other.content;
  });
}

export function deriveThreadPreview(messages: XiaozeStoredMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      const trimmed = message.content.trim().replace(/\s+/g, " ");
      return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
    }
  }
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (firstUser) {
    const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
    return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
  }
  return "暂无消息";
}

export function buildThreadRecord(threadId: string, messages: XiaozeStoredMessage[], existing?: XiaozeThreadRecord): XiaozeThreadRecord {
  const now = new Date().toISOString();
  return {
    id: threadId,
    title: deriveThreadTitle(messages),
    preview: deriveThreadPreview(messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages,
    messageCount: messages.length > 0 ? messages.length : existing?.messageCount
  };
}

export function isHistoricalThread(thread: XiaozeThreadRecord) {
  return thread.messages.length > 0 || (thread.messageCount ?? 0) > 0;
}

export function hasPersistedThreadContent(thread: XiaozeThreadRecord | undefined) {
  if (!thread) {
    return false;
  }
  return isHistoricalThread(thread);
}

export function isKnownPersistedThread(threads: XiaozeThreadRecord[], threadId: string) {
  return hasPersistedThreadContent(threads.find((thread) => thread.id === threadId));
}

export function mapApiThreadListItem(item: XiaozeApiThreadListItem): XiaozeThreadRecord {
  return {
    id: item.id,
    title: item.title,
    preview: item.preview,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messages: [],
    messageCount: item.messageCount
  };
}

export function mergeApiThreadList(items: XiaozeApiThreadListItem[], activeThreadId: string): XiaozeThreadStoreSnapshot {
  return {
    activeThreadId,
    threads: items.map(mapApiThreadListItem)
  };
}

export function readApiActiveThreadId(storage: Pick<Storage, "getItem"> = sessionStorage): string | null {
  try {
    const value = storage.getItem(XIAOZE_ACTIVE_THREAD_SESSION_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeApiActiveThreadId(threadId: string, storage: Pick<Storage, "setItem"> = sessionStorage) {
  try {
    storage.setItem(XIAOZE_ACTIVE_THREAD_SESSION_KEY, threadId);
  } catch {
    // Ignore storage failures; in-memory state still works for the current tab.
  }
}

export function createApiThreadSnapshot(activeThreadId = readApiActiveThreadId() ?? createThreadId()): XiaozeThreadStoreSnapshot {
  return createEmptyThreadSnapshot(activeThreadId);
}

export function listHistoricalThreads(threads: XiaozeThreadRecord[]) {
  return threads.filter(isHistoricalThread);
}

export function createEmptyThreadSnapshot(activeThreadId = createThreadId()): XiaozeThreadStoreSnapshot {
  return {
    activeThreadId,
    threads: []
  };
}

export function readXiaozeThreadStore(storage: Pick<Storage, "getItem"> = localStorage): XiaozeThreadStoreSnapshot {
  try {
    const raw = storage.getItem(XIAOZE_THREAD_STORAGE_KEY);
    if (!raw) {
      return createEmptyThreadSnapshot();
    }
    const parsed = JSON.parse(raw) as Partial<XiaozeThreadStoreSnapshot>;
    if (!parsed.activeThreadId || !Array.isArray(parsed.threads) || parsed.threads.length === 0) {
      return createEmptyThreadSnapshot();
    }
    const activeThreadId = parsed.activeThreadId;
    const threads = listHistoricalThreads(
      parsed.threads.filter((thread): thread is XiaozeThreadRecord => !!thread?.id)
    ).slice(0, XIAOZE_THREAD_MAX_COUNT);
    if (threads.length === 0) {
      return createEmptyThreadSnapshot(activeThreadId);
    }
    if (!threads.some((thread) => thread.id === activeThreadId)) {
      return { activeThreadId, threads };
    }
    return { activeThreadId, threads };
  } catch {
    return createEmptyThreadSnapshot();
  }
}

export function writeXiaozeThreadStore(snapshot: XiaozeThreadStoreSnapshot, storage: Pick<Storage, "setItem"> = localStorage) {
  const sorted = [...listHistoricalThreads(snapshot.threads)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const trimmedThreads = sorted.slice(0, XIAOZE_THREAD_MAX_COUNT);
  storage.setItem(
    XIAOZE_THREAD_STORAGE_KEY,
    JSON.stringify({
      activeThreadId: snapshot.activeThreadId,
      threads: trimmedThreads
    } satisfies XiaozeThreadStoreSnapshot)
  );
  return { activeThreadId: snapshot.activeThreadId, threads: trimmedThreads };
}

export function upsertThreadRecord(
  snapshot: XiaozeThreadStoreSnapshot,
  threadId: string,
  messages: XiaozeStoredMessage[]
): XiaozeThreadStoreSnapshot {
  const threadsWithoutTarget = snapshot.threads.filter((thread) => thread.id !== threadId);
  if (messages.length === 0) {
    return { activeThreadId: threadId, threads: threadsWithoutTarget };
  }
  const existing = snapshot.threads.find((thread) => thread.id === threadId);
  const nextRecord = buildThreadRecord(threadId, messages, existing);
  const threads = [nextRecord, ...threadsWithoutTarget].slice(0, XIAOZE_THREAD_MAX_COUNT);
  return { activeThreadId: threadId, threads };
}

export function finalizeActiveThread(
  snapshot: XiaozeThreadStoreSnapshot,
  currentMessages: Message[]
): XiaozeThreadStoreSnapshot {
  return upsertThreadRecord(snapshot, snapshot.activeThreadId, serializeXiaozeMessages(currentMessages));
}

export function removeThreadFromSnapshot(snapshot: XiaozeThreadStoreSnapshot, threadId: string) {
  return {
    activeThreadId: snapshot.activeThreadId,
    threads: snapshot.threads.filter((thread) => thread.id !== threadId)
  };
}

export function planThreadDeletion(
  snapshot: XiaozeThreadStoreSnapshot,
  threadId: string,
  currentMessages: Message[],
  createId = createThreadId
): { next: XiaozeThreadStoreSnapshot; deletingActive: boolean } {
  const deletingActive = threadId === snapshot.activeThreadId;
  const persisted = deletingActive
    ? removeThreadFromSnapshot(snapshot, threadId)
    : removeThreadFromSnapshot(finalizeActiveThread(snapshot, currentMessages), threadId);
  const nextActiveId = deletingActive ? createId() : persisted.activeThreadId;

  return {
    deletingActive,
    next: {
      activeThreadId: nextActiveId,
      threads: persisted.threads
    }
  };
}
