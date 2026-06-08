import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { createUser, deactivateUser, replaceUserRoles, updateUserProfile } from "./service";

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
});
