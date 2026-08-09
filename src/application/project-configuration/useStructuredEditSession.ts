import { useMemo, useRef, useSyncExternalStore } from "react";

import {
  createStructuredEditSession,
  type StructuredEditSession,
  type StructuredEditSessionOptions,
  type StructuredEditSessionSnapshot
} from "./structuredEditSession";

type StorageLike = NonNullable<StructuredEditSessionOptions["storage"]>;

export type UseStructuredEditSessionResult = StructuredEditSessionSnapshot & {
  session: StructuredEditSession;
};

/**
 * React adapter over {@link createStructuredEditSession}.
 * Tests should prefer the session command interface directly.
 */
export function useStructuredEditSession(options: {
  storage?: StorageLike;
  onDraftsRecovered?: () => void;
} = {}): UseStructuredEditSessionResult {
  const onDraftsRecoveredRef = useRef(options.onDraftsRecovered);
  onDraftsRecoveredRef.current = options.onDraftsRecovered;

  const storage = options.storage;
  const session = useMemo(
    () =>
      createStructuredEditSession({
        storage,
        onDraftsRecovered: () => onDraftsRecoveredRef.current?.()
      }),
    [storage]
  );

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );

  return { session, ...snapshot };
}
