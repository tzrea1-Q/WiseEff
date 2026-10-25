import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createXiaozeCheckpointer } from "../agent/xiaoze/checkpointer";
import { installPublishedReleaseA } from "../catalog-kernel/runtime/catalogChain.fixture";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";

type Preview = { stateDigest: string; blockers: { code: string }[]; inventory: { key: string; category: string; count: number }[] };
type Draft = { resourceId: string; revision: number };
const relations = ["resources", "members", "drafts", "draft_members", "revisions", "revision_members", "publication_previews"];
const source = '/ { battery { compatible = "test,battery"; status = "disabled"; }; };\n';

describe("Shared DTSI organization erasure through HTTP and a PostgreSQL API login", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  const token = `orgdtsi${randomBytes(5).toString("hex")}`;
  const agentCheckpointer = createXiaozeCheckpointer();
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("shared-org-erasure"); db = createPostgresDatabase(lane.url);
    for (const id of ["home", "target", "foreign"]) {
      await seedCoreGraph(db, { organization: { id: `dtsi-${id}` }, users: [{ id: `dtsi-${id}-admin` }] });
    }
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('dtsi-home-role','dtsi-home-admin','dtsi-home','platform-admin'),
      ('dtsi-target-role','dtsi-target-admin','dtsi-target','admin'),
      ('dtsi-foreign-role','dtsi-foreign-admin','dtsi-foreign','admin')`);
    await installPublishedReleaseA(getRootPostgresPool(db)!);
    const runtime = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolinherit: false }]);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); });
  const target = "/api/v1/platform/organizations/dtsi-target";
  function request<T>(path: string, method = "GET", body?: unknown, user = "dtsi-home-admin") {
    return requestJson<T>(createWiseEffServer({ db: api, agentCheckpointer }), path, {
      method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  const preview = () => request<{ item: Preview }>(`${target}/deletion-preview`);

  it("classifies all seven empty shared-source relations without blocking an otherwise deletable organization", async () => {
    const response = await preview();
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body.item.blockers).toEqual([]);
    for (const relation of relations) expect(response.body.item.inventory)
      .toContainEqual({ key: `public.shared_dtsi_${relation}`, category: "organization-parameters", count: 0 });
  });

  it("erases owned drafts and immutable history while preserving foreign source and platform Catalog", async () => {
    async function create(user: string, name: string, publish: boolean) {
      const result = await request<{ item: Draft }>("/api/v2/shared-dtsi", "POST", {
        name, sourceName: "battery.dtsi", content: source, changeDescription: "Initial shared declaration"
      }, user);
      expect(result.status, result.bodyText).toBe(201);
      const resource = `/api/v2/shared-dtsi/${result.body.item.resourceId}`;
      const prepared = await request<{ item: { id: string } }>(`${resource}/publication-preview`, "POST", { expectedRevision: 1 }, user);
      expect(prepared.status, prepared.bodyText).toBe(201);
      if (!publish) return { resource, draft: result.body.item };
      const published = await request<{ item: { id: string } }>(`${resource}/publications`, "POST", {
        previewId: prepared.body.item.id, idempotencyKey: name.replaceAll(" ", "-")
      }, user);
      expect(published.status, published.bodyText).toBe(201);
      return { resource, version: published.body.item.id, draft: result.body.item };
    }
    const owned = await create("dtsi-target-admin", "Owned published", true);
    const draft = await create("dtsi-target-admin", "Owned draft", false);
    const foreign = await create("dtsi-foreign-admin", "Foreign published", true);
    const foreignDraft = await create("dtsi-foreign-admin", "Foreign draft", false);
    const foreignVersion = await request(`${foreign.resource}/versions/${foreign.version}`, "GET", undefined, "dtsi-foreign-admin");
    const foreignSource = await request(foreignDraft.resource, "GET", undefined, "dtsi-foreign-admin");
    await expect(api.query("select parameter_catalog.definition_purge_mark('public.shared_dtsi_revisions','[]','DELETE')"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(api.query("insert into parameter_catalog.definition_purge_rows values(txid_current(),'public.shared_dtsi_revisions',$1,'DELETE')", [{ id: owned.version }]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(api.transaction(async tx => {
      await tx.query("select set_config('wiseeff.organization_erasure_id','forged',true),set_config('wiseeff.organization_erasure_lease','forged',true)");
      await tx.query("delete from public.shared_dtsi_resources where id=$1", [owned.draft.resourceId]);
    })).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("update public.shared_dtsi_revisions set name='rewrite' where id=$1", [owned.version])).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("delete from public.shared_dtsi_revision_members where revision_id=$1", [owned.version])).rejects.toMatchObject({ code: "55000" });
    const catalog = () => db.query(`select
      (select jsonb_agg(to_jsonb(r) order by id) from parameter_catalog.parameter_definitions r) definitions,
      (select jsonb_agg(to_jsonb(r) order by id) from parameter_catalog.catalog_subjects r) subjects,
      (select jsonb_agg(to_jsonb(r) order by id) from parameter_catalog.catalog_releases r) releases`);
    const beforeCatalog = (await catalog()).rows;
    const initial = await preview();
    expect(initial.body.item.blockers).toEqual([]);
    for (const [relation, count] of Object.entries({ resources: 2, members: 2, drafts: 1, draft_members: 1,
      revisions: 1, revision_members: 1, publication_previews: 2 })) {
      expect(initial.body.item.inventory).toContainEqual({ key: `public.shared_dtsi_${relation}`, category: "organization-parameters", count });
    }
    expect((await request(`${target}/deletion-preview`, "GET", undefined, "dtsi-target-admin")).status).toBe(403);
    expect((await request(`${target}/deletions`, "POST", {
      stateDigest: initial.body.item.stateDigest, confirmationOrganizationId: "dtsi-target"
    }, "dtsi-target-admin")).status).toBe(403);
    const edit = await request(`${draft.resource}/draft`, "PUT", {
      name: "Owned draft", sourceName: "battery.dtsi", content: source.replace("disabled", "okay"),
      expectedRevision: 1, changeDescription: "Draft default changed"
    }, "dtsi-target-admin");
    expect(edit.status, edit.bodyText).toBe(200);
    const stale = await request(`${target}/deletions`, "POST", {
      stateDigest: initial.body.item.stateDigest, confirmationOrganizationId: "dtsi-target"
    });
    expect(stale.status, stale.bodyText).toBe(409);
    const fresh = await preview();
    expect(fresh.body.item.stateDigest).not.toBe(initial.body.item.stateDigest);
    await db.query(`create function fail_shared_erasure() returns trigger language plpgsql as $$ begin raise exception 'transient shared source erasure failure'; end $$;
      create trigger fail_shared_erasure before delete on shared_dtsi_revision_members for each row execute function fail_shared_erasure()`);
    const started = await request<{ item: { id: string; status: string; domains: Record<string, { status: string }> } }>(`${target}/deletions`, "POST", {
      stateDigest: fresh.body.item.stateDigest, confirmationOrganizationId: "dtsi-target"
    });
    expect(started.status, started.bodyText).toBe(202);
    expect(started.body.item).toMatchObject({ status: "failed", domains: { "projects-parameters": { status: "failed" } } });
    for (const relation of relations) expect((await db.query(`select count(*)::int n from public.shared_dtsi_${relation} where organization_id='dtsi-target'`)).rows)
      .toEqual([{ n: fresh.body.item.inventory.find(item => item.key === `public.shared_dtsi_${relation}`)!.count }]);
    expect((await db.query("select content from shared_dtsi_revision_members where revision_id=$1", [owned.version])).rows).toEqual([{ content: source }]);
    expect((await db.query("select content from shared_dtsi_draft_members where resource_id=$1", [draft.draft.resourceId])).rows)
      .toEqual([{ content: source.replace("disabled", "okay") }]);
    await expect(api.transaction(async tx => {
      await tx.query("select set_config('wiseeff.organization_erasure_id',$1,true),set_config('wiseeff.organization_erasure_lease','forged',true)", [started.body.item.id]);
      await tx.query("delete from public.shared_dtsi_drafts where resource_id=$1", [draft.draft.resourceId]);
    })).rejects.toMatchObject({ code: "55000" });
    await db.query("drop trigger fail_shared_erasure on shared_dtsi_revision_members; drop function fail_shared_erasure()");
    const erased = await request<{ item: { id: string; status: string } }>(`/api/v1/platform/organization-deletions/${started.body.item.id}/retry`, "POST");
    expect(erased.status, erased.bodyText).toBe(200);
    expect(erased.body.item.status, erased.bodyText).toBe("deleted");
    for (const relation of relations) expect((await db.query(`select count(*)::int n from public.shared_dtsi_${relation} where organization_id='dtsi-target'`)).rows)
      .toEqual([{ n: 0 }]);
    expect((await db.query("select id from organizations where id='dtsi-target'")).rows).toEqual([]);
    expect((await request(`${owned.resource}/versions/${owned.version}`, "GET", undefined, "dtsi-foreign-admin")).status).toBe(404);
    expect((await request(`${foreign.resource}/versions/${foreign.version}`, "GET", undefined, "dtsi-foreign-admin")).body).toEqual(foreignVersion.body);
    expect((await request(foreignDraft.resource, "GET", undefined, "dtsi-foreign-admin")).body).toEqual(foreignSource.body);
    expect((await catalog()).rows).toEqual(beforeCatalog);
    expect((await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${erased.body.item.id}/retry`, "POST")).body.item.status).toBe("deleted");
  });

  it("upgrades populated published source without changing bytes and makes the existing API login able to erase its Organization", async () => {
    await withTempDatabase({ prefix: "orgdtsiupgrade", migrate: false }, async ({ db: legacy, connectionString }) => {
      await applyMigrations(legacy, migrationsDir, { before: "0296_shared_dtsi_organization_erasure.sql" });
      for (const id of ["home", "target"]) await seedCoreGraph(legacy, {
        organization: { id: `upgrade-dtsi-${id}` }, users: [{ id: `upgrade-dtsi-${id}-admin` }]
      });
      await seedBaselineAuthCatalog(legacy);
      await legacy.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
        ('upgrade-dtsi-home-role','upgrade-dtsi-home-admin','upgrade-dtsi-home','platform-admin'),
        ('upgrade-dtsi-target-role','upgrade-dtsi-target-admin','upgrade-dtsi-target','admin')`);
      const upgradeToken = `${token}up`, runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: upgradeToken });
      const upgradedApi = createPostgresDatabase(runtime.apiUrl);
      const call = <T>(path: string, method = "GET", body?: unknown, user = "upgrade-dtsi-target-admin") =>
        requestJson<T>(createWiseEffServer({ db: upgradedApi, agentCheckpointer }), path, {
          method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      try {
        const created = await call<{ item: Draft }>("/api/v2/shared-dtsi", "POST", {
          name: "Pre-upgrade source", sourceName: "battery.dtsi", content: source, changeDescription: "Before upgrade"
        });
        expect(created.status, created.bodyText).toBe(201);
        const resource = `/api/v2/shared-dtsi/${created.body.item.resourceId}`;
        const prepared = await call<{ item: { id: string } }>(`${resource}/publication-preview`, "POST", { expectedRevision: 1 });
        expect(prepared.status, prepared.bodyText).toBe(201);
        const published = await call<{ item: { id: string } }>(`${resource}/publications`, "POST", {
          previewId: prepared.body.item.id, idempotencyKey: "before-upgrade"
        });
        expect(published.status, published.bodyText).toBe(201);
        const newDraft = await call(`${resource}/draft`, "POST", { baseVersionId: published.body.item.id });
        expect(newDraft.status, newDraft.bodyText).toBe(201);
        const beforeVersion = await call(`${resource}/versions/${published.body.item.id}`);
        const beforeDraft = await call(resource);
        const target = "/api/v1/platform/organizations/upgrade-dtsi-target";
        const blocked = await call<{ item: Preview }>(`${target}/deletion-preview`, "GET", undefined, "upgrade-dtsi-home-admin");
        expect(blocked.status, blocked.bodyText).toBe(200);
        expect(blocked.body.item.blockers).toContainEqual(expect.objectContaining({ code: "unclassified-ownership" }));
        expect(await applyMigrations(legacy, migrationsDir)).toContain("0296_shared_dtsi_organization_erasure.sql");
        expect((await call(`${resource}/versions/${published.body.item.id}`)).body).toEqual(beforeVersion.body);
        expect((await call(resource)).body).toEqual(beforeDraft.body);
        const ready = await call<{ item: Preview }>(`${target}/deletion-preview`, "GET", undefined, "upgrade-dtsi-home-admin");
        expect(ready.body.item.blockers).toEqual([]);
        const erased = await call<{ item: { status: string } }>(`${target}/deletions`, "POST", {
          stateDigest: ready.body.item.stateDigest, confirmationOrganizationId: "upgrade-dtsi-target"
        }, "upgrade-dtsi-home-admin");
        expect(erased.status, erased.bodyText).toBe(202);
        expect(erased.body.item.status, erased.bodyText).toBe("deleted");
      } finally { await upgradedApi.close(); await dropLabRuntimeLogins(connectionString, upgradeToken); }
    });
  }, 120_000);
});
