import { describe, expect, it } from "vitest";
import {
  createDebugSessionBodySchema,
  detectTargetsBodySchema,
  listDebuggingParametersQuerySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
  writeNodeBodySchema
} from "./schemas";

describe("debugging schemas", () => {
  it("accepts optional parameter query filters", () => {
    expect(
      listDebuggingParametersQuerySchema.parse({
        projectId: "aurora",
        module: "power",
        risk: ["Low", "High"]
      })
    ).toEqual({
      projectId: "aurora",
      module: "power",
      risk: ["Low", "High"]
    });
  });

  it("trims and requires target detection project input", () => {
    expect(() => detectTargetsBodySchema.parse({ projectId: "   " })).toThrow();
    expect(detectTargetsBodySchema.parse({ projectId: "aurora", deviceId: "sim-device-1" })).toEqual({
      projectId: "aurora",
      deviceId: "sim-device-1"
    });
  });

  it("requires node session and path for reads", () => {
    expect(() => readNodeBodySchema.parse({ sessionId: "dbg-1", nodePath: "" })).toThrow();
  });

  it("defaults readBack to true for writes", () => {
    const parsed = writeNodeBodySchema.parse({
      sessionId: "dbg-1",
      parameterId: "dbg-fast-charge-current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current",
      value: "3100"
    });

    expect(parsed.readBack).toBe(true);
  });

  it("requires rollback confirmation", () => {
    expect(rollbackSnapshotBodySchema.parse({ confirmationToken: "confirm-rollback" })).toEqual({
      confirmationToken: "confirm-rollback"
    });
  });

  it("requires project, device, and target when creating sessions", () => {
    expect(() => createDebugSessionBodySchema.parse({ projectId: "aurora" })).toThrow();
  });
});
