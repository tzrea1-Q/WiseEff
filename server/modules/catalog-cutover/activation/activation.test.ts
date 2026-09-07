import { describe, expect, it, vi } from "vitest";
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
});
