import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import type { Database, QueryResult } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import type { AuthContext } from "../auth/types";

type QueryCall = {
  text: string;
  values: unknown[];
};

const adminAuth: AuthContext = {
  user: {
    id: "u-admin",
    organizationId: "org-chargelab",
    name: "Admin",
    email: "admin@example.com",
    title: "Admin",
    isActive: true
  },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["users:manage", "admin:access"]
};

const nonAdminAuth: AuthContext = {
  ...adminAuth,
  user: { ...adminAuth.user, id: "u-user" },
  roles: [{ projectId: "aurora", roleId: "hardware-user" }],
  permissions: ["parameter:view"]
};

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-target",
    organization_id: "org-chargelab",
    name: "Target User",
    email: "target@example.com",
    title: "Engineer",
    is_active: true,
    created_at: "2026-06-02T00:00:00.000Z",
    last_active_at: null,
    roles: [{ projectId: "aurora", roleId: "hardware-user" }],
    ...overrides
  };
}

function authRow(auth: AuthContext) {
  return {
    user_id: auth.user.id,
    organization_id: auth.user.organizationId,
    organization_name: auth.organization.name,
    name: auth.user.name,
    email: auth.user.email,
    title: auth.user.title,
    is_active: auth.user.isActive,
    project_id: auth.roles[0]?.projectId ?? null,
    role_id: auth.roles[0]?.roleId ?? "guest"
  };
}

function makeDb(rowsForQuery: (text: string, values: unknown[]) => unknown[] = () => [userRow()], auth: AuthContext = adminAuth) {
  const calls: QueryCall[] = [];
  const query = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    calls.push({ text, values });
    if (text.includes("users.id as user_id")) {
      return { rows: [authRow(auth)] as Row[], rowCount: 1 };
    }
    return { rows: rowsForQuery(text, values) as Row[], rowCount: 1 };
  };
  const tx: Database = { query, transaction: async (fn) => fn(tx) };
  const db: Database = {
    query,
    transaction: async (fn) => fn(tx)
  };

  return { calls, db };
}

describe("user governance routes", () => {
  it("lets Admin create a local account user with credentials and audit evidence", async () => {
    const { calls, db } = makeDb((text) => {
      if (text.includes("from user_password_credentials")) return [];
      return text.includes("returning") || text.includes("select") ? [userRow({ email: null })] : [];
    });

    const response = await requestJson<{ item: { email: string | null; username: string | null; roles: Array<{ roleId: string }> } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({
          name: "Target User",
          username: "target.user",
          password: "WiseEff@2026",
          title: "Engineer",
          roles: [{ projectId: null, roleId: "hardware-user" }]
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.item.email).toBeNull();
    expect(response.body.item.username).toBe("target.user");
    expect(calls.some((call) => call.text.includes("insert into user_password_credentials"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("rejects project-scoped roles during user creation", async () => {
    const { db } = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({
          name: "Target User",
          username: "target.user",
          password: "WiseEff@2026",
          title: "Engineer",
          roles: [{ projectId: "aurora", roleId: "hardware-user" }]
        })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects legacy email-only user creation payloads", async () => {
    const { db } = makeDb();

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({
          name: "Target User",
          email: "target@example.com",
          title: "Engineer",
          roles: [{ projectId: "aurora", roleId: "hardware-user" }]
        })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects non-Admin user mutations at the API boundary", async () => {
    const { db } = makeDb(() => [userRow()], nonAdminAuth);

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => nonAdminAuth } }
      }),
      "/api/v1/users",
      {
        method: "POST",
        headers: { Authorization: "Bearer user" },
        body: JSON.stringify({
          name: "Target User",
          username: "target.user",
          password: "WiseEff@2026",
          title: "Engineer",
          roles: [{ projectId: "aurora", roleId: "hardware-user" }]
        })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("User management permission is required.");
  });

  it("prevents the final effective organization Admin from deactivating itself through the route", async () => {
    const { db } = makeDb(() => [userRow({ id: "u-admin", roles: [{ projectId: null, roleId: "admin" }] })]);

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users/u-admin/activation",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({ isActive: false })
      }
    );

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("At least one usable organization administrator must remain.");
  });

  it("lets Admin permanently delete a non-self user through the route", async () => {
    const { calls, db } = makeDb((text) => (text.includes("from users") ? [userRow()] : []));

    const response = await requestJson<null>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users/u-target",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer admin" }
      }
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("rejects non-Admin deletion before any user mutation", async () => {
    const { calls, db } = makeDb(() => [userRow()], nonAdminAuth);

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => nonAdminAuth } }
      }),
      "/api/v1/users/u-target",
      { method: "DELETE", headers: { Authorization: "Bearer user" } }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("User management permission is required.");
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(false);
  });

  it("prevents the final effective organization Admin from deleting itself through the route", async () => {
    const { calls, db } = makeDb(() => [userRow({ id: "u-admin", roles: [{ projectId: null, roleId: "admin" }] })]);

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users/u-admin",
      { method: "DELETE", headers: { Authorization: "Bearer admin" } }
    );

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("At least one usable organization administrator must remain.");
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(false);
  });

  it("rejects ordinary Admin deletion of a platform-admin at the API boundary", async () => {
    const { calls, db } = makeDb((text) =>
      text.includes("from users")
        ? [userRow({ roles: [{ projectId: null, roleId: "platform-admin" }] })]
        : []
    );

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => adminAuth } } }),
      "/api/v1/users/u-target",
      { method: "DELETE", headers: { Authorization: "Bearer admin" } }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("returns not found for a missing deletion target at the API boundary", async () => {
    const { calls, db } = makeDb((text) => (text.includes("from users") ? [] : [userRow()]));

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => adminAuth } } }),
      "/api/v1/users/u-outside",
      { method: "DELETE", headers: { Authorization: "Bearer admin" } }
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("keeps an existing cross-organization user invisible and unchanged at the API boundary", async () => {
    const foreignUsers = [userRow({ id: "u-outside", organization_id: "org-foreign" })];
    const { calls, db } = makeDb((text, values) => {
      if (!text.includes("from users")) return [];
      return foreignUsers.filter(
        (user) => user.organization_id === values[0] && user.id === values[1]
      );
    });

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => adminAuth } } }),
      "/api/v1/users/u-outside",
      { method: "DELETE", headers: { Authorization: "Bearer admin" } }
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(foreignUsers).toEqual([expect.objectContaining({ id: "u-outside", organization_id: "org-foreign" })]);
    expect(calls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("lets Admin list and decide pending registration role requests", async () => {
    const { calls, db } = makeDb((text, values) => {
      if (text.includes("update local_registration_role_requests")) {
        const status = values[2] === "approved" ? "approved" : "rejected";
        return [
          {
            id: "registration-role-request-1",
            organization_id: "org-chargelab",
            organization_name: "ChargeLab",
            user_id: "u-candidate",
            user_name: "Committer Candidate",
            username: "committer.candidate",
            current_role_id: "hardware-user",
            requested_role_id: "hardware-committer",
            status,
            created_at: "2026-06-12T00:00:00.000Z",
            decided_at: "2026-06-12T00:01:00.000Z",
            decided_by_user_id: "u-admin"
          }
        ];
      }
      if (text.includes("from local_registration_role_requests")) {
        return [
          {
            id: "registration-role-request-1",
            organization_id: "org-chargelab",
            organization_name: "ChargeLab",
            user_id: "u-candidate",
            user_name: "Committer Candidate",
            username: "committer.candidate",
            current_role_id: "hardware-user",
            requested_role_id: "hardware-committer",
            status: "pending",
            created_at: "2026-06-12T00:00:00.000Z",
            decided_at: null,
            decided_by_user_id: null
          }
        ];
      }
      if (text.includes("returning") || text.includes("select")) {
        return [userRow({ id: "u-candidate", is_active: false, roles: [{ projectId: null, roleId: "hardware-user" }] })];
      }
      return [];
    });
    const server = createWiseEffServer({
      db,
      auth: { mode: "production", verifier: { verify: async () => adminAuth } }
    });

    const list = await requestJson<{ items: Array<{ id: string; requestedRoleId: string; username: string }> }>(
      server,
      "/api/v1/users/registration-role-requests",
      {
        headers: { Authorization: "Bearer admin" }
      }
    );
    const approve = await requestJson<{ item: { id: string; status: string; requestedRoleId: string } }>(
      server,
      "/api/v1/users/registration-role-requests/registration-role-request-1/approve",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({})
      }
    );
    const reject = await requestJson<{ item: { id: string; status: string } }>(
      server,
      "/api/v1/users/registration-role-requests/registration-role-request-1/reject",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({})
      }
    );

    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      id: "registration-role-request-1",
      requestedRoleId: "hardware-committer",
      username: "committer.candidate",
      organizationName: "ChargeLab"
    });
    expect(approve.status).toBe(200);
    expect(approve.body.item).toMatchObject({ id: "registration-role-request-1", status: "approved", organizationName: "ChargeLab" });
    expect(reject.status).toBe(200);
    expect(reject.body.item).toMatchObject({ id: "registration-role-request-1", status: "rejected", organizationName: "ChargeLab" });
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("lists decided registration requests with organization names and validates the status filter", async () => {
    const { calls, db } = makeDb((text) => text.includes("from local_registration_role_requests") ? [{
      id: "approved-request",
      organization_id: "org-chargelab",
      organization_name: "ChargeLab",
      user_id: "u-candidate",
      user_name: "Candidate",
      username: "candidate",
      current_role_id: "hardware-user",
      requested_role_id: "hardware-committer",
      status: "approved",
      created_at: "2026-06-12T00:00:00.000Z",
      decided_at: "2026-06-12T00:01:00.000Z",
      decided_by_user_id: "u-admin"
    }] : []);
    const server = createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => adminAuth } } });
    const response = await requestJson<{ items: Array<{ organizationName: string; status: string }> }>(
      server, "/api/v1/users/registration-role-requests?status=decided", { headers: { Authorization: "Bearer admin" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([expect.objectContaining({ organizationName: "ChargeLab", status: "approved" })]);
    const query = calls.find((call) => call.text.includes("from local_registration_role_requests"));
    expect(query?.text).toContain("in ('approved', 'rejected')");
    expect(query?.values).toEqual(["org-chargelab"]);

    const invalid = await requestJson<{ error: { code: string } }>(
      server, "/api/v1/users/registration-role-requests?status=all", { headers: { Authorization: "Bearer admin" } }
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_FAILED");
    expect(calls.filter((call) => call.text.includes("from local_registration_role_requests"))).toHaveLength(1);
  });

  it("returns the home organization for an authenticated member", async () => {
    const { db } = makeDb((text) =>
      text.includes("from organizations")
        ? [{ id: "org-chargelab", name: "ChargeLab", created_at: "2026-01-01T00:00:00.000Z" }]
        : []
    );

    const response = await requestJson<{ organization: { id: string; name: string; createdAt: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => nonAdminAuth } }
      }),
      "/api/v1/organization",
      { headers: { Authorization: "Bearer user" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.organization).toEqual({
      id: "org-chargelab",
      name: "ChargeLab",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("lets Admin rename the home organization", async () => {
    const { calls, db } = makeDb((text) => {
      if (text.includes("update organizations")) {
        return [{ id: "org-chargelab", name: "雷泽能源", created_at: "2026-01-01T00:00:00.000Z" }];
      }
      if (text.includes("from organizations")) {
        return [{ id: "org-chargelab", name: "ChargeLab", created_at: "2026-01-01T00:00:00.000Z" }];
      }
      return [];
    });

    const response = await requestJson<{ organization: { name: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({ name: "雷泽能源" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.organization.name).toBe("雷泽能源");
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("rejects organization rename from a non-Admin", async () => {
    const { db } = makeDb(() => [], nonAdminAuth);

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => nonAdminAuth } }
      }),
      "/api/v1/organization",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer user" },
        body: JSON.stringify({ name: "Acme" })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("lets Admin reset a user password and writes audit evidence", async () => {
    const { calls, db } = makeDb((text) => {
      if (text.includes("from users") || text.includes("returning") || text.includes("select")) {
        return [userRow({ email: null, username: "target.user" })];
      }
      return [];
    });

    const response = await requestJson<{ item: { id: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => adminAuth } }
      }),
      "/api/v1/users/u-target/password",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: JSON.stringify({ password: "ResetPass@2026" })
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.item.id).toBe("u-target");
    expect(calls.some((call) => call.text.includes("update user_password_credentials"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
    expect(JSON.stringify(calls.find((call) => call.text.includes("insert into audit_events"))?.values)).not.toContain(
      "ResetPass@2026"
    );
  });

  it("rejects password reset from a non-Admin", async () => {
    const { db } = makeDb(() => [userRow()], nonAdminAuth);

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({
        db,
        auth: { mode: "production", verifier: { verify: async () => nonAdminAuth } }
      }),
      "/api/v1/users/u-target/password",
      {
        method: "POST",
        headers: { Authorization: "Bearer user" },
        body: JSON.stringify({ password: "ResetPass@2026" })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});
