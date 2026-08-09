import { useMemo, useSyncExternalStore } from "react";

import {
  createWorkbenchActivitySession,
  type WorkbenchActivitySession,
  type WorkbenchActivitySnapshot
} from "./workbenchActivitySession";

export type UseWorkbenchActivitySessionResult = WorkbenchActivitySnapshot & {
  session: WorkbenchActivitySession;
};

/** React adapter over {@link createWorkbenchActivitySession}. Prefer testing the session command interface. */
export function useWorkbenchActivitySession(): UseWorkbenchActivitySessionResult {
  const session = useMemo(() => createWorkbenchActivitySession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
