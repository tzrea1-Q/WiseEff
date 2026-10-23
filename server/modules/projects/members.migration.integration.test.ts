import { describe, expect, it } from "vitest";
import { applyTestMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { getAuthContext } from "../auth/repository";
import { canEditParameters, canMergeParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { makeTestAuthContext } from "../../testing/authContext";

describe("existing project participation expansion (real PostgreSQL)", () => {
  it("preserves effective editing and independent duties while exposing the migrated roster", async () => {
    await withTempDatabase({ prefix: "projectmembers", migrate: false }, async ({ db }) => {
      await applyTestMigrations(db, migrationsDir, { through: "0263_log_operating_organization_erasure.sql" });
      await db.query("insert into organizations(id,name) values('members-a','Members A'),('members-b','Members B')");
      await db.query(`insert into projects(id,organization_id,name,code,status) values
        ('members-one','members-a','Project One','ONE','active'),('members-two','members-a','Project Two','TWO','archived'),
        ('members-foreign','members-b','Foreign Project','OTHER','active')`);
      for (const [id, active, org] of [
        ["members-admin", true, "members-a"], ["members-global", true, "members-a"], ["members-scoped", true, "members-a"],
        ["members-inactive", false, "members-a"], ["members-guest", true, "members-a"], ["members-other", true, "members-b"]
      ] as const) {
        await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,'Engineer',$3)", [id, org, active]);
      }
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
        ('members-admin-role','members-admin','members-a',null,'admin'),
        ('members-global-hw','members-global','members-a',null,'hardware-user'),
        ('members-global-sw','members-global','members-a',null,'software-committer'),
        ('members-scoped-sw','members-scoped','members-a','members-one','software-user'),
        ('members-scoped-hw','members-scoped','members-a','members-two','hardware-committer'),
        ('members-inactive-role','members-inactive','members-a',null,'software-user'),
        ('members-guest-role','members-guest','members-a',null,'guest'),
        ('members-orphan-role','members-guest','members-a','members-absent','hardware-user'),
        ('members-other-role','members-other','members-b',null,'software-user')`);
      const bindingsBefore = await db.query("select * from user_role_bindings order by id");
      const usersBefore = await db.query("select id,organization_id,is_active from users order by id");
      async function qualifications(legacy = false) {
        return Promise.all(["members-admin", "members-global", "members-scoped", "members-guest"].map(async (userId) => {
          // Frozen pre-membership qualification, read before upgrading. The current
          // auth reader also needs newer credential columns and is not a historical reader.
          const roles = legacy ? (await db.query<{ projectId: string | null; roleId: "admin" | "guest" | "hardware-user" | "software-user" | "hardware-committer" | "software-committer" }>(
            'select project_id as "projectId",role_id as "roleId" from user_role_bindings where user_id=$1', [userId])).rows : [];
          const auth = legacy ? makeTestAuthContext({ userId, organizationId: "members-a", roles }) : await getAuthContext(db, userId);
          return { userId, permissions: auth.permissions, projects: ["members-one", "members-two"].map((id) => ({ id,
            edit: legacy ? auth.permissions.includes("parameter:edit") && roles.some((role) => role.roleId === "admin" ||
              role.roleId !== "guest" && (role.projectId === null || role.projectId === id)) : canEditParameters(auth, id), hardwareReview: canReviewParameterStage(auth, id, "hardware_review"),
            softwareReview: canReviewParameterStage(auth, id, "software_review"), merge: canMergeParameters(auth, id) })) };
        }));
      }
      const before = await qualifications(true);
      expect(before.map(({ userId, projects }) => ({ userId, projects }))).toEqual([
        { userId: "members-admin", projects: [
          { id: "members-one", edit: true, hardwareReview: true, softwareReview: true, merge: true },
          { id: "members-two", edit: true, hardwareReview: true, softwareReview: true, merge: true }
        ] },
        { userId: "members-global", projects: [
          { id: "members-one", edit: true, hardwareReview: false, softwareReview: false, merge: false },
          { id: "members-two", edit: true, hardwareReview: false, softwareReview: false, merge: false }
        ] },
        { userId: "members-scoped", projects: [
          { id: "members-one", edit: true, hardwareReview: false, softwareReview: false, merge: true },
          { id: "members-two", edit: true, hardwareReview: true, softwareReview: false, merge: false }
        ] },
        { userId: "members-guest", projects: [
          { id: "members-one", edit: false, hardwareReview: false, softwareReview: false, merge: false },
          { id: "members-two", edit: false, hardwareReview: false, softwareReview: false, merge: false }
        ] }
      ]);
      await applyTestMigrations(db, migrationsDir);
      const auth = await getAuthContext(db, "members-admin");
      const api = () => createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => auth } } });
      const roster = await requestJson<{ projectId: string; members: Array<{ userId: string; isActive: boolean; roles: string[] }> }>(
        api(), "/api/v1/projects/members-one/members", { headers: { Authorization: "Bearer fixture" } });
      expect(roster.status).toBe(200);
      expect(roster.body).toMatchObject({ projectId: "members-one", members: [
        { userId: "members-global", isActive: true, roles: ["hardware-user", "software-committer"] },
        { userId: "members-inactive", isActive: false, roles: ["software-user"] },
        { userId: "members-scoped", isActive: true, roles: ["software-user"] }
      ] });
      expect((await qualifications()).map((item) => ({ ...item, permissions: [...item.permissions].sort() }))).toEqual(before.map((item) => ({ ...item, permissions: [...item.permissions].sort() })));
      expect((await db.query("select * from user_role_bindings order by id")).rows).toEqual(bindingsBefore.rows);
      expect((await db.query("select id,organization_id,is_active from users order by id")).rows).toEqual(usersBefore.rows);
      const second = await requestJson<{ members: Array<{ userId: string; roles: string[] }> }>(
        api(), "/api/v1/projects/members-two/members", { headers: { Authorization: "Bearer fixture" } });
      expect(second.body.members.find((member) => member.userId === "members-scoped")?.roles).toEqual(["hardware-committer"]);
      const rosters = [roster.body.members, second.body.members];
      for (const qualification of before) {
        for (const [index, project] of qualification.projects.entries()) {
          const explicitEdit = rosters[index].some((member) => member.userId === qualification.userId && member.roles.length > 0);
          expect(explicitEdit || qualification.userId === "members-admin").toBe(project.edit);
        }
      }
      expect((await requestJson(api(), "/api/v1/projects/members-foreign/members", { headers: { Authorization: "Bearer fixture" } })).status).toBe(404);
      expect((await requestJson(api(), "/api/v1/projects/members-absent/members", { headers: { Authorization: "Bearer fixture" } })).status).toBe(404);
      await expect(getAuthContext(db, "members-inactive")).rejects.toThrow("User is inactive.");
    });
  }, 120_000);

  it("keeps target rosters administrative, enforces tenant references and offers no membership mutation", async () => {
    await withTempDatabase({ prefix: "projectmembers" }, async ({ db }) => {
      await db.query("insert into organizations(id,name) values('roster-home','Home'),('roster-target','Target')");
      await db.query("insert into projects(id,organization_id,name,code) values('roster-project','roster-target','Target project','TARGET')");
      for (const [id, org, role] of [["roster-platform", "roster-home", "platform-admin"], ["roster-admin", "roster-home", "admin"],
        ["roster-member", "roster-target", "software-user"], ["roster-target-admin", "roster-target", "admin"]]) {
        await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,'Engineer',true)", [id, org]);
        await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`${id}-role`, id, org, role]);
      }
      await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('roster-target','roster-project','roster-member',array['software-user'])");
      async function read(userId: string, path: string, method = "GET") {
        const auth = await getAuthContext(db, userId);
        const api = createWiseEffServer({ db, auth: { mode: "production", verifier: { verify: async () => auth } } });
        return requestJson<{ members: Array<{ userId: string }> }>(api, path, { method, headers: { Authorization: "Bearer fixture" } });
      }
      const path = "/api/v1/projects/roster-project/members";
      expect((await read("roster-platform", `${path}?organizationId=roster-target`)).body.members.map((member) => member.userId)).toEqual(["roster-member"]);
      expect((await read("roster-platform", path)).status).toBe(404);
      expect((await read("roster-admin", `${path}?organizationId=roster-target`)).status).toBe(403);
      expect((await read("roster-member", path)).status).toBe(403);
      expect((await read("roster-target-admin", path)).status).toBe(200);
      expect((await read("roster-target-admin", path, "PUT")).status).toBe(404);
      await expect(db.query("insert into project_members(organization_id,project_id,user_id,roles) values('roster-home','roster-project','roster-admin',array['software-user'])")).rejects.toMatchObject({ code: "23503" });
      await expect(db.query("insert into project_members(organization_id,project_id,user_id,roles) values('roster-target','roster-project','roster-admin',array['software-user'])")).rejects.toMatchObject({ code: "23503" });
      await expect(db.query("update project_members set roles=array['admin']")).rejects.toMatchObject({ code: "23514" });
      expect((await getAuthContext(db, "roster-platform")).organization.id).toBe("roster-home");
    });
  });
});
