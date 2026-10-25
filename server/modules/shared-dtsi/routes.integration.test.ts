import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  const publicationCall = <T>(path: string, method = "GET", body?: unknown, actor = auth) =>
    requestJson<T>(server(actor), `/api/v2/shared-dtsi${path}`, {
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

  it("publishes a frozen source version, reads history without a draft, and replays the same request", async () => {
    const created = await call("", "POST", { name: "Published battery", sourceName: "battery.dtsi", content: source,
      changeDescription: "首次发布电池公共声明" });
    expect(created.status, created.bodyText).toBe(201);
    const draft = created.body.item;
    const preview = await publicationCall<{ item: { id: string; draftRevision: number; changeDescription: string } }>(
      `/${draft.resourceId}/publication-preview`, "POST", { expectedRevision: draft.revision });
    expect(preview.status, preview.bodyText).toBe(201);
    expect(preview.body.item).toMatchObject({ draftRevision: 1, changeDescription: "首次发布电池公共声明" });
    const request = { previewId: preview.body.item.id, idempotencyKey: "publish-first-battery" };
    type Published = { item: { id: string; version: number; changeDescription: string; members: Draft["members"] } };
    const published = await publicationCall<Published>(`/${draft.resourceId}/publications`, "POST", request);
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item).toMatchObject({ version: 1, changeDescription: "首次发布电池公共声明",
      members: [{ id: draft.members[0]!.id, sourceName: "battery.dtsi", content: source }] });
    expect((await call(`/${draft.resourceId}`)).status).toBe(404);
    const detail = await publicationCall<{ item: { draftRevision: number | null; currentVersion: { id: string } } }>(`/${draft.resourceId}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.item).toMatchObject({ draftRevision: null, currentVersion: { id: published.body.item.id } });
    expect((await call("")).body.items).toContainEqual(expect.objectContaining({ resourceId: draft.resourceId, name: "Published battery" }));
    expect((await publicationCall<Published>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    const replay = await publicationCall<Published>(`/${draft.resourceId}/publications`, "POST", request);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(published.body);
    const history = await publicationCall<{ items: { id: string }[] }>(`/${draft.resourceId}/versions`);
    expect(history.body.items.map(item => item.id)).toEqual([published.body.item.id]);
  });

  it("refuses stale or unauthorized publication and serializes competing previews", async () => {
    const input={name:"Guarded publication",sourceName:"guarded.dtsi",content:source,changeDescription:"共享默认状态"};
    const draft=(await call("","POST",input)).body.item;
    type Preview={item:{id:string}};
    const first=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    await call(`/${draft.resourceId}/draft`,"PUT",{...input,content:source.replace("disabled","okay"),expectedRevision:1});
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:first.body.item.id,idempotencyKey:"stale-publish"})).status).toBe(409);
    const next=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const reader={...auth,roles:[],permissions:["parameter:view"] as typeof auth.permissions};
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:next.body.item.id,idempotencyKey:"denied-publish"},reader)).status).toBe(403);
    const other=makeTestAuthContext({organizationId:"org-other-dtsi",userId:"user-other-dtsi"});
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:next.body.item.id,idempotencyKey:"foreign-publish"},other)).status).toBe(404);
    const competing=await publicationCall<Preview>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:2});
    const results=await Promise.all([next.body.item.id,competing.body.item.id].map((previewId,i)=>publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId,idempotencyKey:`race-publish-${i}`})));
    expect(results.map(result=>result.status).sort()).toEqual([201,409]);
    const versions=await publicationCall<{items:{version:number}[]}>(`/${draft.resourceId}/versions`);
    expect(versions.body.items.map(item=>item.version)).toEqual([1]);
  });

  it("retains immutable published source after creating and discarding another draft", async () => {
    const draft=(await call("","POST",{name:"Retained history",sourceName:"history.dtsi",content:source,changeDescription:"保留公共历史"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    type Version={item:{id:string;members:Draft["members"]}};
    const published=await publicationCall<Version>(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"retained-history"});
    const newDraft=await publicationCall<{item:Draft}>(`/${draft.resourceId}/draft`,"POST",{baseVersionId:published.body.item.id});
    expect(newDraft.status,newDraft.bodyText).toBe(201);
    expect(newDraft.body.item.id).not.toBe(draft.id);
    expect(newDraft.body.item.members[0]!.id).toBe(draft.members[0]!.id);
    const changed=await call(`/${draft.resourceId}/draft`,"PUT",{name:"Renamed draft",sourceName:"inc/renamed.dtsi",content:source.replace("disabled","okay"),changeDescription:"修改后续草稿",expectedRevision:1});
    expect(changed.status).toBe(200);
    expect(changed.body.item.members[0]!.id).toBe(draft.members[0]!.id);
    expect((await call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:2})).status).toBe(200);
    expect((await publicationCall<{item:{name:string}}>(`/${draft.resourceId}/detail`)).body.item.name).toBe("Retained history");
    expect((await publicationCall<Version>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    await expect(api.query("update public.shared_dtsi_revisions set name='changed' where id=$1",[published.body.item.id])).rejects.toThrow();
    await expect(api.query("delete from public.shared_dtsi_resources where id=$1",[draft.resourceId])).rejects.toThrow();
    expect((await publicationCall<Version>(`/${draft.resourceId}/versions/${published.body.item.id}`)).body).toEqual(published.body);
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"retained-history"})).status).toBe(200);
  });

  it("serializes publication and discard without inverted source and preview locks",async()=>{
    const draft=(await call("","POST",{name:"Publication discard race",sourceName:"race.dtsi",content:source,changeDescription:"并发发布与丢弃"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    const role=(await api.query<{role:string}>("select current_user as role")).rows[0]!.role;
    const waitForLockCount=(count:number)=>vi.waitFor(async()=>{
      const waiting=(await db.query<{count:string}>("select count(*) from pg_stat_activity where datname=current_database() and usename=$1 and wait_event_type='Lock'",[role])).rows[0]!.count;
      expect(Number(waiting)).toBeGreaterThanOrEqual(count);
    },{timeout:5000,interval:10});
    const requests:Promise<{status:number;bodyText:string}>[]=[];
    let results:PromiseSettledResult<{status:number;bodyText:string}>[]=[];
    try {
      await db.transaction(async gate=>{
        await gate.query("select id from public.shared_dtsi_publication_previews where id=$1 for update",[preview.body.item.id]);
        requests.push(publicationCall(`/${draft.resourceId}/publications`,"POST",{previewId:preview.body.item.id,idempotencyKey:"publish-discard-race"}));
        await waitForLockCount(1);
        requests.push(call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:1}));
        await waitForLockCount(2);
      });
    } finally {results=await Promise.allSettled(requests);}
    expect(results.map(result=>result.status==="fulfilled"?result.value.status:-1)).toEqual([201,404]);
    expect((await publicationCall<{items:{version:number}[]}>(`/${draft.resourceId}/versions`)).body.items.map(version=>version.version)).toEqual([1]);
  },15_000);

  it("keeps drafts on invalid source or audit failure and allows a safe publication retry", async () => {
    for (const content of ["/ { broken {",'/include/ "missing.dtsi"\n/ {};', '#include "missing.h"\n/ {};', '/ { label: a {}; label: b {}; };']) {
      const draft=(await call("","POST",{name:"Invalid draft",sourceName:"invalid.dtsi",content,changeDescription:"检查语法与依赖"})).body.item;
      const rejected=await publicationCall(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
      expect(rejected.status,rejected.bodyText).toBe(400);
      expect((await call(`/${draft.resourceId}`)).body.item.members[0]!.content).toBe(content);
      await call(`/${draft.resourceId}/draft`,"DELETE",{expectedRevision:1});
    }
    const draft=(await call("","POST",{name:"Atomic publication",sourceName:"atomic.dtsi",content:source,changeDescription:"审计原子提交"})).body.item;
    const preview=await publicationCall<{item:{id:string}}>(`/${draft.resourceId}/publication-preview`,"POST",{expectedRevision:1});
    const request={previewId:preview.body.item.id,idempotencyKey:"atomic-publish"};
    await db.query(`create function public.reject_shared_publication_audit() returns trigger language plpgsql as $$begin
      if new.kind='shared-dtsi-publication' then raise exception 'Publication audit unavailable'; end if; return new; end$$;
      create trigger reject_shared_publication_audit before insert on public.audit_events for each row execute function public.reject_shared_publication_audit()`);
    try {
      expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",request)).status).toBe(500);
      expect((await call(`/${draft.resourceId}`)).body.item).toEqual(draft);
      expect((await publicationCall<{items:unknown[]}>(`/${draft.resourceId}/versions`)).body.items).toEqual([]);
    } finally { await db.query("drop trigger reject_shared_publication_audit on public.audit_events; drop function public.reject_shared_publication_audit()"); }
    expect((await publicationCall(`/${draft.resourceId}/publications`,"POST",request)).status).toBe(201);
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
