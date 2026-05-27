import { describe, expect, it } from "vitest";
import {
  debugAccessModes,
  debugDeviceStatuses,
  debugOperationStatuses,
  debugOperationTypes,
  debugRiskLevels,
  debugSessionStatuses,
  debugSnapshotStatuses,
  debugTargetStatuses,
  isTerminalNodeOperationStatus
} from "./status";

describe("debugging status helpers", () => {
  it("exposes stable access and lifecycle codes", () => {
    expect(debugAccessModes).toEqual(["RO", "WO", "RW"]);
    expect(debugRiskLevels).toEqual(["Low", "Medium", "High"]);
    expect(debugDeviceStatuses).toEqual(["online", "offline", "unknown"]);
    expect(debugTargetStatuses).toEqual(["detected", "lost"]);
    expect(debugSessionStatuses).toEqual(["active", "closed"]);
    expect(debugOperationTypes).toEqual(["detect", "read", "write", "rollback"]);
    expect(debugOperationStatuses).toEqual(["pending", "succeeded", "failed", "readback_mismatch"]);
    expect(debugSnapshotStatuses).toEqual(["valid", "consumed", "invalid"]);
  });

  it("treats pending as the only nonterminal node operation status", () => {
    expect(isTerminalNodeOperationStatus("pending")).toBe(false);
    expect(isTerminalNodeOperationStatus("succeeded")).toBe(true);
    expect(isTerminalNodeOperationStatus("failed")).toBe(true);
    expect(isTerminalNodeOperationStatus("readback_mismatch")).toBe(true);
  });
});
