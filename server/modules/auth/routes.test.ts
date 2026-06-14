import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerAuthRoutes } from "./routes";
import { createLocalAuthService } from "./localAuth";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createLocalRouteDb() {
  const calls: QueryCall[] = [];
  const organization = { id: "org-local", name: "Local Org" };
  const user = {
    id: "u-local",
    organizationId: organization.id,
    name: "Local Admin",
    email: null as string | null,
    title: "Owner",
    isActive: true
  };
  let passwordHash = "";
  let username = "";
  let roleId = "admin";
  let tokenHash = "";
  let revokedAt: string | null = null;
  const pendingRoleRequestUserIds = new Set<string>();

  async function query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("select user_id as id from user_password_credentials")) {
      const matches = username.toLowerCase() === String(values[0]).toLowerCase();
      return {
        rows: matches ? ([{ id: user.id }] as Row[]) : [],
        rowCount: matches ? 1 : 0
      };
    }
    if (normalized.startsWith("insert into organizations")) {
      organization.id = values[0] as string;
      organization.name = values[1] as string;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into users")) {
      user.id = values[0] as string;
      user.organizationId = values[1] as string;
      user.name = values[2] as string;
      user.email = null;
      user.title = values[3] as string;
      user.isActive = values[4] as boolean;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into user_password_credentials")) {
      username = values[1] as string;
      passwordHash = values[2] as string;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into user_role_bindings")) {
      roleId = values[3] as string;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into local_registration_role_requests")) {
      pendingRoleRequestUserIds.add(values[2] as string);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("select true as exists from local_registration_role_requests")) {
      const exists = pendingRoleRequestUserIds.has(values[0] as string);
      return { rows: (exists ? [{ exists: true }] : []) as Row[], rowCount: exists ? 1 : 0 };
    }
    if (normalized.startsWith("insert into auth_sessions")) {
      tokenHash = values[3] as string;
      revokedAt = null;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("from users join user_password_credentials")) {
      if (username.toLowerCase() !== String(values[0]).toLowerCase()) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: user.id,
          organization_id: user.organizationId,
          name: user.name,
          title: user.title,
          is_active: user.isActive,
          username,
          password_hash: passwordHash
        }] as Row[],
        rowCount: 1
      };
    }
    if (normalized.includes("from auth_sessions")) {
      return {
        rows: [{
          id: "sess-local",
          user_id: user.id,
          organization_id: user.organizationId,
          expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: revokedAt
        }] as Row[],
        rowCount: tokenHash ? 1 : 0
      };
    }
    if (normalized.startsWith("update auth_sessions set revoked_at")) {
      revokedAt = values[1] as string;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("update users set name")) {
      user.name = (values[2] as string | undefined) ?? user.name;
      user.title = (values[3] as string | undefined) ?? user.title;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("update users set last_active_at")) {
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("users.id as user_id")) {
      return {
        rows: [{
          user_id: user.id,
          organization_id: user.organizationId,
          organization_name: organization.name,
          name: user.name,
          email: user.email,
          username,
          title: user.title,
          is_active: user.isActive,
          project_id: null,
          role_id: roleId
        }] as Row[],
        rowCount: 1
      };
    }

    return { rows: [], rowCount: 0 };
  }

  const tx: Queryable = { query };
  const db: Database = {
    query,
    transaction: async (fn) => fn(tx)
  };

  return { calls, db };
}

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

  it("registers, reads, updates, and logs out a local account session", async () => {
    const { db } = createLocalRouteDb();
    const localAuthService = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const serverOptions = {
      db,
      env: { AUTH_PROVIDER: "local" as const },
      auth: { mode: "production" as const },
      localAuthService
    };

    const registered = await requestJson<{ token: string; auth: { user: { username: string; email?: string }; roles: Array<{ roleId: string }> } }>(
      createWiseEffServer(serverOptions),
      "/api/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({
          organization: "硬件部",
          name: "Local Admin",
          username: "local.admin",
          roleId: "hardware-user",
          password: "strong-password"
        })
      }
    );
    expect(registered.status).toBe(201);
    expect(registered.body.auth.user.username).toBe("local.admin");
    expect(registered.body.auth.user.email).toBeUndefined();
    expect(registered.body.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(registered.body.token).toMatch(/^we_local_/);

    const me = await requestJson<{ user: { username: string; email?: string } }>(createWiseEffServer(serverOptions), "/api/v1/me", {
      headers: { Authorization: `Bearer ${registered.body.token}` }
    });
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("local.admin");
    expect(me.body.user.email).toBeUndefined();

    const profile = await requestJson<{ user: { name: string; title: string } }>(
      createWiseEffServer(serverOptions),
      "/api/v1/me/profile",
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${registered.body.token}` },
        body: JSON.stringify({ name: "Updated Admin", title: "Platform Owner" })
      }
    );
    expect(profile.status).toBe(200);
    expect(profile.body.user).toMatchObject({ name: "Updated Admin", title: "Platform Owner" });

    const logout = await requestJson(createWiseEffServer(serverOptions), "/api/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${registered.body.token}` }
    });
    expect(logout.status).toBe(200);

    const afterLogout = await requestJson<{ error: { message: string } }>(createWiseEffServer(serverOptions), "/api/v1/me", {
      headers: { Authorization: `Bearer ${registered.body.token}` }
    });
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error.message).toBe("Session is not active.");
  });

  it("rejects legacy email fields on local register and login", async () => {
    const { db } = createLocalRouteDb();
    const localAuthService = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const serverOptions = {
      db,
      env: { AUTH_PROVIDER: "local" as const },
      auth: { mode: "production" as const },
      localAuthService
    };

    const register = await requestJson<{ error: { code: string } }>(createWiseEffServer(serverOptions), "/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        organization: "硬件部",
        name: "Local Admin",
        username: "local.admin",
        email: "local@example.com",
        roleId: "hardware-user",
        password: "strong-password"
      })
    });
    const login = await requestJson<{ error: { code: string } }>(createWiseEffServer(serverOptions), "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: "local.admin",
        email: "local@example.com",
        password: "strong-password"
      })
    });

    expect(register.status).toBe(400);
    expect(register.body.error.code).toBe("VALIDATION_FAILED");
    expect(login.status).toBe(400);
    expect(login.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns a pending approval result without a token for committer registration", async () => {
    const { calls, db } = createLocalRouteDb();
    const localAuthService = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const serverOptions = {
      db,
      env: { AUTH_PROVIDER: "local" as const },
      auth: { mode: "production" as const },
      localAuthService
    };

    const registered = await requestJson<{
      status: string;
      user: { username: string; isActive: boolean };
      requestedRoleId: string;
      assignedRoleId: string;
      token?: string;
      auth?: unknown;
    }>(createWiseEffServer(serverOptions), "/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        organization: "硬件部",
        name: "Committer Candidate",
        username: "committer.candidate",
        roleId: "hardware-committer",
        password: "strong-password"
      })
    });

    expect(registered.status).toBe(202);
    expect(registered.body).toMatchObject({
      status: "pending_approval",
      user: { username: "committer.candidate", isActive: false },
      requestedRoleId: "hardware-committer",
      assignedRoleId: "hardware-user"
    });
    expect(registered.body.token).toBeUndefined();
    expect(registered.body.auth).toBeUndefined();
    expect(calls.some((call) => call.text.includes("insert into auth_sessions"))).toBe(false);

    const login = await requestJson<{ error: { code: string; message: string } }>(createWiseEffServer(serverOptions), "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "committer.candidate", password: "strong-password" })
    });
    expect(login.status).toBe(403);
    expect(login.body.error.message).toBe("User is pending Admin approval.");
  });
});
