import { useMemo, useSyncExternalStore } from "react";

import {
  createConfigRevisionGateSession,
  type ConfigRevisionGateSession,
  type ConfigRevisionGateSnapshot
} from "./configRevisionGateSession";

export type UseConfigRevisionGateSessionResult = ConfigRevisionGateSnapshot & {
  session: ConfigRevisionGateSession;
};

export function useConfigRevisionGateSession(): UseConfigRevisionGateSessionResult {
  const session = useMemo(() => createConfigRevisionGateSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, ...snapshot };
}
