import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";
import { createDefaultUserGovernanceApiClient, createOrganizationWorkspaceClient, createUserGovernanceClient } from "./userGovernanceClient";
import { withOrganizationScope } from "./organizationScope";

function createFetchMock(response: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status }));
}

describe("createUserGovernanceClient", () => {
  it("loads real workspace summary through the fixed organization client without hydrating management lists", async () => {
    const item = { organization: { id: "target", name: "Target", status: "active" }, counts: { members: 2, teams: 1, projects: 3 }, administration: null };
    const fetchMock = createFetchMock({ item });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }), "target");
    await expect(client.getWorkspaceSummary()).resolves.toEqual(item);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/v1/organization/workspace-summary?organizationId=target", expect.objectContaining({ method: "GET" }));
  });
  it("opens Home with the current authenticated identity without a write, while explicit targets use the audited entry", async () => {
    const actor = { user: { id: "actual-user", organizationId: "home" }, organization: { id: "home", name: "Home" } };
    const fetchMock = vi.fn<typeof fetch>(async (path) => new Response(JSON.stringify(String(path).endsWith("/me") ? actor : { actor, organization: { id: "target", name: "Target" } })));
    const client = createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));
    await expect(client.enterOperatingContext()).resolves.toEqual({ actor, organization: actor.organization });
    await expect(client.enterOperatingContext("target")).resolves.toEqual({ actor, organization: { id: "target", name: "Target" } });
    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/v1/me", "GET"], ["/api/v1/organization/operating-scope", "POST"]
    ]);
  });
  it("retains a fixed target when a resource URL supplies another organization", () => {
    expect(withOrganizationScope("/api/v1/users?status=decided&organizationId=other#section", "target")).toBe("/api/v1/users?status=decided&organizationId=target#section");
    expect(withOrganizationScope("/api/v1/users?status=decided")).toBe("/api/v1/users?status=decided");
  });
  it("binds independent member and project requests to their own organization even when responses arrive late", async () => {
    let finishFirst!: (value: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementation(async () => new Response(JSON.stringify({ items: [], item: { id: "member", roles: [] }, bindings: [] })));
    const api = createApiClient({ baseUrl: "", fetchImpl: fetchMock });
    const first = createUserGovernanceClient(api, "target A"), second = createUserGovernanceClient(api, "target-B");
    const late = first.listUsers();
    await second.listUsers();
    await first.updateUserProfile("member", { name: "A member", title: "" });
    await second.listRegistrationRoleRequests("decided");
    await first.getProjectWorkflowRoleBindings("project");
    finishFirst(new Response(JSON.stringify({ items: [] })));
    await late;
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/users?organizationId=target+A", "/api/v1/users?organizationId=target-B", "/api/v1/users/member?organizationId=target+A",
      "/api/v1/users/registration-role-requests?status=decided&organizationId=target-B", "/api/v1/projects/project/workflow-role-bindings?organizationId=target+A"
    ]);
  });
  it("picks the highest organization role without promoting project bindings", async () => {
    const fetchMock = createFetchMock({ items: [
      { id: "admin", roles: [{ projectId: null, roleId: "admin" }, { projectId: null, roleId: "platform-admin" }] },
      { id: "member", roles: [{ projectId: "aurora", roleId: "software-committer" }] }
    ] });
    const users = await createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock })).listUsers();
    expect(users[0].roleId).toBe("platform-admin");
    expect(users[0].roles).toHaveLength(2);
    expect(users[1].roleId).toBe("guest");
    expect(users[1].roles).toEqual([{ projectId: "aurora", roleId: "software-committer" }]);
  });

  it("requests decided registration history and updates member profile fields", async () => {
    const fetchMock = createFetchMock({ items: [], item: { id: "member", roles: [] } });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));
    await client.listRegistrationRoleRequests("decided");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/registration-role-requests?status=decided", expect.objectContaining({ method: "GET" }));
    await client.updateUserProfile("member", { name: "成员", title: "" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/member", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "成员", title: "" }) }));
  });

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

  it("does not synthesize email when a backend user has no email", async () => {
    const fetchMock = createFetchMock({
      items: [
        {
          id: "u-local",
          organizationId: "org-local",
          name: "Local User",
          email: null,
          title: "Owner",
          isActive: true,
          createdAt: "2026-06-02T00:00:00.000Z",
          lastActiveAt: null,
          roles: [{ projectId: null, roleId: "admin" }]
        }
      ]
    });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const users = await client.listUsers();

    expect(users[0].email).toBeUndefined();
  });

  it("creates users through the backend with a durable role binding", async () => {
    const fetchMock = createFetchMock({ item: { id: "u-new", roles: [{ projectId: "aurora", roleId: "hardware-user" }] } }, 201);
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await client.createUser({
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "Validation Engineer",
      password: "WiseEff@2026",
      roleId: "hardware-user",
      projectId: "aurora"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users", {
      body: JSON.stringify({
        name: "Demo Engineer",
        username: "demo.engineer",
        title: "Validation Engineer",
        password: "WiseEff@2026",
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

  it("permanently deletes a governed user and accepts an empty 204 response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(client.deleteUser("u/target")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/u%2Ftarget", {
      headers: { Accept: "application/json" },
      method: "DELETE"
    });
  });

  it("resets a governed user password", async () => {
    const fetchMock = createFetchMock({
      item: {
        id: "u-target",
        organizationId: "org-chargelab",
        name: "Liu Min",
        email: null,
        username: "liu.min",
        title: "Validation Engineer",
        isActive: true,
        createdAt: "2026-06-02T00:00:00.000Z",
        lastActiveAt: null,
        roles: [{ projectId: null, roleId: "hardware-user" }]
      }
    });
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(client.resetUserPassword("u-target", "ResetPass@2026")).resolves.toEqual(
      expect.objectContaining({
        id: "u-target",
        username: "liu.min",
        roleId: "hardware-user"
      })
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/u-target/password", {
      body: JSON.stringify({ password: "ResetPass@2026" }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST"
    });
  });

  it("lists and decides pending registration role requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "registration-role-request-1",
                organizationId: "org-chargelab",
                userId: "u-candidate",
                userName: "Committer Candidate",
                username: "committer.candidate",
                currentRoleId: "software-user",
                requestedRoleId: "software-committer",
                status: "pending",
                createdAt: "2026-06-12T00:00:00.000Z",
                decidedAt: null,
                decidedByUserId: null
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            item: {
              id: "registration-role-request-1",
              organizationId: "org-chargelab",
              userId: "u-candidate",
              userName: "Committer Candidate",
              username: "committer.candidate",
              currentRoleId: "software-user",
              requestedRoleId: "software-committer",
              status: "approved",
              createdAt: "2026-06-12T00:00:00.000Z",
              decidedAt: "2026-06-12T00:01:00.000Z",
              decidedByUserId: "u-admin"
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            item: {
              id: "registration-role-request-1",
              organizationId: "org-chargelab",
              userId: "u-candidate",
              userName: "Committer Candidate",
              username: "committer.candidate",
              currentRoleId: "software-user",
              requestedRoleId: "software-committer",
              status: "rejected",
              createdAt: "2026-06-12T00:00:00.000Z",
              decidedAt: "2026-06-12T00:01:00.000Z",
              decidedByUserId: "u-admin"
            }
          }),
          { status: 200 }
        )
      );
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(client.listRegistrationRoleRequests()).resolves.toEqual([
      expect.objectContaining({
        id: "registration-role-request-1",
        requestedRoleId: "software-committer",
        status: "pending"
      })
    ]);
    await expect(client.approveRegistrationRoleRequest("registration-role-request-1")).resolves.toMatchObject({
      id: "registration-role-request-1",
      status: "approved"
    });
    await expect(client.rejectRegistrationRoleRequest("registration-role-request-1")).resolves.toMatchObject({
      id: "registration-role-request-1",
      status: "rejected"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/registration-role-requests", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/registration-role-requests/registration-role-request-1/approve", {
      body: JSON.stringify({}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST"
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/registration-role-requests/registration-role-request-1/reject", {
      body: JSON.stringify({}),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST"
    });
  });

  it("reads and updates the home organization", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organization: { id: "org-chargelab", name: "ChargeLab", createdAt: "2026-01-15T00:00:00.000Z" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organization: { id: "org-chargelab", name: "LeiZe Energy", createdAt: "2026-01-15T00:00:00.000Z" }
          }),
          { status: 200 }
        )
      );
    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    await expect(client.getOrganization()).resolves.toEqual({
      id: "org-chargelab",
      name: "ChargeLab",
      createdAt: "2026-01-15T00:00:00.000Z"
    });
    await expect(client.updateOrganization({ name: "LeiZe Energy" })).resolves.toEqual({
      id: "org-chargelab",
      name: "LeiZe Energy",
      createdAt: "2026-01-15T00:00:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/organization", {
      headers: { Accept: "application/json" },
      method: "GET"
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/organization", {
      body: JSON.stringify({ name: "LeiZe Energy" }),
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

    expect(fetchMock).toHaveBeenCalledWith(`${resolveWiseEffApiBaseUrl()}/api/v1/users`, {
      headers: { Accept: "application/json", Authorization: "Bearer oidc-token" },
      method: "GET"
    });
  });

  it("fetches and updates project workflow role bindings", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({
            projectId: "aurora",
            ready: true,
            missingRoles: [],
            bindings: [
              {
                userId: "u-hw",
                userName: "HW MDE",
                username: "hw.mde",
                email: "hw@example.com",
                title: "Engineer",
                isActive: true,
                roles: ["hardware-committer"]
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({
            item: {
              projectId: "aurora",
              userId: "u-hw",
              roles: ["hardware-committer", "software-committer"]
            }
          }),
          { status: 200 }
        )
      );

    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const bindings = await client.getProjectWorkflowRoleBindings("aurora");
    expect(bindings.ready).toBe(true);
    expect(bindings.bindings[0].roles).toEqual(["hardware-committer"]);
    expect(bindings.bindings[0].name).toBe("HW MDE");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects/aurora/workflow-role-bindings", {
      headers: { Accept: "application/json" },
      method: "GET"
    });

    const updated = await client.updateProjectWorkflowRoleBindings("aurora", "u-hw", {
      roles: ["hardware-committer", "software-committer"],
      expectedRoles: ["hardware-committer"]
    });
    expect(updated.item.roles).toEqual(["hardware-committer", "software-committer"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects/aurora/workflow-role-bindings/u-hw", {
      body: JSON.stringify({
        roles: ["hardware-committer", "software-committer"],
        expectedRoles: ["hardware-committer"]
      }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PUT"
    });
  });

  it("updates organization roles with CAS expectedRoles contract", async () => {
    const fetchMock = createFetchMock({
      item: {
        id: "u-1",
        organizationId: "org-1",
        name: "User 1",
        title: "Engineer",
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
        roles: [{ projectId: null, roleId: "hardware-user" }]
      }
    });

    const client = createUserGovernanceClient(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const updated = await client.updateOrganizationRoles("u-1", {
      roles: ["hardware-user"],
      expectedRoles: ["guest"]
    });

    expect(updated.roleId).toBe("hardware-user");
    expect(updated.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/u-1/organization-roles", {
      body: JSON.stringify({
        roles: ["hardware-user"],
        expectedRoles: ["guest"]
      }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PUT"
    });
  });
});
