import { describe, expect, it } from "vitest";
import { parseRuntimeMode, parseStaticApiAuthorization } from "./runtimeMode";

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
