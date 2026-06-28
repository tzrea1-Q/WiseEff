import { describe, expect, it, vi } from "vitest";

import { shouldBypassProxyForUrl } from "./proxyBypass";

describe("proxyFetch", () => {
  it("bypasses proxy for loopback and IPv4 server URLs", () => {
    expect(shouldBypassProxyForUrl("http://127.0.0.1:8787/api/v1/device-bridges/pair")).toBe(true);
    expect(shouldBypassProxyForUrl("http://101.43.45.27/api/v1/device-bridges/pair")).toBe(true);
    expect(shouldBypassProxyForUrl("ws://101.43.45.27/api/v1/device-bridges/ws")).toBe(true);
    expect(shouldBypassProxyForUrl("https://wiseeff.example.com/api/v1/device-bridges/pair")).toBe(false);
  });

  it("bypasses proxy when hostname matches configured serverUrl", () => {
    expect(
      shouldBypassProxyForUrl("https://tzrea1.com/api/v1/device-bridges/pair", "https://tzrea1.com")
    ).toBe(true);
  });

  it("bypasses proxy for NO_PROXY hosts", () => {
    vi.stubEnv("NO_PROXY", "101.43.45.27,tzrea1.com");
    expect(shouldBypassProxyForUrl("https://tzrea1.com/api/v1/device-bridges/pair")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("uses direct fetch for bypassed server URLs even when proxy env is set", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7897");
    expect(shouldBypassProxyForUrl("http://101.43.45.27/api/v1/device-bridges/pair")).toBe(true);
    vi.unstubAllEnvs();
  });
});
