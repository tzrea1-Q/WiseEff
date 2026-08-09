import { useMemo, useSyncExternalStore } from "react";

import {
  createWorkbenchWorkspaceLoadSession,
  type WorkbenchWorkspaceLoadSession,
  type WorkbenchWorkspaceLoadSnapshot
} from "./workbenchWorkspaceLoadSession";

export type UseWorkbenchWorkspaceLoadSessionResult = WorkbenchWorkspaceLoadSnapshot & {
  session: WorkbenchWorkspaceLoadSession;
};

/** React adapter over {@link createWorkbenchWorkspaceLoadSession}. Prefer testing the session command interface. */
export function useWorkbenchWorkspaceLoadSession(): UseWorkbenchWorkspaceLoadSessionResult {
  const session = useMemo(() => createWorkbenchWorkspaceLoadSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
