import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { XiaozePromptDebugSnapshot } from "./xiaozePromptDebugTypes";

type PromptDebugStore = Map<string, XiaozePromptDebugSnapshot>;

const emptyStore: PromptDebugStore = new Map();
let promptDebugStore: PromptDebugStore = new Map();
const listeners = new Set<() => void>();

function emitPromptDebugChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function setXiaozePromptDebugSnapshot(runId: string, snapshot: XiaozePromptDebugSnapshot) {
  const next = new Map(promptDebugStore);
  next.set(runId, snapshot);
  promptDebugStore = next;
  emitPromptDebugChange();
}

export function clearXiaozePromptDebugStore() {
  promptDebugStore = new Map();
  emitPromptDebugChange();
}

function subscribePromptDebugStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPromptDebugSnapshot(runId: string) {
  return promptDebugStore.get(runId);
}

const XiaozePromptDebugContext = createContext<PromptDebugStore>(emptyStore);

export function XiaozePromptDebugProvider({ children }: { children: ReactNode }) {
  const store = useSyncExternalStore(subscribePromptDebugStore, () => promptDebugStore, () => emptyStore);
  return <XiaozePromptDebugContext.Provider value={store}>{children}</XiaozePromptDebugContext.Provider>;
}

export function useXiaozePromptDebugSnapshot(runId: string | undefined) {
  const store = useContext(XiaozePromptDebugContext);
  return useMemo(() => (runId ? store.get(runId) : undefined), [runId, store]);
}

export function useXiaozePromptDebugSnapshotForTurn(userMessage: string, runId: string | undefined) {
  const store = useSyncExternalStore(subscribePromptDebugStore, () => promptDebugStore, () => emptyStore);
  return useMemo(() => {
    if (runId) {
      const byRun = store.get(runId);
      if (byRun) {
        return byRun;
      }
    }
    for (const snapshot of store.values()) {
      if (snapshot.userMessage === userMessage) {
        return snapshot;
      }
    }
    return undefined;
  }, [runId, store, userMessage]);
}

export function useXiaozeLatestPromptDebugSnapshot() {
  const store = useSyncExternalStore(subscribePromptDebugStore, () => promptDebugStore, () => emptyStore);
  return useMemo(() => {
    const entries = [...store.values()];
    return entries.length > 0 ? entries[entries.length - 1] : undefined;
  }, [store]);
}

export function readXiaozePromptDebugSnapshot(runId: string) {
  return getPromptDebugSnapshot(runId);
}
