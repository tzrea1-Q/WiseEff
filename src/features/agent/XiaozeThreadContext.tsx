import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Message } from "@ag-ui/core";
import { listXiaozeThreads as fetchXiaozeThreads, archiveXiaozeThread } from "@/infrastructure/http/xiaozeThreadsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import {
  areStoredMessagesEqual,
  createApiThreadSnapshot,
  createThreadId,
  finalizeActiveThread,
  hasPersistedThreadContent,
  listHistoricalThreads,
  mergeApiThreadList,
  planThreadDeletion,
  readXiaozeThreadStore,
  serializeXiaozeMessages,
  upsertThreadRecord,
  writeApiActiveThreadId,
  writeXiaozeThreadStore
} from "./xiaozeThreadStorage";
import type { XiaozeThreadRecord, XiaozeThreadStoreSnapshot } from "./xiaozeThreadTypes";

type XiaozeThreadContextValue = {
  activeThreadId: string;
  threads: XiaozeThreadRecord[];
  threadsHydrated: boolean;
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

let threadStoreSnapshot: XiaozeThreadStoreSnapshot = isApiRuntime ? createApiThreadSnapshot() : readXiaozeThreadStore();
let threadStoreGeneration = 0;
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
  threadStoreGeneration += 1;
  if (!isApiRuntime) {
    threadStoreSnapshot = writeXiaozeThreadStore(next);
  } else {
    threadStoreSnapshot = next;
    writeApiActiveThreadId(next.activeThreadId);
  }
  emitThreadStoreChange();
}

type SyncThreadsOptions = {
  force?: boolean;
  activeThreadId?: string;
  requestGeneration?: number;
};

async function syncThreadsFromApi(options: SyncThreadsOptions = {}) {
  const requestGeneration = options.requestGeneration ?? threadStoreGeneration;
  const activeThreadId = options.activeThreadId ?? threadStoreSnapshot.activeThreadId;
  const items = await fetchXiaozeThreads();
  if (!options.force && requestGeneration !== threadStoreGeneration) {
    return;
  }
  commitThreadStore(mergeApiThreadList(items, activeThreadId));
}

export function XiaozeThreadProvider({ children }: { children: ReactNode }) {
  const store = useSyncExternalStore(subscribeThreadStore, getThreadStoreSnapshot, getThreadStoreSnapshot);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threadsHydrated, setThreadsHydrated] = useState(!isApiRuntime);

  const refreshThreads = useCallback(async () => {
    if (!isApiRuntime) {
      return;
    }
    try {
      await syncThreadsFromApi({ requestGeneration: threadStoreGeneration });
    } finally {
      setThreadsHydrated(true);
    }
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
    if (serialized.length === 0 && !hasPersistedThreadContent(existing)) {
      return;
    }
    if (existing && areStoredMessagesEqual(existing.messages, serialized)) {
      return;
    }
    const requestGeneration = threadStoreGeneration;
    commitThreadStore(upsertThreadRecord(snapshot, snapshot.activeThreadId, serialized));
    if (isApiRuntime) {
      syncThreadsFromApi({ requestGeneration }).catch(() => undefined);
    }
  }, []);

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
    const { deletingActive, next } = planThreadDeletion(snapshot, threadId, currentMessages);

    commitThreadStore(next);

    if (!isApiRuntime) {
      if (deletingActive) {
        setHistoryOpen(false);
      }
      return;
    }

    try {
      await archiveXiaozeThread(threadId);
      await syncThreadsFromApi({ force: true, activeThreadId: threadStoreSnapshot.activeThreadId });
    } catch (error) {
      commitThreadStore(snapshot);
      console.error("Failed to archive Xiaoze thread.", error);
      return;
    }

    if (deletingActive) {
      setHistoryOpen(false);
    }
  }, []);

  const value = useMemo<XiaozeThreadContextValue>(
    () => ({
      activeThreadId: store.activeThreadId,
      threads: listHistoricalThreads(store.threads),
      threadsHydrated,
      historyOpen,
      setHistoryOpen,
      createNewThread,
      selectThread,
      deleteThread,
      persistActiveThread,
      refreshThreads
    }),
    [createNewThread, deleteThread, historyOpen, persistActiveThread, refreshThreads, selectThread, store, threadsHydrated]
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
  threadStoreGeneration += 1;
  emitThreadStoreChange();
}
