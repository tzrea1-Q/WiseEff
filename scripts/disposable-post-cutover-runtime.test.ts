import { describe, expect, it } from "vitest";

import {
  allocateLoopbackPort,
  assertDisposableDatabaseIdentity,
  buildDisposableDatabaseName,
} from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";

describe("disposable post-cutover acceptance database safety", () => {
  it("allocates a loopback runtime port instead of relying on a shared fixed port", async () => {
    const port = await allocateLoopbackPort({ min: 5_190, max: 5_199 });
    expect(port).toBeGreaterThanOrEqual(5_190);
    expect(port).toBeLessThanOrEqual(5_199);
    expect(port).not.toBe(18_888);
    expect(port).not.toBe(5_174);
  });

  it("uses the dedicated destructive-test database prefix", () => {
    const databaseName = buildDisposableDatabaseName("parameter_topology_round6");
    expect(databaseName).toMatch(
      /^wiseeff_acceptance_disposable_[a-z0-9_]+$/,
    );
    expect(databaseName.length).toBeLessThanOrEqual(63);
  });

  it("rejects shared database names and migration marker mismatches", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/disposable database name/i);

    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-other",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/migration run marker/i);
  });

  it("accepts only an exact test marker and cutover run match", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).not.toThrow();
  });
});
