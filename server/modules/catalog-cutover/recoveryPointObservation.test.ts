import { describe, expect, it } from "vitest";

import {
  assertObservedRecoveryPoint,
  fixtureObservedRecoveryPoint,
  observedRecoveryPointFromStores,
} from "./recoveryPointObservation";

describe("cutover P3 recovery-point observation", () => {
  it("accepts digest-bound three-store proof and refuses inventory-only objects", () => {
    const observed = fixtureObservedRecoveryPoint();
    expect(assertObservedRecoveryPoint(observed).ok).toBe(true);
    expect(assertObservedRecoveryPoint(undefined).ok).toBe(false);
    expect(assertObservedRecoveryPoint({ counts: { specs: 1 } }).ok).toBe(false);
    expect(
      assertObservedRecoveryPoint({
        ...observed,
        evidenceDigest: `sha256:${"cd".repeat(32)}`,
      }).ok,
    ).toBe(false);
    const live = observedRecoveryPointFromStores({
      postgres: { identity: "127.0.0.1:55438/wiseeff_t23b", checksum: observed.postgresChecksum },
      objectStore: { identity: "archive", checksum: observed.objectStoreChecksum },
      redis: { identity: "redis", checksum: observed.redisChecksum },
    });
    expect(assertObservedRecoveryPoint(live).ok).toBe(true);
  });
});
