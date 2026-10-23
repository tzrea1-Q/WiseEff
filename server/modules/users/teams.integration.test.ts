import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import type { AuthContext } from "../auth/types";

type Team = { id: string; organizationId: string; name: string; memberIds: string[] };
const home = { id: "teams-home", name: "Home" }, target = { id: "teams-target", name: "Target" };
const actor = (role: "platform-admin" | "admin" | "software-user" = "platform-admin"): AuthContext => ({
  user: { id: role === "platform-admin" ? "teams-platform" : role === "admin" ? "teams-admin" : "teams-reader", organizationId: home.id, name: "Operator", title: "", isActive: true },
  organization: home, roles: [{ projectId: null, roleId: role }], permissions: role === "software-user" ? [] : ["users:manage", "admin:access", ...(role === "platform-admin" ? ["platform:access" as const] : [])]
});

describe("flat organization teams through HTTP and PostgreSQL", () => {
  let db: RootDatabase;
  let ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("teams"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: home, users: [{ id: "teams-platform" }, { id: "teams-admin" }, { id: "teams-reader" }] });
    await seedCoreGraph(db, { organization: target, users: [{ id: "teams-member-a" }, { id: "teams-member-b", isActive: false }], projects: [{ id: "teams-project" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('teams-platform-role','teams-platform',$1,'platform-admin'),('teams-admin-role','teams-admin',$1,'admin'),('teams-reader-role','teams-reader',$1,'software-user'),('teams-member-role','teams-member-a',$2,'software-user')", [home.id, target.id]);
  });
  afterEach(async () => { try { await db?.close(); } finally { await ephemeral?.drop(); } });
  function request<T>(path = "", method = "GET", body?: unknown, role: Parameters<typeof actor>[0] = "platform-admin", organizationId = target.id) {
    return requestJson<T>(createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: { verify: async () => actor(role) } } }),
      `/api/v1/organization/teams${path}?organizationId=${organizationId}`, { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  it("creates and renames a target team and keeps the actor's Home organization", async () => {
    const created = await request<{ item: Team }>("", "POST", { name: "研发团队" });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ organizationId: target.id, name: "研发团队", memberIds: [] });
    const renamed = await request<{ item: Team }>(`/${created.body.item.id}`, "PATCH", { name: "软件团队" });
    expect(renamed.status).toBe(200);
    expect((await request<{ items: Team[] }>()).body.items).toEqual([expect.objectContaining({ name: "软件团队" })]);
    const events = await db.query<{ actor_user_id: string; organization_id: string }>("select actor_user_id,organization_id from audit_events where target_id=$1 order by created_at", [created.body.item.id]);
    expect(events.rows).toEqual([{ actor_user_id: "teams-platform", organization_id: target.id }, { actor_user_id: "teams-platform", organization_id: target.id }]);
    expect((await db.query<{ organization_id: string }>("select organization_id from users where id='teams-platform'")).rows[0].organization_id).toBe(home.id);
  });

  it("supports explicit bulk membership in multiple teams without granting or deleting project permissions", async () => {
    const first = (await request<{ item: Team }>("", "POST", { name: "研发" })).body.item;
    const second = (await request<{ item: Team }>("", "POST", { name: "验证" })).body.item;
    const beforeRoles = (await db.query("select user_id,project_id,role_id from user_role_bindings order by user_id,role_id")).rows;
    const selected = await request<{ item: Team }>(`/${first.id}/members`, "PUT", { userIds: ["teams-member-b", "teams-member-a", "teams-member-a"] });
    expect(selected.status).toBe(200);
    expect(selected.body.item.memberIds).toEqual(["teams-member-a", "teams-member-b"]);
    expect((await request(`/${second.id}/members`, "PUT", { userIds: ["teams-member-a"] })).status).toBe(200);
    expect((await request<{ items: Team[] }>()).body.items.filter((team) => team.memberIds.includes("teams-member-a"))).toHaveLength(2);
    expect((await request(`/${first.id}/members`, "PUT", { userIds: ["teams-member-b"] })).status).toBe(200);
    expect((await request(`/${first.id}`, "DELETE")).status).toBe(204);
    expect((await request<{ items: Team[] }>()).body.items).toEqual([expect.objectContaining({ id: second.id, memberIds: ["teams-member-a"] })]);
    expect((await db.query("select user_id,project_id,role_id from user_role_bindings order by user_id,role_id")).rows).toEqual(beforeRoles);
    expect((await db.query("select id from projects where id='teams-project'")).rowCount).toBe(1);
    expect((await db.query<{ is_active: boolean }>("select is_active from users where id='teams-member-b'")).rows).toEqual([{ is_active: false }]);
    expect((await request(`/${first.id}`, "DELETE")).status).toBe(404);
  });

  it("rejects invalid names, duplicate names, foreign members and foreign teams without partial membership changes", async () => {
    const first = (await request<{ item: Team }>("", "POST", { name: "Team" })).body.item;
    expect((await request("", "POST", { name: " team " })).status).toBe(409);
    expect((await request("", "POST", { name: " " })).status).toBe(400);
    expect((await request("", "POST", { name: "x".repeat(81) })).status).toBe(400);
    await request(`/${first.id}/members`, "PUT", { userIds: ["teams-member-a"] });
    expect((await request(`/${first.id}/members`, "PUT", { userIds: ["teams-member-b", "teams-admin"] })).status).toBe(404);
    expect((await request<{ items: Team[] }>()).body.items[0].memberIds).toEqual(["teams-member-a"]);
    const foreign = (await request<{ item: Team }>("", "POST", { name: "Home team" }, "admin", home.id)).body.item;
    for (const [path, method, body] of [[`/${foreign.id}`, "PATCH", { name: "stolen" }], [`/${foreign.id}/members`, "PUT", { userIds: [] }], [`/${foreign.id}`, "DELETE", undefined]] as const) {
      expect((await request(path, method, body)).status).toBe(404);
    }
    for (const role of ["admin", "software-user"] as const) {
      for (const [path, method, body] of [["", "GET", undefined], ["", "POST", { name: "Forbidden" }], [`/${first.id}`, "PATCH", { name: "Forbidden" }], [`/${first.id}/members`, "PUT", { userIds: [] }], [`/${first.id}`, "DELETE", undefined]] as const) {
        expect((await request(path, method, body, role)).status).toBe(403);
      }
    }
    expect((await request("", "POST", { name: "Allowed home team" }, "admin", home.id)).status).toBe(201);
    expect((await request("", "GET", undefined, "software-user", home.id)).status).toBe(403);
    expect((await request("", "POST", { name: "Forbidden home team" }, "software-user", home.id)).status).toBe(403);
  });

  it("enforces same-organization membership and uniqueness in PostgreSQL independently of HTTP validation", async () => {
    const team = (await request<{ item: Team }>("", "POST", { name: "Database constrained" })).body.item;
    await expect(db.transaction((tx) => tx.query("insert into organization_team_members(team_id,organization_id,user_id) values($1,$2,'teams-admin')", [team.id, target.id]))).rejects.toMatchObject({ code: "23503" });
    await request(`/${team.id}/members`, "PUT", { userIds: ["teams-member-a"] });
    await expect(db.transaction((tx) => tx.query("insert into organization_team_members(team_id,organization_id,user_id) values($1,$2,'teams-member-a')", [team.id, target.id]))).rejects.toMatchObject({ code: "23505" });
    expect((await request<{ items: Team[] }>()).body.items[0].memberIds).toEqual(["teams-member-a"]);
  });

  it("serializes concurrent membership replacements and rejects concurrent duplicate team creation", async () => {
    const creations = await Promise.all([request<{ item: Team }>("", "POST", { name: "Concurrent" }), request<{ item: Team }>("", "POST", { name: "Concurrent" })]);
    expect(creations.map((result) => result.status).sort()).toEqual([201, 409]);
    const id = creations.find((result) => result.status === 201)!.body.item.id;
    const results = await Promise.all([request(`/${id}/members`, "PUT", { userIds: ["teams-member-a"] }), request(`/${id}/members`, "PUT", { userIds: ["teams-member-b"] })]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const finalMembers = (await request<{ items: Team[] }>()).body.items[0].memberIds;
    expect([["teams-member-a"], ["teams-member-b"]]).toContainEqual(finalMembers);
  });

  it("rolls the domain mutation back if the same-transaction audit cannot be stored", async () => {
    await db.query(`create function public.reject_test_team_audit() returns trigger language plpgsql as $$ begin
      if new.kind='organization-team' then raise exception 'Test audit failure'; end if; return new; end; $$;
      create trigger reject_test_team_audit before insert on audit_events for each row execute function public.reject_test_team_audit()`);
    expect((await request("", "POST", { name: "Must roll back" })).status).toBe(500);
    expect((await request<{ items: Team[] }>()).body.items).toEqual([]);
  });
});
