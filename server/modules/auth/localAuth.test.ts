import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createLocalAuthService } from "./localAuth";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createMemoryLocalAuthDb() {
  const calls: QueryCall[] = [];
  const organizations = new Map<string, { id: string; name: string }>();
  const users = new Map<string, { id: string; organizationId: string; name: string; email: string | null; title: string; isActive: boolean }>();
  const credentials = new Map<string, { username: string; passwordHash: string }>();
  const roles = new Map<string, Array<{ projectId: string | null; roleId: string }>>();
  const sessions = new Map<string, { id: string; userId: string; organizationId: string; tokenHash: string; expiresAt: string; revokedAt: string | null }>();

  async function query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("select user_id as id from user_password_credentials")) {
      const username = String(values[0]).toLowerCase();
      const credential = Array.from(credentials.entries()).find(([, item]) => item.username.toLowerCase() === username);
      return { rows: (credential ? [{ id: credential[0] }] : []) as Row[], rowCount: credential ? 1 : 0 };
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
        isActive: true
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
      return { rows: [], rowCount: 1 };
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

describe("local auth service", () => {
  it("registers a local account with the selected organization, username, and role", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = await service.register(
      {
        organization: "硬件部",
        name: "Pilot Admin",
        username: "pilot.admin",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    expect(result.auth.user.username).toBe("pilot.admin");
    expect(result.auth.user.email).toBeUndefined();
    expect(result.auth.organization.name).toBe("硬件部");
    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(result.auth.permissions).toContain("parameter:edit");
    expect(result.auth.permissions).not.toContain("users:manage");
    expect(result.session.token).toMatch(/^we_local_/);
    expect(calls.find((call) => call.text.includes("insert into users"))?.text).not.toContain("email");
  });

  it("reuses the stable organization id for the selected local registration organization", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const first = await service.register(
      {
        organization: "硬件部",
        name: "Hardware One",
        username: "hardware.one",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );
    const second = await service.register(
      {
        organization: "硬件部",
        name: "Hardware Two",
        username: "hardware.two",
        roleId: "hardware-user",
        password: "strong-password"
      },
      { requestId: "request-2" }
    );

    expect(first.auth.organization.id).toBe("org-hardware-department");
    expect(second.auth.organization.id).toBe("org-hardware-department");
    expect(first.auth.organization.name).toBe("硬件部");
  });

  it("rejects self-service Admin registration", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await expect(
      service.register(
        {
          organization: "硬件部",
          name: "Self Admin",
          username: "self.admin",
          roleId: "admin",
          password: "strong-password"
        },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Admin registration is not allowed.");
  });

  it("creates a pending role request and grants only the matching base role for committer registration", async () => {
    const { calls, db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = await service.register(
      {
        organization: "软件部",
        name: "Committer Candidate",
        username: "committer.candidate",
        roleId: "software-committer",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "software-user" }]);
    expect(result.auth.permissions).not.toContain("parameter:review");
    expect(calls.some((call) => call.text.includes("insert into local_registration_role_requests"))).toBe(true);
    expect(calls.find((call) => call.text.includes("insert into user_role_bindings"))?.values[3]).toBe("software-user");
  });

  it("defaults registration to a non-admin base user role", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    const result = await service.register(
      {
        organization: "硬件部",
        name: "Default User",
        username: "default.user",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    expect(result.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(result.auth.permissions).not.toContain("users:manage");
  });

  it("logs in with local credentials and resolves the session token", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });

    await service.register(
      {
        organization: "硬件部",
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
    const registered = await service.register(
      {
        organization: "软件部",
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    await service.logout(`Bearer ${registered.session.token}`, registered.auth, { requestId: "request-2" });

    await expect(service.resolveSession(`Bearer ${registered.session.token}`)).rejects.toThrow("Session is not active.");
  });

  it("updates the current user profile without adding email or changing roles", async () => {
    const { db } = createMemoryLocalAuthDb();
    const service = createLocalAuthService(db, { now: () => new Date("2026-06-12T00:00:00.000Z") });
    const registered = await service.register(
      {
        organization: "软件部",
        name: "Pilot Admin",
        username: "pilot.admin",
        password: "strong-password"
      },
      { requestId: "request-1" }
    );

    const updated = await service.updateCurrentUserProfile(registered.auth, { name: "Renamed Admin", title: "Owner" }, { requestId: "request-2" });

    expect(updated.user).toMatchObject({ name: "Renamed Admin", title: "Owner", username: "pilot.admin" });
    expect(updated.user.email).toBeUndefined();
    expect(updated.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
  });
});
