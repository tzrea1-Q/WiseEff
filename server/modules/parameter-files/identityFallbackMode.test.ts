import { afterEach, describe, expect, it, vi } from "vitest";

import { readDtsIdentityFallbackMode } from "./identityFallbackMode";

describe("readDtsIdentityFallbackMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to allow when unset", () => {
    expect(readDtsIdentityFallbackMode({})).toBe("allow");
  });

  it("accepts allow, warn, and deny", () => {
    expect(readDtsIdentityFallbackMode({ DTS_IDENTITY_FALLBACK_MODE: "allow" })).toBe("allow");
    expect(readDtsIdentityFallbackMode({ DTS_IDENTITY_FALLBACK_MODE: "warn" })).toBe("warn");
    expect(readDtsIdentityFallbackMode({ DTS_IDENTITY_FALLBACK_MODE: "deny" })).toBe("deny");
  });

  it("falls back to allow for unknown values", () => {
    expect(readDtsIdentityFallbackMode({ DTS_IDENTITY_FALLBACK_MODE: "nonsense" })).toBe("allow");
  });
});
