import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createDefaultUserGovernanceApiClient, createUserGovernanceClient } from "./userGovernanceClient";

function createFetchMock(response: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status }));
}

describe("createUserGovernanceClient", () => {
  it("lists backend governed users", async () => {
    const fetchMock = createFetchMock({
      items: [
        {
          id: "u-admin",
          organizationId: "org-chargelab",
          name: "Xu Yun",
          email: "xu.yun@chargelab.cn",
          title: "Platform Owner",
          isActive: true,
          createdAt: "2026-06-02T00:00:00.000Z",
          lastActiveAt: null,
          roles: [{ projectId: null, roleId: "admin" }]
        }
      ]
    });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(client.listUsers()).resolves.toEqual([
      expect.objectContaining({
        id: "u-admin",
        roleId: "admin",
        isActive: true,
        lastActive: "never"
      })
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
  });

  it("creates users through the backend with a durable role binding", async () => {
    const fetchMock = createFetchMock({ item: { id: "u-new", roles: [{ projectId: "aurora", roleId: "hardware-user" }] } }, 201);
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await client.createUser({
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user",
      projectId: "aurora"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users", {
      body: JSON.stringify({
        name: "Demo Engineer",
        email: "demo@chargelab.cn",
        title: "Validation Engineer",
        roles: [{ projectId: "aurora", roleId: "hardware-user" }]
      }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST"
    });
  });

  it("updates role bindings and activation through backend mutation APIs", async () => {
    const fetchMock = createFetchMock({ item: { id: "u-target", roles: [{ projectId: null, roleId: "software-committer" }] } });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await client.assignUserRole("u-target", "software-committer");
    await client.setUserActive("u-target", false);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/u-target/roles", {
      body: JSON.stringify({ roles: [{ projectId: null, roleId: "software-committer" }] }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PUT"
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/u-target/activation", {
      body: JSON.stringify({ isActive: false }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PATCH"
    });
  });

  it("uses browser OIDC authorization for the default API client", async () => {
    const fetchMock = createFetchMock({ items: [] });
    const apiClient = createDefaultUserGovernanceApiClient({
      fetchImpl: fetchMock,
      oidcWindow: {
        wiseEffOidc: {
          getAccessToken: async () => "oidc-token"
        }
      }
    });
    const client = createUserGovernanceClient(apiClient);

    await client.listUsers();

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/users", {
      headers: { Accept: "application/json", Authorization: "Bearer oidc-token" },
      method: "GET"
    });
  });
});
