import { describe, expect, it, vi } from "vitest";

import { resolveBridgeServerUrl, resolveBridgeWebOrigin } from "./bridgeServerUrl";

describe("resolveBridgeServerUrl", () => {
  it("uses the API origin when the page and API run on different ports", () => {
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8787");
    expect(resolveBridgeServerUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:8787");
    vi.unstubAllEnvs();
  });

  it("keeps the page origin when frontend and API are same-origin", () => {
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "https://wiseeff.example.com");
    expect(resolveBridgeServerUrl("https://wiseeff.example.com")).toBe("https://wiseeff.example.com");
    vi.unstubAllEnvs();
  });

  it("returns the page origin for bridge web CORS", () => {
    expect(resolveBridgeWebOrigin("https://tzrea1.com")).toBe("https://tzrea1.com");
  });
});
