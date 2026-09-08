import { expect, it, vi } from "vitest";

// Inspection must not initialize comparison consumers, which belong to apply.
// This is a dependency-loading regression, not a substitute for gate execution.
vi.mock("../../release-verification/comparison/index", () => {
  throw new Error("comparison-consumers-initialized-during-inspection");
});

it("opens the inspection API without initializing comparison consumers", async () => {
  const { createApplicationReadActivation } = await import("./index");
  const connect = vi.fn();
  const activation = createApplicationReadActivation({
    target: { systemIdentifier: "123", databaseOid: "456" },
    managementPool: { connect },
    boundary: { withLockedBoundary: async () => { throw new Error("boundary-unavailable"); } },
  } as never);
  await expect(activation.inspectFacts("run", `sha256:${"1".repeat(64)}`))
    .rejects.toThrow("PCAT-ACTIVATION-BOUNDARY-UNAVAILABLE");
  expect(connect).not.toHaveBeenCalled();
});
