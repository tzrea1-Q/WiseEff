import { describe, expect, it, vi } from "vitest";

import { resolveLocalBridgeHealthUrl, resolveLocalBridgeUrl } from "./localBridgeHttpUrl";

describe("localBridgeHttpUrl", () => {
  it("uses the Vite proxy in dev", () => {
    vi.stubEnv("DEV", true);
    expect(resolveLocalBridgeHealthUrl()).toBe("/local-bridge/health");
    expect(resolveLocalBridgeUrl("/tools/install")).toBe("/local-bridge/tools/install");
    vi.unstubAllEnvs();
  });

  it("uses the local bridge origin in production builds", () => {
    vi.stubEnv("DEV", false);
    expect(resolveLocalBridgeHealthUrl()).toBe("http://127.0.0.1:18787/health");
    vi.unstubAllEnvs();
  });
});
