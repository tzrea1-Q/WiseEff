import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerAuthRoutes } from "./routes";

describe("GET /api/v1/me", () => {
  it("requires an injected auth context resolver", () => {
    expect(() => registerAuthRoutes(createRouter(), {} as Parameters<typeof registerAuthRoutes>[1])).toThrow(
      "Auth context resolver is required for auth routes."
    );
  });

  it("returns the seeded current user in development fallback mode", async () => {
    const response = await requestJson<{
      user: { id: string };
      roles: Array<{ roleId: string }>;
      permissions: string[];
    }>(createWiseEffServer(), "/api/v1/me", {
      headers: { "X-WiseEff-User": "u-xu-yun" }
    });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("u-xu-yun");
    expect(response.body.roles[0].roleId).toBe("admin");
    expect(response.body.permissions).toContain("admin:access");
  });
});
