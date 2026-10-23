import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Message } from "@ag-ui/core";
import { listXiaozeThreads as fetchXiaozeThreads, archiveXiaozeThread } from "@/infrastructure/http/xiaozeThreadsClient";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createDefaultApiClient } from "@/infrastructure/http/defaultApiClient";
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
  readApiActiveThreadId,
  serializeXiaozeMessages,
  upsertThreadRecord,
  writeApiActiveThreadId,
  writeXiaozeThreadStore
} from "./xiaozeThreadStorage";
import type { XiaozeThreadRecord, XiaozeThreadStoreSnapshot } from "./xiaozeThreadTypes";

type XiaozeThreadContextValue = {
  apiClient?: ReturnType<typeof createDefaultApiClient>;
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

function LegacyXiaozeThreadProvider({ children }: { children: ReactNode }) {
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

/** API state belongs to one actor/target provider, never a module-wide mutable target. */
function ApiXiaozeThreadProvider({ children, scopeKey, organizationId }: { children: ReactNode; scopeKey: string; organizationId?: string }) {
  const apiClient = useMemo(() => createDefaultApiClient({ organizationId }), [organizationId]);
  const storageKey = `wiseeff.xiaoze.active-thread:${scopeKey}`;
  const [store, setStore] = useState(() => createApiThreadSnapshot(readApiActiveThreadId(sessionStorage, storageKey) ?? createThreadId()));
  const current = useRef(store), generation = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false), [threadsHydrated, setThreadsHydrated] = useState(false);
  const commit = useCallback((next: XiaozeThreadStoreSnapshot) => {
    generation.current += 1; current.current = next; setStore(next);
    writeApiActiveThreadId(next.activeThreadId, sessionStorage, storageKey);
  }, [storageKey]);
  const refreshThreads = useCallback(async () => {
    const request = generation.current;
    const items = await fetchXiaozeThreads(apiClient);
    if (request !== generation.current) return;
    commit(mergeApiThreadList(items, current.current.activeThreadId));
    setThreadsHydrated(true);
  }, [apiClient, commit]);
  useEffect(() => {
    let cancelled = false;
    void refreshThreads().catch(() => { if (!cancelled) setThreadsHydrated(true); });
    return () => { cancelled = true; generation.current += 1; };
  }, [refreshThreads]);
  const createNewThread = useCallback((messages: Message[]) => {
    const next = createThreadId();
    commit({ ...finalizeActiveThread(current.current, messages), activeThreadId: next });
    setHistoryOpen(false); return next;
  }, [commit]);
  const selectThread = useCallback((id: string, messages: Message[]) => {
    commit({ ...finalizeActiveThread(current.current, messages), activeThreadId: id }); setHistoryOpen(false);
  }, [commit]);
  const persistActiveThread = useCallback((messages: Message[]) => {
    const snapshot = current.current, serialized = serializeXiaozeMessages(messages);
    const existing = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId);
    if ((!serialized.length && !hasPersistedThreadContent(existing)) || (existing && areStoredMessagesEqual(existing.messages, serialized))) return;
    commit(upsertThreadRecord(snapshot, snapshot.activeThreadId, serialized));
    void refreshThreads().catch(() => undefined);
  }, [commit, refreshThreads]);
  const deleteThread = useCallback(async (id: string, messages: Message[]) => {
    const snapshot = current.current, plan = planThreadDeletion(snapshot, id, messages);
    commit(plan.next); const request = generation.current;
    try { await archiveXiaozeThread(id, apiClient); await refreshThreads(); }
    catch (error) {
      if (request === generation.current) { commit(snapshot); console.error("Failed to archive Xiaoze thread.", error); }
      return;
    }
    if (plan.deletingActive) setHistoryOpen(false);
  }, [apiClient, commit, refreshThreads]);
  const value = useMemo(() => ({ apiClient, activeThreadId: store.activeThreadId, threads: listHistoricalThreads(store.threads),
    threadsHydrated, historyOpen, setHistoryOpen, createNewThread, selectThread, persistActiveThread, deleteThread, refreshThreads }),
  [apiClient, store, threadsHydrated, historyOpen, createNewThread, selectThread, persistActiveThread, deleteThread, refreshThreads]);
  return <XiaozeThreadContext.Provider value={value}>{children}</XiaozeThreadContext.Provider>;
}

export function XiaozeThreadProvider({ children, scopeKey = "home", organizationId }: { children: ReactNode; scopeKey?: string; organizationId?: string }) {
  return isApiRuntime ? <ApiXiaozeThreadProvider key={scopeKey} scopeKey={scopeKey} organizationId={organizationId}>{children}</ApiXiaozeThreadProvider>
    : <LegacyXiaozeThreadProvider>{children}</LegacyXiaozeThreadProvider>;
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
