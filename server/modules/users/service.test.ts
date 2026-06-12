import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import {
  approveRegistrationRoleRequest,
  createUser,
  deactivateUser,
  listRegistrationRoleRequests,
  rejectRegistrationRoleRequest,
  replaceUserRoles,
  updateUserProfile
} from "./service";

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
  roles: [{ projectId: "aurora", roleId: "software-user" }],
  permissions: ["parameter:view"]
};

function createDb(rowsForQuery: (text: string, values: unknown[]) => unknown[] = () => []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const tx: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      txCalls.push({ text, values });
      return { rows: rowsForQuery(text, values) as Row[], rowCount: 1 };
    }
  };
  const db: Database = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });
      return { rows: rowsForQuery(text, values) as Row[], rowCount: 1 };
    },
    transaction: async (fn) => fn(tx)
  };

  return { calls, db, txCalls };
}

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

describe("user governance service", () => {
  it("creates a user, assigns roles, and writes audit in one transaction", async () => {
    const { db, txCalls } = createDb((text) => (text.includes("returning") || text.includes("select") ? [userRow()] : []));

    const result = await createUser(
      db,
      adminAuth,
      {
        name: "Target User",
        email: "target@example.com",
        title: "Engineer",
        roles: [{ projectId: "aurora", roleId: "hardware-user" }]
      },
      { requestId: "request-1" }
    );

    expect(result.email).toBe("target@example.com");
    expect(txCalls.some((call) => call.text.includes("insert into users"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("defaults missing user titles to User before durable insert", async () => {
    const { db, txCalls } = createDb((text) => (text.includes("returning") || text.includes("select") ? [userRow({ title: "User" })] : []));

    await createUser(
      db,
      adminAuth,
      {
        name: "Target User",
        email: "target@example.com",
        roles: [{ projectId: "aurora", roleId: "hardware-user" }]
      },
      { requestId: "request-1" }
    );

    const insertCall = txCalls.find((call) => call.text.includes("insert into users"));
    expect(insertCall?.values[4]).toBe("User");
  });

  it("rejects non-admin user governance mutations", async () => {
    const { db, txCalls } = createDb();

    await expect(
      createUser(db, nonAdminAuth, { name: "Target", email: "target@example.com", title: "Engineer", roles: [] })
    ).rejects.toThrow("User management permission is required.");
    expect(txCalls).toHaveLength(0);
  });

  it("prevents the active admin from disabling itself", async () => {
    const { db } = createDb();

    await expect(deactivateUser(db, adminAuth, adminAuth.user.id, { isActive: false }, { requestId: "request-1" })).rejects.toThrow(
      "Active Admin cannot disable itself."
    );
  });

  it("prevents removing the active admin's last Admin capability", async () => {
    const { db } = createDb((text) => (text.includes("count") ? [{ count: "1" }] : [userRow({ id: "u-admin" })]));

    await expect(replaceUserRoles(db, adminAuth, adminAuth.user.id, { roles: [{ projectId: "aurora", roleId: "software-user" }] })).rejects.toThrow(
      "Active Admin cannot remove its last Admin capability."
    );
  });

  it("updates profiles and role bindings with audit evidence", async () => {
    const { db, txCalls } = createDb((text) => (text.includes("returning") || text.includes("select") ? [userRow({ name: "Renamed" })] : []));

    await updateUserProfile(db, adminAuth, "u-target", { name: "Renamed", title: "Lead Engineer" }, { requestId: "request-1" });
    await replaceUserRoles(db, adminAuth, "u-target", { roles: [{ projectId: null, roleId: "admin" }] }, { requestId: "request-2" });

    expect(txCalls.some((call) => call.text.includes("update users"))).toBe(true);
    expect(txCalls.filter((call) => call.text.includes("insert into audit_events")).length).toBeGreaterThanOrEqual(2);
  });

  it("lists pending local registration role requests for Admin users", async () => {
    const { db } = createDb((text) =>
      text.includes("from local_registration_role_requests")
        ? [
            {
              id: "registration-role-request-1",
              organization_id: "org-software-department",
              user_id: "u-candidate",
              user_name: "Committer Candidate",
              username: "committer.candidate",
              current_role_id: "software-user",
              requested_role_id: "software-committer",
              status: "pending",
              created_at: "2026-06-12T00:00:00.000Z",
              decided_at: null,
              decided_by_user_id: null
            }
          ]
        : []
    );

    await expect(listRegistrationRoleRequests(db, adminAuth)).resolves.toEqual([
      expect.objectContaining({
        id: "registration-role-request-1",
        organizationId: "org-software-department",
        userId: "u-candidate",
        username: "committer.candidate",
        currentRoleId: "software-user",
        requestedRoleId: "software-committer",
        status: "pending"
      })
    ]);
  });

  it("lists pending local registration role requests outside the Admin user's own organization", async () => {
    const { calls, db } = createDb((text, values) =>
      text.includes("from local_registration_role_requests") && values.length === 0
        ? [
            {
              id: "registration-role-request-1",
              organization_id: "org-hardware-department",
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
          ]
        : []
    );

    const result = await listRegistrationRoleRequests(db, adminAuth);

    expect(result).toEqual([
      expect.objectContaining({
        id: "registration-role-request-1",
        organizationId: "org-hardware-department"
      })
    ]);
    expect(calls.find((call) => call.text.includes("from local_registration_role_requests"))?.values).toEqual([]);
  });

  it("approves a pending local registration role request by assigning the requested committer role", async () => {
    const { db, txCalls } = createDb((text) => {
      if (text.includes("from local_registration_role_requests")) {
        return [
          {
            id: "registration-role-request-1",
            organization_id: "org-software-department",
            user_id: "u-candidate",
            user_name: "Committer Candidate",
            username: "committer.candidate",
            current_role_id: "software-user",
            requested_role_id: "software-committer",
            status: "pending",
            created_at: "2026-06-12T00:00:00.000Z",
            decided_at: null,
            decided_by_user_id: null
            }
          ];
      }
      if (text.includes("update local_registration_role_requests")) {
        return [
          {
            id: "registration-role-request-1",
            organization_id: "org-software-department",
            user_id: "u-candidate",
            user_name: "Committer Candidate",
            username: "committer.candidate",
            current_role_id: "software-user",
            requested_role_id: "software-committer",
            status: "approved",
            created_at: "2026-06-12T00:00:00.000Z",
            decided_at: "2026-06-12T00:01:00.000Z",
            decided_by_user_id: "u-admin"
          }
        ];
      }
      if (text.includes("returning") || text.includes("select")) {
        return [userRow({ id: "u-candidate", roles: [{ projectId: null, roleId: "software-committer" }] })];
      }
      return [];
    });

    const result = await approveRegistrationRoleRequest(db, adminAuth, "registration-role-request-1", { requestId: "request-1" });

    expect(result.status).toBe("approved");
    expect(txCalls.find((call) => call.text.includes("delete from user_role_bindings"))?.values[0]).toBe("org-software-department");
    expect(txCalls.find((call) => call.text.includes("insert into user_role_bindings"))?.values[4]).toBe("software-committer");
    expect(txCalls.find((call) => call.text.includes("update local_registration_role_requests"))?.values[0]).toBe("org-software-department");
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("rejects a pending local registration role request without changing role bindings", async () => {
    const { db, txCalls } = createDb((text) =>
      text.includes("from local_registration_role_requests")
        ? [
            {
              id: "registration-role-request-1",
              organization_id: "org-chargelab",
              user_id: "u-candidate",
              user_name: "Committer Candidate",
              username: "committer.candidate",
              current_role_id: "software-user",
              requested_role_id: "software-committer",
              status: "pending",
              created_at: "2026-06-12T00:00:00.000Z",
              decided_at: null,
              decided_by_user_id: null
            }
          ]
        : text.includes("update local_registration_role_requests")
          ? [
              {
                id: "registration-role-request-1",
                organization_id: "org-chargelab",
                user_id: "u-candidate",
                user_name: "Committer Candidate",
                username: "committer.candidate",
                current_role_id: "software-user",
                requested_role_id: "software-committer",
                status: "rejected",
                created_at: "2026-06-12T00:00:00.000Z",
                decided_at: "2026-06-12T00:01:00.000Z",
                decided_by_user_id: "u-admin"
              }
            ]
          : []
    );

    const result = await rejectRegistrationRoleRequest(db, adminAuth, "registration-role-request-1", { requestId: "request-1" });

    expect(result.status).toBe("rejected");
    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update local_registration_role_requests"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("rejects non-admin local registration role request decisions", async () => {
    const { db, txCalls } = createDb();

    await expect(listRegistrationRoleRequests(db, nonAdminAuth)).rejects.toThrow("User management permission is required.");
    await expect(approveRegistrationRoleRequest(db, nonAdminAuth, "registration-role-request-1")).rejects.toThrow(
      "User management permission is required."
    );
    await expect(rejectRegistrationRoleRequest(db, nonAdminAuth, "registration-role-request-1")).rejects.toThrow(
      "User management permission is required."
    );
    expect(txCalls).toHaveLength(0);
  });
});
