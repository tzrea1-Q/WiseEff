import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createAuthClient, LOCAL_AUTH_TOKEN_STORAGE_KEY } from "./authClient";

describe("createAuthClient", () => {
  it("fetches the current auth context", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: { id: "u-xu-yun", organizationId: "org-chargelab", name: "Xu Yun", email: "xu@chargelab.cn", title: "Platform Owner", isActive: true },
          organization: { id: "org-chargelab", name: "ChargeLab" },
          roles: [{ projectId: null, roleId: "admin" }],
          permissions: ["admin:access"]
        }),
        { status: 200 }
      )
    );

    const authClient = createAuthClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));
    const context = await authClient.getCurrentAuthContext();

    expect(context.user.id).toBe("u-xu-yun");
    expect(context.roles[0].roleId).toBe("admin");
  });

  it("logs in, stores the local token, updates profile, and logs out", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && String(_url).endsWith("/api/v1/auth/login")) {
        return new Response(
          JSON.stringify({
            token: "we_local_test",
            expiresAt: "2026-06-19T00:00:00.000Z",
            auth: {
              user: { id: "u-local", organizationId: "org-local", name: "Local User", username: "local.user", title: "Owner", isActive: true },
              organization: { id: "org-local", name: "Local Org" },
              roles: [{ projectId: null, roleId: "admin" }],
              permissions: ["admin:access"]
            }
          }),
          { status: 200 }
        );
      }
      if (init?.method === "PATCH" && String(_url).endsWith("/api/v1/me/profile")) {
        return new Response(
          JSON.stringify({
            user: { id: "u-local", organizationId: "org-local", name: "Renamed", username: "local.user", title: "Lead", isActive: true },
            organization: { id: "org-local", name: "Local Org" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access"]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const authClient = createAuthClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const login = await authClient.login({ username: "local.user", password: "strong-password" });
    const profile = await authClient.updateCurrentUserProfile({ name: "Renamed", title: "Lead" });
    await authClient.logout();

    expect(login.token).toBe("we_local_test");
    expect(login.auth.user.email).toBeUndefined();
    expect(profile.user.name).toBe("Renamed");
    expect(profile.user.email).toBeUndefined();
    expect(localStorage.getItem(LOCAL_AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "local.user", password: "strong-password" }) })
    );
  });

  it("registers a local account and persists the returned token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token: "we_local_registered",
          expiresAt: "2026-06-19T00:00:00.000Z",
          auth: {
            user: { id: "u-local", organizationId: "org-local", name: "Local User", username: "local.user", title: "Owner", isActive: true },
            organization: { id: "org-local", name: "Local Org" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access"]
          }
        }),
        { status: 201 }
      )
    );
    const authClient = createAuthClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await authClient.register({
      organization: "硬件部",
      name: "Local User",
      username: "local.user",
      roleId: "hardware-user",
      password: "strong-password"
    });

    expect(localStorage.getItem(LOCAL_AUTH_TOKEN_STORAGE_KEY)).toBe("we_local_registered");
  });

  it("does not persist a local token when committer registration is pending approval", async () => {
    localStorage.removeItem(LOCAL_AUTH_TOKEN_STORAGE_KEY);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "pending_approval",
          user: { id: "u-local", organizationId: "org-local", name: "Local Committer", username: "local.committer", title: "hardware-user", isActive: false },
          organization: { id: "org-local", name: "Local Org" },
          requestedRoleId: "hardware-committer",
          assignedRoleId: "hardware-user"
        }),
        { status: 202 }
      )
    );
    const authClient = createAuthClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const result = await authClient.register({
      organization: "硬件部",
      name: "Local Committer",
      username: "local.committer",
      roleId: "hardware-committer",
      password: "strong-password"
    });

    expect("status" in result ? result.status : undefined).toBe("pending_approval");
    expect(localStorage.getItem(LOCAL_AUTH_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
