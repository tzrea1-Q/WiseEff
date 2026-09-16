import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import {
  getProjectRoleBindings,
  replaceOrganizationRoles,
  replaceProjectWorkflowRoles,
  replaceUserRoles
} from "./service";

const ORG = "org-test-proj-roles";
const PROJECT_A = "aurora";
const PROJECT_B = "zephyr";

const ADMIN_ID = "u-test-admin";
const USER_1_ID = "u-test-user-1";
const USER_2_ID = "u-test-user-2";

const adminAuth: AuthContext = {
  user: {
    id: ADMIN_ID,
    organizationId: ORG,
    name: "Test Admin",
    email: "admin@test.org",
    title: "Platform Lead",
    isActive: true
  },
  organization: { id: ORG, name: "Test Org" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["users:manage", "admin:access", "parameter:edit", "parameter:review", "parameter:view"]
};

describe("project workflow roles governance (real PostgreSQL)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();

    // Seed organization
    await db.query(`insert into organizations (id, name) values ($1, $2)`, [ORG, "Test Org"]);

    // Seed projects
    await db.query(
      `insert into projects (id, organization_id, name, code, status) values ($1, $2, $3, $4, 'active'), ($5, $6, $7, $8, 'active')`,
      [PROJECT_A, ORG, "Aurora", "AUR", PROJECT_B, ORG, "Zephyr", "ZEP"]
    );

    // Seed users
    for (const [id, name, email] of [
      [ADMIN_ID, "Test Admin", "admin@test.org"],
      [USER_1_ID, "Engineer One", "eng1@test.org"],
      [USER_2_ID, "Engineer Two", "eng2@test.org"]
    ]) {
      await db.query(
        `insert into users (id, organization_id, name, email, title, is_active) values ($1, $2, $3, $4, 'Engineer', true)`,
        [id, ORG, name, email]
      );
    }

    // Seed admin role
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values ($1, $2, $3, null, 'admin')`,
      [randomUUID(), ADMIN_ID, ORG]
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("R03: updating organization roles preserves project review role bindings", async () => {
    // 1. Assign project review role to USER_1 in aurora
    await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_1_ID, {
      roles: ["hardware-committer"],
      expectedRoles: []
    });

    // Verify project role is present
    const projectBindingsBefore = await getProjectRoleBindings(db, adminAuth, PROJECT_A);
    const user1Binding = projectBindingsBefore.bindings.find((b) => b.userId === USER_1_ID);
    expect(user1Binding?.roles).toEqual(["hardware-committer"]);

    // 2. Update USER_1 organization roles
    await replaceOrganizationRoles(db, adminAuth, USER_1_ID, {
      roles: ["software-user"],
      expectedRoles: []
    });

    // 3. Verify project role is STILL present and untouched
    const projectBindingsAfter = await getProjectRoleBindings(db, adminAuth, PROJECT_A);
    const user1BindingAfter = projectBindingsAfter.bindings.find((b) => b.userId === USER_1_ID);
    expect(user1BindingAfter?.roles).toEqual(["hardware-committer"]);

    // Verify org role is present in DB
    const res = await db.query<{ role_id: string }>(
      `select role_id from user_role_bindings where user_id = $1 and project_id is null`,
      [USER_1_ID]
    );
    expect(res.rows.map((r) => r.role_id)).toEqual(["software-user"]);
  });

  it("R04: detects stale expectations with 409 conflict and role-bindings-stale", async () => {
    // Both read expectedRoles: []
    // Admin 1 updates successfully
    await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_1_ID, {
      roles: ["hardware-committer"],
      expectedRoles: []
    });

    // Admin 2 tries to update with stale expectedRoles: []
    await expect(
      replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_1_ID, {
        roles: ["software-committer"],
        expectedRoles: []
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        status: 409,
        message: "Project workflow roles are stale.",
        details: expect.objectContaining({ code: "role-bindings-stale" })
      })
    );

    // Idempotent retry: applying identical desired roles succeeds without error
    const noopResult = await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_1_ID, {
      roles: ["hardware-committer"],
      expectedRoles: []
    });
    expect(noopResult.roles).toEqual(["hardware-committer"]);
  });

  it("R07: empty roles array only deletes the 3 review roles for that project", async () => {
    // Set roles on project A and project B, plus an org role
    await db.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values
       ($1, $2, $3, null, 'hardware-user'),
       ($4, $2, $3, $5, 'hardware-committer'),
       ($6, $2, $3, $7, 'software-committer')`,
      [randomUUID(), USER_1_ID, ORG, randomUUID(), PROJECT_A, randomUUID(), PROJECT_B]
    );

    // Clear roles on PROJECT_A
    await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_1_ID, {
      roles: [],
      expectedRoles: ["hardware-committer"]
    });

    // Check project A bindings: empty
    const bindingsA = await getProjectRoleBindings(db, adminAuth, PROJECT_A);
    expect(bindingsA.bindings.find((b) => b.userId === USER_1_ID)?.roles ?? []).toEqual([]);

    // Check project B bindings: software-committer preserved!
    const bindingsB = await getProjectRoleBindings(db, adminAuth, PROJECT_B);
    expect(bindingsB.bindings.find((b) => b.userId === USER_1_ID)?.roles).toEqual(["software-committer"]);

    // Check org bindings: hardware-user preserved!
    const orgBindings = await db.query<{ role_id: string }>(
      `select role_id from user_role_bindings where user_id = $1 and project_id is null`,
      [USER_1_ID]
    );
    expect(orgBindings.rows.map((r) => r.role_id)).toEqual(["hardware-user"]);
  });

  it("R02: cannot assign new project roles to an inactive user", async () => {
    // Deactivate user 2
    await db.query(`update users set is_active = false where id = $1`, [USER_2_ID]);

    await expect(
      replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_2_ID, {
        roles: ["hardware-committer"],
        expectedRoles: []
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        status: 400,
        details: expect.objectContaining({ code: "target-user-inactive" })
      })
    );
  });

  it("R02: can remove existing roles from an inactive user", async () => {
    // Assign role while active
    await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_2_ID, {
      roles: ["hardware-committer"],
      expectedRoles: []
    });

    // Deactivate user 2
    await db.query(`update users set is_active = false where id = $1`, [USER_2_ID]);

    // Removal should succeed
    const res = await replaceProjectWorkflowRoles(db, adminAuth, PROJECT_A, USER_2_ID, {
      roles: [],
      expectedRoles: ["hardware-committer"]
    });
    expect(res.roles).toEqual([]);
  });

  it("R09: legacy PUT /api/v1/users/:userId/roles rejects project-scoped roles", async () => {
    await expect(
      replaceUserRoles(db, adminAuth, USER_1_ID, {
        roles: [{ projectId: PROJECT_A, roleId: "hardware-committer" }]
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        status: 400,
        details: expect.objectContaining({ code: "project-roles-deprecated" })
      })
    );
  });
});

