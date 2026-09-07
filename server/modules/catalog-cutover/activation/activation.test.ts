import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createApplicationReadActivation, createActivationIntent } from "./index";
import type { ActivationOptions } from "./interface";

const input = () => ({
  runId: "cutover-source", attemptId: "activation-attempt",
  target: { systemIdentifier: "123", databaseOid: "456" },
  planDigest: `sha256:${"1".repeat(64)}`, predecessorBindingDigest: null,
  reportDigest: `sha256:${"2".repeat(64)}`,
  expectedObservationDigest: `sha256:${"3".repeat(64)}`,
});

describe("application read activation public boundary (not full release evidence)", () => {
  it("rejects a caller-supplied digest that does not bind the request before any lease or effect", async () => {
    const options = { boundary: { withLockedBoundary: vi.fn() }, managementPool: { connect: vi.fn() } } as unknown as ActivationOptions;
    const activation = createApplicationReadActivation(options);
    await expect(activation.apply({ ...input(), inputDigest: `sha256:${"0".repeat(64)}` }))
      .rejects.toThrow("PCAT-ACTIVATION-INTENT-REJECTED");
    expect(options.boundary.withLockedBoundary).not.toHaveBeenCalled();
    expect(options.managementPool.connect).not.toHaveBeenCalled();
  });
  it("copies its input and rejects unknown command fields rather than treating them as permission", () => {
    const source = input();
    const intent = createActivationIntent(source);
    source.target.databaseOid = "999";
    expect(intent.target.databaseOid).toBe("456");
    expect(() => createActivationIntent({ ...input(), passed: true } as never)).toThrow("PCAT-ACTIVATION-INTENT-REJECTED");
  });
  it("does not coerce numeric target identities into trusted observed strings", () => {
    expect(() => createActivationIntent({ ...input(), target: { systemIdentifier: 123, databaseOid: "456" } } as never))
      .toThrow("PCAT-ACTIVATION-INTENT-REJECTED");
  });
  it("does not leak boundary diagnostics before acquiring a database lease", async () => {
    const connect = vi.fn();
    const activation = createApplicationReadActivation({ target: input().target, managementPool: { connect },
      boundary: { withLockedBoundary: async () => { throw new Error("private-target-password"); } },
    } as unknown as ActivationOptions);
    await expect(activation.inspectFacts("run", input().planDigest)).rejects.toThrow("PCAT-ACTIVATION-BOUNDARY-UNAVAILABLE");
    expect(connect).not.toHaveBeenCalled();
  });
  it("acquires the existing session lock before opening its consistent observation snapshot", async () => {
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("pg_control_system")) return { rowCount: 1, rows: [input().target] };
        if (sql.includes("pg_try_advisory")) return { rowCount: 1, rows: [{ acquired: true }] };
        if (sql.includes("from parameter_catalog.parameter_catalog_cutover_runs")) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ safe: true }] };
      }), release: vi.fn(),
    });
    const activation = createApplicationReadActivation({ target: input().target,
      managementPool: { connect: (callback: (error: null, client: unknown) => void) => callback(null, client) },
      boundary: { withLockedBoundary: async (body: () => Promise<unknown>) => body(), verify: async () => undefined },
    } as unknown as ActivationOptions);
    await expect(activation.inspectFacts("run", input().planDigest)).rejects.toThrow("PCAT-ACTIVATION-RUN-MISMATCH");
    const calls = client.query.mock.calls.map(([sql]) => sql);
    const lock = calls.findIndex(sql => sql.includes("pg_try_advisory_lock("));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(calls.findIndex(sql => sql.startsWith("begin")));
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
