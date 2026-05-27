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
