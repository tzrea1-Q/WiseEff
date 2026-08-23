import { describe, expect, it } from "vitest";

import {
  allocateLoopbackPort,
  afterNestedProcessesStop,
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

  it("rejects a marker purpose other than the expected one", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "xiaoze-action",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/parameter-topology test-only marker/i);
  });

  it("accepts a custom marker purpose when the caller expects it", () => {
    expect(() =>
      assertDisposableDatabaseIdentity(
        {
          databaseName: "wiseeff_acceptance_disposable_round6_abc",
          markerPurpose: "xiaoze-action",
          markerMigrationRunId: "run-1",
          cutoverMigrationRunId: "run-1",
          expectedMigrationRunId: "run-1",
        },
        "xiaoze-action",
      ),
    ).not.toThrow();
  });

  it("never deletes nested database or object evidence after process cleanup fails", async () => {
    let resourceCleanupCalls = 0;

    await expect(afterNestedProcessesStop(
      [new Error("operation not permitted")],
      async () => { resourceCleanupCalls += 1; },
    )).rejects.toThrow(/retained for parent takeover/i);

    expect(resourceCleanupCalls).toBe(0);
  });
});
