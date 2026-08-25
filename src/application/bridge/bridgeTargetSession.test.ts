import { describe, expect, it } from "vitest";

import type { DeviceTarget } from "@/application/ports/DebuggingGateway";

import {
  bridgeTargetSelectionFrom,
  defaultDeviceId,
  normalizeBridgeProtocol,
  pickPreferredBridgeId
} from "./bridgeTargetSession";

describe("defaultDeviceId", () => {
  it("mirrors the reload `bridge:<bridgeId>` device id", () => {
    expect(defaultDeviceId("bridge-b")).toBe("bridge:bridge-b");
  });
});

describe("normalizeBridgeProtocol", () => {
  it("accepts only hdc and adb", () => {
    expect(normalizeBridgeProtocol("hdc")).toBe("hdc");
    expect(normalizeBridgeProtocol("adb")).toBe("adb");
  });

  it("falls back when the value is missing or not a debug protocol", () => {
    expect(normalizeBridgeProtocol(null)).toBe("hdc");
    expect(normalizeBridgeProtocol(undefined)).toBe("hdc");
    expect(normalizeBridgeProtocol("usb")).toBe("hdc");
    expect(normalizeBridgeProtocol("usb", "adb")).toBe("adb");
  });
});

describe("pickPreferredBridgeId", () => {
  const bridges = [{ id: "bridge-a" }, { id: "bridge-b" }];

  it("prefers the connected bridge when nothing is selected yet", () => {
    expect(pickPreferredBridgeId(bridges, { connected: true, bridgeId: "bridge-b" }, "")).toBe(
      "bridge-b"
    );
  });

  it("keeps the current selection while that bridge is still listed", () => {
    expect(pickPreferredBridgeId(bridges, null, "bridge-b")).toBe("bridge-b");
  });

  it("moves to a newly connected bridge even when the old bridge remains listed", () => {
    expect(pickPreferredBridgeId(bridges, { connected: true, bridgeId: "bridge-a" }, "bridge-b")).toBe(
      "bridge-a"
    );
  });

  it("falls back to the first listed bridge when the current id is gone", () => {
    expect(pickPreferredBridgeId([{ id: "bridge-a" }], null, "bridge-b")).toBe("bridge-a");
  });

  it("ignores a health bridgeId that is not in the list", () => {
    expect(
      pickPreferredBridgeId(bridges, { connected: true, bridgeId: "bridge-missing" }, "")
    ).toBe("bridge-a");
  });

  it("returns an empty id when there are no bridges", () => {
    expect(pickPreferredBridgeId([], { connected: true, bridgeId: "bridge-b" }, "bridge-b")).toBe(
      ""
    );
  });
});

describe("bridgeTargetSelectionFrom", () => {
  it("maps DeviceTarget protocol / bridgeId / targetRef onto the shared selection", () => {
    const target: DeviceTarget = {
      id: "target-1",
      label: "Lab Target",
      protocol: "adb",
      bridgeId: "bridge-1",
      targetRef: "AURORA-9"
    };
    expect(bridgeTargetSelectionFrom(target)).toEqual({
      protocol: "adb",
      bridgeId: "bridge-1",
      targetRef: "AURORA-9"
    });
  });

  it("fills missing DeviceTarget fields with empty ids and the fallback protocol", () => {
    const target: DeviceTarget = { id: "target-1", label: "Lab Target" };
    expect(bridgeTargetSelectionFrom(target, "hdc")).toEqual({
      protocol: "hdc",
      bridgeId: "",
      targetRef: ""
    });
  });
});
