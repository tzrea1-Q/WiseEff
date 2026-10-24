import { useEffect, useMemo, useSyncExternalStore } from "react";

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
 * React adapter over {@link createDtsReloadRunSession}. The first initial project may
 * arrive after API hydration; other options retain mount-time initializer semantics.
 */
export function useDtsReloadRunSession(
  options: DtsReloadRunSessionOptions = {}
): UseDtsReloadRunSessionResult {
  const session = useMemo(
    () => createDtsReloadRunSession(options),
    // A stable session preserves user edits while API hydration settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    session.initializeProject(options.initialProjectId ?? "");
  }, [options.initialProjectId, session]);

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );

  return { session, ...snapshot };
}
