import { describe, expect, it } from "vitest";
import { parseRuntimeMode } from "./runtimeMode";

describe("parseRuntimeMode", () => {
  it("defaults to mock mode", () => {
    expect(parseRuntimeMode(undefined, "development")).toBe("mock");
  });

  it("accepts api mode", () => {
    expect(parseRuntimeMode("api", "development")).toBe("api");
  });

  it("blocks mock mode in production", () => {
    expect(() => parseRuntimeMode("mock", "production")).toThrow("Mock runtime cannot be used in production builds");
  });
});
