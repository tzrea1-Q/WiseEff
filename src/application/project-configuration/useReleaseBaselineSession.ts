import { useMemo, useSyncExternalStore } from "react";

import {
  createReleaseBaselineSession,
  type ReleaseBaselineSession,
  type ReleaseBaselineSessionSnapshot
} from "./releaseBaselineSession";

export type UseReleaseBaselineSessionResult = ReleaseBaselineSessionSnapshot & {
  session: ReleaseBaselineSession;
};

/** React adapter over {@link createReleaseBaselineSession}. Prefer testing the session command interface. */
export function useReleaseBaselineSession(): UseReleaseBaselineSessionResult {
  const session = useMemo(() => createReleaseBaselineSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
