import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createAuthAttemptLimiter } from "./authAttemptLimiter";
import { createLocalAuthService, type RegisterLocalAccountResult } from "./localAuth";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createMemoryLocalAuthDb(extraOrganizations: Array<{ id: string; name: string }> = []) {
  const calls: QueryCall[] = [];
  const organizations = new Map<string, { id: string; name: string }>([
    ["org-chargelab", { id: "org-chargelab", name: "ChargeLab" }],
    ...extraOrganizations.map((organization) => [organization.id, organization] as const)
  ]);
  const users = new Map<string, { id: string; organizationId: string; name: string; email: string | null; title: string; isActive: boolean }>();
  const credentials = new Map<string, { username: string; passwordHash: string }>();
  const roles = new Map<string, Array<{ projectId: string | null; roleId: string }>>();
  const sessions = new Map<string, { id: string; userId: string; organizationId: string; tokenHash: string; expiresAt: string; revokedAt: string | null }>();
  const pendingRoleRequestUserIds = new Set<string>();

  async function query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("select user_id as id from user_password_credentials")) {
      const username = String(values[0]).toLowerCase();
      const credential = Array.from(credentials.entries()).find(([, item]) => item.username.toLowerCase() === username);
      return { rows: (credential ? [{ id: credential[0] }] : []) as Row[], rowCount: credential ? 1 : 0 };
    }

    if (normalized.includes("from organizations") && normalized.includes("where id = $1")) {
      const organization = organizations.get(values[0] as string);
      return { rows: (organization ? [organization] : []) as Row[], rowCount: organization ? 1 : 0 };
    }

    if (normalized.includes("from organizations") && normalized.includes("id <> all($1::text[])")) {
      const retired = new Set(values[0] as string[]);
      const rows = Array.from(organizations.values()).filter((organization) => !retired.has(organization.id));
      return { rows: rows as Row[], rowCount: rows.length };
    }

    if (normalized.startsWith("insert into organizations")) {
      organizations.set(values[0] as string, { id: values[0] as string, name: values[1] as string });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("insert into users")) {
      users.set(values[0] as string, {
        id: values[0] as string,
        organizationId: values[1] as string,
        name: values[2] as string,
        email: null,
        title: values[3] as string,
        isActive: values[4] as boolean
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("insert into user_password_credentials")) {
      credentials.set(values[0] as string, { username: values[1] as string, passwordHash: values[2] as string });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("insert into user_role_bindings")) {
      roles.set(values[1] as string, [{ projectId: null, roleId: values[3] as string }]);
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
      sessions.set(values[3] as string, {
        id: values[0] as string,
        userId: values[1] as string,
        organizationId: values[2] as string,
        tokenHash: values[3] as string,
        expiresAt: values[4] as string,
        revokedAt: null
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.includes("from users join user_password_credentials") && normalized.includes("where users.id = $1")) {
      const user = users.get(values[0] as string);
      const credential = user ? credentials.get(user.id) : undefined;
      return {
        rows: (user && credential
          ? [{
              id: user.id,
              organization_id: user.organizationId,
              name: user.name,
              title: user.title,
              is_active: user.isActive,
              username: credential.username,
              password_hash: credential.passwordHash
            }]
          : []) as Row[],
        rowCount: user && credential ? 1 : 0
      };
    }

    if (normalized.includes("from users join user_password_credentials")) {
      const username = String(values[0]).toLowerCase();
      const user = Array.from(users.values()).find((item) => {
        const credential = credentials.get(item.id);
        return credential?.username.toLowerCase() === username;
      });
      const credential = user ? credentials.get(user.id) : undefined;
      return {
        rows: (user && credential
          ? [{
              id: user.id,
              organization_id: user.organizationId,
              name: user.name,
              title: user.title,
              is_active: user.isActive,
              username: credential.username,
              password_hash: credential.passwordHash
            }]
          : []) as Row[],
        rowCount: user && credential ? 1 : 0
      };
    }

    if (normalized.includes("from user_role_bindings") && normalized.includes("count(*)")) {
      const count = Array.from(roles.values()).reduce(
        (total, bindings) => total + bindings.filter((binding) => binding.roleId === "admin").length,
        0
      );
      return { rows: [{ count: String(count) }] as Row[], rowCount: 1 };
    }

    if (normalized.startsWith("update user_password_credentials")) {
      const credential = credentials.get(values[0] as string);
      if (credential) {
        credential.passwordHash = values[1] as string;
      }
      return { rows: [], rowCount: credential ? 1 : 0 };
    }

    if (normalized.includes("from auth_sessions")) {
      const session = sessions.get(values[0] as string);
      return {
        rows: (session
          ? [{
              id: session.id,
              user_id: session.userId,
              organization_id: session.organizationId,
              expires_at: session.expiresAt,
              revoked_at: session.revokedAt
            }]
          : []) as Row[],
        rowCount: session ? 1 : 0
      };
    }

    if (normalized.startsWith("update auth_sessions set revoked_at") && normalized.includes("user_id")) {
      const exceptTokenHash = values[2] as string | null;
      let rowCount = 0;
      for (const session of sessions.values()) {
        if (session.userId !== values[0] || session.revokedAt) {
          continue;
        }
        if (exceptTokenHash && session.tokenHash === exceptTokenHash) {
          continue;
        }
        session.revokedAt = values[1] as string;
        rowCount += 1;
      }
      return { rows: [], rowCount };
    }

    if (normalized.startsWith("update auth_sessions set revoked_at")) {
      const session = sessions.get(values[0] as string);
      if (session) {
        session.revokedAt = values[1] as string;
      }
      return { rows: [], rowCount: session ? 1 : 0 };
    }

    if (normalized.startsWith("update users set last_active_at")) {
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update users set name")) {
      const user = users.get(values[1] as string);
      if (user) {
        user.name = (values[2] as string | undefined) ?? user.name;
        user.title = (values[3] as string | undefined) ?? user.title;
      }
      return { rows: [], rowCount: user ? 1 : 0 };
    }

    if (normalized.includes("users.id as user_id")) {
      const user = users.get(values[0] as string);
      if (!user) {
        return { rows: [], rowCount: 0 };
      }
      const organization = organizations.get(user.organizationId);
      return {
        rows: (roles.get(user.id) ?? []).map((role) => ({
          user_id: user.id,
          organization_id: user.organizationId,
          organization_name: organization?.name ?? user.organizationId,
          name: user.name,
          email: user.email,
          username: credentials.get(user.id)?.username ?? null,
          title: user.title,
          is_active: user.isActive,
          project_id: role.projectId,
          role_id: role.roleId
        })) as Row[],
        rowCount: roles.get(user.id)?.length ?? 0
      };
    }

    return { rows: [], rowCount: 0 };
  }

  const queryable: Queryable = { query };
  const db: Database = {
    query,
    transaction: async (fn) => fn(queryable)
  };

  return { calls, db };
}

function expectAuthenticatedRegistration(result: RegisterLocalAccountResult) {
  expect(result.status).toBe("authenticated");
  if (result.status !== "authenticated") {
    throw new Error("Expected authenticated local registration.");
  }
  return result;
}

describe("local auth service", () => {
  it("registers a local account into the evaluation organization without a department picker", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = expectAuthenticatedRegistration(await service.register(
      {
        name: "Pilot Admin",
        username: "pilot.admin",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    expect(result.auth.user.username).toBe("pilot.admin");
    expect(result.auth.user.email).toBeUndefined();
    expect(result.auth.organization).toEqual({ id: "org-chargelab", name: "ChargeLab" });
    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(result.auth.permissions).toContain("parameter:edit");
    expect(result.auth.permissions).not.toContain("users:manage");
    expect(result.session.token).toMatch(/^we_local_/);
    expect(calls.find((call) => call.text.includes("insert into users"))?.text).not.toContain("email");
    expect(calls.some((call) => call.text.includes("insert into organizations"))).toBe(false);
    expect(calls.find((call) => call.text.includes("insert into users"))?.values).not.toContain("org-hardware-department");
  });

  it("ignores a retired department organization field instead of minting that tenant", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = expectAuthenticatedRegistration(await service.register(
      {
        organization: "硬件部",
        name: "Demo User",
        username: "demo.user",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    expect(result.auth.organization).toEqual({ id: "org-chargelab", name: "ChargeLab" });
    expect(calls.some((call) => call.values.includes("org-hardware-department"))).toBe(false);
  });

  it("can override the registration organization for isolation tests", async () => {
    const { db } = createMemoryLocalAuthDb([{ id: "org-fixture", name: "Fixture Org" }]);
    const service = createLocalAuthService(db, {
      now: () => new Date("2026-06-12T00:00:00.000Z"),
      registrationOrganizationResolver: () => ({ id: "org-fixture", name: "Fixture Org" })
    });

    const result = expectAuthenticatedRegistration(await service.register(
      {
        name: "Demo User",
        username: "demo.user",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    expect(result.auth.organization).toEqual({ id: "org-fixture", name: "Fixture Org" });
    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
  });

  it("reuses the evaluation organization for every local registration", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const first = expectAuthenticatedRegistration(await service.register(
      {
        name: "Hardware One",
        username: "hardware.one",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));
    const second = expectAuthenticatedRegistration(await service.register(
      {
        name: "Software Two",
        username: "software.two",
        roleId: "software-user",
        password: "strong-password"
      },
      { requestId: "request-2" }
    ));

    expect(first.auth.organization).toEqual({ id: "org-chargelab", name: "ChargeLab" });
    expect(second.auth.organization).toEqual({ id: "org-chargelab", name: "ChargeLab" });
  });

  it("rejects self-service Admin registration", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await expect(
      service.register(
        {
          name: "Self Admin",
          username: "self.admin",
          roleId: "admin",
          password: "strong-password"
        },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Admin registration is not allowed.");
  });

  it("creates a pending inactive role request without a session for committer registration", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = await service.register(
      {
        name: "Committer Candidate",
        username: "committer.candidate",
        roleId: "software-committer",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    expect(result.status).toBe("pending_approval");
    expect(result.assignedRoleId).toBe("software-user");
    expect(result.requestedRoleId).toBe("software-committer");
    expect(result.session).toBeUndefined();
    expect("auth" in result).toBe(false);
    expect(calls.some((call) => call.text.includes("insert into local_registration_role_requests"))).toBe(true);
    expect(calls.find((call) => call.text.includes("insert into user_role_bindings"))?.values[3]).toBe("software-user");
    expect(calls.find((call) => call.text.includes("insert into users"))?.values).toContain(false);
    expect(calls.some((call) => call.text.includes("insert into auth_sessions"))).toBe(false);
  });

  it("blocks login for a pending committer registration until Admin approval activates it", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await service.register(
      {
        name: "Committer Candidate",
        username: "committer.candidate",
        roleId: "software-committer",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    await expect(
      service.login({ username: "committer.candidate", password: "strong-password" }, { requestId: "request-2" })
    ).rejects.toThrow("User is pending Admin approval.");
  });

  it("defaults registration to a non-admin base user role", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = expectAuthenticatedRegistration(await service.register(
      {
        name: "Default User",
        username: "default.user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(result.auth.permissions).not.toContain("users:manage");
  });

  it("logs in with local credentials and resolves the session token", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await service.register(
      {
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    const login = await service.login({ username: "pilot.admin", password: "strong-password" }, { requestId: "request-2" });
    const resolved = await service.resolveSession(`Bearer ${login.session.token}`);

    expect(resolved.user.username).toBe("pilot.admin");
  });

  it("revokes sessions on logout", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const registered = expectAuthenticatedRegistration(await service.register(
      {
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    await service.logout(`Bearer ${registered.session.token}`, registered.auth, { requestId: "request-2" });

    await expect(service.resolveSession(`Bearer ${registered.session.token}`)).rejects.toThrow("Session is not active.");
  });

  it("logs out without an authorization token (development auto-auth)", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const registered = expectAuthenticatedRegistration(await service.register(
      {
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    await expect(service.logout(undefined, registered.auth, { requestId: "request-2" })).resolves.toBeUndefined();
  });

  it("updates the current user profile without adding email or changing roles", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const registered = expectAuthenticatedRegistration(await service.register(
      {
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    ));

    const updated = await service.updateCurrentUserProfile(registered.auth, { name: "Renamed Admin", title: "Owner" }, { requestId: "request-2" });

    expect(updated.user).toMatchObject({ name: "Renamed Admin", title: "Owner", username: "pilot.admin" });
    expect(updated.user.email).toBeUndefined();
    expect(updated.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
  });

  it("reports public local-auth config including whether a local Admin exists", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await expect(service.getPublicConfig()).resolves.toEqual({
      provider: "local",
      selfRegisterEnabled: true,
      hasLocalAdmin: false,
      evaluationOrganizationName: "ChargeLab"
    });

    await db.query(
      "insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values ($1, $2, $3, null, $4)",
      ["bind-admin", "u-admin", "org-chargelab", "admin"]
    );
    await expect(service.getPublicConfig()).resolves.toMatchObject({ hasLocalAdmin: true });
  });

  it("refuses self-registration when the switch is off", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, {
      now: () => new Date("2026-06-12T00:00:00.000Z"),
      selfRegisterEnabled: false
    });

    await expect(
      service.register(
        {
          name: "Pilot User",
          username: "pilot.user",
          password: "strong-password"
        },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Self-registration is disabled.");
  });

  it("rate-limits login attempts and audits failed passwords", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, {
      now: () => new Date("2026-06-12T00:00:00.000Z"),
      attemptLimiter: createAuthAttemptLimiter({ maxAttempts: 2, windowMs: 60_000 })
    });
    await service.register(
      {
        name: "Pilot User",
        username: "pilot.user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    await expect(
      service.login({ username: "pilot.user", password: "wrong-password" }, { requestId: "request-2", clientIp: "10.0.0.8" })
    ).rejects.toThrow("Username or password is incorrect.");
    await expect(
      service.login({ username: "pilot.user", password: "wrong-password" }, { requestId: "request-3", clientIp: "10.0.0.8" })
    ).rejects.toThrow("Username or password is incorrect.");
    await expect(
      service.login({ username: "pilot.user", password: "wrong-password" }, { requestId: "request-4", clientIp: "10.0.0.8" })
    ).rejects.toThrow("Too many authentication attempts. Try again later.");

    const failedAudit = calls.find(
      (call) => call.text.includes("insert into audit_events") && JSON.stringify(call.values).includes("login-failed")
    );
    expect(failedAudit).toBeDefined();
    expect(JSON.stringify(failedAudit?.values)).toContain("invalid_password");
  });

  it("changes the current password, keeps this session, and revokes the others", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const first = expectAuthenticatedRegistration(
      await service.register(
        {
          name: "Pilot User",
          username: "pilot.user",
          password: "strong-password"
        },
        { requestId: "request-1" }
      )
    );
    const second = await service.login({ username: "pilot.user", password: "strong-password" }, { requestId: "request-2" });

    await expect(
      service.changePassword(
        first.auth,
        { currentPassword: "strong-password", newPassword: "strong-password" },
        { requestId: "request-3", authorization: `Bearer ${first.session.token}` }
      )
    ).rejects.toThrow("New password must be different from the current password.");
    await expect(
      service.changePassword(
        first.auth,
        { currentPassword: "wrong-password", newPassword: "newer-password" },
        { requestId: "request-4", authorization: `Bearer ${first.session.token}` }
      )
    ).rejects.toThrow("Current password is incorrect.");

    await expect(
      service.changePassword(
        first.auth,
        { currentPassword: "strong-password", newPassword: "newer-password" },
        { requestId: "request-5", authorization: `Bearer ${first.session.token}` }
      )
    ).resolves.toEqual({ ok: true });

    await expect(service.resolveSession(`Bearer ${first.session.token}`)).resolves.toMatchObject({
      user: { username: "pilot.user" }
    });
    await expect(service.resolveSession(`Bearer ${second.session.token}`)).rejects.toThrow("Session is not active.");
    await expect(
      service.login({ username: "pilot.user", password: "newer-password" }, { requestId: "request-6" })
    ).resolves.toMatchObject({ status: "authenticated" });
  });
});
