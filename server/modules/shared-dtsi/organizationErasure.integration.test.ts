import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createLocalObjectStore } from "../logs/objectStore";
import { getAuthContext } from "../auth/repository";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";

type Preview = { stateDigest: string; blockers: { code: string }[]; inventory: { key: string; category: string; count: number }[] };
type Draft = { resourceId: string; revision: number };
const relations = ["resources", "members", "drafts", "draft_members", "revisions", "revision_members", "publication_previews"];
const source = '/ { battery { compatible = "test,battery"; status = "disabled"; }; };\n';

describe("Shared DTSI organization erasure through HTTP and a PostgreSQL API login", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let directory: string, store: ReturnType<typeof createLocalObjectStore>;
  const token = `orgdtsi${randomBytes(5).toString("hex")}`;
  const agentCheckpointer = createXiaozeCheckpointer();
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("shared-org-erasure"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "orgdtsi-objects-")); store = createLocalObjectStore(directory);
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
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const target = "/api/v1/platform/organizations/dtsi-target";
  function request<T>(path: string, method = "GET", body?: unknown, user = "dtsi-home-admin") {
    return requestJson<T>(createWiseEffServer({ db: api, agentCheckpointer, objectStore: store }), path, {
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
    const auth = await getAuthContext(db, "dtsi-target-admin"), projectId = "dtsi-target-project";
    await db.query("insert into projects(id,organization_id,name,code,status) values($1,'dtsi-target','Referenced source','DTSI','initialized')", [projectId]);
    const set = await createConfigSet(db, auth, { projectId, name: "Fixed shared source" });
    const rootSource = '/dts-v1/; / { model = "Organization erasure"; };';
    const root = await uploadProjectParameterFile(db, store, auth, { projectId, fileName: "board.dts", bytes: Buffer.from(rootSource) });
    await addConfigSetFile(db, auth, { configSetId: set.id, fileId: root.file.id, role: "base", sortOrder: 0 });
    await ingestConfigRevision(db, { organizationId: "dtsi-target", projectId, configSetId: set.id, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: root.file.id, fileVersionId: root.version.id, fileName: "board.dts", role: "base", sortOrder: 0, content: rootSource }] }, auth);
    const memberPath = `/api/v1/projects/${projectId}/config-sets/${set.id}/member-addition`;
    const reference = { sharedReference: { resourceId: owned.draft.resourceId, versionId: owned.version }, role: "misc", sortOrder: 1 };
    const plan = await request<{ item: { proofToken: string } }>(`${memberPath}/preview`, "POST", reference, "dtsi-target-admin");
    expect(plan.status, plan.bodyText).toBe(200);
    const applied = await request(`${memberPath}/apply`, "POST", { ...reference, proofToken: plan.body.item.proofToken,
      reason: "Reference source before organization erasure", clientMutationId: "org-dtsi-reference" }, "dtsi-target-admin");
    expect(applied.status, applied.bodyText).toBe(200);
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
    expect(initial.body.item.inventory).toEqual(expect.arrayContaining([
      { key: "public.project_shared_dtsi_references", category: "projects", count: 1 },
      { key: "public.project_shared_dtsi_snapshots", category: "projects", count: 1 }
    ]));
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
    expect((await db.query("select id from project_shared_dtsi_references where organization_id='dtsi-target'")).rows).toEqual([]);
    expect((await db.query("select file_id from project_shared_dtsi_snapshots")).rows).toEqual([]);
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
        // Genuine pre-0296 rows: the current application requires later additive columns.
        // Seed the old contract through the already provisioned API login, then upgrade it.
        const resourceId=randomUUID(),memberId=randomUUID(),versionId=randomUUID(),draftId=randomUUID(),previewId=randomUUID();
        const checksum=`sha256:${createHash("sha256").update(source).digest("hex")}`,sizeBytes=Buffer.byteLength(source);
        const manifest={schemaVersion:"shared-dtsi/v1",members:[{id:memberId,sourceName:"battery.dtsi",checksum,sizeBytes,role:"include"}],
          externalReferences:[],includeGraph:[],buildInputs:{includeSearchPaths:[]}};
        const digest=`sha256:${createHash("sha256").update(JSON.stringify({name:"Pre-upgrade source",manifest,changeDescription:"Before upgrade"})).digest("hex")}`;
        await upgradedApi.transaction(async tx=>{
          await tx.query("insert into shared_dtsi_resources(id,organization_id,name) values ($1,'upgrade-dtsi-target','Pre-upgrade source')",[resourceId]);
          await tx.query("insert into shared_dtsi_members(id,resource_id,organization_id) values ($1,$2,'upgrade-dtsi-target')",[memberId,resourceId]);
          await tx.query(`insert into shared_dtsi_revisions(id,resource_id,organization_id,version,name,draft_revision,change_description,manifest,digest,created_by_user_id)
            values ($1,$2,'upgrade-dtsi-target',1,'Pre-upgrade source',1,'Before upgrade',$3::jsonb,$4,'upgrade-dtsi-target-admin')`,[versionId,resourceId,JSON.stringify(manifest),digest]);
          await tx.query(`insert into shared_dtsi_revision_members(revision_id,member_id,resource_id,organization_id,source_name,content,checksum,size_bytes)
            values ($1,$2,$3,'upgrade-dtsi-target','battery.dtsi',$4,$5,$6)`,[versionId,memberId,resourceId,source,checksum,sizeBytes]);
          await tx.query(`insert into shared_dtsi_drafts(id,resource_id,organization_id,created_by_user_id,updated_by_user_id)
            values ($1,$2,'upgrade-dtsi-target','upgrade-dtsi-target-admin','upgrade-dtsi-target-admin')`,[draftId,resourceId]);
          await tx.query(`insert into shared_dtsi_draft_members(draft_id,member_id,resource_id,organization_id,source_name,content)
            values ($1,$2,$3,'upgrade-dtsi-target','battery.dtsi',$4)`,[draftId,memberId,resourceId,source]);
          await tx.query(`insert into shared_dtsi_publication_previews(id,resource_id,organization_id,draft_id,draft_revision,actor_user_id,actor_fingerprint,
            name,change_description,manifest,members,digest,idempotency_key,published_revision_id)
            values ($1,$2,'upgrade-dtsi-target',$3,1,'upgrade-dtsi-target-admin','old-actor-fingerprint','Pre-upgrade source','Before upgrade',$4::jsonb,$5::jsonb,$6,'before-upgrade',$7)`,
            [previewId,resourceId,randomUUID(),JSON.stringify(manifest),JSON.stringify([{id:memberId,sourceName:"battery.dtsi",content:source,checksum,sizeBytes}]),digest,versionId]);
        });
        const beforeRows=await upgradedApi.query("select to_jsonb(revision) as value from shared_dtsi_revisions revision where id=$1",[versionId]);
        const beforeDraft=await upgradedApi.query("select to_jsonb(draft) as value from shared_dtsi_drafts draft where id=$1",[draftId]);
        for(const relation of relations)expect((await upgradedApi.query(`select count(*)::int as count from shared_dtsi_${relation} where organization_id='upgrade-dtsi-target'`)).rows).toEqual([{count:1}]);
        const resource=`/api/v2/shared-dtsi/${resourceId}`;
        const target = "/api/v1/platform/organizations/upgrade-dtsi-target";
        expect(await applyMigrations(legacy, migrationsDir)).toContain("0296_shared_dtsi_organization_erasure.sql");
        expect((await upgradedApi.query("select to_jsonb(revision) as value from shared_dtsi_revisions revision where id=$1",[versionId])).rows).toEqual(beforeRows.rows);
        const upgradedDraft=(await upgradedApi.query<{value:Record<string,unknown>}>("select to_jsonb(draft) as value from shared_dtsi_drafts draft where id=$1",[draftId])).rows[0]!.value;
        const { dependencies,build_inputs,source_origin,...originalDraft }=upgradedDraft;
        expect([{value:originalDraft}]).toEqual(beforeDraft.rows);
        expect({dependencies,build_inputs,source_origin}).toEqual({dependencies:[],build_inputs:{includeSearchPaths:[],defines:{}},source_origin:null});
        const exact=await call<{item:{members:{content:string}[]}}>(`${resource}/versions/${versionId}`);
        expect(exact.status,exact.bodyText).toBe(200);expect(exact.body.item.members).toEqual([expect.objectContaining({id:memberId,sourceName:"battery.dtsi",content:source,checksum,sizeBytes})]);
        const reopened=await call<{item:{dependencies:unknown[];members:{content:string}[]}}>(resource);
        expect(reopened.status,reopened.bodyText).toBe(200);expect(reopened.body.item.dependencies).toEqual([]);expect(reopened.body.item.members).toEqual([expect.objectContaining({content:source})]);
        expect((await upgradedApi.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{rolsuper:false,rolinherit:false}]);
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
