import { randomUUID } from "node:crypto";

import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";

export type CanonicalSourceAttemptCleanupDescriptor = Readonly<{
  storageKeys: readonly string[];
}>;

export type CanonicalSourceAttempt = {
  /** ObjectStore view that writes under a unique attempt filename. */
  objectStore: ObjectStore;
  /** Snapshot of objects whose put calls returned successfully. */
  readonly cleanupDescriptor: CanonicalSourceAttemptCleanupDescriptor;
  /** Caller may invoke only after the outer database transaction is confirmed rolled back. */
  cleanupAfterConfirmedRollback(): Promise<void>;
};

/**
 * Track attempt-owned objects without owning the surrounding database transaction.
 * A rejected put is deliberately not tracked: its storage acknowledgement may be unknown.
 */
export function createCanonicalSourceAttempt(
  objectStore: ObjectStore,
): CanonicalSourceAttempt {
  const storageKeys: string[] = [];
  const attemptObjectStore: ObjectStore = {
    async put(input) {
      if (!objectStore.delete) {
        throw new ApiError(
          "INTERNAL_ERROR",
          "Canonical source attempt cleanup requires an object-store delete operation.",
          { reason: "canonical-source-object-cleanup-unavailable" },
        );
      }
      const stored = await objectStore.put({
        ...input,
        fileName: `canonical-source-attempt-${randomUUID()}-${input.fileName}`,
      });
      storageKeys.push(stored.storageKey);
      return stored;
    },
    get: (storageKey) => objectStore.get(storageKey),
  };
  if (objectStore.getBounded) {
    attemptObjectStore.getBounded = (storageKey, maxBytes) =>
      objectStore.getBounded!(storageKey, maxBytes);
  }
  if (objectStore.delete) {
    attemptObjectStore.delete = (storageKey) => objectStore.delete!(storageKey);
  }

  return {
    objectStore: attemptObjectStore,
    get cleanupDescriptor() {
      return { storageKeys: [...storageKeys] };
    },
    async cleanupAfterConfirmedRollback() {
      const results = await Promise.allSettled(
        [...new Set(storageKeys)].map((storageKey) =>
          objectStore.delete!(storageKey),
        ),
      );
      const failed = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed.length) {
        throw new ApiError(
          "INTERNAL_ERROR",
          "Canonical source attempt cleanup failed.",
          {
            reason: "canonical-source-object-cleanup-failed",
            objectCount: failed.length,
          },
        );
      }
    },
  };
}
