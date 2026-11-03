import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { makeTestAuthContext } from "../../testing/authContext";
import { installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle, retiredPowerAliasSuccessorBundle, retiredPowerSubjectSuccessorBundle } from "../catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { moduleStructureExportSchema, moduleStructurePreviewResponseSchema, moduleStructureUpdateDocumentSchema } from "../contracts/dtoSchemas/moduleStructure";
import { createCatalogKernel } from "../catalog-kernel/interface";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { DefinitionRevisionId, ParameterDefinitionId, SubjectRegistrationId } from "../parameter-catalog-contract";

describe("module structure export", () => {
  let fixture: ParameterCatalogDatabase;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  const org = "export-org";
  const user = "export-admin";
  const runToken = `mstransfer${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  beforeAll(async () => {
    fixture = await createDisposableParameterCatalogDatabase("structureexport");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db)!;
    const chain = await installPublishedCatalogChain(pool);
    const bundle = nodeTypeAndSecondDriverSuccessorBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: chain.pinC, expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    await pool.query("insert into organizations(id,name) values ($1,'Export')", [org]);
    await pool.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await pool.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('export-role',$1,$2,'admin')", [user, org]);
    await pool.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      values ('export-root',$1,'Root','export-root','business','curated')`, [org]);
    const runtime = await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
  }, 120_000);

  afterAll(async () => { await api?.close(); if (fixture) await dropLabRuntimeLogins(fixture.url, runToken); await db?.close(); await fixture?.close(); });

  it("exports the complete organization structure and retains a baseline", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const response = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body).toMatchObject({ format: "wiseeff-module-structure", version: 1,
      source: { organizationId: org, exportId: expect.any(String) },
      modules: [expect.objectContaining({ sourceId: "export-root", name: "Root" })],
      counts: { modules: 1, subjects: 0 } });
    const exportId = (response.body as { source: { exportId: string } }).source.exportId;
    const baseline = await db.query("select document from parameter_catalog.module_structure_export_baselines where organization_id=$1 and export_id=$2", [org, exportId]);
    expect(baseline.rows).toEqual([{ document: response.body }]);
    expect((await db.query("select 1 from audit_events where organization_id=$1 and action='module-structure-export'", [org])).rowCount).toBe(1);
    await expect(api.query("update parameter_catalog.module_structure_export_baselines set document='{}' where export_id=$1", [exportId])).rejects.toMatchObject({ code: "42501" });
    await expect(api.query("delete from parameter_catalog.module_structure_export_baselines where export_id=$1", [exportId])).rejects.toMatchObject({ code: "42501" });
    const cross = await requestJson(app, "/api/v2/organizations/another-org/module-structure/exports", { method: "POST", body: "{}",
      headers: { "x-wiseeff-actor-id": user, "x-wiseeff-organization-id": org } });
    expect(cross.status).toBe(403);
  });

  it("previews an unchanged package without writing another baseline or audit", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const document = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(document.status, document.bodyText).toBe(200);
    const before = await db.query(`select
      (select count(*)::int from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*)::int from audit_events where organization_id=$1) as audits`, [org]);
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: document.body, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body).toMatchObject({ changes: [], conflicts: [], token: expect.any(String) });
    const after = await db.query(`select
      (select count(*)::int from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*)::int from audit_events where organization_id=$1) as audits`, [org]);
    expect(after.rows).toEqual(before.rows);
  });

  it("registers an explicitly requested Catalog root through the transfer", async () => {
    const org = "lifecycle-export-org";
    const user = "lifecycle-export-admin";
    const guestUser = "lifecycle-export-guest";
    await db.query("insert into organizations(id,name) values ($1,'Lifecycle')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Guest','Guest',true)", [guestUser, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('lifecycle-guest-role',$1,$2,'guest')", [guestUser, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('lifecycle-export-role',$1,$2,'admin')", [user, org]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('lifecycle-export-root',$1,'Root','lifecycle-export-root','business','curated')", [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    const subject = await db.query<{ id: string }>(`select s.id from parameter_catalog.catalog_subjects s
      join parameter_catalog.catalog_release_subjects rs on rs.subject_id=s.id
      join parameter_catalog.catalog_state cs on cs.current_catalog_release_id=rs.release_id
      where s.owner_subject_id is null and s.kind='driver' and rs.lifecycle='active' order by s.id limit 1`);
    const subjectId = subject.rows[0]!.id;
    const edited = { ...document, modules: [...document.modules, { ref: "registration-destination", name: "Registration destination", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" }], subjects: [...document.subjects, { subjectId, state: "active", placement: { kind: "module", moduleRef: "registration-destination" }, recognition: { mode: "override", override: { compatibles: ["acme,new"], nodeTypeName: null } } }] };
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ moduleId: `subject:${subjectId}`, field: "state", after: "active" })]) });
    const guest = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: guestUser, roles: [{ roleId: "guest", projectId: null }] }) } } });
    const denied = await requestJson(guest, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "denied", reason: "Reviewed" }) });
    expect(denied.status).toBe(403);
    const applyBody = JSON.stringify({ document: edited, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "register-root", reason: "Reviewed registration" });
    const secondApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const [applied, simultaneous] = await Promise.all([app, secondApp].map(server => requestJson(server, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: applyBody })));
    expect(applied.status, applied.bodyText).toBe(200);
    expect(simultaneous.status, simultaneous.bodyText).toBe(200);
    expect(simultaneous.body).toEqual(applied.body);
    const replay = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "register-root", reason: "Reviewed registration" }) });
    expect(replay.body).toEqual(applied.body);
    const duplicate = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(duplicate.status).toBe(409);
    const next = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const nextDocument = next.body as z.infer<typeof moduleStructureExportSchema>;
    const destination = nextDocument.modules.find(module => module.name === "Registration destination")!;
    expect(nextDocument.subjects).toEqual(expect.arrayContaining([expect.objectContaining({ subjectId, state: "active", placement: { kind: "module", moduleRef: destination.ref } })]));
    const identity = (await db.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [org, subjectId])).rows[0]!.id;
    expect((await db.query("select compatibles from registration_recognition_rules where registration_id=$1", [identity])).rows).toEqual([{ compatibles: ["acme,new"] }]);
    const contradictory = structuredClone(nextDocument) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    contradictory.subjects.find(row => row.subjectId === subjectId)!.operation = "retire";
    expect((await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: contradictory, resolutions: {} }) })).status).toBe(400);
    const child = nextDocument.subjects.find(row => row.ownerSubjectId === subjectId);
    if (child) {
      const childEdit = structuredClone(nextDocument);
      childEdit.subjects.find(row => row.subjectId === child.subjectId)!.state = child.state === "active" ? "retired" : "active";
      expect((await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: childEdit, resolutions: {} }) })).status).toBe(409);
    }
    await db.query("update parameter_catalog.organization_subject_registrations set status='retired' where id=$1", [identity]);
    const unchanged = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: nextDocument, resolutions: {} }) });
    expect(unchanged.status, unchanged.bodyText).toBe(200);
    expect(unchanged.body).toMatchObject({ changes: [], conflicts: [] });
    const unchangedApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: nextDocument, resolutions: {}, token: (unchanged.body as { token: string }).token, idempotencyKey: "unchanged-state", reason: "Preserve concurrent state" }) });
    expect(unchangedApply.status, unchangedApply.bodyText).toBe(200);
    expect((await db.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [identity])).rows[0]).toEqual({ status: "retired" });
    await db.query("update parameter_catalog.organization_subject_registrations set status='active' where id=$1", [identity]);
    // Queue each real single-item writer before the import on the shared PostgreSQL lock.
    const makeApp = () => createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const moduleApi = "/api/v1/parameter-modules";
    const created = await requestJson(makeApp(), moduleApi, { method: "POST", body: JSON.stringify({ name: "Race target" }) });
    expect(created.status, created.bodyText).toBe(201);
    const raceId = (created.body as { item: { id: string } }).item.id;
    const recognitionPath = `/api/v2/organizations/${org}/subject-registrations/${identity}/recognition`;
    for (const kind of ["create", "edit", "move", "delete", "recognition"] as const) {
      const snapshot = await requestJson(makeApp(), `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      const raceDocument = snapshot.body as z.infer<typeof moduleStructureExportSchema>;
      const planned = await requestJson(makeApp(), `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: raceDocument, resolutions: {} }) });
      expect(planned.status, planned.bodyText).toBe(200);
      const recognition = kind === "recognition" ? await requestJson(makeApp(), recognitionPath) : null;
      if (recognition) expect(recognition.status, recognition.bodyText).toBe(200);
      const writers = {
        create: { path: moduleApi, method: "POST", body: { name: "Race created" } },
        edit: { path: `${moduleApi}/${raceId}`, method: "PATCH", body: { description: "Edited concurrently" } },
        move: { path: `${moduleApi}/${raceId}/move`, method: "POST", body: { parentId: destination.sourceId } },
        delete: { path: `${moduleApi}/${raceId}`, method: "DELETE", body: undefined },
        recognition: { path: recognitionPath, method: "PATCH", body: { compatibles: ["acme,race"] } },
      };
      const writer = writers[kind];
      const gate = await getRootPostgresPool(db)!.connect();
      await gate.query("begin");
      await gate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${org}`]);
      const pid = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      let pendingWriter: ReturnType<typeof requestJson> | undefined;
      let pendingImport: ReturnType<typeof requestJson> | undefined;
      try {
        pendingWriter = requestJson(makeApp(), writer.path, { method: writer.method, body: writer.body ? JSON.stringify(writer.body) : undefined,
          ...(recognition ? { headers: { "If-Match": recognition.headers.get("etag")!, "X-WiseEff-Catalog-Release": raceDocument.source.catalogReleaseId, "Idempotency-Key": "recognition-race" } } : {}) });
        await vi.waitFor(async () => { expect((await db.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid])).rowCount).toBeGreaterThan(0); }, { interval: 10 });
        pendingImport = requestJson(makeApp(), `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: raceDocument, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: `race-${kind}`, reason: "Review race" }) });
        await vi.waitFor(async () => { expect((await db.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid])).rowCount).toBeGreaterThan(1); }, { interval: 10 });
        await gate.query("commit");
        const result = await pendingWriter;
        expect(result.status, `${kind}: ${result.bodyText}`).toBe(kind === "create" ? 201 : kind === "delete" ? 204 : 200);
        expect((await pendingImport).status, kind).toBe(409);
      } finally { await gate.query("rollback"); gate.release(); await pendingWriter?.catch(() => undefined); await pendingImport?.catch(() => undefined); }
    }
    const afterRaces = await requestJson(makeApp(), `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    Object.assign(nextDocument, afterRaces.body);
    for (const operation of ["retire", "restore"] as const) {
      const current = structuredClone(next.body) as z.infer<typeof moduleStructureExportSchema>;
      if (operation === "restore") {
        const refreshed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
        Object.assign(current, refreshed.body);
      }
      const root = current.subjects.find(row => row.subjectId === subjectId)!;
      const lifecycleDocument = { ...current, modules: [...current.modules.map(row => operation === "retire" && row.sourceId === "lifecycle-export-root" ? { ...row, operation: "delete" } : row), ...(operation === "restore" ? [{ ref: "restore-destination", name: "Restore destination", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" }] : [])], subjects: current.subjects.map(row => row === root ? { ...row, state: operation === "retire" ? "retired" : "active", ...(operation === "restore" ? { placement: { kind: "module", moduleRef: "restore-destination" } } : {}), recognition: { ...row.recognition!, mode: "override", override: { ...row.recognition!.effective, compatibles: [operation === "retire" ? "acme,mixed" : "acme,restored"] } } } : row) };
      const planned = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: lifecycleDocument, resolutions: {} }) });
      expect(planned.status, planned.bodyText).toBe(200);
      if (operation === "retire") {
        await db.query(`create function public.fail_lifecycle_audit() returns trigger language plpgsql as $$ begin if new.action='module-structure-update' then raise exception 'injected'; end if; return new; end $$`);
        await db.query("create trigger fail_lifecycle_audit before insert on audit_events for each row execute function public.fail_lifecycle_audit()");
        try {
          const failed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: lifecycleDocument, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: "retire-failed", reason: "Reviewed lifecycle" }) });
          expect(failed.status).toBe(500);
          expect((await db.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [identity])).rows[0]).toEqual({ status: "active" });
        } finally {
          await db.query("drop trigger fail_lifecycle_audit on audit_events");
          await db.query("drop function public.fail_lifecycle_audit()");
        }
      }
      const writes = operation === "retire" ? [app, secondApp] : [app];
      const results = await Promise.all(writes.map((server, index) => requestJson(server, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: lifecycleDocument, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: `${operation}-${index}`, reason: "Reviewed lifecycle" }) })));
      expect(results.map(result => result.status).sort()).toEqual(operation === "retire" ? [200, 409] : [200]);
      const stored = await db.query("select id,status from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [org, subjectId]);
      expect(stored.rows).toEqual([{ id: identity, status: operation === "retire" ? "retired" : "active" }]);
      expect((await db.query("select compatibles from registration_recognition_rules where registration_id=$1", [identity])).rows).toEqual([{ compatibles: [operation === "retire" ? "acme,mixed" : "acme,restored"] }]);
    }
  });

  it("preserves a long historical encoded path on unchanged and metadata-only updates", async () => {
    const org = "historical-path-org", user = "historical-path-admin";
    await db.query("insert into organizations(id,name) values ($1,'Historical')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('historical-path-role',$1,$2,'admin')", [user, org]);
    await db.query(`with recursive tree as (
      select 1 as n, 'h0001'::text as id, null::text as parent_id, 'h0001'::text as path
      union all select n+1, 'h'||lpad((n+1)::text,4,'0'), id, path||'/'||'h'||lpad((n+1)::text,4,'0') from tree where n<450)
      insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin)
      select id,$1,'Historical '||n,parent_id,path,n,'business','curated' from tree order by n`, [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const path = `/api/v2/organizations/${org}/module-structure`;
    const exported = await requestJson(app, `${path}/exports`, { method: "POST", body: "{}" });
    expect(exported.status, exported.bodyText).toBe(200);
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    for (const metadata of [false, true]) {
      if (metadata) document.modules.find(module => module.sourceId === "h0450")!.description = "Retained path";
      const preview = await requestJson(app, `${path}/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
      expect(preview.status, preview.bodyText).toBe(200);
      const applied = await requestJson(app, `${path}/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: `historical-${metadata}`, reason: "Retain history" }) });
      expect(applied.status, applied.bodyText).toBe(200);
    }
    expect((await db.query("select length(path) as length,description from parameter_modules where id='h0450'")).rows).toEqual([{ length: 2699, description: "Retained path" }]);
  });

  it("requires explicit disposition of children before deleting a populated module", async () => {
    const org = "delete-tree-org", user = "delete-tree-admin";
    await db.query("insert into organizations(id,name) values ($1,'Delete tree')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('delete-tree-role',$1,$2,'admin')", [user, org]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('delete-root',$1,'Root','delete-root','business','curated')", [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    await db.query(`insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin)
      values ('delete-child',$1,'Child','delete-root','delete-root/delete-child',2,'business','curated')`, [org]);
    await db.query(`insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin,archived_at)
      values ('delete-archived',$1,'Archived','delete-root','delete-root/delete-archived',2,'business','curated',now())`, [org]);
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    document.modules.find(m => m.sourceId === "delete-root")!.operation = "delete";
    const preview = () => requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect((await preview()).status).toBe(409);
    document.modules.find(m => m.sourceId === "delete-child")!.parentRef = null;
    let planned = await preview();
    expect(planned.status, planned.bodyText).toBe(200);
    expect(planned.body).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ moduleId: "delete-root", field: "delete" })]) });
    const apply = (key: string) => requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: key, reason: "Reorganize" }) });
    await db.query(`insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin)
      values ('delete-race',$1,'Concurrent','delete-root','delete-root/delete-race',2,'business','curated')`, [org]);
    expect((await apply("delete-stale")).status).toBe(409);
    await db.query("delete from parameter_modules where id='delete-race'");
    planned = await preview();
    const writer = await getRootPostgresPool(db)!.connect();
    await writer.query("begin");
    await writer.query(`insert into public.parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk,parameter_module_id)
      values ('delete-legacy-definition',$1,'Retained','','','ENV','Root','','','Low','delete-root')`, [org]);
    const competingApply = apply("delete-legacy-stale");
    await new Promise(resolve => setTimeout(resolve, 50));
    await writer.query("commit"); writer.release();
    expect((await competingApply).status).toBe(409);
    planned = await preview();
    expect(planned.body).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ moduleId: "delete-root", field: "legacyImpact", before: 1 })]) });
    await db.query(`create function public.fail_transfer_delete() returns trigger language plpgsql as $$
      begin if old.id='delete-root' then raise exception 'injected deletion failure'; end if; return old; end $$`);
    await db.query("create trigger fail_transfer_delete before delete on parameter_modules for each row execute function public.fail_transfer_delete()");
    try { expect((await apply("delete-stage-rollback")).status).toBeGreaterThanOrEqual(500); }
    finally { await db.query("drop trigger fail_transfer_delete on parameter_modules"); await db.query("drop function public.fail_transfer_delete()"); }
    expect((await db.query("select parent_id from parameter_modules where id='delete-child'")).rows).toEqual([{ parent_id: "delete-root" }]);
    await db.query(`create function public.fail_delete_transfer_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-update' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await db.query("create trigger fail_delete_transfer_audit before insert on audit_events for each row execute function public.fail_delete_transfer_audit()");
    try { expect((await apply("delete-rollback")).status).toBeGreaterThanOrEqual(500); }
    finally { await db.query("drop trigger fail_delete_transfer_audit on audit_events"); await db.query("drop function public.fail_delete_transfer_audit()"); }
    expect((await db.query("select parent_id from parameter_modules where id='delete-child'")).rows).toEqual([{ parent_id: "delete-root" }]);
    const applied = await apply("delete-parent");
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await db.query("select id,parent_id from parameter_modules where id=any($1::text[]) order by id", [["delete-root", "delete-child"]])).rows).toEqual([{ id: "delete-child", parent_id: null }]);
    expect((await db.query("select parent_id,path from parameter_modules where id='delete-archived'")).rows).toEqual([{ parent_id: null, path: "delete-root/delete-archived" }]);
    expect((await db.query("select parameter_module_id,module from parameter_definitions where id='delete-legacy-definition'")).rows).toEqual([{ parameter_module_id: null, module: "unset" }]);
  });

  it("rejects a deletion preview when a registration is created afterward", async () => {
    const org = "delete-register-org", user = "delete-register-admin";
    await db.query("insert into organizations(id,name) values ($1,'Delete registration')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('delete-register-role',$1,$2,'admin')", [user, org]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('delete-register-module',$1,'Old','delete-register-module','business','curated')", [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    document.modules[0]!.operation = "delete";
    const planned = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(planned.status, planned.bodyText).toBe(200);
    await db.query(`create function public.pause_delete_registration() returns trigger language plpgsql as $$
      begin if new.organization_id='delete-register-org' then perform pg_sleep(0.3); end if; return new; end $$`);
    await db.query("create trigger pause_delete_registration before insert on parameter_catalog.organization_subject_registrations for each row execute function public.pause_delete_registration()");
    let stale;
    try {
      const registering = requestJson(app, `/api/v2/organizations/${org}/subject-registrations`, { method: "POST", headers: {
        "X-WiseEff-Catalog-Release": document.source.catalogReleaseId, "Idempotency-Key": "delete-register-race" },
        body: JSON.stringify({ subjectId: "csub_acme_power", placement: { mode: "use-default" }, destinationModuleId: "delete-register-module", reason: "Register" }) });
      await new Promise(resolve => setTimeout(resolve, 100));
      const competingApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
        makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
      const applying = requestJson(competingApp, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: "delete-register-stale", reason: "Reorganize" }) });
      const registration = await registering;
      expect(registration.status, registration.bodyText).toBe(201);
      stale = await applying;
    } finally {
      await db.query("drop trigger pause_delete_registration on parameter_catalog.organization_subject_registrations");
      await db.query("drop function public.pause_delete_registration()");
    }
    expect(stale.status).toBe(409);
    expect((await db.query("select id from parameter_modules where id='delete-register-module'")).rowCount).toBe(1);
  });

  it("moves a retired root to a new module before deletion without restoring it", async () => {
    const org = "delete-retired-org", user = "delete-retired-admin";
    await db.query("insert into organizations(id,name) values ($1,'Delete retired')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('delete-retired-role',$1,$2,'admin')", [user, org]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('delete-retired-module',$1,'Old','delete-retired-module','business','curated')", [org]);
    await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('delete-retired-registration',$1,'csub_acme_power','active','explicit','{}','delete-retired-placement')`, [org]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('delete-retired-placement','delete-retired-registration',$1,'delete-retired-module','curated')`, [org]);
    });
    await db.query("insert into projects(id,organization_id,name,code) values ('delete-retired-project',$1,'Retained','KEEP')", [org]);
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Missing Catalog release");
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const binding = await createSourceBackedBindingService(pool).stabilize({ snapshot: loaded.value, organizationId: org,
      projectId: "delete-retired-project", logicalNodeId: "retained-node", registrationId: SubjectRegistrationId("delete-retired-registration"),
      definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"), effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"), expectedEffectiveRevisionId: null });
    if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    const retained = async () => ({
      bindings: (await db.query("select id from parameter_catalog.project_parameter_bindings where organization_id=$1 order by id", [org])).rows,
      values: (await db.query("select id from parameter_catalog.project_parameter_values where binding_id=$1 order by id", [binding.value.binding.id])).rows,
      history: (await db.query("select id from parameter_catalog.binding_history_events where binding_id=$1 order by id", [binding.value.binding.id])).rows,
    });
    const before = await retained();
    expect(before.bindings.length).toBeGreaterThan(0); expect(before.values.length).toBeGreaterThan(0); expect(before.history.length).toBeGreaterThan(0);
    await db.query("update parameter_catalog.organization_subject_registrations set status='retired' where id='delete-retired-registration'");
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    document.modules[0].operation = "delete";
    const preview = () => requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect((await preview()).status).toBe(409);
    document.modules.push({ ref: "new-destination", name: "New", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" });
    document.subjects[0].placement = { kind: "module", moduleRef: "new-destination" };
    const planned = await preview();
    expect(planned.status, planned.bodyText).toBe(200);
    expect(planned.body).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ moduleId: "subject:csub_acme_power", field: "placement" })]) });
    const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (planned.body as { token: string }).token, idempotencyKey: "retired-delete", reason: "Reorganize" }) });
    expect(applied.status, applied.bodyText).toBe(200);
    expect(await retained()).toEqual(before);
    expect((await db.query(`select r.status,r.current_placement_id,m.name from parameter_catalog.organization_subject_registrations r
      join parameter_catalog.subject_placements p on p.id=r.current_placement_id join parameter_modules m on m.id=p.module_id where r.id='delete-retired-registration'`)).rows)
      .toEqual([{ status: "retired", current_placement_id: "delete-retired-placement", name: "New" }]);
  });

  it("copies a retired driver and its cascade-retired child without activating either", async () => {
    const target = "copy-subject-target", admin = "copy-subject-admin";
    const sourceOrg = "copy-subject-source", sourceAdmin = "copy-subject-source-admin";
    await db.query("insert into organizations(id,name) values ($1,'Source')", [sourceOrg]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [sourceAdmin, sourceOrg]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('copy-subject-source-role',$1,$2,'admin')", [sourceAdmin, sourceOrg]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('copy-subject-module',$1,'Root','copy-subject-module','business','curated')", [sourceOrg]);
    await db.query("insert into organizations(id,name) values ($1,'Target')", [target]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [admin, target]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('copy-subject-role',$1,$2,'admin')", [admin, target]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('copy-subject-guest',$1,'Guest','Guest',true)", [target]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('copy-subject-guest-role','copy-subject-guest',$1,'guest')", [target]);
    await db.query("select parameter_catalog.claim_catalog_subject_owner('csub_acme_charger','csub_acme_power')");
    await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id,display_alias)
        values ('copy-source-root',$1,'csub_acme_power','retired','explicit','{}','copy-source-root-place','Power alias')`, [sourceOrg]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('copy-source-root-place','copy-source-root',$1,'copy-subject-module','curated')`, [sourceOrg]);
      await tx.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        values ($1,'copy-source-root','csub_acme_power',array['acme,copy'],'physical-device','multiple')`, [sourceOrg]);
      await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,cascade_retired,registration_method,proof,current_placement_id)
        values ('copy-source-child',$1,'csub_acme_charger','retired',true,'automatic','{}','copy-source-child-place')`, [sourceOrg]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('copy-source-child-place','copy-source-child',$1,null,'curated')`, [sourceOrg]);
    });
    const source = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: sourceOrg, userId: sourceAdmin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const destination = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: target, userId: admin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const secondDestination = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: target, userId: admin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(source, `/api/v2/organizations/${sourceOrg}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(exported.status, exported.bodyText).toBe(200);
    const path = `/api/v2/organizations/${target}/module-structure`;
    const input = { mode: "copy", document: exported.body, resolutions: {}, mappings: { "copy-subject-module": "create" } };
    const viewer = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: target, userId: "copy-subject-guest", roles: [{ roleId: "guest", projectId: null }] }) } } });
    expect((await requestJson(viewer, `${path}/previews`, { method: "POST", body: JSON.stringify(input) })).status).toBe(403);
    const preview = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(preview.status, preview.bodyText).toBe(200);
    const invalidOwner = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    invalidOwner.subjects.find(subject => subject.subjectId === "csub_acme_charger")!.ownerSubjectId = null;
    const incompatible = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: invalidOwner }) });
    expect(incompatible.status).toBe(409);
    const missing = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    missing.subjects[0]!.subjectId = "missing-catalog-subject";
    const missingCatalog = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: missing }) });
    expect(missingCatalog.status).toBe(409);
    const auditsBeforeFailure = (await db.query("select count(*)::int as count from audit_events where organization_id=$1", [target])).rows[0];
    for (const [table, action] of [["parameter_modules", "insert"], ["parameter_catalog.module_structure_created_refs", "insert"],
      ["parameter_catalog.organization_subject_registrations", "insert"], ["registration_recognition_rules", "insert"],
      ["audit_events", "insert"], ["parameter_catalog.governance_command_idempotency", "update"]] as const) {
      await db.query(`create function public.fail_copy_subject_stage() returns trigger language plpgsql as $$ begin raise exception 'injected copy failure'; end $$`);
      await db.query(`create trigger fail_copy_subject_stage after ${action} on ${table} for each row execute function public.fail_copy_subject_stage()`);
      try {
        const failed = await requestJson(destination, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...input,
          token: (preview.body as { token: string }).token, idempotencyKey: `failure-${table}`, reason: "Test rollback" }) });
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect((await db.query("select count(*)::int as count from parameter_modules where organization_id=$1", [target])).rows[0]).toEqual({ count: 0 });
        expect((await db.query("select count(*)::int as count from parameter_catalog.organization_subject_registrations where organization_id=$1", [target])).rows[0]).toEqual({ count: 0 });
        expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_created_refs where organization_id=$1", [target])).rows[0]).toEqual({ count: 0 });
        expect((await db.query("select count(*)::int as count from parameter_catalog.governance_command_idempotency where organization_id=$1 and command_family='module-structure-update'", [target])).rows[0]).toEqual({ count: 0 });
        expect((await db.query("select count(*)::int as count from audit_events where organization_id=$1", [target])).rows[0]).toEqual(auditsBeforeFailure);
      } finally {
        await db.query(`drop trigger fail_copy_subject_stage on ${table}`);
        await db.query("drop function public.fail_copy_subject_stage()");
      }
    }
    await db.query(`create function public.require_retired_copy_snapshot() returns trigger language plpgsql as $$ begin
      if new.organization_id='copy-subject-target' and (new.status <> 'retired' or
        (new.subject_id='csub_acme_charger' and not new.cascade_retired)) then raise exception 'copy activated a retained registration'; end if;
      return new; end $$`);
    await db.query("create trigger require_retired_copy_snapshot before insert on parameter_catalog.organization_subject_registrations for each row execute function public.require_retired_copy_snapshot()");
    const command = JSON.stringify({ ...input, token: (preview.body as { token: string }).token, idempotencyKey: "copy-retired", reason: "Copy retained settings" });
    const [applied, simultaneous] = await Promise.all([destination, secondDestination].map(app => requestJson(app, `${path}/applies`, { method: "POST", body: command })));
    await db.query("drop trigger require_retired_copy_snapshot on parameter_catalog.organization_subject_registrations");
    await db.query("drop function public.require_retired_copy_snapshot()");
    expect(applied.status, applied.bodyText).toBe(200);
    expect(simultaneous.status, simultaneous.bodyText).toBe(200);
    expect(simultaneous.body).toEqual(applied.body);
    const replay = await requestJson(destination, `${path}/applies`, { method: "POST", body: command });
    expect(replay.body).toEqual(applied.body);
    const copied = await requestJson(destination, `${path}/exports`, { method: "POST", body: "{}" });
    expect(copied.body).toMatchObject({ subjects: expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power", state: "retired", displayAlias: "Power alias",
        recognition: expect.objectContaining({ mode: "override", override: expect.objectContaining({ compatibles: ["acme,copy"] }) }) }),
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "retired", cascadeRetired: true }),
    ]) });
    const sourceAfter = await requestJson(source, `/api/v2/organizations/${sourceOrg}/module-structure/exports`, { method: "POST", body: "{}" });
    expect((sourceAfter.body as { subjects: unknown[] }).subjects).toEqual((exported.body as { subjects: unknown[] }).subjects);
    const identity = (await db.query<{ id: string; current_placement_id: string }>(`select id,current_placement_id from parameter_catalog.organization_subject_registrations
      where organization_id=$1 and subject_id='csub_acme_power'`, [target])).rows[0]!;
    const staleInput = { ...input, mappings: {} };
    const stalePreview = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify(staleInput) });
    expect(stalePreview.status, stalePreview.bodyText).toBe(200);
    const gatePool = getRootPostgresPool(db)!;
    const gate = await gatePool.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${target}`]);
    await gate.query("update parameter_catalog.organization_subject_registrations set display_alias='Concurrent alias' where id=$1", [identity.id]);
    const gatePid = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    let pending: ReturnType<typeof requestJson> | undefined;
    try {
      pending = requestJson(destination, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...staleInput,
        token: (stalePreview.body as { token: string }).token, idempotencyKey: "copy-competing-writer", reason: "Review copy" }) });
      await vi.waitFor(async () => { expect((await gatePool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [gatePid])).rowCount).toBeGreaterThan(0); });
      await gate.query("commit");
      expect((await pending).status).toBe(409);
    } finally { await gate.query("rollback"); gate.release(); await pending?.catch(() => undefined); }
    await db.query("update parameter_catalog.organization_subject_registrations set display_alias='Target alias' where id=$1", [identity.id]);
    await db.query("update registration_recognition_rules set compatibles=array['target,rule'] where registration_id=$1", [identity.id]);
    const repeated = { ...input, mappings: {} };
    const conflict = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify(repeated) });
    expect(conflict.status, conflict.bodyText).toBe(200);
    expect(conflict.body).toMatchObject({ conflicts: expect.arrayContaining([
      expect.objectContaining({ key: "subject:csub_acme_power:displayAlias" }),
      expect.objectContaining({ key: "subject:csub_acme_power:recognition" }),
    ]) });
    const resolved = { ...repeated, resolutions: { "subject:csub_acme_power:displayAlias": "file", "subject:csub_acme_power:recognition": "file" } };
    const resolution = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify(resolved) });
    expect(resolution.status, resolution.bodyText).toBe(200);
    const reapplied = await requestJson(destination, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...resolved,
      token: (resolution.body as { token: string }).token, idempotencyKey: "copy-resolved", reason: "Resolve target settings" }) });
    expect(reapplied.status, reapplied.bodyText).toBe(200);
    expect((await db.query("select id,current_placement_id from parameter_catalog.organization_subject_registrations where id=$1", [identity.id])).rows[0]).toEqual(identity);
    const resolvedExport = await requestJson(destination, `${path}/exports`, { method: "POST", body: "{}" });
    expect(resolvedExport.body).toMatchObject({ subjects: expect.arrayContaining([expect.objectContaining({ subjectId: "csub_acme_power", displayAlias: "Power alias",
      recognition: expect.objectContaining({ override: expect.objectContaining({ compatibles: ["acme,copy"] }) }) })]) });
    const restore = structuredClone(resolvedExport.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    restore.subjects.find(subject => subject.subjectId === "csub_acme_power")!.state = "active";
    const restoreInput = { document: restore, resolutions: {} };
    const reviewed = await requestJson(destination, `${path}/previews`, { method: "POST", body: JSON.stringify(restoreInput) });
    expect(reviewed.status, reviewed.bodyText).toBe(200);
    const restored = await requestJson(destination, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...restoreInput,
      token: (reviewed.body as { token: string }).token, idempotencyKey: "restore-copy", reason: "Restore driver" }) });
    expect(restored.status, restored.bodyText).toBe(200);
    const afterRestore = await requestJson(destination, `${path}/exports`, { method: "POST", body: "{}" });
    expect(afterRestore.body).toMatchObject({ subjects: expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power", state: "active" }),
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "active", cascadeRetired: false }),
    ]) });
    const secondTarget = "copy-subject-target-two", secondAdmin = "copy-subject-admin-two";
    await db.query("insert into organizations(id,name) values ($1,'Target two')", [secondTarget]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [secondAdmin, secondTarget]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('copy-subject-role-two',$1,$2,'admin')", [secondAdmin, secondTarget]);
    await db.query("update parameter_catalog.organization_subject_registrations set status='active' where id='copy-source-root'");
    await db.query("update parameter_catalog.organization_subject_registrations set cascade_retired=false where id='copy-source-child'");
    const historical = await requestJson(source, `/api/v2/organizations/${sourceOrg}/module-structure/exports`, { method: "POST", body: "{}" });
    const secondApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: secondTarget, userId: secondAdmin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const secondPath = `/api/v2/organizations/${secondTarget}/module-structure`;
    const secondInput = { mode: "copy", document: historical.body, resolutions: {}, mappings: { "copy-subject-module": "create" } };
    const secondPreview = await requestJson(secondApp, `${secondPath}/previews`, { method: "POST", body: JSON.stringify(secondInput) });
    expect(secondPreview.status, secondPreview.bodyText).toBe(200);
    const secondApply = await requestJson(secondApp, `${secondPath}/applies`, { method: "POST", body: JSON.stringify({ ...secondInput,
      token: (secondPreview.body as { token: string }).token, idempotencyKey: "copy-historical", reason: "Copy historical child" }) });
    expect(secondApply.status, secondApply.bodyText).toBe(200);
    const historicalCopy = await requestJson(secondApp, `${secondPath}/exports`, { method: "POST", body: "{}" });
    expect(historicalCopy.body).toMatchObject({ subjects: expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power", state: "active" }),
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "retired", cascadeRetired: false }),
    ]) });
    const capacity = structuredClone(historical.body) as z.infer<typeof moduleStructureExportSchema>;
    capacity.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!.override!.instanceCardinality = "singleton-per-project";
    const capacityInput = { mode: "copy", document: capacity, mappings: {}, resolutions: { "subject:csub_acme_power:recognition": "file" } };
    const beforeCapacity = await requestJson(secondApp, `${secondPath}/previews`, { method: "POST", body: JSON.stringify(capacityInput) });
    expect(beforeCapacity.status, beforeCapacity.bodyText).toBe(200);
    await db.query("insert into projects(id,organization_id,name,code) values ('copy-capacity-project',$1,'Capacity','COPYCAP')", [secondTarget]);
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Missing Catalog release");
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const targetRegistration = (await db.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'", [secondTarget])).rows[0]!.id;
    for (const logicalNodeId of ["copy-capacity-one", "copy-capacity-two"]) {
      const binding = await createSourceBackedBindingService(pool).stabilize({ snapshot: loaded.value, organizationId: secondTarget,
        projectId: "copy-capacity-project", logicalNodeId, registrationId: SubjectRegistrationId(targetRegistration),
        definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"), effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"), expectedEffectiveRevisionId: null });
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    }
    const overCapacity = await requestJson(secondApp, `${secondPath}/previews`, { method: "POST", body: JSON.stringify(capacityInput) });
    expect(overCapacity.status).toBe(409);
    const staleCapacity = await requestJson(secondApp, `${secondPath}/applies`, { method: "POST", body: JSON.stringify({ ...capacityInput,
      token: (beforeCapacity.body as { token: string }).token, idempotencyKey: "copy-capacity-race", reason: "Check capacity" }) });
    expect(staleCapacity.status).toBe(409);
    for (const operation of ["retire", "restore"] as const) {
      const snapshot = await requestJson(secondApp, `${secondPath}/exports`, { method: "POST", body: "{}" });
      const edit = structuredClone(snapshot.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
      edit.subjects.find(subject => subject.subjectId === "csub_acme_power")!.state = operation === "retire" ? "retired" : "active";
      const lifecycleInput = { document: edit, resolutions: {} };
      const planned = await requestJson(secondApp, `${secondPath}/previews`, { method: "POST", body: JSON.stringify(lifecycleInput) });
      expect(planned.status, planned.bodyText).toBe(200);
      const result = await requestJson(secondApp, `${secondPath}/applies`, { method: "POST", body: JSON.stringify({ ...lifecycleInput,
        token: (planned.body as { token: string }).token, idempotencyKey: `historical-${operation}`, reason: "Check lifecycle" }) });
      expect(result.status, result.bodyText).toBe(200);
    }
    const historicalRestored = await requestJson(secondApp, `${secondPath}/exports`, { method: "POST", body: "{}" });
    expect(historicalRestored.body).toMatchObject({ subjects: expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "retired", cascadeRetired: false }),
    ]) });
    for (const [rootState, childState, suffix] of [["active", "active", "active"], ["retired", "active", "retired-active"], ["retired", "retired", "historical"]] as const) {
      const targetId = `copy-subject-${suffix}`, userId = `copy-subject-admin-${suffix}`;
      await db.query("insert into organizations(id,name) values ($1,'Copy status')", [targetId]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, targetId]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`role-${userId}`, userId, targetId]);
      await db.query("update parameter_catalog.organization_subject_registrations set status=$2 where id=$1", ["copy-source-root", rootState]);
      await db.query("update parameter_catalog.organization_subject_registrations set status=$2,cascade_retired=false where id=$1", ["copy-source-child", childState]);
      const snapshot = await requestJson(source, `/api/v2/organizations/${sourceOrg}/module-structure/exports`, { method: "POST", body: "{}" });
      const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
        makeTestAuthContext({ organizationId: targetId, userId: userId, roles: [{ roleId: "admin", projectId: null }] }) } } });
      const targetPath = `/api/v2/organizations/${targetId}/module-structure`;
      const copy = { mode: "copy", document: snapshot.body, resolutions: {}, mappings: { "copy-subject-module": "create" } };
      const plan = await requestJson(app, `${targetPath}/previews`, { method: "POST", body: JSON.stringify(copy) });
      expect(plan.status, plan.bodyText).toBe(200);
      const result = await requestJson(app, `${targetPath}/applies`, { method: "POST", body: JSON.stringify({ ...copy,
        token: (plan.body as { token: string }).token, idempotencyKey: `copy-${suffix}`, reason: "Copy lifecycle snapshot" }) });
      expect(result.status, result.bodyText).toBe(200);
      const copiedStatus = await requestJson(app, `${targetPath}/exports`, { method: "POST", body: "{}" });
      expect(copiedStatus.body).toMatchObject({ subjects: expect.arrayContaining([
        expect.objectContaining({ subjectId: "csub_acme_power", state: rootState }),
        expect.objectContaining({ subjectId: "csub_acme_charger", state: childState, cascadeRetired: false }),
      ]) });
    }
  });

  it("copies modules into the authorized target only after explicit mapping choices", async () => {
    const target = "copy-target";
    const admin = "copy-target-admin";
    await db.query("insert into organizations(id,name) values ($1,'Target')", [target]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [admin, target]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('copy-target-role',$1,$2,'admin')", [admin, target]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('copy-existing',$1,'Root','copy-existing','business','curated')", [target]);
    const sourceApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const targetApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: target, userId: admin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(sourceApp, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.source.exportId = "copy-without-source-baseline";
    document.modules.push({ ...document.modules[0]!, ref: "copy-child", sourceId: "copy-source-child", name: "Child", parentRef: "export-root" });
    const path = `/api/v2/organizations/${target}/module-structure`;
    const input = { mode: "copy", document, resolutions: {}, mappings: {} };
    const preview = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body).toMatchObject({ mappings: expect.arrayContaining([expect.objectContaining({ ref: "export-root", candidates: expect.arrayContaining([expect.objectContaining({ id: "copy-existing" })]) })]) });
    const withoutName = { ...document, modules: document.modules.map(module => module.ref === "export-root" ? { ref: module.ref, sourceId: module.sourceId } : module) };
    const partialChoice = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: withoutName }) });
    expect(partialChoice.status, partialChoice.bodyText).toBe(200);
    expect(partialChoice.body).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ key: "mapping:export-root", file: null })]) });
    const choices = { "export-root": "copy-existing", "copy-child": "create" };
    const deepModules = Array.from({ length: 75 }, (_, index) => 74 - index).map(index => ({ ref: `copy-limit-${index}`, name: `Copy limit ${index}`, parentRef: index ? `copy-limit-${index - 1}` : null, description: "", scope: "", sortOrder: 0, importance: "medium" }));
    const deepCopy = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input,
      document: { ...document, modules: [...document.modules, ...deepModules] },
      mappings: { ...choices, ...Object.fromEntries(deepModules.map(module => [module.ref, "create"])) } }) });
    expect(deepCopy.status, deepCopy.bodyText).toBe(400);
    expect(deepCopy.bodyText).toContain("encoded path");
    await db.query("update parameter_modules set description='Target description' where id='copy-existing'");
    const conflicting = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, mappings: choices }) });
    expect(conflicting.status, conflicting.bodyText).toBe(200);
    expect(conflicting.body).toMatchObject({ conflicts: [expect.objectContaining({ key: "export-root:description", current: "Target description" })] });
    const resolved = { ...input, mappings: choices, resolutions: { "export-root:description": "file" } };
    let reviewed = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(resolved) });
    expect(reviewed.status, reviewed.bodyText).toBe(200);
    await db.query("update parameter_modules set scope='Concurrent target edit' where id='copy-existing'");
    const stale = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...resolved,
      token: (reviewed.body as { token: string }).token, idempotencyKey: "stale-copy", reason: "Copy tree" }) });
    expect(stale.status).toBe(409);
    await db.query("update parameter_modules set scope='' where id='copy-existing'");
    reviewed = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(resolved) });
    expect(reviewed.status, reviewed.bodyText).toBe(200);
    await db.query(`create function fail_copy_mapping() returns trigger language plpgsql as $$ begin raise exception 'injected mapping failure'; end $$;
      create trigger fail_copy_mapping before insert on parameter_catalog.module_structure_created_refs for each row execute function fail_copy_mapping()`);
    try {
      const failed = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...resolved,
        token: (reviewed.body as { token: string }).token, idempotencyKey: "copy-failure", reason: "Copy tree" }) });
      expect(failed.status).toBe(500);
      expect((await db.query("select name from parameter_modules where organization_id=$1", [target])).rows).toEqual([{ name: "Root" }]);
      expect((await db.query("select package_ref from parameter_catalog.module_structure_created_refs where organization_id=$1", [target])).rows).toEqual([]);
    } finally { await db.query("drop trigger fail_copy_mapping on parameter_catalog.module_structure_created_refs; drop function fail_copy_mapping()"); }
    await db.query(`create function fail_copy_audit() returns trigger language plpgsql as $$ begin
      if new.action='module-structure-update' then raise exception 'injected copy audit failure'; end if; return new; end $$;
      create trigger fail_copy_audit before insert on audit_events for each row execute function fail_copy_audit()`);
    try {
      const failed = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...resolved,
        token: (reviewed.body as { token: string }).token, idempotencyKey: "copy-audit-failure", reason: "Copy tree" }) });
      expect(failed.status).toBe(500);
      expect((await db.query("select name,description from parameter_modules where organization_id=$1", [target])).rows).toEqual([{ name: "Root", description: "Target description" }]);
      expect((await db.query("select package_ref from parameter_catalog.module_structure_created_refs where organization_id=$1", [target])).rows).toEqual([]);
    } finally { await db.query("drop trigger fail_copy_audit on audit_events; drop function fail_copy_audit()"); }
    const commitBody = JSON.stringify({ ...resolved, token: (reviewed.body as { token: string }).token, idempotencyKey: "copy-tree", reason: "Copy tree" });
    const secondTargetApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: target, userId: admin, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const [applied, concurrent] = await Promise.all([targetApp, secondTargetApp].map(server => requestJson(server, `${path}/applies`, { method: "POST", body: commitBody })));
    expect(applied.status, applied.bodyText).toBe(200);
    expect(concurrent.status, concurrent.bodyText).toBe(200);
    expect(concurrent.body).toEqual(applied.body);
    expect((await db.query("select name,parent_id from parameter_modules where organization_id=$1 order by name", [target])).rows)
      .toEqual([{ name: "Child", parent_id: "copy-existing" }, { name: "Root", parent_id: null }]);
    expect((await db.query("select name from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows).toEqual([{ name: "Root" }]);
    const replay = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...resolved,
      token: (reviewed.body as { token: string }).token, idempotencyKey: "copy-tree", reason: "Copy tree" }) });
    expect(replay.body).toEqual(applied.body);
    await db.query("update parameter_modules set name='Renamed target' where id='copy-existing'");
    const again = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(again.status, again.bodyText).toBe(200);
    expect(again.body).toMatchObject({ changes: [], conflicts: [] });
    const repeated = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...input,
      token: (again.body as { token: string }).token, idempotencyKey: "copy-again", reason: "Repeat copy" }) });
    expect(repeated.status, repeated.bodyText).toBe(200);
    expect((await db.query("select name from parameter_modules where id='copy-existing'")).rows).toEqual([{ name: "Renamed target" }]);
    const partialDocument = { ...document, modules: document.modules.map(module => module.ref === "export-root"
      ? { ref: module.ref, sourceId: module.sourceId, operation: module.operation } : module) };
    const partial = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: partialDocument }) });
    expect(partial.status, partial.bodyText).toBe(200);
    expect(partial.body).toMatchObject({ changes: [], conflicts: [] });
    const childId = (await db.query<{ id: string }>("select id from parameter_modules where organization_id=$1 and name='Child'", [target])).rows[0]!.id;
    const otherDocument = { ...document, source: { ...document.source, exportId: "another-package" } };
    const otherInput = { ...input, document: otherDocument, mappings: { "export-root": "copy-existing", "copy-child": childId }, resolutions: { "export-root:name": "current" } };
    const otherPreview = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(otherInput) });
    expect(otherPreview.status, otherPreview.bodyText).toBe(200);
    const otherApply = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...otherInput,
      token: (otherPreview.body as { token: string }).token, idempotencyKey: "other-package", reason: "Reuse modules" }) });
    expect(otherApply.status, otherApply.bodyText).toBe(200);
    expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_created_refs where organization_id=$1 and module_id='copy-existing'", [target])).rows).toEqual([{ count: 2 }]);
    const excluded = { ...document, modules: document.modules.map(module => module.ref === "export-root" ? { ...module, operation: "delete" } : module) };
    const dangling = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: excluded }) });
    expect(dangling.status).toBe(400);
    const excludedAll = { ...document, modules: excluded.modules.map(module => ({ ...module, operation: "delete" })) };
    const excludedPreview = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input, document: excludedAll }) });
    expect(excludedPreview.status, excludedPreview.bodyText).toBe(200);
    expect(excludedPreview.body).toMatchObject({ changes: [], conflicts: [] });
    const excludedApply = await requestJson(targetApp, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...input, document: excludedAll,
      token: (excludedPreview.body as { token: string }).token, idempotencyKey: "excluded-copy", reason: "Exclude source modules" }) });
    expect(excludedApply.status, excludedApply.bodyText).toBe(200);
    expect((await db.query("select count(*)::int as count from parameter_modules where organization_id=$1 and kind='business'", [target])).rows).toEqual([{ count: 2 }]);
    const unsupported = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify({ ...input,
      document: { ...document, subjects: [{ subjectId: "unsupported" }] } }) });
    expect(unsupported.status).toBe(400);
    await db.query("delete from parameter_modules where id=$1", [childId]);
    const missing = await requestJson(targetApp, `${path}/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(missing.status).toBe(409);
    const cross = await requestJson(targetApp, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(cross.status).toBe(403);
  });

  it("creates package-local parent and child and reuses their identities after a rename", async () => {
    const org = "create-tree-org";
    const user = "create-tree-admin";
    await db.query("insert into organizations(id,name) values ($1,'Tree')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('tree-role',$1,$2,'admin')", [user, org]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('tree-unclassified',$1,'Unclassified','tree-unclassified','unclassified','curated')", [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    const additions = [
      { ref: "new-child", name: "New child", parentRef: "new-parent", description: "", scope: "", sortOrder: 0, importance: "medium" },
      { ref: "new-parent", name: "New parent", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
      ...Array.from({ length: 55 }, (_, index) => 54 - index).map(index => ({ ref: `deep-${index}`, name: `Deep ${index}`, parentRef: index ? `deep-${index - 1}` : null, description: "", scope: "", sortOrder: 0, importance: "medium" })),
    ];
    const edited = { ...document, modules: [...document.modules, ...additions] };
    const previewPath = `/api/v2/organizations/${org}/module-structure/previews`;
    const applyPath = `/api/v2/organizations/${org}/module-structure/applies`;
    const tooDeep = { ...document, modules: [...document.modules, ...Array.from({ length: 75 }, (_, index) => 74 - index).map(index => ({ ref: `limit-${index}`, name: `Limit ${index}`, parentRef: index ? `limit-${index - 1}` : null, description: "", scope: "", sortOrder: 0, importance: "medium" }))] };
    const rejected = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document: tooDeep, resolutions: {} }) });
    expect(rejected.status, rejected.bodyText).toBe(400);
    expect(rejected.bodyText).toContain("encoded path");
    const preview = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    await db.query(`create function fail_created_ref() returns trigger language plpgsql as $$ begin raise exception 'injected mapping failure'; end $$;
      create trigger fail_created_ref before insert on parameter_catalog.module_structure_created_refs for each row execute function fail_created_ref()`);
    try {
      const failed = await requestJson(app, applyPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "failed-tree", reason: "Create tree" }) });
      expect(failed.status).toBe(500);
      expect((await db.query("select id from parameter_modules where organization_id=$1 and kind='business'", [org])).rows).toEqual([]);
      expect((await db.query("select package_ref from parameter_catalog.module_structure_created_refs where organization_id=$1", [org])).rows).toEqual([]);
    } finally {
      await db.query("drop trigger fail_created_ref on parameter_catalog.module_structure_created_refs; drop function fail_created_ref()");
    }
    const secondApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const [applied, competing] = await Promise.all([app, secondApp].map((server, index) => requestJson(server, applyPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: `new-tree-${index}`, reason: "Create tree" }) })));
    expect([applied.status, competing.status].sort()).toEqual([200, 409]);
    const created = (await db.query<{ id: string; parent_id: string | null; name: string; path: string; depth: number }>("select id,parent_id,name,path,depth from parameter_modules where organization_id=$1 and name in ('New parent','New child') order by name", [org])).rows;
    expect(created).toHaveLength(2);
    expect(created[0].parent_id).toBe(created[1].id);
    expect((await db.query("select depth from parameter_modules where organization_id=$1 and name='Deep 54'", [org])).rows).toEqual([{ depth: 55 }]);
    await db.query("update parameter_modules set name='Renamed parent' where id=$1", [created[1].id]);
    const again = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(again.status, again.bodyText).toBe(200);
    expect(again.body).toMatchObject({ changes: [], conflicts: [] });
    const reapplied = await requestJson(app, applyPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (again.body as { token: string }).token, idempotencyKey: "new-tree-again", reason: "Repeat" }) });
    expect(reapplied.status, reapplied.bodyText).toBe(200);
    expect((await db.query("select name from parameter_modules where id=$1", [created[1].id])).rows[0]).toEqual({ name: "Renamed parent" });
    await db.query("delete from parameter_modules where id=$1", [created[0].id]);
    const deleted = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(deleted.status).toBe(409);
  });

  it("validates the final graph and moves a subtree into a vacated sibling name", async () => {
    const org = "move-tree-org";
    const user = "move-tree-admin";
    await db.query("insert into organizations(id,name) values ($1,'Tree')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('move-tree-role',$1,$2,'admin')", [user, org]);
    await db.query(`insert into parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin) values
      ('move-a',$1,null,'A','move-a',1,'business','curated'), ('move-b',$1,null,'B','move-b',1,'business','curated'),
      ('move-child',$1,'move-a','Child','move-a/move-child',2,'business','curated'),
      ('move-leaf',$1,'move-child','Leaf','move-a/move-child/move-leaf',3,'business','curated'),
      ('move-occupied',$1,'move-b','Child','move-b/move-occupied',2,'business','curated')`, [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureUpdateDocumentSchema>;
    const child = document.modules.find(m => m.sourceId === "move-child")!;
    const occupied = document.modules.find(m => m.sourceId === "move-occupied")!;
    child.parentRef = "move-leaf";
    await db.query("update parameter_modules set parent_id=null where id='move-child'");
    const previewPath = `/api/v2/organizations/${org}/module-structure/previews`;
    const unresolved = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(unresolved.body).toMatchObject({ conflicts: [expect.objectContaining({ key: "move-child:parentRef" })] });
    const cycle = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document, resolutions: { "move-child:parentRef": "file" } }) });
    expect(cycle.status).toBe(409);
    expect(cycle.body).toMatchObject({ error: { details: { path: `modules.${document.modules.indexOf(child)}.parentRef` } } });
    await db.query("update parameter_modules set parent_id='move-a' where id='move-child'");
    child.parentRef = "move-b"; occupied.parentRef = "move-a";
    document.modules.find(m => m.sourceId === "move-a")!.name = "B";
    document.modules.find(m => m.sourceId === "move-b")!.name = "A";
    child.description = "Moved subtree";
    document.modules.push({ ref: "batch-parent", name: "New parent", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
      { ref: "batch-child", name: "New child", parentRef: "batch-parent", description: "", scope: "", sortOrder: 0, importance: "medium" });
    Object.assign(occupied, { operation: "delete", parentRef: "move-b" });
    const preview = await requestJson(app, previewPath, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "move", reason: "Move tree" }) });
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await db.query("select parent_id,path,depth from parameter_modules where id='move-leaf'")).rows[0]).toEqual({ parent_id: "move-child", path: "move-b/move-child/move-leaf", depth: 3 });
    const final = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const graph = (final.body as z.infer<typeof moduleStructureExportSchema>).modules;
    const newParent = graph.find(m => m.name === "New parent")!;
    expect(graph.map(m => ({ name: m.name, parentRef: m.parentRef, description: m.description })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "A", parentRef: null, description: "" }, { name: "B", parentRef: null, description: "" },
      { name: "Child", parentRef: "move-b", description: "Moved subtree" }, { name: "Leaf", parentRef: "move-child", description: "" },
      { name: "New child", parentRef: newParent.ref, description: "" }, { name: "New parent", parentRef: null, description: "" },
    ]);
  });

  it("merges independent field edits and asks for conflicting field choices", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.modules[0]!.description = "From file";
    await db.query("update parameter_modules set scope='Current scope' where organization_id=$1 and id='export-root'", [org]);
    const path = `/api/v2/organizations/${org}/module-structure/previews`;
    const preview = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body).toMatchObject({ changes: [expect.objectContaining({ moduleId: "export-root", field: "description", after: "From file" })], conflicts: [] });
    await db.query("update parameter_modules set description='Current description' where organization_id=$1 and id='export-root'", [org]);
    const conflict = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    expect(conflict.body).toMatchObject({ changes: [], conflicts: [expect.objectContaining({ key: "export-root:description", file: "From file", current: "Current description" })] });
    const resolved = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: { "export-root:description": "file" } }) });
    expect(resolved.body).toMatchObject({ changes: [expect.objectContaining({ field: "description", after: "From file" })], conflicts: [] });
  });

  it("applies once and replays the committed receipt before checking stale state", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.modules[0]!.description = "Applied once";
    const resolutions = {};
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
    const token = (preview.body as { token: string }).token;
    const body = { document, resolutions, token, idempotencyKey: "apply-once", reason: "Reviewed metadata" };
    const path = `/api/v2/organizations/${org}/module-structure/applies`;
    const secondApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const [applied, simultaneous] = await Promise.all([requestJson(app, path, { method: "POST", body: JSON.stringify(body) }),
      requestJson(secondApp, path, { method: "POST", body: JSON.stringify(body) })]);
    expect(applied.status, applied.bodyText).toBe(200);
    expect(applied.body).toMatchObject({ organizationId: org, changedModules: 1 });
    expect(simultaneous.status, simultaneous.bodyText).toBe(200);
    expect(simultaneous.body).toEqual(applied.body);
    await db.query("update users set name='Renamed administrator' where id=$1", [user]);
    const replay = await requestJson(app, path, { method: "POST", body: JSON.stringify(body) });
    expect(replay.status, replay.bodyText).toBe(200);
    expect(replay.body).toEqual(applied.body);
    const mismatch = await requestJson(app, path, { method: "POST", body: JSON.stringify({ ...body, reason: "Different reason" }) });
    expect(mismatch.status).toBe(409);
    expect((await db.query("select count(*)::int as count from audit_events where organization_id=$1 and action='module-structure-update'", [org])).rows[0]).toEqual({ count: 1 });
    expect((await db.query("select description from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows[0]).toEqual({ description: "Applied once" });
  });

  it("rejects stale confirmation and unsupported changes without writing", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.modules[0]!.description = "Not applied";
    const resolutions = {};
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
    await db.query("update parameter_modules set scope='Changed after preview' where organization_id=$1 and id='export-root'", [org]);
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
      document, resolutions, token: (preview.body as { token: string }).token, idempotencyKey: "stale", reason: "Reviewed" }) });
    expect(result.status).toBe(409);
    expect((await db.query("select description from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows[0]).toEqual({ description: "Applied once" });
    document.modules[0]!.parentRef = "unsupported-parent";
    const unsupported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
    expect(unsupported.status).toBe(400);
  });

  it("requires a fresh preview when the actor's roles change", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.modules[0]!.description = "Changed after permission review";
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('export-extra-role',$1,$2,'guest')", [user, org]);
    try {
      const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
        document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "role-drift", reason: "Reviewed" }) });
      expect(applied.status, applied.bodyText).toBe(409);
    } finally { await db.query("delete from user_role_bindings where id='export-extra-role'"); }
  });

  it("rolls back metadata and retry identity when audit fails", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    document.modules[0]!.description = "Must roll back";
    const resolutions = {};
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
    await db.query(`create function public.fail_structure_update_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-update' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await db.query("create trigger fail_structure_update_audit before insert on audit_events for each row execute function public.fail_structure_update_audit()");
    try {
      const failed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
        document, resolutions, token: (preview.body as { token: string }).token, idempotencyKey: "rollback", reason: "Reviewed" }) });
      expect(failed.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.query("drop trigger fail_structure_update_audit on audit_events");
      await db.query("drop function public.fail_structure_update_audit()");
    }
    expect((await db.query("select description from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows[0]).toEqual({ description: "Applied once" });
    expect((await db.query("select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key='rollback'", [org])).rowCount).toBe(0);
  });

  it("accepts omitted fields, rejects foreign baselines and unknown writable fields, and preserves a no-op", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    const module = document.modules[0]!;
    const partial = { ...document, modules: [{ ref: module.ref, sourceId: module.sourceId }], subjects: [] };
    const path = `/api/v2/organizations/${org}/module-structure/previews`;
    const preview = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: partial, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body).toMatchObject({ changes: [], conflicts: [] });
    const before = (await db.query("select origin,importance_override,updated_at from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows[0];
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
      document: partial, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "no-op", reason: "No changes" }) });
    expect(result.body).toMatchObject({ changedModules: 0, changedFields: 0 });
    expect((await db.query("select origin,importance_override,updated_at from parameter_modules where organization_id=$1 and id='export-root'", [org])).rows[0]).toEqual(before);
    expect((await db.query("select count(*)::int as count from audit_events where organization_id=$1 and action='module-structure-update'", [org])).rows[0]).toEqual({ count: 1 });
    const foreign = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, source: { ...partial.source, organizationId: "foreign" } }, resolutions: {} }) });
    expect(foreign.status).toBe(403);
    const missing = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, source: { ...partial.source, exportId: "missing" } }, resolutions: {} }) });
    expect(missing.status).toBe(404);
    const unknown = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, modules: [{ ...partial.modules[0], invented: true }] }, resolutions: {} }) });
    expect(unknown.status).toBe(400);
    const duplicate = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, modules: [partial.modules[0], partial.modules[0]] }, resolutions: {} }) });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toMatchObject({ error: { details: { path: "modules.1.ref" } } });
    const unsupported = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, version: 2 }, resolutions: {} }) });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body).toMatchObject({ error: { details: { issues: expect.arrayContaining([expect.objectContaining({ path: "document.version" })]) } } });
    const dangling = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document: { ...partial, modules: [{ ...partial.modules[0], parentRef: "missing" }] }, resolutions: {} }) });
    expect(dangling.status).toBe(400);
    expect(dangling.body).toMatchObject({ error: { details: { path: "modules.0.parentRef" } } });
  });

  it("rolls back the mutation and audit if writing the receipt fails", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
    const original = document.modules[0]!.description;
    document.modules[0]!.description = "Receipt failure";
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
    const before = (await db.query("select count(*)::int as count from audit_events where organization_id=$1 and action='module-structure-update'", [org])).rows[0];
    await db.query(`create function public.fail_structure_receipt() returns trigger language plpgsql as $$
      begin if new.command_family='module-structure-update' then raise exception 'injected receipt failure'; end if; return new; end $$`);
    await db.query("create trigger fail_structure_receipt before update on parameter_catalog.governance_command_idempotency for each row execute function public.fail_structure_receipt()");
    try {
      const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
        document, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "receipt-failure", reason: "Reviewed" }) });
      expect(result.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.query("drop trigger fail_structure_receipt on parameter_catalog.governance_command_idempotency");
      await db.query("drop function public.fail_structure_receipt()");
    }
    expect((await db.query("select description from parameter_modules where id='export-root'")).rows[0]).toEqual({ description: original });
    expect((await db.query("select count(*)::int as count from audit_events where organization_id=$1 and action='module-structure-update'", [org])).rows[0]).toEqual(before);
    expect((await db.query("select 1 from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key='receipt-failure'", [org])).rowCount).toBe(0);
  });

  it("applies a valid sibling name swap without committing temporary names", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('export-swap',$1,'Other','export-swap','business','curated')", [org]);
    try {
      const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
      const root = document.modules.find(m => m.sourceId === "export-root")!;
      const other = document.modules.find(m => m.sourceId === "export-swap")!;
      [root.name, other.name] = [other.name, root.name];
      const resolutions = {};
      const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document, resolutions }) });
      expect(preview.status, preview.bodyText).toBe(200);
      const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
        document, resolutions, token: (preview.body as { token: string }).token, idempotencyKey: "name-swap", reason: "Swap names" }) });
      expect(applied.status, applied.bodyText).toBe(200);
      expect((await db.query("select id,name from parameter_modules where id in ('export-root','export-swap') order by id")).rows).toEqual([
        { id: "export-root", name: "Other" }, { id: "export-swap", name: "Root" }]);
    } finally {
      await db.query("delete from parameter_modules where id='export-swap'");
      await db.query("update parameter_modules set name='Root' where id='export-root'");
    }
  });

  it("keeps historical whitespace and importance inheritance on a full unchanged round trip", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    await db.query("update parameter_modules set description=' historical ',origin='auto',importance_override=false where id='export-root'");
    const before = (await db.query("select description,origin,importance_override,updated_at from parameter_modules where id='export-root'")).rows[0];
    const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: exported.body, resolutions: {} }) });
    expect(preview.body).toMatchObject({ changes: [], conflicts: [] });
    const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
      document: exported.body, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "historical-no-op", reason: "Unchanged" }) });
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await db.query("select description,origin,importance_override,updated_at from parameter_modules where id='export-root'")).rows[0]).toEqual(before);
  });

  it("denies a non-admin and a different organization at the public preview boundary", async () => {
    const adminApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const exported = await requestJson(adminApp, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('export-guest',$1,'Guest','Guest',true)", [org]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('export-guest-role','export-guest',$1,'guest')", [org]);
    const viewerApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: "export-guest", roles: [{ roleId: "guest", projectId: null }] }) } } });
    const body = JSON.stringify({ document: exported.body, resolutions: {} });
    const denied = await requestJson(viewerApp, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body });
    expect(denied.status).toBe(403);
    const foreign = await requestJson(adminApp, "/api/v2/organizations/another-org/module-structure/previews", { method: "POST", body });
    expect(foreign.status).toBe(403);
  });

  it("previews a near-limit package and rejects one over the document bound", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const original = (await db.query<{ description: string }>("select description from parameter_modules where id='export-root'")).rows[0]!.description;
    await db.query("update parameter_modules set description=$1 where id='export-root'", ["x".repeat(4 * 1024 * 1024 - 4096)]);
    try {
      const exported = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      expect(exported.status, exported.bodyText).toBe(200);
      let document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
      const padding = 4 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(document));
      expect(padding).toBeGreaterThanOrEqual(0);
      await db.query("update parameter_modules set description=description || $1 where id='export-root'", ["x".repeat(padding)]);
      const exact = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      expect(exact.status, exact.bodyText).toBe(200);
      document = structuredClone(exact.body) as z.infer<typeof moduleStructureExportSchema>;
      expect(Buffer.byteLength(JSON.stringify(document))).toBe(4 * 1024 * 1024);
      const path = `/api/v2/organizations/${org}/module-structure/previews`;
      const accepted = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
      expect(accepted.status, accepted.bodyText).toBe(200);
      const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document, resolutions: {}, token: (accepted.body as { token: string }).token, idempotencyKey: "byte-limit-noop", reason: "Verify full round trip" }) });
      expect(applied.status, applied.bodyText).toBe(200);
      document.modules[0]!.description += "x";
      const rejected = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
      expect(rejected.status).toBe(400);
    } finally { await db.query("update parameter_modules set description=$1 where id='export-root'", [original]); }
  });

  it("includes all modules and retained recognition settings without a page limit", async () => {
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      select 'export-extra-'||n,$1,'Extra '||n,'export-extra-'||n,'business','curated' from generate_series(1,250) n`, [org]);
    await db.query("select parameter_catalog.claim_catalog_subject_owner('csub_acme_charger','csub_acme_power')");
    await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id,display_alias)
        values ('export-registration',$1,'csub_acme_power','retired','explicit','{}','export-placement','Power alias')`, [org]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('export-placement','export-registration',$1,'export-root','curated')`, [org]);
      await tx.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        values ($1,'export-registration','csub_acme_power',array['acme,override'],'physical-device','multiple')`, [org]);
      await tx.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,cascade_retired,registration_method,proof,current_placement_id)
        values ('export-child',$1,'csub_acme_charger','retired',true,'automatic','{}','export-child-placement')`, [org]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('export-child-placement','export-child',$1,null,'curated')`, [org]);
    });
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports?limit=1`, { method: "POST", body: "{}" });
    expect(result.status, result.bodyText).toBe(200);
    expect(() => moduleStructureExportSchema.parse(result.body)).not.toThrow();
    expect(result.body).toMatchObject({ counts: { modules: 251, subjects: 2 },
      subjects: expect.arrayContaining([expect.objectContaining({ subjectId: "csub_acme_power", state: "retired", displayAlias: "Power alias",
        placement: { kind: "module", moduleRef: "export-root" }, recognition: expect.objectContaining({ mode: "override",
          override: expect.objectContaining({ compatibles: ["acme,override"] }), effective: expect.objectContaining({ compatibles: ["acme,override"] }) }) }),
        expect.objectContaining({ subjectId: "csub_acme_charger", ownerSubjectId: "csub_acme_power", state: "retired", cascadeRetired: true,
          placement: null, recognition: expect.objectContaining({ mode: "inherit", override: null }) })]) });
    expect((result.body as { modules: unknown[] }).modules).toHaveLength(251);
    expect((await api.query(`select module_id,via_owner_registration_id from parameter_catalog.registration_effective_module
      where registration_id='export-child'`)).rows).toEqual([{ module_id: "export-root", via_owner_registration_id: "export-registration" }]);
    const retainedBefore = (await db.query(`select r.id,r.status,r.cascade_retired,r.current_placement_id,r.display_alias,
      rr.compatibles from parameter_catalog.organization_subject_registrations r left join registration_recognition_rules rr
      on rr.organization_id=r.organization_id and rr.registration_id=r.id where r.organization_id=$1 order by r.id`, [org])).rows;
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: result.body, resolutions: {} }) });
    expect(preview.body).toMatchObject({ changes: [], conflicts: [] });
    const roundTrip = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({
      document: result.body, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "populated-no-op", reason: "Round trip" }) });
    expect(roundTrip.status, roundTrip.bodyText).toBe(200);
    expect((await db.query(`select r.id,r.status,r.cascade_retired,r.current_placement_id,r.display_alias,
      rr.compatibles from parameter_catalog.organization_subject_registrations r left join registration_recognition_rules rr
      on rr.organization_id=r.organization_id and rr.registration_id=r.id where r.organization_id=$1 order by r.id`, [org])).rows).toEqual(retainedBefore);
    {
    const reset = structuredClone(result.body) as z.infer<typeof moduleStructureExportSchema>;
    const recognition = reset.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!;
    recognition.mode = "inherit"; recognition.override = null;
    const resetModule = reset.modules.find(module => module.sourceId === "export-root")!;
    const oldDescription = resetModule.description;
    resetModule.description = "Updated with recognition";
    const resetPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: reset, resolutions: {} }) });
    expect(resetPreview.status, resetPreview.bodyText).toBe(200);
    expect(resetPreview.body).toMatchObject({ changes: expect.arrayContaining([expect.objectContaining({ moduleId: "csub_acme_power", field: "recognition" })]), conflicts: [] });
    const resetBody = { document: reset, resolutions: {}, token: (resetPreview.body as { token: string }).token, idempotencyKey: "recognition-reset", reason: "Restore defaults" };
    const viewerApp = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: "export-guest", roles: [{ roleId: "guest", projectId: null }] }) } } });
    const deniedReset = await requestJson(viewerApp, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify(resetBody) });
    expect(deniedReset.status).toBe(403);
    await db.query(`create function public.fail_recognition_batch_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-update' then raise exception 'injected recognition batch failure'; end if; return new; end $$`);
    await db.query("create trigger fail_recognition_batch_audit before insert on audit_events for each row execute function public.fail_recognition_batch_audit()");
    try {
      const failed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify(resetBody) });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect((await db.query("select 1 from registration_recognition_rules where registration_id='export-registration'")).rowCount).toBe(1);
      expect((await db.query<{ description: string }>("select description from parameter_modules where id='export-root'")).rows[0]?.description).toBe(oldDescription);
    } finally { await db.query("drop trigger fail_recognition_batch_audit on audit_events"); await db.query("drop function public.fail_recognition_batch_audit()"); }
    const resetResult = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: reset, resolutions: {},
      token: (resetPreview.body as { token: string }).token, idempotencyKey: "recognition-reset", reason: "Restore defaults" }) });
    expect(resetResult.status, resetResult.bodyText).toBe(200);
    expect((await db.query("select 1 from registration_recognition_rules where registration_id='export-registration'")).rowCount).toBe(0);
    const inherited = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const edited = structuredClone(inherited.body) as z.infer<typeof moduleStructureExportSchema>;
    const editedRule = edited.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!;
    editedRule.mode = "override"; editedRule.override = { ...editedRule.effective, compatibles: ["acme,new"] };
    const editPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(editPreview.status, editPreview.bodyText).toBe(200);
    await db.query(`create function public.fail_recognition_batch_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-update' then raise exception 'injected recognition batch failure'; end if; return new; end $$`);
    await db.query("create trigger fail_recognition_batch_audit before insert on audit_events for each row execute function public.fail_recognition_batch_audit()");
    try {
      const failed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {},
        token: (editPreview.body as { token: string }).token, idempotencyKey: "recognition-edit", reason: "Update matching" }) });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect((await db.query("select 1 from registration_recognition_rules where registration_id='export-registration'")).rowCount).toBe(0);
    } finally { await db.query("drop trigger fail_recognition_batch_audit on audit_events"); await db.query("drop function public.fail_recognition_batch_audit()"); }
    const editResult = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {},
      token: (editPreview.body as { token: string }).token, idempotencyKey: "recognition-edit", reason: "Update matching" }) });
    expect(editResult.status, editResult.bodyText).toBe(200);
    expect((await db.query<{ compatibles: string[] }>("select compatibles from registration_recognition_rules where registration_id='export-registration'")).rows[0]?.compatibles).toEqual(["acme,new"]);
    const conflictExport = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const conflictDocument = structuredClone(conflictExport.body) as z.infer<typeof moduleStructureExportSchema>;
    conflictDocument.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!.override!.compatibles = ["acme,file"];
    await db.query("update registration_recognition_rules set compatibles=array['acme,current'] where registration_id='export-registration'");
    const conflictPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: conflictDocument, resolutions: {} }) });
    expect(conflictPreview.status, conflictPreview.bodyText).toBe(200);
    expect(conflictPreview.body).toMatchObject({ conflicts: [expect.objectContaining({ key: "csub_acme_power:recognition.compatibles", baseline: ["acme,new"], file: ["acme,file"], current: ["acme,current"] })] });
    const invalid = structuredClone(conflictDocument);
    invalid.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!.override!.compatibles = ["invalid selector!"];
    const invalidPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: invalid,
      resolutions: { "csub_acme_power:recognition.compatibles": "file" } }) });
    expect(invalidPreview.status).toBe(400);
    expect(invalidPreview.body).toMatchObject({ error: { details: { path: `subjects.${invalid.subjects.findIndex(subject => subject.subjectId === "csub_acme_power")}.recognition.override` } } });
    const resolved = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: conflictDocument,
      resolutions: { "csub_acme_power:recognition.compatibles": "file" } }) });
    expect(resolved.status, resolved.bodyText).toBe(200);
    await db.query("update registration_recognition_rules set compatibles=array['acme,later'] where registration_id='export-registration'");
    const stale = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: conflictDocument,
      resolutions: { "csub_acme_power:recognition.compatibles": "file" }, token: (resolved.body as { token: string }).token,
      idempotencyKey: "recognition-stale", reason: "Review" }) });
    expect(stale.status).toBe(409);
    }
    {
    const combinedExport = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const edited = structuredClone(combinedExport.body) as z.infer<typeof moduleStructureExportSchema>;
    const previousDescription = edited.modules.find(module => module.sourceId === "export-root")!.description;
    edited.modules.find(module => module.sourceId === "export-root")!.description = "Combined placement update";
    const root = edited.subjects.find(subject => subject.subjectId === "csub_acme_power")!;
    root.placement = { kind: "unset" };
    root.displayAlias = null;
    root.recognition!.override!.compatibles = ["acme,combined"];
    const placementPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(placementPreview.status, placementPreview.bodyText).toBe(200);
    expect(() => moduleStructurePreviewResponseSchema.parse(placementPreview.body)).not.toThrow();
    await db.query("update parameter_catalog.organization_subject_registrations set display_alias='Concurrent' where id='export-registration'");
    const stalePlacement = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (placementPreview.body as { token: string }).token,
        idempotencyKey: "stale-retired-unset", reason: "Reorganize retired subject" }) });
    expect(stalePlacement.status).toBe(409);
    const conflict = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(conflict.body).toMatchObject({ conflicts: [expect.objectContaining({ key: "subject:csub_acme_power:displayAlias", baseline: "Power alias", file: null, current: "Concurrent" })] });
    const resolutions = { "subject:csub_acme_power:displayAlias": "file" };
    const resolved = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions }) });
    expect(resolved.status, resolved.bodyText).toBe(200);
    await db.query(`create function public.fail_subject_transfer_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-update' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await db.query("create trigger fail_subject_transfer_audit before insert on audit_events for each row execute function public.fail_subject_transfer_audit()");
    try {
      const failed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
        method: "POST", body: JSON.stringify({ document: edited, resolutions, token: (resolved.body as { token: string }).token,
          idempotencyKey: "retired-rollback", reason: "Reorganize retired subject" }) });
      expect(failed.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.query("drop trigger fail_subject_transfer_audit on audit_events");
      await db.query("drop function public.fail_subject_transfer_audit()");
    }
    expect((await db.query(`select r.status,r.display_alias,p.module_id from parameter_catalog.organization_subject_registrations r
      join parameter_catalog.subject_placements p on p.id=r.current_placement_id where r.id='export-registration'`)).rows)
      .toEqual([{ status: "retired", display_alias: "Concurrent", module_id: "export-root" }]);
    expect((await db.query("select description from parameter_modules where id='export-root'")).rows[0]).toEqual({ description: previousDescription });
    expect((await db.query<{ compatibles: string[] }>("select compatibles from registration_recognition_rules where registration_id='export-registration'")).rows[0]?.compatibles).toEqual(["acme,later"]);
    const placementApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions, token: (resolved.body as { token: string }).token,
        idempotencyKey: "retired-unset-alias", reason: "Reorganize retired subject" }) });
    expect(placementApply.status, placementApply.bodyText).toBe(200);
    expect((await db.query<{ compatibles: string[] }>("select compatibles from registration_recognition_rules where registration_id='export-registration'")).rows[0]?.compatibles).toEqual(["acme,combined"]);
    const replay = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
      method: "POST", body: JSON.stringify({ document: edited, resolutions, token: (resolved.body as { token: string }).token,
        idempotencyKey: "retired-unset-alias", reason: "Reorganize retired subject" }) });
    expect(replay.body).toEqual(placementApply.body);
    expect((await db.query(`select r.status,r.current_placement_id,r.display_alias,p.module_id
      from parameter_catalog.organization_subject_registrations r join parameter_catalog.subject_placements p on p.id=r.current_placement_id
      where r.id='export-registration'`)).rows).toEqual([{ status: "retired", current_placement_id: "export-placement", display_alias: null, module_id: null }]);
    expect((await db.query(`select status,cascade_retired,current_placement_id from parameter_catalog.organization_subject_registrations
      where id='export-child'`)).rows).toEqual([{ status: "retired", cascade_retired: true, current_placement_id: "export-child-placement" }]);
    expect((await api.query(`select module_id,via_owner_registration_id from parameter_catalog.registration_effective_module
      where registration_id='export-child'`)).rows).toEqual([{ module_id: null, via_owner_registration_id: "export-registration" }]);
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      values ('export-unclassified',$1,'Unclassified','export-unclassified','unclassified','curated')`, [org]);
    const nextExport = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    const unclassified = structuredClone(nextExport.body) as z.infer<typeof moduleStructureExportSchema>;
    const newDestination = { ...unclassified, modules: [...unclassified.modules,
      { ref: "new-placement-module", name: "New placement module", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" }],
      subjects: unclassified.subjects.map(subject => subject.subjectId === "csub_acme_power" ? { ...subject, placement: { kind: "module", moduleRef: "new-placement-module" } } : subject) };
    const destinationPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: newDestination, resolutions: {} }) });
    expect(destinationPreview.status, destinationPreview.bodyText).toBe(200);
    const destinationApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
      method: "POST", body: JSON.stringify({ document: newDestination, resolutions: {}, token: (destinationPreview.body as { token: string }).token,
        idempotencyKey: "new-placement", reason: "Place in new module" }) });
    expect(destinationApply.status, destinationApply.bodyText).toBe(200);
    const destination = (await db.query<{ module_id: string }>("select module_id from parameter_catalog.subject_placements where id='export-placement'")).rows[0]!;
    expect((await db.query("select name from parameter_modules where id=$1", [destination.module_id])).rows).toEqual([{ name: "New placement module" }]);
    const destinationAgain = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: newDestination, resolutions: {} }) });
    expect(destinationAgain.status, destinationAgain.bodyText).toBe(200);
    expect(destinationAgain.body).toMatchObject({ changes: [], conflicts: [] });
    await db.query("update parameter_catalog.subject_placements set module_id=null where id='export-placement'");
    await db.query("delete from parameter_modules where id=$1", [destination.module_id]);
    unclassified.subjects.find(subject => subject.subjectId === "csub_acme_power")!.placement = { kind: "unclassified" };
    const unclassifiedPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, {
      method: "POST", body: JSON.stringify({ document: unclassified, resolutions: {} }) });
    expect(unclassifiedPreview.status, unclassifiedPreview.bodyText).toBe(200);
    const unclassifiedApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, {
      method: "POST", body: JSON.stringify({ document: unclassified, resolutions: {}, token: (unclassifiedPreview.body as { token: string }).token,
        idempotencyKey: "retired-unclassified", reason: "Use unclassified" }) });
    expect(unclassifiedApply.status, unclassifiedApply.bodyText).toBe(200);
    expect((await db.query("select module_id from parameter_catalog.subject_placements where id='export-placement'")).rows[0]).toEqual({ module_id: "export-unclassified" });
    expect((await api.query(`select module_id,via_owner_registration_id from parameter_catalog.registration_effective_module
      where registration_id='export-child'`)).rows).toEqual([{ module_id: "export-unclassified", via_owner_registration_id: "export-registration" }]);
    await db.query("update parameter_catalog.subject_placements set module_id=null where id='export-placement'");
    await db.query("delete from parameter_modules where id='export-unclassified'");
    }
    await db.query("update parameter_catalog.organization_subject_registrations set status='active' where id='export-registration'");
    await db.query("update parameter_catalog.organization_subject_registrations set cascade_retired=false where id='export-child'");
    const active = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(active.status, active.bodyText).toBe(200);
    expect((active.body as { subjects: unknown[] }).subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power", state: "active" }),
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "retired", cascadeRetired: false }),
    ]));
    const capacityDocument = structuredClone(active.body) as z.infer<typeof moduleStructureExportSchema>;
    capacityDocument.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!.override!.instanceCardinality = "singleton-per-project";
    const beforeCapacity = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: capacityDocument, resolutions: {} }) });
    expect(beforeCapacity.status, beforeCapacity.bodyText).toBe(200);
    await db.query("insert into projects(id,organization_id,name,code) values ('recognition-capacity-project',$1,'Capacity','CAP')", [org]);
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Missing Catalog release");
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const stabilize = (logicalNodeId: string) => createSourceBackedBindingService(pool).stabilize({ snapshot: loaded.value, organizationId: org,
        projectId: "recognition-capacity-project", logicalNodeId, registrationId: SubjectRegistrationId("export-registration"),
        definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"), effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"), expectedEffectiveRevisionId: null });
    const sourceGate = await pool.connect();
    await sourceGate.query("begin");
    await sourceGate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${org}`]);
    const sourceGatePid = (await sourceGate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    let sourceWrite: ReturnType<typeof stabilize> | undefined;
    let competingApply: ReturnType<typeof requestJson> | undefined;
    try {
      sourceWrite = stabilize("capacity-one");
      await vi.waitFor(async () => { expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [sourceGatePid])).rowCount).toBeGreaterThan(0); });
      competingApply = requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: capacityDocument,
        resolutions: {}, token: (beforeCapacity.body as { token: string }).token, idempotencyKey: "source-instance-race", reason: "Review" }) });
      await vi.waitFor(async () => { expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [sourceGatePid])).rowCount).toBeGreaterThan(1); });
      await sourceGate.query("commit");
      const binding = await sourceWrite;
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
      expect((await competingApply).status).toBe(409);
    } finally { await sourceGate.query("rollback"); sourceGate.release(); await sourceWrite?.catch(() => undefined); await competingApply?.catch(() => undefined); }
    const secondBinding = await stabilize("capacity-two");
    if (!secondBinding.ok) throw new Error(JSON.stringify(secondBinding.error));
    const capacityPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: capacityDocument, resolutions: {} }) });
    expect(capacityPreview.status, capacityPreview.bodyText).toBe(409);
    expect(capacityPreview.bodyText).toContain("单例容量");
    const capacityApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: capacityDocument,
      resolutions: {}, token: (beforeCapacity.body as { token: string }).token, idempotencyKey: "capacity-race", reason: "Review" }) });
    expect(capacityApply.status).toBe(409);
    const releaseDocument = structuredClone(active.body) as z.infer<typeof moduleStructureExportSchema>;
    releaseDocument.subjects.find(subject => subject.subjectId === "csub_acme_power")!.recognition!.override!.compatibles = ["acme,release-race"];
    const releasePreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: releaseDocument, resolutions: {} }) });
    expect(releasePreview.status, releasePreview.bodyText).toBe(200);
    const lifecycleDocument = structuredClone(active.body) as z.infer<typeof moduleStructureExportSchema>;
    const lifecycleRoot = lifecycleDocument.subjects.find(subject => subject.subjectId === "csub_acme_power")!;
    lifecycleRoot.state = "retired";
    const lifecyclePreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: lifecycleDocument, resolutions: {} }) });
    expect(lifecyclePreview.status, lifecyclePreview.bodyText).toBe(200);
    const gate = await pool.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(688004000041::bigint)");
    const gatePid = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const bundle = retiredPowerAliasSuccessorBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const publication = installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle), expectedCurrent: pin, expectedTargetDigest: compiled.value.aggregateDigest });
    let pending: ReturnType<typeof requestJson> | undefined;
    try {
      await vi.waitFor(async () => { expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [gatePid])).rowCount).toBeGreaterThan(0); });
      pending = requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: releaseDocument,
        resolutions: {}, token: (releasePreview.body as { token: string }).token, idempotencyKey: "release-race", reason: "Review" }) });
      await vi.waitFor(async () => { expect((await pool.query("select pid from pg_stat_activity where wait_event='advisory' and datname=current_database()")).rowCount).toBeGreaterThan(1); });
      await gate.query("commit");
      expect((await publication).ok).toBe(true);
      expect((await pending).status).toBe(409);
      const staleLifecycle = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: lifecycleDocument,
        resolutions: {}, token: (lifecyclePreview.body as { token: string }).token, idempotencyKey: "lifecycle-release-drift", reason: "Review" }) });
      expect(staleLifecycle.status).toBe(409);
      const refreshed = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: releaseDocument, resolutions: {} }) });
      expect(refreshed.status, refreshed.bodyText).toBe(200);
      const refreshedApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: releaseDocument,
        resolutions: {}, token: (refreshed.body as { token: string }).token, idempotencyKey: "release-refreshed", reason: "Review" }) });
      expect(refreshedApply.status, refreshedApply.bodyText).toBe(200);

    } finally { await gate.query("rollback"); gate.release(); await publication.catch(() => undefined); await pending?.catch(() => undefined); }
  });

  it("reads the release and module rows from one PostgreSQL snapshot", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    let pending: ReturnType<typeof requestJson> | undefined;
    await db.transaction(async tx => {
      await tx.query("lock table public.parameter_modules in access exclusive mode");
      pending = requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const activity = await db.query<{ blocked: boolean }>(`select exists (select 1 from pg_stat_activity
          where wait_event_type='Lock' and query like 'select id,parent_id,name,description,scope,sort_order,importance%') as blocked`);
        blocked = activity.rows[0]?.blocked === true;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await tx.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
        values ('export-later',$1,'Later','export-later','business','curated')`, [org]);
    });
    const result = await pending!;
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body).toMatchObject({ counts: { modules: 251, subjects: 2 } });
    const later = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(later.body).toMatchObject({ counts: { modules: 252, subjects: 2 } });
  });

  it("returns the supported entry maximum completely and rejects an excess before saving a baseline", async () => {
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      select 'export-scale-'||n,$1,'Scale '||n,'export-scale-'||n,'business','curated' from generate_series(1,9748) n`, [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const path = `/api/v2/organizations/${org}/module-structure/exports`;
    const maximum = await requestJson(app, path, { method: "POST", body: "{}" });
    expect(maximum.status, maximum.bodyText).toBe(200);
    expect((maximum.body as { modules: unknown[] }).modules).toHaveLength(10_000);
    const preview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: maximum.body, resolutions: {} }) });
    expect(preview.status, preview.bodyText).toBe(200);
    const applied = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: maximum.body, resolutions: {}, token: (preview.body as { token: string }).token, idempotencyKey: "maximum-noop", reason: "Verify full round trip" }) });
    expect(applied.status, applied.bodyText).toBe(200);
    expect(applied.body).toMatchObject({ changedModules: 0, changedFields: 0 });
    const edited = structuredClone(maximum.body) as z.infer<typeof moduleStructureExportSchema>;
    edited.modules.find(module => module.sourceId === "export-root")!.description = "Scale update";
    edited.modules.find(module => module.sourceId === "export-scale-1")!.parentRef = "export-root";
    const mixedPreview = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {} }) });
    expect(mixedPreview.status, mixedPreview.bodyText).toBe(200);
    const mixedApply = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: edited, resolutions: {}, token: (mixedPreview.body as { token: string }).token, idempotencyKey: "maximum-mixed", reason: "Verify full package" }) });
    expect(mixedApply.status, mixedApply.bodyText).toBe(200);
    expect((await db.query("select description from parameter_modules where id='export-root'")).rows).toEqual([{ description: "Scale update" }]);
    expect((await db.query("select parent_id from parameter_modules where id='export-scale-1'")).rows).toEqual([{ parent_id: "export-root" }]);
    const before = (await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0];
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('export-excess',$1,'Excess','export-excess','business','curated')", [org]);
    const excess = await requestJson(app, path, { method: "POST", body: "{}" });
    expect(excess.status).toBe(400);
    expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0]).toEqual(before);
  }, 60_000);

  it("rolls back the baseline when audit insertion fails", async () => {
    await db.query("delete from parameter_modules where id='export-excess'");
    const before = (await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0];
    await db.query(`create function reject_structure_export_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-export' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await db.query("create trigger reject_structure_export_audit before insert on audit_events for each row execute function reject_structure_export_audit()");
    try {
      const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
        makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
      const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      expect(result.status).toBe(500);
      expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0]).toEqual(before);
    } finally {
      await db.query("drop trigger reject_structure_export_audit on audit_events");
      await db.query("drop function reject_structure_export_audit()");
    }
  });

  it("rejects an over-byte-limit document before baseline or audit writes", async () => {
    await db.query("update parameter_modules set description=repeat('x', 4194304) where id='export-root'");
    const before = (await db.query(`select
      (select count(*) from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*) from audit_events where organization_id=$1 and action='module-structure-export') as audits`, [org])).rows[0];
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(result.status).toBe(400);
    expect((await db.query(`select
      (select count(*) from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*) from audit_events where organization_id=$1 and action='module-structure-export') as audits`, [org])).rows[0]).toEqual(before);
  });

  it("rejects a copy when its current Catalog Subject is retired after preview", async () => {
    const pool = getRootPostgresPool(db)!;
    const aliasBundle = retiredPowerAliasSuccessorBundle();
    const aliasCompiled = compileCatalogRelease(aliasBundle);
    if (!aliasCompiled.ok) throw new Error(JSON.stringify(aliasCompiled.error));
    let pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Missing Catalog release");
    const currentId = (await db.query<{ id: string }>("select current_catalog_release_id as id from parameter_catalog.catalog_state where singleton")).rows[0]!.id;
    if (currentId !== aliasBundle.targetReleaseId) {
      const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(aliasBundle), expectedCurrent: pin, expectedTargetDigest: aliasCompiled.value.aggregateDigest });
      if (!installed.ok) throw new Error(JSON.stringify(installed.error));
      pin = (await captureCurrentCatalogPin(pool))!;
    }
    const sourceOrg = "retirement-copy-source", targetOrg = "retirement-copy-target";
    for (const organization of [sourceOrg, targetOrg]) {
      await db.query("insert into organizations(id,name) values ($1,'Catalog copy')", [organization]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [`${organization}-admin`, organization]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`${organization}-role`, `${organization}-admin`, organization]);
    }
    await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
        values ('retirement-copy-registration',$1,'csub_acme_power','active','explicit','{}','retirement-copy-placement')`, [sourceOrg]);
      await tx.query("insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin) values ('retirement-copy-placement','retirement-copy-registration',$1,null,'curated')", [sourceOrg]);
      const children = await tx.query<{ id: string }>("select id from parameter_catalog.catalog_subjects where owner_subject_id='csub_acme_power'");
      for (const child of children.rows) {
        await tx.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
          values ($1,$2,$3,'active','automatic','{}',$4)`, [`retirement-copy-${child.id}`, sourceOrg, child.id, `retirement-copy-place-${child.id}`]);
        await tx.query("insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin) values ($1,$2,$3,null,'curated')",
          [`retirement-copy-place-${child.id}`, `retirement-copy-${child.id}`, sourceOrg]);
      }
    });
    const app = (organization: string) => createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: organization, userId: `${organization}-admin`, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const source = app(sourceOrg), target = app(targetOrg);
    const exported = await requestJson(source, `/api/v2/organizations/${sourceOrg}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(exported.status, exported.bodyText).toBe(200);
    const input = { mode: "copy", document: exported.body, mappings: {}, resolutions: {} };
    const path = `/api/v2/organizations/${targetOrg}/module-structure`;
    const preview = await requestJson(target, `${path}/previews`, { method: "POST", body: JSON.stringify(input) });
    expect(preview.status, preview.bodyText).toBe(200);
    const retired = retiredPowerSubjectSuccessorBundle(), compiled = compileCatalogRelease(retired);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(retired), expectedCurrent: pin, expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    expect((await requestJson(target, `${path}/previews`, { method: "POST", body: JSON.stringify(input) })).status).toBe(409);
    const stale = await requestJson(target, `${path}/applies`, { method: "POST", body: JSON.stringify({ ...input,
      token: (preview.body as { token: string }).token, idempotencyKey: "copy-catalog-retired", reason: "Review copy" }) });
    expect(stale.status).toBe(409);
    expect((await db.query("select count(*)::int as count from parameter_catalog.organization_subject_registrations where organization_id=$1", [targetOrg])).rows[0]).toEqual({ count: 0 });
  });
});
