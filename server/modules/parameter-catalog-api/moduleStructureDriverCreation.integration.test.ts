import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { getAuthContext } from "../auth/repository";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { bootstrapFirstAcme, persistPredecessorArtifact } from "../catalog-kernel/install/publicationTestHarness";
import { enablePublicationPolicy } from "../catalog-publication/authorization/testHarness";
import { runPublicationManagerOnce } from "../catalog-publication/jobs/manager";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { moduleStructureExportSchema, moduleStructurePreviewResponseSchema, moduleStructureUpdateDocumentSchema } from "../contracts/dtoSchemas/moduleStructure";

type Document = z.infer<typeof moduleStructureUpdateDocumentSchema>;
type Preview = z.infer<typeof moduleStructurePreviewResponseSchema>;
type Snapshot = { modules: number; registrations: number; subjects: number; definitions: number; candidates: number; jobs: number };

describe("module structure creates drivers through publication before atomic organization import", () => {
  let fixture: ParameterCatalogDatabase;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let manager: ReturnType<typeof createPostgresDatabase>;
  let admin: pg.Client;
  const runToken = `msnew${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  beforeEach(async () => {
    fixture = await createDisposableParameterCatalogDatabase("structuredriver");
    db = createPostgresDatabase(fixture.url);
    admin = new pg.Client({ connectionString: fixture.url });
    await admin.connect();
    const predecessor = await bootstrapFirstAcme(getRootPostgresPool(db)!);
    await persistPredecessorArtifact(admin, predecessor);
    await enablePublicationPolicy(admin, { publicationEnabled: true, lowRiskSingleActorPublish: true });
    const runtime = await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken });
    api = createPostgresDatabase(runtime.apiUrl);
    manager = createPostgresDatabase(runtime.managerUrl);
    for (const connection of [api, manager]) expect((await connection.query<{ superuser: boolean }>(
      "select rolsuper as superuser from pg_roles where rolname=current_user",
    )).rows[0]?.superuser).toBe(false);
  }, 120_000);

  afterEach(async () => {
    await api?.close();
    await manager?.close();
    if (fixture) await dropLabRuntimeLogins(fixture.url, runToken);
    await admin?.end();
    await db?.close();
    await fixture?.close();
  });

  async function organization(id: string) {
    await db.query("insert into organizations(id,name) values ($1,$1)", [id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [`${id}-admin`, id]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`${id}-role`, `${id}-admin`, id]);
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Existing',$1,'business','curated')", [`${id}-module`, id]);
    const auth = makeTestAuthContext({ organizationId: id, userId: `${id}-admin`, roleId: "admin" });
    const createApp = () => createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () => auth } } });
    const app = createApp();
    const path = `/api/v2/organizations/${id}/module-structure`;
    const exported = async (): Promise<Document> => {
      const response = await requestJson(app, `${path}/exports`, { method: "POST", body: "{}" });
      expect(response.status, response.bodyText).toBe(200);
      return moduleStructureExportSchema.parse(response.body);
    };
    const preview = (document: unknown, mode = "update") => requestJson(app, `${path}/previews`, {
      method: "POST", body: JSON.stringify({ mode, document, resolutions: {} }),
    });
    // requestJson owns listen/close. Concurrent confirmations need independent
    // HTTP listeners while sharing the same real API pool and database locks.
    const confirm = (endpoint: "driver-publications" | "applies", document: Document, token: string, key: string) =>
      requestJson(createApp(), `${path}/${endpoint}`, { method: "POST", body: JSON.stringify({
        mode: "update", document, resolutions: {}, token, idempotencyKey: key, reason: "Reviewed new drivers and module destinations",
      }) });
    return { app, path, exported, preview, confirm };
  }

  function withDrivers(document: Document, suffix: string): Document {
    const result: Document = structuredClone(document);
    result.modules.push(
      { ref: `new-parent-${suffix}`, operation: "upsert", name: `Power ${suffix}`, parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
      { ref: `new-child-${suffix}`, operation: "upsert", name: `Charging ${suffix}`, parentRef: `new-parent-${suffix}`, description: "", scope: "", sortOrder: 0, importance: "high" },
    );
    result.newDrivers = [
      { ref: `new-chip-${suffix}`, compatible: `acme,chip-${suffix}`, driverNature: "physical-device", instanceCardinality: "multiple",
        displayAlias: `Chip ${suffix}`, placement: { kind: "module", moduleRef: `new-child-${suffix}` } },
      { ref: `new-service-${suffix}`, compatible: `acme,service-${suffix}`, driverNature: "logical-service", instanceCardinality: "singleton-per-project",
        displayAlias: null, placement: { kind: "module", moduleRef: document.modules[0]!.ref } },
    ];
    return result;
  }

  async function snapshot(organizationId: string) {
    return (await db.query<Snapshot>(`select
      (select count(*)::int from parameter_modules where organization_id=$1) as modules,
      (select count(*)::int from parameter_catalog.organization_subject_registrations where organization_id=$1) as registrations,
      (select count(*)::int from parameter_catalog.catalog_subjects) as subjects,
      (select count(*)::int from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::int from catalog_publication.candidates) as candidates,
      (select count(*)::int from catalog_publication.publication_jobs) as jobs`, [organizationId])).rows[0]!;
  }

  async function activate() {
    const pool = getRootPostgresPool(manager)!;
    expect(await runPublicationManagerOnce({ db: manager, pool, installer: createCatalogInstaller(pool), ownerId: runToken,
      resolvePublisherActor: async principalId => {
        const user = (await manager.query<{ organization_id: string }>(`select u.organization_id from users u
          join user_role_bindings r on r.user_id=u.id and r.organization_id=u.organization_id
          where u.id=$1 and u.is_active and r.role_id='admin' and r.project_id is null`, [principalId])).rows[0];
        return user ? createUserInvocation(makeTestAuthContext({ userId: principalId, organizationId: user.organization_id, roleId: "admin" })) : null;
      },
    })).toBe("claimed");
  }

  async function checkedPreview(source: Awaited<ReturnType<typeof organization>>, document: Document): Promise<Preview> {
    const response = await source.preview(document);
    expect(response.status, response.bodyText).toBe(200);
    return moduleStructurePreviewResponseSchema.parse(response.body);
  }

  it("publishes multiple empty drivers, then creates modules and registrations without duplicates or rewriting later edits", async () => {
    const id = "new-driver-success", source = await organization(id);
    const document = withDrivers(await source.exported(), "success");
    document.newDrivers![0]!.ref = "__proto__";
    // Both are literal DTS values and distinct Catalog identities.
    document.newDrivers![0]!.compatible = "onewire-phy,pl061,gpio";
    document.newDrivers![1]!.compatible = "huawei, wireless_aux_tx";
    const before = await snapshot(id);
    const initial = await checkedPreview(source, document);
    expect(initial.driverCreation).toMatchObject({ phase: "required", drivers: document.newDrivers });
    expect(await snapshot(id)).toEqual(before);
    expect((await source.confirm("applies", document, initial.token, "premature")).status).toBe(409);
    const [published, concurrent] = await Promise.all([
      source.confirm("driver-publications", document, initial.token, "publish-success"),
      source.confirm("driver-publications", document, initial.token, "publish-success"),
    ]);
    expect(published.status, published.bodyText).toBe(200);
    const publishing = moduleStructurePreviewResponseSchema.parse(published.body);
    expect(publishing.driverCreation).toMatchObject({ phase: "publishing", jobId: expect.any(String), candidateId: expect.any(String) });
    expect(concurrent.status, concurrent.bodyText).toBe(200);
    expect(concurrent.body).toMatchObject({ driverCreation: { jobId: publishing.driverCreation!.jobId, candidateId: publishing.driverCreation!.candidateId } });
    const queued = await snapshot(id);
    expect(queued).toMatchObject({ ...before, candidates: Number(before!.candidates) + 1, jobs: Number(before!.jobs) + 1 });
    const replay = await source.confirm("driver-publications", document, initial.token, "publish-success");
    expect(replay.status, replay.bodyText).toBe(200);
    expect(replay.body).toMatchObject({ driverCreation: { jobId: publishing.driverCreation!.jobId, candidateId: publishing.driverCreation!.candidateId } });
    expect(await snapshot(id)).toEqual(queued);
    const changedRequest = structuredClone(document);
    changedRequest.modules[1]!.description = "Different content under the same publication key";
    const keyConflict = await source.confirm("driver-publications", changedRequest, initial.token, "publish-success");
    expect(keyConflict.status, keyConflict.bodyText).toBe(409);
    expect(await snapshot(id)).toEqual(queued);
    expect((await source.confirm("applies", document, publishing.token, "still-pending")).status).toBe(409);
    await activate();
    const ready = await checkedPreview(source, document);
    expect(ready.driverCreation?.phase).toBe("ready");
    const ids = ready.driverCreation!.drivers.map(driver => driver.subjectId!);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(subjectId => subjectId.startsWith("csub_"))).toBe(true);
    expect((await snapshot(id))).toMatchObject({ modules: before!.modules, registrations: 0, definitions: before!.definitions });
    const applied = await source.confirm("applies", document, ready.token, "apply-success");
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await source.confirm("applies", document, ready.token, "apply-success")).body).toEqual(applied.body);
    const after = await source.exported();
    expect(after.subjects).toHaveLength(2);
    expect(after.modules).toHaveLength(document.modules.length);
    for (const [index, driver] of document.newDrivers!.entries()) {
      const subject = after.subjects.find(entry => entry.subjectId === ids[index]);
      expect(subject).toMatchObject({ kind: "driver", state: "active", displayAlias: driver.displayAlias,
        recognition: { mode: "inherit", effective: { compatibles: [driver.compatible], driverNature: driver.driverNature, instanceCardinality: driver.instanceCardinality } } });
      expect((await db.query("select 1 from parameter_catalog.parameter_definitions where subject_id=$1", [ids[index]])).rowCount).toBe(0);
    }
    const renamed: Document = structuredClone(after);
    renamed.subjects[0]!.displayAlias = "Later user alias";
    renamed.subjects[0]!.state = "retired";
    const renamePreview = await checkedPreview(source, renamed);
    expect((await source.confirm("applies", renamed, renamePreview.token, "later-settings")).status).toBe(200);
    const resumed = await checkedPreview(source, document);
    expect(resumed.driverCreation?.phase).toBe("applied");
    expect(resumed.changes).toEqual([]);
    expect(resumed.conflicts).toEqual([]);
    expect((await source.exported()).subjects.find(entry => entry.subjectId === renamed.subjects[0]!.subjectId))
      .toMatchObject({ displayAlias: "Later user alias", state: "retired" });
  }, 120_000);

  it("rejects unsupported declarations with precise file paths and no publication or organization writes", async () => {
    const id = "new-driver-invalid", source = await organization(id);
    const document = withDrivers(await source.exported(), "invalid");
    const before = await snapshot(id);
    const cases: Array<{ path: string; mutate: (value: Document) => void }> = [
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "acme,*"; } },
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "onewire-phy,,gpio"; } },
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "onewire-phy,pl061,"; } },
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "huawei ,wireless_aux_tx"; } },
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "huawei,wireless aux_tx"; } },
      { path: "/newDrivers/0/placement/moduleRef", mutate: value => { value.newDrivers![0]!.placement.moduleRef = "missing-module"; } },
      { path: "/newDrivers/1/ref", mutate: value => { value.newDrivers![1]!.ref = value.newDrivers![0]!.ref; } },
      { path: "/newDrivers/1/compatible", mutate: value => { value.newDrivers![1]!.compatible = value.newDrivers![0]!.compatible; } },
      { path: "/newDrivers/0/compatible", mutate: value => { value.newDrivers![0]!.compatible = "acme,power"; } },
    ];
    for (const entry of cases) {
      const invalid = structuredClone(document);
      entry.mutate(invalid);
      const rejected = await source.preview(invalid);
      expect([400, 409], rejected.bodyText).toContain(rejected.status);
      expect(rejected.body).toMatchObject({ error: { details: { issues: expect.arrayContaining([
        expect.objectContaining({ jsonPointer: entry.path, hint: expect.any(String), received: expect.anything() }),
      ]) } } });
      expect(await snapshot(id)).toEqual(before);
    }
    const incomplete = structuredClone(document) as unknown as { newDrivers: Array<Record<string, unknown>> };
    delete incomplete.newDrivers[0]!.driverNature;
    const missing = await source.preview(incomplete);
    expect(missing.status, missing.bodyText).toBe(400);
    expect(missing.body).toMatchObject({ error: { details: { issues: expect.arrayContaining([
      expect.objectContaining({ jsonPointer: "/newDrivers/0/driverNature" }),
    ]) } } });
    const copy = await source.preview(document, "copy");
    expect(copy.status, copy.bodyText).toBe(400);
    const corrupt = structuredClone(document);
    corrupt.counts.subjects += 2;
    expect((await source.preview(corrupt)).status).toBe(400);
    expect(await snapshot(id)).toEqual(before);
  });

  it("rejects stale publication approval and revalidates module errors before producing a candidate", async () => {
    const id = "new-driver-stale", source = await organization(id);
    const document = withDrivers(await source.exported(), "stale");
    const initial = await checkedPreview(source, document);
    const before = await snapshot(id);
    await db.query("update parameter_modules set description='Concurrent metadata' where organization_id=$1", [id]);
    const stale = await source.confirm("driver-publications", document, initial.token, "stale-approval");
    expect(stale.status, stale.bodyText).toBe(409);
    expect(await snapshot(id)).toEqual(before);
    const updated = await checkedPreview(source, document);
    const invalid = structuredClone(document);
    invalid.modules[1]!.parentRef = invalid.modules[2]!.ref;
    expect((await source.confirm("driver-publications", invalid, updated.token, "invalid-hierarchy")).status).toBe(409);
    expect(await snapshot(id)).toEqual(before);
  });

  it("isolates organizations and enforces publication capability independently of ordinary import access", async () => {
    const id = "new-driver-auth", source = await organization(id);
    const other = await organization("new-driver-auth-other");
    const document = withDrivers(await source.exported(), "auth");
    const initial = await checkedPreview(source, document);
    const before = await snapshot(id);
    const cross = await requestJson(source.app, `${other.path}/driver-publications`, { method: "POST", body: JSON.stringify({
      document, resolutions: {}, token: initial.token, idempotencyKey: "foreign", reason: "Reviewed",
    }) });
    expect(cross.status, cross.bodyText).toBe(403);
    const ownForeign = await other.preview(document);
    expect(ownForeign.status, ownForeign.bodyText).toBe(403);
    // Production authentication reloads database roles and ignores permissions
    // supplied by the verifier. Platform admins retain organization import access
    // but require an explicit Catalog capability grant to publish.
    await db.query("update user_role_bindings set role_id='platform-admin' where id=$1", [`${id}-role`]);
    await db.query(`insert into roles(id,name,level,permissions)
      values ('catalog-capability-module-driver-author','Driver author','user',array['catalog:author'])`);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id)
      values ($1,$2,$3,'catalog-capability-module-driver-author')`, [`${id}-author`, `${id}-admin`, id]);
    const restricted = await getAuthContext(api, `${id}-admin`);
    expect(restricted.permissions).toContain("catalog:author");
    expect(restricted.permissions).not.toContain("catalog:publish");
    const allowedImport = await checkedPreview(source, document);
    const rejected = await source.confirm("driver-publications", document, allowedImport.token, "without-publish");
    expect(rejected.status, rejected.bodyText).toBe(403);
    expect(rejected.body).toMatchObject({ error: { code: "FORBIDDEN", details: { reason: "publication-capability-missing" } } });
    expect(await snapshot(id)).toEqual(before);
  });

  it("keeps a successful Catalog publication while rolling back organization writes on audit failure, then resumes", async () => {
    const id = "new-driver-rollback", source = await organization(id);
    const document = withDrivers(await source.exported(), "rollback");
    const initial = await checkedPreview(source, document);
    const published = await source.confirm("driver-publications", document, initial.token, "publish-rollback");
    expect(published.status, published.bodyText).toBe(200);
    await activate();
    const ready = await checkedPreview(source, document);
    expect(ready.driverCreation?.phase).toBe("ready");
    const before = await snapshot(id);
    await db.query(`create function fail_new_driver_audit() returns trigger language plpgsql as $$ begin
      if new.organization_id='new-driver-rollback' and new.action='module-structure-update' then raise exception 'injected import audit failure'; end if; return new; end $$;
      create trigger fail_new_driver_audit before insert on audit_events for each row execute function fail_new_driver_audit()`);
    try {
      expect((await source.confirm("applies", document, ready.token, "retry-audit")).status).toBe(500);
      expect(await snapshot(id)).toEqual(before);
      expect((await checkedPreview(source, document)).driverCreation?.phase).toBe("ready");
    } finally { await db.query("drop trigger fail_new_driver_audit on audit_events; drop function fail_new_driver_audit()"); }
    const applied = await source.confirm("applies", document, ready.token, "retry-audit");
    expect(applied.status, applied.bodyText).toBe(200);
    expect((await checkedPreview(source, document)).driverCreation?.phase).toBe("applied");
    expect((await snapshot(id))).toMatchObject({ subjects: before!.subjects, candidates: before!.candidates, jobs: before!.jobs, registrations: 2 });
  }, 120_000);

  it("requires explicit rebase retry and permits placement repair without reallocating published driver identities", async () => {
    const first = await organization("new-driver-rebase-first");
    const secondId = "new-driver-rebase-second", second = await organization(secondId);
    const firstDocument = withDrivers(await first.exported(), "rebase-first");
    const secondDocument = withDrivers(await second.exported(), "rebase-second");
    const firstPreview = await checkedPreview(first, firstDocument);
    const secondPreview = await checkedPreview(second, secondDocument);
    const firstPublished = await first.confirm("driver-publications", firstDocument, firstPreview.token, "publish-rebase-first");
    expect(firstPublished.status, firstPublished.bodyText).toBe(200);
    const secondPublished = await second.confirm("driver-publications", secondDocument, secondPreview.token, "publish-rebase-second");
    expect(secondPublished.status, secondPublished.bodyText).toBe(200);
    const oldPublication = moduleStructurePreviewResponseSchema.parse(secondPublished.body).driverCreation!;
    await activate();
    expect((await checkedPreview(first, firstDocument)).driverCreation?.phase).toBe("ready");
    await activate();
    const blocked = await checkedPreview(second, secondDocument);
    expect(blocked.driverCreation).toMatchObject({ phase: "blocked", candidateId: oldPublication.candidateId, jobId: oldPublication.jobId });
    const beforeRetry = await snapshot(secondId);
    const unchangedRetry = await second.confirm("driver-publications", secondDocument, secondPreview.token, "publish-rebase-second");
    expect(unchangedRetry.status, unchangedRetry.bodyText).toBe(200);
    expect(unchangedRetry.body).toMatchObject({ driverCreation: { phase: "blocked", jobId: oldPublication.jobId } });
    expect(await snapshot(secondId)).toEqual(beforeRetry);
    const rebased = await second.confirm("driver-publications", secondDocument, blocked.token, "publish-rebase-second-new");
    expect(rebased.status, rebased.bodyText).toBe(200);
    const newPublication = moduleStructurePreviewResponseSchema.parse(rebased.body).driverCreation!;
    expect(newPublication.phase).toBe("publishing");
    expect(newPublication.candidateId).not.toBe(oldPublication.candidateId);
    expect(newPublication.jobId).not.toBe(oldPublication.jobId);
    expect(await snapshot(secondId)).toMatchObject({ candidates: beforeRetry.candidates + 1, jobs: beforeRetry.jobs + 1, modules: beforeRetry.modules, registrations: 0 });
    await activate();
    const ready = await checkedPreview(second, secondDocument);
    expect(ready.driverCreation?.phase).toBe("ready");
    const identities = Object.fromEntries(ready.driverCreation!.drivers.map(driver => [driver.ref, driver.subjectId]));
    const repaired = structuredClone(secondDocument);
    repaired.newDrivers!.reverse();
    repaired.newDrivers![0]!.placement.moduleRef = "new-parent-rebase-second";
    repaired.newDrivers![0]!.displayAlias = "Reviewed destination repair";
    const repairedPreview = await checkedPreview(second, repaired);
    expect(repairedPreview.driverCreation?.phase).toBe("ready");
    expect(Object.fromEntries(repairedPreview.driverCreation!.drivers.map(driver => [driver.ref, driver.subjectId]))).toEqual(identities);
    expect(repairedPreview.driverCreation).toMatchObject({ jobId: newPublication.jobId, candidateId: newPublication.candidateId });
    const applied = await second.confirm("applies", repaired, repairedPreview.token, "apply-repaired-placement");
    expect(applied.status, applied.bodyText).toBe(200);
    const exported = await second.exported();
    const parent = exported.modules.find(module => module.name === "Power rebase-second")!;
    expect(exported.subjects.find(subject => subject.subjectId === identities[repaired.newDrivers![0]!.ref])).toMatchObject({
      displayAlias: "Reviewed destination repair", placement: { kind: "module", moduleRef: parent.ref },
    });
    expect(await snapshot(secondId)).toMatchObject({ candidates: beforeRetry.candidates + 1, jobs: beforeRetry.jobs + 1, registrations: 2 });
  }, 120_000);

  it("leaves modules and registrations unapplied when the publisher loses access before manager activation", async () => {
    const id = "new-driver-revoked", source = await organization(id);
    const document = withDrivers(await source.exported(), "revoked");
    const initial = await checkedPreview(source, document);
    const before = await snapshot(id);
    const published = await source.confirm("driver-publications", document, initial.token, "publish-revoked");
    expect(published.status, published.bodyText).toBe(200);
    await db.query("delete from user_role_bindings where organization_id=$1", [id]);
    await activate();
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`${id}-role`, `${id}-admin`, id]);
    const blocked = await checkedPreview(source, document);
    expect(blocked.driverCreation?.phase).toBe("blocked");
    expect((await source.confirm("applies", document, blocked.token, "no-activation")).status).toBe(409);
    expect((await snapshot(id))).toMatchObject({ modules: before!.modules, registrations: before!.registrations, subjects: before!.subjects, definitions: before!.definitions });
  }, 120_000);
});
