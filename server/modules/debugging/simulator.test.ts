import { describe, expect, it } from "vitest";
import { createSimulatorDebugDeviceGateway } from "./simulator";

describe("simulator debugging gateway", () => {
  it("detects online simulator targets", async () => {
    const gateway = createSimulatorDebugDeviceGateway();

    const result = await gateway.detectTargets({ projectId: "aurora" });

    expect(result.ok).toBe(true);
    expect(result.targets).toContainEqual(
      expect.objectContaining({
        id: "sim-target-aurora-1",
        targetRef: "simulator://aurora-1",
        online: true
      })
    );
  });

  it("reads the constant charge current node", async () => {
    const gateway = createSimulatorDebugDeviceGateway();

    const result = await gateway.readNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: "3000",
        stdout: "3000"
      })
    );
  });

  it("blocks writes to read-only nodes", async () => {
    const gateway = createSimulatorDebugDeviceGateway();

    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/cycle_count",
      value: "129",
      readBack: true
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toBe("Node is read-only.");
  });

  it("writes a writable node, verifies readback, and persists the new value", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const nodePath = "/sys/class/power_supply/battery/input_current_limit";

    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath,
      value: "3100",
      readBack: true
    });
    const readAfterWrite = await gateway.readNode({
      targetRef: "simulator://aurora-1",
      nodePath
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.value).toBe("3100");
    expect(result.readResult?.value).toBe("3100");
    expect(result.readResult?.stdout).toBe("3100");
    expect(readAfterWrite).toEqual(
      expect.objectContaining({
        ok: true,
        value: "3100",
        stdout: "3100"
      })
    );
  });

  it("rejects writes to unknown nodes without creating them", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const nodePath = "/sys/class/power_supply/battery/unknown_limit";

    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath,
      value: "3100",
      readBack: true
    });
    const readAfterWrite = await gateway.readNode({
      targetRef: "simulator://aurora-1",
      nodePath
    });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("not found");
    expect(result.writeResult).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("not found")
      })
    );
    expect(readAfterWrite).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("not found")
      })
    );
  });

  it("reports deterministic durations for read and write results", async () => {
    const timestamps = [10, 14, 20, 27, 30, 36];
    const gateway = createSimulatorDebugDeviceGateway({
      now: () => timestamps.shift() ?? 36
    });

    const readResult = await gateway.readNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current"
    });
    const writeResult = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/temp_limit",
      value: "46",
      readBack: true
    });

    expect(readResult.durationMs).toBe(4);
    expect(writeResult.writeResult.durationMs).toBe(7);
    expect(writeResult.readResult?.durationMs).toBe(10);
  });

  it("reports readback mismatch for configured mismatch nodes", async () => {
    const gateway = createSimulatorDebugDeviceGateway();

    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/readback_mismatch",
      value: "2",
      readBack: true
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.readResult?.stdout).not.toBe("2");
  });

  it("reports offline targets", async () => {
    const gateway = createSimulatorDebugDeviceGateway({
      targets: [
        {
          id: "sim-target-offline",
          deviceId: "sim-device-offline",
          targetRef: "simulator://offline",
          label: "Offline Simulator",
          online: false,
          nodes: {}
        }
      ]
    });

    const result = await gateway.readNode({ targetRef: "simulator://offline", nodePath: "/missing" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("offline");
  });
});
