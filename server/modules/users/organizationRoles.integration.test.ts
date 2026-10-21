import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import type { UserGovernanceDto } from "./types";

const organizationId = "org-role-set";
const admin: AuthContext = {
  user: { id: "role-admin", organizationId, name: "Role Admin", title: "Admin", isActive: true },
  organization: { id: organizationId, name: "Role Org" },
  roles: [{ projectId: null, roleId: "admin" }], permissions: ["users:manage", "admin:access"]
};
const platformAdmin: AuthContext = { ...admin, user: { ...admin.user, id: "role-platform" }, roles: [{ projectId: null, roleId: "platform-admin" }] };
const target = "role-member";

describe("organization role set API (real PostgreSQL)", () => {
  let db: RootDatabase;
  let ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("orgroles");
    db = createPostgresDatabase(ephemeral.url);
    await db.query("insert into organizations (id, name) values ($1, 'Role Org'), ('org-role-other', 'Other Org')", [organizationId]);
    await db.query("insert into projects (id, organization_id, name, code, status) values ('role-project', $1, 'Role Project', 'RLS', 'active')", [organizationId]);
    for (const [id, org] of [[admin.user.id, organizationId], [platformAdmin.user.id, organizationId], [target, organizationId], ["role-outsider", "org-role-other"]]) {
      await db.query("insert into users (id, organization_id, name, title, is_active) values ($1, $2, $1, 'Engineer', true)", [id, org]);
    }
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values
      ('role-set-admin', $1, $3, null, 'admin'), ('role-set-platform', $2, $3, null, 'platform-admin'),
      ('role-set-member', $4, $3, null, 'software-user'), ('role-set-project', $4, $3, 'role-project', 'hardware-committer')`,
    [admin.user.id, platformAdmin.user.id, organizationId, target]);
  });
  afterEach(async () => { try { await db?.close(); } finally { await ephemeral?.drop(); } });

  function api(auth = admin) {
    return createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => auth } } });
  }
  function update(roles: string[], expectedRoles: string[], userId = target, auth = admin) {
    return requestJson<{ item: UserGovernanceDto; error: { code: string; details: { code: string; currentRoles: string[] }; message: string } }>(
      api(auth), `/api/v1/users/${userId}/organization-roles`, {
        method: "PUT", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify({ roles, expectedRoles })
      }
    );
  }
  async function readMember(userId = target) {
    const response = await requestJson<{ items: UserGovernanceDto[] }>(api(), "/api/v1/users", { headers: { Authorization: "Bearer fixture" } });
    expect(response.status).toBe(200);
    return response.body.items.find((user) => user.id === userId)!;
  }

  it("combines and clears organization roles while retaining project duties after readback", async () => {
    const combined = await update(["hardware-user", "software-committer"], ["software-user"]);
    expect(combined.status).toBe(200);
    expect((await readMember()).roles).toEqual(expect.arrayContaining([
      { projectId: null, roleId: "hardware-user" }, { projectId: null, roleId: "software-committer" },
      { projectId: "role-project", roleId: "hardware-committer" }
    ]));
    const cleared = await update([], ["software-committer", "hardware-user"]);
    expect(cleared.status).toBe(200);
    expect((await readMember()).roles).toEqual([{ projectId: "role-project", roleId: "hardware-committer" }]);
  });

  it("accepts only one competing update and returns the actual role set to the stale writer", async () => {
    const results = await Promise.all([
      update(["hardware-user"], ["software-user"]), update(["software-committer"], ["software-user"])
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results.find((result) => result.status === 200)!;
    const stale = results.find((result) => result.status === 409)!;
    const currentRoles = winner.body.item.roles.filter((role) => role.projectId === null).map((role) => role.roleId);
    expect(stale.body.error.details).toMatchObject({ code: "role-bindings-stale", currentRoles });
    expect((await readMember()).roles).toEqual(winner.body.item.roles);
    expect((await update(["hardware-committer"], currentRoles)).status).toBe(200);
    expect((await readMember()).roles).toEqual(expect.arrayContaining([
      { projectId: null, roleId: "hardware-committer" }, { projectId: "role-project", roleId: "hardware-committer" }
    ]));
  });

  it("preserves server-side platform grant, organization boundary and non-admin protection", async () => {
    const grant = await update(["platform-admin"], ["software-user"]);
    expect(grant.status).toBe(403);
    expect(grant.body.error.message).toBe("Only a platform super admin may grant or revoke the platform-admin role.");
    expect((await update([], [], "role-outsider")).status).toBe(404);
    const memberAuth = { ...admin, user: { ...admin.user, id: target } };
    expect((await update([], ["software-user"], target, memberAuth)).status).toBe(403);
    expect((await readMember()).roles).toEqual(expect.arrayContaining([{ projectId: null, roleId: "software-user" }]));
    expect((await update(["platform-admin"], ["software-user"], target, platformAdmin)).status).toBe(200);
    expect((await update([], ["platform-admin"], target)).status).toBe(403);
  });

  it("refuses to remove the current account's last administrator capability even with no other active admin", async () => {
    await db.query("update users set is_active = false where id = $1", [platformAdmin.user.id]);
    const denied = await update([], ["admin"], admin.user.id);
    expect(denied.status).toBe(409);
    expect(denied.body.error.message).toBe("Active Admin cannot remove its last Admin capability.");
    expect((await readMember(admin.user.id)).roles).toEqual([{ projectId: null, roleId: "admin" }]);
  });
});
