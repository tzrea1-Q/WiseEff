import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createAuthClient } from "./authClient";

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
});
