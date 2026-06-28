import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRuntimeMode, parseStaticApiAuthorization, resolveWiseEffApiBaseUrl } from "./runtimeMode";

describe("resolveWiseEffApiBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the page origin in production when the configured API host differs", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "https://tzrea1.com");
    vi.stubGlobal("window", {
      location: {
        origin: "http://101.43.45.27"
      }
    } as Window);

    expect(resolveWiseEffApiBaseUrl()).toBe("http://101.43.45.27");
  });

  it("keeps the configured API URL when it matches the page origin", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "https://tzrea1.com");
    vi.stubGlobal("window", {
      location: {
        origin: "https://tzrea1.com"
      }
    } as Window);

    expect(resolveWiseEffApiBaseUrl()).toBe("https://tzrea1.com");
  });

  it("keeps the configured API URL outside production builds", () => {
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8787");
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173"
      }
    } as Window);

    expect(resolveWiseEffApiBaseUrl()).toBe("http://127.0.0.1:8787");
  });
});

describe("parseRuntimeMode", () => {
  it("defaults to api mode when unset", () => {
    expect(parseRuntimeMode(undefined, "development")).toBe("api");
    expect(parseRuntimeMode("", "development")).toBe("api");
  });

  it("accepts mock mode outside production", () => {
    expect(parseRuntimeMode("mock", "development")).toBe("mock");
  });

  it("blocks mock mode in production", () => {
    expect(() => parseRuntimeMode("mock", "production")).toThrow("Mock runtime cannot be used in production builds");
  });

  it("allows static API authorization only outside production builds", () => {
    expect(parseStaticApiAuthorization("Bearer smoke", "development")).toBe("Bearer smoke");
    expect(parseStaticApiAuthorization(undefined, "production")).toBeUndefined();
    expect(() => parseStaticApiAuthorization("Bearer static-token", "production")).toThrow(
      "Static API authorization cannot be used in production builds"
    );
  });
});
