import { useMemo, useSyncExternalStore } from "react";

import {
  createWorkbenchNavigationSession,
  type WorkbenchNavigationSession,
  type WorkbenchNavigationSnapshot
} from "./workbenchNavigationSession";

export type UseWorkbenchNavigationSessionResult = WorkbenchNavigationSnapshot & {
  session: WorkbenchNavigationSession;
};

/** React adapter over {@link createWorkbenchNavigationSession}. Prefer testing the session command interface. */
export function useWorkbenchNavigationSession(): UseWorkbenchNavigationSessionResult {
  const session = useMemo(() => createWorkbenchNavigationSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
