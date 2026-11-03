import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { makeTestAuthContext } from "../../testing/authContext";
import { installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle, retiredPowerAliasSuccessorBundle } from "../catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { moduleStructureExportSchema } from "../contracts/dtoSchemas/moduleStructure";
import { createCatalogKernel } from "../catalog-kernel/interface";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract";

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
      const document = structuredClone(exported.body) as z.infer<typeof moduleStructureExportSchema>;
      const path = `/api/v2/organizations/${org}/module-structure/previews`;
      const accepted = await requestJson(app, path, { method: "POST", body: JSON.stringify({ document, resolutions: {} }) });
      expect(accepted.status, accepted.bodyText).toBe(200);
      document.modules[0]!.description += "x".repeat(8192);
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
    const resolved = await requestJson(app, `/api/v2/organizations/${org}/module-structure/previews`, { method: "POST", body: JSON.stringify({ document: conflictDocument,
      resolutions: { "csub_acme_power:recognition.compatibles": "file" } }) });
    expect(resolved.status, resolved.bodyText).toBe(200);
    await db.query("update registration_recognition_rules set compatibles=array['acme,later'] where registration_id='export-registration'");
    const stale = await requestJson(app, `/api/v2/organizations/${org}/module-structure/applies`, { method: "POST", body: JSON.stringify({ document: conflictDocument,
      resolutions: { "csub_acme_power:recognition.compatibles": "file" }, token: (resolved.body as { token: string }).token,
      idempotencyKey: "recognition-stale", reason: "Review" }) });
    expect(stale.status).toBe(409);
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
    for (const logicalNodeId of ["capacity-one", "capacity-two"]) {
      const binding = await createSourceBackedBindingService(pool).stabilize({ snapshot: loaded.value, organizationId: org,
        projectId: "recognition-capacity-project", logicalNodeId, registrationId: "export-registration",
        definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"), effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"), expectedEffectiveRevisionId: null });
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    }
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
});
