import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { getAuthContext } from "../auth/repository";
import type { ProjectMemberDto } from "../projects/members";

describe("explicit team project grants use the single-member HTTP authority", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("teamgrants"); db = createPostgresDatabase(ephemeral.url);
    await db.query("insert into organizations(id,name) values('bulk-home','Home'),('bulk-target','Target')");
    await db.query(`insert into users(id,organization_id,name,title,is_active) values
      ('bulk-platform','bulk-home','Platform','Administrator',true),('bulk-foreign','bulk-home','Foreign','Engineer',true),
      ('bulk-alice','bulk-target','Alice','Engineer',true),('bulk-bob','bulk-target','Bob','Engineer',true),('bulk-inactive','bulk-target','Inactive','Engineer',false)`);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('bulk-platform-role','bulk-platform','bulk-home','platform-admin'),('bulk-alice-role','bulk-alice','bulk-target','software-user'),('bulk-bob-role','bulk-bob','bulk-target','guest')");
    await db.query("insert into projects(id,organization_id,name,code) values('bulk-project','bulk-target','Project','BULK')");
    await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('bulk-target','bulk-project','bulk-alice',array['hardware-user'])");
  });
  afterEach(async () => { try { await db.close(); } finally { await ephemeral.drop(); } });
  async function api<T>(path: string, method = "GET", body?: unknown, actor = "bulk-platform") {
    const auth = await getAuthContext(db, actor);
    return requestJson<T>(createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: { verify: async () => auth } } }), `${path}?organizationId=bulk-target`,
      { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const rosterPath = "/api/v1/projects/bulk-project/members";
  it("persists concrete individual grants and keeps them unchanged after team membership changes or deletion", async () => {
    const team = await api<{ item: { id: string; memberIds: string[] } }>("/api/v1/organization/teams", "POST", { name: "Engineering" });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
    const teamPath = `/api/v1/organization/teams/${team.body.item.id}`;
    const selected = await api<{ item: { memberIds: string[] } }>(`${teamPath}/members`, "PUT", { userIds: ["bulk-alice", "bulk-bob"] });
    expect(selected.status).toBe(200);
    const snapshot = selected.body.item.memberIds;
    const previous = (await api<{ members: ProjectMemberDto[] }>(rosterPath)).body.members;
    for (const userId of snapshot) {
      const expectedRoles = previous.find((member) => member.userId === userId)?.roles ?? [];
      expect((await api(rosterPath + `/${userId}`, "PUT", { roles: [...expectedRoles, "software-user"], expectedRoles })).status).toBe(200);
    }
    const granted = (await api<{ members: ProjectMemberDto[] }>(rosterPath)).body.members;
    expect(granted.map(({ userId, roles }) => ({ userId, roles }))).toEqual([
      { userId: "bulk-alice", roles: ["hardware-user", "software-user"] }, { userId: "bulk-bob", roles: ["software-user"] }
    ]);
    expect((await api(`${teamPath}/members`, "PUT", { userIds: ["bulk-inactive"] })).status).toBe(200);
    expect((await api(teamPath, "DELETE")).status).toBe(204);
    expect((await api<{ members: ProjectMemberDto[] }>(rosterPath)).body.members).toEqual(granted);
    expect((await getAuthContext(db, "bulk-bob")).projectMemberships).toEqual([{ projectId: "bulk-project", roles: ["software-user"] }]);
    expect((await getAuthContext(db, "bulk-bob")).roles).toEqual([{ projectId: null, roleId: "guest" }]);
    expect((await getAuthContext(db, "bulk-platform")).organization.id).toBe("bulk-home");
  });
  it("returns explicit mixed outcomes for conflict, foreign member and unauthorized caller without overwriting current grants", async () => {
    const results = await Promise.all([
      api(`${rosterPath}/bulk-alice`, "PUT", { roles: ["software-user"], expectedRoles: [] }),
      api(`${rosterPath}/bulk-bob`, "PUT", { roles: ["software-user"], expectedRoles: [] }),
      api(`${rosterPath}/bulk-foreign`, "PUT", { roles: ["software-user"], expectedRoles: [] })
    ]);
    expect(results.map((result) => result.status), JSON.stringify(results.map((result) => result.body))).toEqual([409, 200, 404]);
    expect((await api(`${rosterPath}/bulk-alice`, "PUT", { roles: ["software-committer"], expectedRoles: ["hardware-user"] }, "bulk-bob")).status).toBe(403);
    expect((await api<{ members: ProjectMemberDto[] }>(rosterPath)).body.members.map(({ userId, roles }) => ({ userId, roles }))).toEqual([
      { userId: "bulk-alice", roles: ["hardware-user"] }, { userId: "bulk-bob", roles: ["software-user"] }
    ]);
    const inactive = (await api<{ items: Array<{ id: string; isActive: boolean }> }>("/api/v1/users")).body.items.find((user) => user.id === "bulk-inactive");
    expect(inactive?.isActive).toBe(false);
  });
});
