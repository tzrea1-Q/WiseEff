import { describe, expect, it } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { detectDeviceTargets } from "./detectDeviceTargets";

describe("automatic device discovery", () => {
  it.each(["hdc", "adb"] as const)("finds %s devices without choosing a protocol", async (supported) => {
    expect(await detectDeviceTargets(async (protocol) => {
      if (protocol !== supported) throw new WiseEffApiError("PROTOCOL_UNSUPPORTED", "Tool unavailable", {}, "req-1");
      return [{ id: "usb-device", protocol }];
    })).toEqual([{ id: "usb-device", protocol: supported }]);
  });
  it("returns both kinds of devices for device selection", async () => {
    expect(await detectDeviceTargets(async (protocol) => [{ id: protocol, protocol }]))
      .toEqual([{ id: "hdc", protocol: "hdc" }, { id: "adb", protocol: "adb" }]);
  });
  it("does not present the same physical device twice", async () => {
    const targets = await detectDeviceTargets(async (protocol) => [{
      id: `bridge:local:${protocol}:serial`, bridgeId: "local", targetRef: "serial", protocol
    }]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ protocol: "hdc", bridgeId: "local", targetRef: "serial" });
  });
  it("reports an empty result when no devices are connected", async () => {
    expect(await detectDeviceTargets(async () => [])).toEqual([]);
  });
  it.each(["FORBIDDEN", "UNAUTHENTICATED", "INTERNAL_ERROR"])("preserves %s failures even if another transport succeeds", async (code) => {
    const error = new WiseEffApiError(code, "Detection failed", {}, "req-1");
    await expect(detectDeviceTargets(async (protocol) => {
      if (protocol === "adb") throw error;
      return [{ protocol }];
    })).rejects.toBe(error);
  });
});
