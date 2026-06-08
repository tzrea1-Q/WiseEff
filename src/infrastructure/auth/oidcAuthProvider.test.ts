import { describe, expect, it, vi } from "vitest";
import { createDefaultOidcAuthProvider, createOidcAuthProvider } from "./oidcAuthProvider";

describe("createOidcAuthProvider", () => {
  it("returns a bearer authorization value from the current access token", async () => {
    const provider = createOidcAuthProvider({
      getAccessToken: async () => "access-token"
    });

    await expect(provider.getAuthorization()).resolves.toBe("Bearer access-token");
  });

  it("refreshes the session before reading the access token when configured", async () => {
    const refresh = vi.fn(async () => undefined);
    const getAccessToken = vi.fn(async () => "fresh-token");
    const provider = createOidcAuthProvider({ getAccessToken, refresh });

    await expect(provider.getAuthorization()).resolves.toBe("Bearer fresh-token");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("logs out and rethrows when refresh fails", async () => {
    const logout = vi.fn();
    const provider = createOidcAuthProvider({
      getAccessToken: async () => "stale-token",
      refresh: async () => {
        throw new Error("refresh failed");
      },
      logout
    });

    await expect(provider.getAuthorization()).rejects.toThrow("refresh failed");
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the OIDC runtime has no access token yet", async () => {
    const provider = createOidcAuthProvider({
      getAccessToken: async () => undefined
    });

    await expect(provider.getAuthorization()).resolves.toBeUndefined();
  });

  it("loads browser-provided OIDC tokens for default API clients", async () => {
    const runtime = {
      getAccessToken: vi.fn(async () => "runtime-access-token"),
      refresh: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined)
    };

    const provider = createDefaultOidcAuthProvider({
      wiseEffOidc: runtime
    });

    expect(provider).toBeDefined();
    if (!provider) throw new Error("Expected default OIDC provider.");
    await expect(provider.getAuthorization()).resolves.toBe("Bearer runtime-access-token");
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
  });
});
