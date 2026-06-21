import { describe, expect, it, vi } from "vitest";
import type { DebugDeviceGateway } from "./gateway";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";

function gateway(): DebugDeviceGateway {
  return {
    detectTargets: vi.fn(),
    readNode: vi.fn(),
    writeNode: vi.fn()
  };
}

describe("debug device gateway registry", () => {
  it("returns the gateway registered for a protocol", () => {
    const hdc = gateway();
    const adb = gateway();
    const registry = createDebugDeviceGatewayRegistry({ hdc, adb });

    expect(registry.hasGateway("hdc")).toBe(true);
    expect(registry.hasGateway("adb")).toBe(true);
    expect(registry.requireGateway("hdc")).toBe(hdc);
    expect(registry.requireGateway("adb")).toBe(adb);
  });

  it("throws a typed error when protocol support is missing", () => {
    const registry = createDebugDeviceGatewayRegistry({ hdc: gateway() });

    let error: unknown;
    try {
      registry.requireGateway("adb");
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "PROTOCOL_UNSUPPORTED",
      status: 409,
      details: { protocol: "adb" },
      message: "Debug protocol adb is not enabled."
    });
    expect(registry.hasGateway("adb")).toBe(false);
  });
});
