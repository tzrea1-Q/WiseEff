import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedFetch, resolveXiaozeAuthorizationHeader } from "./xiaozeHttpAgent";

vi.mock("@/infrastructure/auth/oidcAuthProvider", () => ({
  createDefaultOidcAuthProvider: () => ({
    getAuthorization: vi.fn(async () => undefined)
  })
}));

vi.mock("@/infrastructure/http/authClient", () => ({
  readLocalAuthToken: vi.fn(() => "we_local_test_token")
}));

vi.mock("@/infrastructure/http/runtimeMode", () => ({
  wiseEffApiAuthorization: undefined,
  wiseEffApiBaseUrl: "http://127.0.0.1:8787"
}));

describe("xiaozeHttpAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves local session bearer tokens for Xiaoze requests", async () => {
    await expect(resolveXiaozeAuthorizationHeader()).resolves.toBe("Bearer we_local_test_token");
  });

  it("adds Authorization on each fetch call", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const authFetch = createAuthenticatedFetch(fetchImpl);

    await authFetch("http://127.0.0.1:8787/api/v1/agent/xiaoze", { method: "POST" });

    const calls = fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.[1]?.headers as Headers | undefined;
    expect(headers?.get("Authorization")).toBe("Bearer we_local_test_token");
  });
});
