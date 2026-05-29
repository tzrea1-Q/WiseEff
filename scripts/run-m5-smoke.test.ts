import { describe, expect, it } from "vitest";
import { canSkipWithoutApi, resolveApiBaseUrl } from "./run-m5-smoke.shared";

describe("M5 smoke helpers", () => {
  it("does not allow skipping the API probe by default", () => {
    expect(canSkipWithoutApi({})).toBe(false);
  });

  it("allows skipping the API probe only with an explicit local flag", () => {
    expect(canSkipWithoutApi({ M5_SMOKE_ALLOW_NO_API: "true" })).toBe(true);
  });

  it("resolves the API base URL from the shared env vars", () => {
    expect(
      resolveApiBaseUrl({
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:5173"
      })
    ).toBe("http://127.0.0.1:8787");
  });
});
