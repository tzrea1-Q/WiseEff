import { useMemo, useSyncExternalStore } from "react";

import {
  createConfigSetOpsSession,
  type ConfigSetOpsSession,
  type ConfigSetOpsSnapshot
} from "./configSetOpsSession";

export type UseConfigSetOpsSessionResult = ConfigSetOpsSnapshot & {
  session: ConfigSetOpsSession;
};

/** React adapter over {@link createConfigSetOpsSession}. Prefer testing the session command interface. */
export function useConfigSetOpsSession(): UseConfigSetOpsSessionResult {
  const session = useMemo(() => createConfigSetOpsSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
