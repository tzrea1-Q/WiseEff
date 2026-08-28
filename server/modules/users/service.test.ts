import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import {
  listGovernedUsers,
  approveRegistrationRoleRequest,
  createUser,
  deactivateUser,
  deleteUser,
  getHomeOrganization,
  listRegistrationRoleRequests,
  rejectRegistrationRoleRequest,
  replaceUserRoles,
  resetUserPassword,
  updateHomeOrganization,
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

function createDb(
  rowsForQuery: (text: string, values: unknown[]) => unknown[] = () => [],
  rowCountForQuery: (text: string, values: unknown[]) => number = () => 1
) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const tx: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      txCalls.push({ text, values });
      return { rows: rowsForQuery(text, values) as Row[], rowCount: rowCountForQuery(text, values) };
    }
  };
  const db: Database = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });
      return { rows: rowsForQuery(text, values) as Row[], rowCount: rowCountForQuery(text, values) };
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
    const { db, txCalls } = createDb((text) => {
      if (text.includes("from user_password_credentials")) return [];
      return text.includes("returning") || text.includes("select") ? [userRow({ email: null })] : [];
    });

    const result = await createUser(
      db,
      adminAuth,
      {
        name: "Target User",
        username: "target.user",
        password: "WiseEff@2026",
        title: "Engineer",
        roles: [{ projectId: "aurora", roleId: "hardware-user" }]
      },
      { requestId: "request-1" }
    );

    expect(result.email).toBeNull();
    expect(result.username).toBe("target.user");
    expect(txCalls.some((call) => call.text.includes("insert into users"))).toBe(true);
    const credentialInsert = txCalls.find((call) => call.text.includes("insert into user_password_credentials"));
    expect(credentialInsert).toBeDefined();
    expect(credentialInsert?.values[1]).toBe("target.user");
    expect(credentialInsert?.values[2]).toEqual(expect.stringMatching(/^scrypt\$/));
    expect(credentialInsert?.values[2]).not.toBe("WiseEff@2026");
    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(true);
    const auditInsert = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditInsert).toBeDefined();
    expect(JSON.stringify(auditInsert?.values)).toContain("target.user");
    expect(JSON.stringify(auditInsert?.values)).not.toContain("WiseEff@2026");
  });

  it("defaults missing user titles to User before durable insert", async () => {
    const { db, txCalls } = createDb((text) => {
      if (text.includes("from user_password_credentials")) return [];
      return text.includes("returning") || text.includes("select") ? [userRow({ title: "User" })] : [];
    });

    await createUser(
      db,
      adminAuth,
      {
        name: "Target User",
        username: "target.user",
        password: "WiseEff@2026",
        roles: [{ projectId: "aurora", roleId: "hardware-user" }]
      },
      { requestId: "request-1" }
    );

    const insertCall = txCalls.find((call) => call.text.includes("insert into users"));
    expect(insertCall?.values[3]).toBe("User");
  });

  it("rejects non-admin user governance mutations", async () => {
    const { db, txCalls } = createDb();

    await expect(
      createUser(db, nonAdminAuth, { name: "Target", username: "target.user", password: "WiseEff@2026", title: "Engineer", roles: [] })
    ).rejects.toThrow("User management permission is required.");
    expect(txCalls).toHaveLength(0);
  });

  it("rejects duplicate local usernames before creating a user", async () => {
    const { db, txCalls } = createDb((text) => (text.includes("from user_password_credentials") ? [{ id: "u-existing" }] : []));

    await expect(
      createUser(
        db,
        adminAuth,
        {
          name: "Target User",
          username: "target.user",
          password: "WiseEff@2026",
          roles: [{ projectId: null, roleId: "hardware-user" }]
        },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Username is already registered.");
    expect(txCalls.some((call) => call.text.includes("insert into users"))).toBe(false);
  });

  it("rejects non-platform-admin callers creating a platform-admin user", async () => {
    const { db, txCalls } = createDb();

    await expect(
      createUser(
        db,
        adminAuth,
        {
          name: "Escalation Target",
          username: "escalation.target",
          password: "WiseEff@2026",
          roles: [{ projectId: null, roleId: "platform-admin" }]
        },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Only a platform super admin may grant or revoke the platform-admin role.");
    expect(txCalls).toHaveLength(0);
  });

  it("allows platform-admin callers to create a platform-admin user", async () => {
    const platformAdminAuth: AuthContext = {
      ...adminAuth,
      roles: [{ projectId: null, roleId: "platform-admin" }],
      permissions: [...adminAuth.permissions, "platform:access", "platform:schema-promote"]
    };
    const { db, txCalls } = createDb((text) => {
      if (text.includes("from user_password_credentials")) return [];
      return text.includes("returning") || text.includes("select")
        ? [userRow({ roles: [{ projectId: null, roleId: "platform-admin" }] })]
        : [];
    });

    await createUser(
      db,
      platformAdminAuth,
      {
        name: "Platform Admin",
        username: "platform.admin",
        password: "WiseEff@2026",
        roles: [{ projectId: null, roleId: "platform-admin" }]
      },
      { requestId: "request-1" }
    );

    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(true);
  });

  it("prevents the active admin from disabling itself", async () => {
    const { db } = createDb();

    await expect(deactivateUser(db, adminAuth, adminAuth.user.id, { isActive: false }, { requestId: "request-1" })).rejects.toThrow(
      "Active Admin cannot disable itself."
    );
  });

  it("prevents the active admin from deleting itself", async () => {
    const { db, txCalls } = createDb((text) => (text.includes("from users") ? [userRow({ id: "u-admin" })] : []));

    await expect(deleteUser(db, adminAuth, adminAuth.user.id, { requestId: "request-1" })).rejects.toThrow(
      "Active Admin cannot delete itself."
    );
    expect(txCalls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("prevents an ordinary admin from deleting a platform super admin", async () => {
    const { db, txCalls } = createDb((text) =>
      text.includes("from users")
        ? [userRow({ roles: [{ projectId: null, roleId: "platform-admin" }] })]
        : []
    );

    await expect(deleteUser(db, adminAuth, "u-target", { requestId: "request-1" })).rejects.toThrow(
      "Only a platform super admin may delete a platform-admin user."
    );
    expect(txCalls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("fails the transaction when the target disappears before the scoped delete", async () => {
    const { db, txCalls } = createDb(
      (text) => (text.includes("from users") ? [userRow()] : []),
      (text) => (text.includes("delete from users") ? 0 : 1)
    );

    await expect(deleteUser(db, adminAuth, "u-target", { requestId: "request-1" })).rejects.toThrow(
      "User was not found."
    );
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("delete from users"))).toBe(true);
  });

  it("returns not found without audit or delete for a missing or cross-organization target", async () => {
    const { db, txCalls } = createDb(() => []);

    await expect(deleteUser(db, adminAuth, "u-outside", { requestId: "request-1" })).rejects.toThrow(
      "User was not found."
    );
    expect(txCalls.some((call) => call.text.includes("delete from users"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("rejects non-platform-admin callers granting platform-admin to another user", async () => {
    const { db } = createDb((text) => (text.includes("from users") ? [userRow()] : []));

    await expect(
      replaceUserRoles(
        db,
        adminAuth,
        "u-target",
        { roles: [{ projectId: null, roleId: "platform-admin" }] },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Only a platform super admin may grant or revoke the platform-admin role.");
  });

  it("rejects non-platform-admin callers granting platform-admin to themselves", async () => {
    const { db } = createDb((text) => (text.includes("from users") ? [userRow({ id: "u-admin" })] : []));

    await expect(
      replaceUserRoles(
        db,
        adminAuth,
        adminAuth.user.id,
        { roles: [{ projectId: null, roleId: "platform-admin" }] },
        { requestId: "request-1" }
      )
    ).rejects.toThrow("Only a platform super admin may grant or revoke the platform-admin role.");
  });

  it("allows platform-admin callers to grant platform-admin", async () => {
    const platformAdminAuth: AuthContext = {
      ...adminAuth,
      roles: [{ projectId: null, roleId: "platform-admin" }],
      permissions: [...adminAuth.permissions, "platform:access", "platform:schema-promote"]
    };
    const { db, txCalls } = createDb((text) => (text.includes("from users") || text.includes("returning") ? [userRow()] : []));

    await replaceUserRoles(
      db,
      platformAdminAuth,
      "u-target",
      { roles: [{ projectId: null, roleId: "platform-admin" }] },
      { requestId: "request-1" }
    );

    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(true);
  });

  it("keeps governed user listing scoped to the caller organization for platform-admin", async () => {
    const platformAdminAuth: AuthContext = {
      ...adminAuth,
      roles: [{ projectId: null, roleId: "platform-admin" }],
      permissions: [...adminAuth.permissions, "platform:access", "platform:schema-promote"]
    };
    const { calls, db } = createDb(() => []);

    await listGovernedUsers(db, platformAdminAuth);

    const listUsersCall = calls.find((call) => call.text.includes("from users"));
    expect(listUsersCall?.values[0]).toBe("org-chargelab");
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

  it("scopes registration role request listing to the org admin's own organization", async () => {
    const { calls, db } = createDb((text, values) =>
      text.includes("from local_registration_role_requests") && values.includes("org-chargelab")
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
        : []
    );

    const result = await listRegistrationRoleRequests(db, adminAuth);

    expect(result).toEqual([
      expect.objectContaining({ id: "registration-role-request-1", organizationId: "org-chargelab" })
    ]);
    expect(calls.find((call) => call.text.includes("from local_registration_role_requests"))?.values).toContain(
      "org-chargelab"
    );
  });

  it("lets a platform admin list pending registration role requests across organizations", async () => {
    const platformAdminAuth: AuthContext = {
      ...adminAuth,
      roles: [
        { projectId: null, roleId: "admin" },
        { projectId: null, roleId: "platform-admin" }
      ]
    };
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

    const result = await listRegistrationRoleRequests(db, platformAdminAuth);

    expect(result).toEqual([
      expect.objectContaining({ id: "registration-role-request-1", organizationId: "org-hardware-department" })
    ]);
    expect(calls.find((call) => call.text.includes("from local_registration_role_requests"))?.values).toEqual([]);
  });

  it("refuses org-admin decisions on registration role requests from another organization", async () => {
    const otherOrgRow = {
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
    };
    // An org-scoped lookup cannot see the other organization's request, while the
    // unscoped admin lookup (the escalation path) would return it.
    const { db, txCalls } = createDb((text, values) =>
      text.includes("from local_registration_role_requests") && !values.includes("org-chargelab")
        ? [otherOrgRow]
        : []
    );

    await expect(approveRegistrationRoleRequest(db, adminAuth, "registration-role-request-1")).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(rejectRegistrationRoleRequest(db, adminAuth, "registration-role-request-1")).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    expect(txCalls.some((call) => call.text.includes("insert into user_role_bindings"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update users") && call.text.includes("is_active"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update local_registration_role_requests"))).toBe(false);
  });

  it("approves a pending local registration role request by activating the user and assigning the requested committer role", async () => {
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
    expect(txCalls.find((call) => call.text.includes("update users") && call.text.includes("set is_active"))?.values).toEqual([
      "org-software-department",
      "u-candidate",
      true
    ]);
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

  it("returns the caller's home organization without requiring users:manage", async () => {
    const { db } = createDb((text) =>
      text.includes("from organizations")
        ? [{ id: "org-chargelab", name: "ChargeLab", created_at: "2026-01-01T00:00:00.000Z" }]
        : []
    );

    await expect(getHomeOrganization(db, nonAdminAuth)).resolves.toEqual({
      id: "org-chargelab",
      name: "ChargeLab",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("renames the home organization and writes an organization-update audit in the same transaction", async () => {
    const { db, txCalls } = createDb((text) => {
      if (text.includes("update organizations")) {
        return [{ id: "org-chargelab", name: "雷泽能源", created_at: "2026-01-01T00:00:00.000Z" }];
      }
      if (text.includes("from organizations")) {
        return [{ id: "org-chargelab", name: "ChargeLab", created_at: "2026-01-01T00:00:00.000Z" }];
      }
      return [];
    });

    const result = await updateHomeOrganization(db, adminAuth, { name: "  雷泽能源  " }, { requestId: "request-1" });

    expect(result).toEqual({
      id: "org-chargelab",
      name: "雷泽能源",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    expect(txCalls.some((call) => call.text.includes("update organizations") && call.values[1] === "雷泽能源")).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toEqual(
      expect.arrayContaining(["organization-update", "update", "organization", "org-chargelab"])
    );
  });

  it("resets a user password, revokes sessions, and writes audit", async () => {
    const { db, txCalls } = createDb((text) => {
      if (text.includes("from users") || text.includes("returning")) {
        return [userRow({ email: null, username: "target.user" })];
      }
      return [];
    });

    const result = await resetUserPassword(
      db,
      adminAuth,
      "u-target",
      { password: "ResetPass@2026" },
      { requestId: "request-reset" }
    );

    expect(result.id).toBe("u-target");
    expect(txCalls.some((call) => call.text.includes("update user_password_credentials"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("update auth_sessions") && call.text.includes("user_id"))).toBe(true);
    const auditInsert = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(JSON.stringify(auditInsert?.values)).toContain("user-password-reset");
    expect(JSON.stringify(auditInsert?.values)).toContain("reset-password");
    expect(JSON.stringify(auditInsert?.values)).not.toContain("ResetPass@2026");
  });

  it("rejects password reset without users:manage", async () => {
    const { db, txCalls } = createDb();

    await expect(resetUserPassword(db, nonAdminAuth, "u-target", { password: "ResetPass@2026" })).rejects.toThrow(
      "User management permission is required."
    );
    expect(txCalls).toHaveLength(0);
  });

  it("rejects organization rename without users:manage", async () => {
    const { db, txCalls } = createDb();

    await expect(updateHomeOrganization(db, nonAdminAuth, { name: "Acme" })).rejects.toThrow(
      "User management permission is required."
    );
    expect(txCalls).toHaveLength(0);
  });
});
