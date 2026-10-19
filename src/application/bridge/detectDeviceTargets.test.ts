import { describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { detectDeviceTargets } from "./detectDeviceTargets";

describe("automatic device discovery", () => {
  it.each(["hdc", "adb"] as const)("finds %s devices without choosing a protocol", async (supported) => {
    const detect = vi.fn(async () => [{ id: "usb-device", protocol: supported }]);
    expect(await detectDeviceTargets(detect)).toEqual([{ id: "usb-device", protocol: supported }]);
    expect(detect).toHaveBeenCalledExactlyOnceWith();
  });
  it("returns both kinds of devices for device selection", async () => {
    expect(await detectDeviceTargets(async () => (["hdc", "adb"] as const).map((protocol) => ({ id: protocol, protocol }))))
      .toEqual([{ id: "hdc", protocol: "hdc" }, { id: "adb", protocol: "adb" }]);
  });
  it("does not present the same physical device twice", async () => {
    const targets = await detectDeviceTargets(async () => (["hdc", "adb"] as const).map((protocol) => ({
      id: `bridge:local:${protocol}:serial`, bridgeId: "local", targetRef: "serial", protocol
    })));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ protocol: "hdc", bridgeId: "local", targetRef: "serial" });
  });
  it("reports an empty result when no devices are connected", async () => {
    expect(await detectDeviceTargets(async () => [])).toEqual([]);
  });
  it.each(["FORBIDDEN", "UNAUTHENTICATED", "INTERNAL_ERROR", "PROTOCOL_UNSUPPORTED", "DEVICE_UNAVAILABLE"])("preserves server %s failures", async (code) => {
    const error = new WiseEffApiError(code, "Detection failed", {}, "req-1");
    await expect(detectDeviceTargets(async () => { throw error; })).rejects.toBe(error);
  });
});
