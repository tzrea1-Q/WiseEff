import { useMemo, useSyncExternalStore } from "react";

import {
  createNodeDebuggingSession,
  type NodeDebuggingSession,
  type NodeDebuggingSessionOptions,
  type NodeDebuggingSessionSnapshot
} from "./nodeDebuggingSession";

export type UseNodeDebuggingSessionResult = NodeDebuggingSessionSnapshot & {
  session: NodeDebuggingSession;
};

/**
 * React adapter over {@link createNodeDebuggingSession}. Options are read once on mount
 * (initializer semantics). Tests should prefer the session command interface directly.
 */
export function useNodeDebuggingSession(
  options: NodeDebuggingSessionOptions = {}
): UseNodeDebuggingSessionResult {
  const session = useMemo(
    () => createNodeDebuggingSession(options),
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
