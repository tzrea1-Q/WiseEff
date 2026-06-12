import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
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
  const tx: Queryable = { query };
  const db: Database = {
    query,
    transaction: async (fn) => fn(tx)
  };

  return { calls, db };
}

describe("user governance routes", () => {
  it("lets Admin create a durable user with audit evidence", async () => {
    const { calls, db } = makeDb((text) => (text.includes("returning") || text.includes("select") ? [userRow()] : []));

    const response = await requestJson<{ item: { email: string; roles: Array<{ roleId: string }> } }>(
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

    expect(response.status).toBe(201);
    expect(response.body.item.email).toBe("target@example.com");
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
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
          email: "target@example.com",
          title: "Engineer",
          roles: [{ projectId: "aurora", roleId: "hardware-user" }]
        })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("User management permission is required.");
  });

  it("prevents the active Admin from deactivating itself through the route", async () => {
    const { db } = makeDb();

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
    expect(response.body.error.message).toBe("Active Admin cannot disable itself.");
  });

  it("lets Admin list and decide pending registration role requests", async () => {
    const { calls, db } = makeDb((text, values) => {
      if (text.includes("update local_registration_role_requests")) {
        const status = values[2] === "approved" ? "approved" : "rejected";
        return [
          {
            id: "registration-role-request-1",
            organization_id: "org-chargelab",
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
        return [userRow({ id: "u-candidate", roles: [{ projectId: null, roleId: "hardware-committer" }] })];
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
      username: "committer.candidate"
    });
    expect(approve.status).toBe(200);
    expect(approve.body.item).toMatchObject({ id: "registration-role-request-1", status: "approved" });
    expect(reject.status).toBe(200);
    expect(reject.body.item).toMatchObject({ id: "registration-role-request-1", status: "rejected" });
    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });
});
