import { useMemo, useSyncExternalStore } from "react";

import {
  createWorkbenchCanvasHistorySession,
  type WorkbenchCanvasHistorySession,
  type WorkbenchCanvasHistorySnapshot
} from "./workbenchCanvasHistorySession";

export type UseWorkbenchCanvasHistorySessionResult = WorkbenchCanvasHistorySnapshot & {
  session: WorkbenchCanvasHistorySession;
};

/** React adapter over {@link createWorkbenchCanvasHistorySession}. Prefer testing the session command interface. */
export function useWorkbenchCanvasHistorySession(): UseWorkbenchCanvasHistorySessionResult {
  const session = useMemo(() => createWorkbenchCanvasHistorySession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
