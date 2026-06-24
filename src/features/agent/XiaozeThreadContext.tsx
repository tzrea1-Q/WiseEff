import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Message } from "@ag-ui/core";
import { listXiaozeThreads as fetchXiaozeThreads, archiveXiaozeThread } from "@/infrastructure/http/xiaozeThreadsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import {
  areStoredMessagesEqual,
  createEmptyThreadSnapshot,
  createThreadId,
  finalizeActiveThread,
  listHistoricalThreads,
  readXiaozeThreadStore,
  removeThreadFromSnapshot,
  serializeXiaozeMessages,
  upsertThreadRecord,
  writeXiaozeThreadStore
} from "./xiaozeThreadStorage";
import type { XiaozeThreadRecord, XiaozeThreadStoreSnapshot } from "./xiaozeThreadTypes";

type XiaozeThreadContextValue = {
  activeThreadId: string;
  threads: XiaozeThreadRecord[];
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  createNewThread: (currentMessages: Message[]) => string;
  selectThread: (threadId: string, currentMessages: Message[]) => void;
  deleteThread: (threadId: string, currentMessages: Message[]) => Promise<void>;
  persistActiveThread: (messages: Message[]) => void;
  refreshThreads: () => Promise<void>;
};

const XiaozeThreadContext = createContext<XiaozeThreadContextValue | null>(null);
const isApiRuntime = wiseEffRuntimeMode === "api";

let threadStoreSnapshot: XiaozeThreadStoreSnapshot = isApiRuntime ? createEmptyThreadSnapshot() : readXiaozeThreadStore();
const listeners = new Set<() => void>();

function emitThreadStoreChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribeThreadStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getThreadStoreSnapshot() {
  return threadStoreSnapshot;
}

export function readActiveXiaozeThreadStoreSnapshot() {
  return threadStoreSnapshot;
}

function commitThreadStore(next: XiaozeThreadStoreSnapshot) {
  if (!isApiRuntime) {
    threadStoreSnapshot = writeXiaozeThreadStore(next);
  } else {
    threadStoreSnapshot = next;
  }
  emitThreadStoreChange();
}

function mapApiThread(item: Awaited<ReturnType<typeof fetchXiaozeThreads>>[number]): XiaozeThreadRecord {
  return {
    id: item.id,
    title: item.title,
    preview: item.preview,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messages: []
  };
}

export function XiaozeThreadProvider({ children }: { children: ReactNode }) {
  const store = useSyncExternalStore(subscribeThreadStore, getThreadStoreSnapshot, getThreadStoreSnapshot);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refreshThreads = useCallback(async () => {
    if (!isApiRuntime) {
      return;
    }
    const items = await fetchXiaozeThreads();
    commitThreadStore({
      activeThreadId: threadStoreSnapshot.activeThreadId,
      threads: items.map(mapApiThread)
    });
  }, []);

  useEffect(() => {
    if (!isApiRuntime) {
      return;
    }
    refreshThreads().catch(() => undefined);
  }, [refreshThreads]);

  const persistActiveThread = useCallback((messages: Message[]) => {
    const snapshot = threadStoreSnapshot;
    const serialized = serializeXiaozeMessages(messages);
    const existing = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId);
    if (serialized.length === 0 && (!existing || existing.messages.length === 0)) {
      return;
    }
    if (existing && areStoredMessagesEqual(existing.messages, serialized)) {
      return;
    }
    commitThreadStore(upsertThreadRecord(snapshot, snapshot.activeThreadId, serialized));
    if (isApiRuntime) {
      refreshThreads().catch(() => undefined);
    }
  }, [refreshThreads]);

  const createNewThread = useCallback((currentMessages: Message[]) => {
    const persisted = finalizeActiveThread(threadStoreSnapshot, currentMessages);
    const nextThreadId = createThreadId();
    commitThreadStore({
      activeThreadId: nextThreadId,
      threads: persisted.threads
    });
    setHistoryOpen(false);
    return nextThreadId;
  }, []);

  const selectThread = useCallback((threadId: string, currentMessages: Message[]) => {
    if (threadId === threadStoreSnapshot.activeThreadId) {
      setHistoryOpen(false);
      return;
    }
    const persisted = finalizeActiveThread(threadStoreSnapshot, currentMessages);
    commitThreadStore({ ...persisted, activeThreadId: threadId });
    setHistoryOpen(false);
  }, []);

  const deleteThread = useCallback(async (threadId: string, currentMessages: Message[]) => {
    const snapshot = threadStoreSnapshot;
    const deletingActive = threadId === snapshot.activeThreadId;
    const persisted =
      deletingActive ? removeThreadFromSnapshot(snapshot, threadId) : removeThreadFromSnapshot(finalizeActiveThread(snapshot, currentMessages), threadId);
    const nextActiveId = deletingActive ? createThreadId() : persisted.activeThreadId;

    commitThreadStore({
      activeThreadId: nextActiveId,
      threads: persisted.threads
    });

    if (isApiRuntime) {
      try {
        await archiveXiaozeThread(threadId);
      } catch {
        await refreshThreads();
        return;
      }
      await refreshThreads();
    }

    if (deletingActive) {
      setHistoryOpen(false);
    }
  }, [refreshThreads]);

  const value = useMemo<XiaozeThreadContextValue>(
    () => ({
      activeThreadId: store.activeThreadId,
      threads: listHistoricalThreads(store.threads),
      historyOpen,
      setHistoryOpen,
      createNewThread,
      selectThread,
      deleteThread,
      persistActiveThread,
      refreshThreads
    }),
    [createNewThread, deleteThread, historyOpen, persistActiveThread, refreshThreads, selectThread, store]
  );

  return <XiaozeThreadContext.Provider value={value}>{children}</XiaozeThreadContext.Provider>;
}

export function useXiaozeThreads() {
  const context = useContext(XiaozeThreadContext);
  if (!context) {
    throw new Error("useXiaozeThreads must be used within XiaozeThreadProvider");
  }
  return context;
}

export function resetXiaozeThreadStoreForTests(snapshot = readXiaozeThreadStore()) {
  threadStoreSnapshot = snapshot;
  emitThreadStoreChange();
}
