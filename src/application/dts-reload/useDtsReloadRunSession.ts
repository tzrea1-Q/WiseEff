import { useMemo, useSyncExternalStore } from "react";

import {
  createDtsReloadRunSession,
  type DtsReloadRunSession,
  type DtsReloadRunSessionOptions,
  type DtsReloadRunSessionSnapshot
} from "./dtsReloadRunSession";

export type UseDtsReloadRunSessionResult = DtsReloadRunSessionSnapshot & {
  session: DtsReloadRunSession;
};

/**
 * React adapter over {@link createDtsReloadRunSession}. Options are read once on mount
 * (initializer semantics). Tests should prefer the session command interface directly.
 */
export function useDtsReloadRunSession(
  options: DtsReloadRunSessionOptions = {}
): UseDtsReloadRunSessionResult {
  const session = useMemo(
    () => createDtsReloadRunSession(options),
    // Options are mount-time initial values by contract; a stable session is required.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );

  return { session, ...snapshot };
}
