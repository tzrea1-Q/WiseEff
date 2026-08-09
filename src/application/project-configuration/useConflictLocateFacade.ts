import { useMemo, useSyncExternalStore } from "react";

import {
  createConflictLocateFacade,
  type ConflictLocateFacade,
  type ConflictLocateFacadeSnapshot
} from "./conflictLocateFacade";

export type UseConflictLocateFacadeResult = ConflictLocateFacadeSnapshot & {
  facade: ConflictLocateFacade;
};

/** React adapter over {@link createConflictLocateFacade}. Prefer testing the facade command interface. */
export function useConflictLocateFacade(): UseConflictLocateFacadeResult {
  const facade = useMemo(() => createConflictLocateFacade(), []);
  const snapshot = useSyncExternalStore(facade.subscribe, facade.getSnapshot, facade.getSnapshot);
  return { facade, ...snapshot };
}
