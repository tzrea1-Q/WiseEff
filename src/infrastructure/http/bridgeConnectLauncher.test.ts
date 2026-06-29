import { describe, expect, it, vi } from "vitest";

import { buildBridgeConnectUrl, launchBridgeConnect, probeLocalBridgeHealth } from "./bridgeConnectLauncher";

describe("bridgeConnectLauncher", () => {
  it("launches custom protocol URLs through a transient anchor click", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: "", rel: "", style: { display: "" }, click, remove } as unknown as HTMLAnchorElement;
    const appendChild = vi.spyOn(document.body, "appendChild").mockImplementation(() => anchor);
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    launchBridgeConnect("wiseeff-bridge://connect?server=http%3A%2F%2F127.0.0.1");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toContain("wiseeff-bridge://connect");
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);

    createElement.mockRestore();
    appendChild.mockRestore();
  });

  it("builds connect URLs with server, origin, and pairing code", () => {
    expect(
      buildBridgeConnectUrl("http://101.43.45.27", "337769", "http://101.43.45.27")
    ).toBe("wiseeff-bridge://connect?server=http%3A%2F%2F101.43.45.27&webOrigin=http%3A%2F%2F101.43.45.27&code=337769");
  });
  it("parses tools probe state from local health JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        paired: true,
        connected: true,
        updatedAt: "2026-06-25T00:00:00.000Z",
        tools: {
          adb: { available: false, reason: "adb not found" },
          hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
        }
      })
    })) as unknown as typeof fetch;

    await expect(probeLocalBridgeHealth(fetchImpl)).resolves.toEqual({
      ok: true,
      paired: true,
      connected: true,
      updatedAt: "2026-06-25T00:00:00.000Z",
      tools: {
        adb: { available: false, reason: "adb not found" },
        hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
      }
    });
  });
});
