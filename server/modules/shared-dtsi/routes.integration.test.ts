import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { registerSharedDtsiRoutes } from "./routes";

const source = '/ { battery: battery { compatible = "test,battery"; status = "disabled"; }; };\n';
const auth = makeTestAuthContext({ organizationId: "org-shared-dtsi", userId: "user-shared-dtsi" });
type Draft = { id: string; resourceId: string; name: string; revision: number;
  members: { id: string; sourceName: string; content: string }[] };

describe("shared DTSI draft HTTP workflow (PostgreSQL API login)", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  const token = `shared_dtsi_${process.pid}`;
  function server(actor = auth) {
    const router = createRouter();
    registerSharedDtsiRoutes(router, { db: api, getCurrentAuthContext: () => actor });
    return createHttpServer(router);
  }
  const call = (path: string, method = "GET", body?: unknown, actor = auth) =>
    requestJson<{ item: Draft; items: Draft[]; error: { code: string } }>(server(actor), `/api/v2/shared-dtsi${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("shared-dtsi-t01");
    db = createPostgresDatabase(lane.url);
    await db.query("insert into organizations(id,name) values ('org-shared-dtsi','Shared source'),('org-other-dtsi','Other')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('user-shared-dtsi','org-shared-dtsi','Source author','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-dtsi-role','user-shared-dtsi','org-shared-dtsi','admin')");
    const logins = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(logins.apiUrl);
    expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ rolsuper: false, rolinherit: false });
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); });

  it("creates, reopens, updates and discards an exact source draft with stable member identity", async () => {
    const created = await call("", "POST", { name: "Battery common", sourceName: "battery.dtsi", content: source });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    expect(draft).toMatchObject({ name: "Battery common", revision: 1, members: [{ sourceName: "battery.dtsi", content: source }] });
    expect((await call("")).body.items).toEqual([expect.objectContaining({ resourceId: draft.resourceId, name: draft.name })]);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
    const content = source.replace("disabled", "okay");
    const updated = await call(`/${draft.resourceId}/draft`, "PUT", { name: "Battery common", sourceName: "inc/battery.dtsi", content, expectedRevision: 1 });
    expect(updated.status, updated.bodyText).toBe(200);
    expect(updated.body.item).toMatchObject({ id: draft.id, resourceId: draft.resourceId, revision: 2,
      members: [{ id: draft.members[0]!.id, sourceName: "inc/battery.dtsi", content }] });
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 2 })).status).toBe(200);
    expect((await call(`/${draft.resourceId}`)).status).toBe(404);
  });

  it("isolates resource reads and writes and denies read-only or inactive writers", async () => {
    const created = await call("", "POST", { name: "Private organization source", sourceName: "battery.dtsi", content: source });
    const draft = created.body.item;
    const other = makeTestAuthContext({ organizationId: "org-other-dtsi", userId: "user-other-dtsi" });
    expect((await call("", "GET", undefined, other)).body.items).toEqual([]);
    expect((await call(`/${draft.resourceId}`, "GET", undefined, other)).status).toBe(404);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 }, other)).status).toBe(404);
    const reader = { ...auth, roles: [], permissions: ["parameter:view"] as typeof auth.permissions };
    expect((await call(`/${draft.resourceId}`, "GET", undefined, reader)).status).toBe(200);
    expect((await call("", "POST", { name: "Denied", sourceName: "denied.dtsi", content: "" }, reader)).status).toBe(403);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 }, { ...auth, user: { ...auth.user, isActive: false } })).status).toBe(403);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });

  it("serializes competing updates and refuses stale saves and discards without losing source", async () => {
    const draft = (await call("", "POST", { name: "Concurrent source", sourceName: "battery.dtsi", content: source })).body.item;
    const updates = await Promise.all(["first", "second"].map(name => call(`/${draft.resourceId}/draft`, "PUT", {
      name, sourceName: "battery.dtsi", content: `// ${name}\n${source}`, expectedRevision: 1
    })));
    expect(updates.map(result => result.status).sort()).toEqual([200, 409]);
    const current = (await call(`/${draft.resourceId}`)).body.item;
    expect(current.revision).toBe(2);
    expect(current.members[0]!.content).toBe(`// ${current.name}\n${source}`);
    expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 })).status).toBe(409);
    expect((await call(`/${draft.resourceId}`)).body.item).toEqual(current);
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 2 });
  });

  it("accepts incomplete draft text but rejects unsafe paths and undeclared fields", async () => {
    for (const sourceName of ["../battery.dtsi", "/battery.dtsi", "inc\\battery.dtsi", "battery.dts"]) {
      expect((await call("", "POST", { name: "Invalid path", sourceName, content: source })).status).toBe(400);
    }
    expect((await call("", "POST", { name: "Forged scope", sourceName: "battery.dtsi", content: source, organizationId: "org-other-dtsi" })).status).toBe(400);
    const draft = (await call("", "POST", { name: "Incomplete source", sourceName: "battery.dtsi", content: "/ { unfinished {" })).body.item;
    expect((await call(`/${draft.resourceId}`)).body.item.members[0]!.content).toBe("/ { unfinished {");
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });

  it("rolls back a source write when its audit fails and keeps suspended resources readable", async () => {
    await db.query(`create function public.reject_shared_dtsi_audit() returns trigger language plpgsql as $$begin
      if new.kind='shared-dtsi-draft' then raise exception 'Shared source audit unavailable'; end if; return new; end$$;
      create trigger reject_shared_dtsi_audit before insert on public.audit_events for each row execute function public.reject_shared_dtsi_audit()`);
    try {
      expect((await call("", "POST", { name: "Rollback probe", sourceName: "battery.dtsi", content: source })).status).toBe(500);
      expect((await call("?q=Rollback")).body.items).toEqual([]);
    } finally {
      await db.query("drop trigger reject_shared_dtsi_audit on public.audit_events; drop function public.reject_shared_dtsi_audit()");
    }
    const draft = (await call("", "POST", { name: "Suspended source", sourceName: "battery.dtsi", content: source })).body.item;
    await db.query("update organizations set status='suspended' where id='org-shared-dtsi'");
    try {
      expect((await call(`/${draft.resourceId}`)).status).toBe(200);
      expect((await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 })).status).toBe(403);
    } finally { await db.query("update organizations set status='active' where id='org-shared-dtsi'"); }
    await call(`/${draft.resourceId}/draft`, "DELETE", { expectedRevision: 1 });
  });
});
