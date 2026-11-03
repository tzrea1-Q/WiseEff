import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool, type Database, type Queryable, type RootDatabase } from "../../shared/database/client";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedLegacySubjectPlacement } from "../../testing/parameterCatalog/driverSource";
import { applyMigrations, migrationsDir } from "../../testing/tempDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins, type ProvisionedRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle, retiredPowerAliasSuccessorBundle } from "../catalog-kernel/runtime/catalogChain.fixture";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogSubjectId, SubjectRegistrationId, type CatalogReleasePin } from "../parameter-catalog-contract";
import { createRegistrationService } from "../parameter-governance/registration";
import { getPlacement, getRegistration } from "../parameter-governance/queries/registration";
import { getParameterModuleById, updateParameterModule } from "../parameters/parameterModuleRepository";
import { createLegacyParameterModule as createParameterModule, seedLegacyModuleMapping } from "../../testing/legacyParameterModuleFixture";
import { updateParameterModuleForAuth, moveParameterModuleForAuth } from "../parameters/service";
import type { AuthContext } from "../auth/types";
import { readRegistry } from "./repository";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { captureModuleRecognitionCatalog, loadModuleRecognitionSettings, loadOrganizationCatalogSnapshot, loadOrganizationRecognitionRules,
  readRegistrationRecognitionSettings, registrationRecognitionEtag, updateRegistrationRecognitionSettings } from "./recognitionSettings";
import { createUserInvocation } from "../auth/trustedInvocation";
import { DriverCompatible, NormalizedNodeTypeName, createCatalogKernel } from "../catalog-kernel/interface";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { aggregateBindingDashboardHotspots } from "../parameter-bindings/dashboardRead";
import { DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract";
import { CATALOG_IDEMPOTENCY_HEADER, CATALOG_IF_MATCH_HEADER, CATALOG_RELEASE_HEADER } from "../contracts/dtoSchemas/parameterCatalog";
import { resolveModuleIdForBinding } from "./resolveModuleForBinding";
import { migrateModuleStructure } from "../../../scripts/migrate-module-structure";
import { runV05 } from "../release-verification/gates/postgres/countGates";
import { queryOf } from "../release-verification/gates/postgres/session";

describe("administrator module metadata through the API database role", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let ownerDb: RootDatabase;
  let apiDb: RootDatabase;
  let runtime: ProvisionedRuntimeLogins;
  let release: CatalogReleasePin;
  let unplacedRuleModuleId: string;
  const migrationNotices: string[] = [];
  const legacyFixtures = new Map<string, { auth: AuthContext; parent: Awaited<ReturnType<typeof createParameterModule>>;
    target: Awaited<ReturnType<typeof createParameterModule>>; module: Awaited<ReturnType<typeof createParameterModule>>;
    registrationId: ReturnType<typeof SubjectRegistrationId> }>();

  beforeAll(async () => {
    database = await createCheckedEmptyDatabase("moduleadminmetadata");
    ownerDb = createPostgresDatabase(database.url);
    await applyMigrations(ownerDb, migrationsDir, { before: "0320_placement_business_modules.sql" });
    // Current writers need later columns while constructing the pre-0320 fixture;
    // remove them before applying the real migrations.
    await ownerDb.query("alter table public.parameter_modules add column archived_at timestamptz");
    await ownerDb.query("alter table parameter_catalog.organization_subject_registrations add column display_alias text");
    await ownerDb.query("alter table parameter_catalog.organization_subject_registrations add column cascade_retired boolean not null default false");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const chain = await installPublishedCatalogChain(pool);
    const bundle = nodeTypeAndSecondDriverSuccessorBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, {
      mode: "advance", source: jsonCatalogReleaseSource(bundle), expectedCurrent: chain.pinC, expectedTargetDigest: compiled.value.aggregateDigest,
    });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    release = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    // These tests exercise technical modules and recognition rules retained from before 0320.
    for (const [key, kind, origin] of [
      ["auto-driver", "driver-group", "auto"], ["manual-driver", "driver-group", "curated"],
      ["auto-node", "node-type", "auto"], ["manual-node", "node-type", "curated"],
      ["boundaries", "driver-group", "auto"], ["foreign", "node-type", "curated"],
      ["overlapping-edits", "node-type", "auto"], ["reciprocal-moves", "node-type", "auto"],
      ["overlapping-move-audit", "node-type", "auto"], ["driver-recognition", "driver-group", "auto"],
      ["local-rule-boundaries", "node-type", "auto"], ["foreign-rule-boundaries", "driver-group", "curated"],
      ["existing-capacity", "driver-group", "curated"], ["recognition-placement-move", "driver-group", "curated"],
      ["recognition-late-registration", "node-type", "auto"],
      ["registration-rule-overlay", "driver-group", "curated"],
      ["recognition-upgrade", "driver-group", "curated"],
      ["recognition-api", "driver-group", "curated"],
      ["ambiguous-rule", "driver-group", "curated"],
      ["recognition-mismatch", "node-type", "curated"],
      ["recognition-unproven", "node-type", "curated"],
      ["recognition-shared-upgrade", "driver-group", "curated"],
      ["recognition-no-placement", "driver-group", "curated"],
      ["recognition-old-endpoint", "driver-group", "curated"],
      ["recognition-release-lock", "node-type", "curated"],
      ["recognition-release-race", "node-type", "curated"],
      ["legacy-runtime-mapping", "driver-group", "curated"],
    ] as const) await prepareLegacyFixture(key, kind, origin);
    const upgrade = legacyFixtures.get("recognition-upgrade")!;
    await pool.query(`insert into public.module_recognition_rules
      (organization_id, module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,'csub_acme_power',array['local,upgrade'],'physical-device','multiple')`, [upgrade.auth.organization.id, upgrade.module.id]);
    const mismatch = legacyFixtures.get("recognition-mismatch")!;
    const unproven = legacyFixtures.get("recognition-unproven")!;
    await pool.query(`insert into public.module_recognition_rules
      (organization_id, module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,'csub_acme_power',array['local,misattributed'],'physical-device','multiple'),
             ($3,$4,null,array['local,unproven'],'physical-device','multiple')`,
    [mismatch.auth.organization.id, mismatch.module.id, unproven.auth.organization.id, unproven.module.id]);
    await applyMigrations(ownerDb, migrationsDir, { before: "0322_registration_effective_module.sql" });
    const shared = legacyFixtures.get("recognition-shared-upgrade")!;
    const sharedService = createRegistrationService(pool);
    const moved = await sharedService.execute({ kind: "move-placement", organizationId: shared.auth.organization.id,
      registrationId: shared.registrationId, expectedRelease: release, destinationModuleId: shared.target.id,
      idempotencyKey: "migration-shared-move", context: { actorKind: "org-admin", principalId: shared.auth.user.id } });
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    const second = await sharedService.execute({ kind: "register", organizationId: shared.auth.organization.id,
      subjectId: CatalogSubjectId("csub_acme_sensor"), subjectKind: "driver", expectedRelease: release,
      placement: { mode: "use-default" }, destinationModuleId: shared.target.id, method: "explicit", proof: {},
      idempotencyKey: "migration-shared-register", context: { actorKind: "org-admin", principalId: shared.auth.user.id } });
    if (!second.ok) throw new Error(JSON.stringify(second.error));
    await pool.query(`insert into public.module_recognition_rules
      (organization_id, module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,'csub_acme_power',array['local,shared-upgrade'],'physical-device','multiple')`,
    [shared.auth.organization.id, shared.target.id]);
    const unplaced = legacyFixtures.get("recognition-no-placement")!;
    const emptyModule = await createParameterModule(pool, { organizationId: unplaced.auth.organization.id,
      name: "Empty legacy module", kind: "driver-group" });
    unplacedRuleModuleId = emptyModule.id;
    await pool.query(`insert into public.module_recognition_rules
      (organization_id, module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,'csub_acme_power',array['local,unplaced'],'physical-device','multiple')`,
    [unplaced.auth.organization.id, unplacedRuleModuleId]);
    const migrationPool = getRootPostgresPool(ownerDb)!;
    const observedClients = new WeakSet<pg.PoolClient>();
    const observeNotices = (client: pg.PoolClient) => {
      if (observedClients.has(client)) return;
      observedClients.add(client);
      client.on("notice", notice => migrationNotices.push(notice.message ?? ""));
    };
    migrationPool.on("acquire", observeNotices);
    try {
      await ownerDb.query("alter table public.parameter_modules drop column archived_at");
      await ownerDb.query("alter table parameter_catalog.organization_subject_registrations drop column display_alias");
      await ownerDb.query("alter table parameter_catalog.organization_subject_registrations drop column cascade_retired");
      await applyMigrations(ownerDb, migrationsDir);
    } finally {
      migrationPool.off("acquire", observeNotices);
    }
    runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: `modadmin${process.pid}` });
    apiDb = createPostgresDatabase(runtime.apiUrl);
  }, 120_000);

  afterAll(async () => {
    await apiDb?.close();
    await pool?.end();
    if (runtime?.runToken) {
      const cleanup = await dropLabRuntimeLogins(database.url, runtime.runToken);
      if (cleanup.failed.length) throw new Error(cleanup.failed.join(","));
    }
    await ownerDb?.close();
    await database?.close();
  });

  async function prepareLegacyFixture(key: string, kind: "driver-group" | "node-type", origin: "auto" | "curated") {
    const organizationId = `org-module-admin-${key}`;
    const userId = `user-module-admin-${key}`;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Module admin')`, [organizationId]);
    await pool.query(`insert into public.users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'Admin', $3, 'Admin', true)`, [userId, organizationId, `${key}@module.test`]);
    await pool.query(`insert into public.user_role_bindings (id, user_id, organization_id, role_id, project_id)
      values ($1, $2, $3, 'admin', null)`, [`role-${key}`, userId, organizationId]);
    const auth: AuthContext = {
      user: { id: userId, organizationId, name: "Admin", email: `${key}@module.test`, title: "Admin", isActive: true },
      organization: { id: organizationId, name: "Module admin" },
      roles: [{ roleId: "admin", projectId: null }], permissions: ["admin:access", "parameter:view"],
    };
    const parent = await createParameterModule(pool, { organizationId, name: "Parent", importance: "high" });
    const target = await createParameterModule(pool, { organizationId, name: "Target", importance: "low" });
    const module = await createParameterModule(pool, { organizationId, name: "Original", parentId: parent.id, kind, origin });
    const registrationId = await seedLegacySubjectPlacement(pool, { organizationId,
      subjectId: kind === "driver-group" ? "csub_acme_power" : "csub_acme_charger", moduleId: module.id,
      reason: "Administrator metadata migration fixture" });
    legacyFixtures.set(key, { auth, parent, target, module, registrationId });
  }

  async function fixture(key: string, _kind: "driver-group" | "node-type", _origin: "auto" | "curated") {
    const prepared = legacyFixtures.get(key);
    if (!prepared) throw new Error(`Missing legacy fixture ${key}`);
    const { auth, registrationId } = prepared;
    const placementQuery = { organizationId: auth.organization.id, registrationId, observedCatalogReleaseId: release.id,
      authScope: { organizationId: auth.organization.id, principalId: auth.user.id } };
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, placementQuery);
    if (!placement.ok) throw new Error(JSON.stringify(placement.error));
    return { ...prepared, placementQuery, placement: placement.value };
  }
  const registrationService = () => createRegistrationService(getRootPostgresPool(apiDb)!);
  async function updateRecognition(db: Database, f: Awaited<ReturnType<typeof fixture>>,
    body: Parameters<typeof updateRegistrationRecognitionSettings>[1]["body"]) {
    const current = await readRegistrationRecognitionSettings(db, f.auth.organization.id, f.registrationId);
    if (!current) throw new Error("Recognition settings unavailable");
    return updateRegistrationRecognitionSettings(db, { organizationId: f.auth.organization.id, registrationId: f.registrationId,
      body, invocation: createUserInvocation(f.auth), requestId: crypto.randomUUID(),
      ifMatch: registrationRecognitionEtag(current), idempotencyKey: crypto.randomUUID(), catalogReleaseId: release.id });
  }

  it("copies an unambiguous legacy recognition rule to its registration during upgrade", async () => {
    const f = await fixture("recognition-upgrade", "driver-group", "curated");
    const result = await apiDb.query(`select registration_id, compatibles from public.registration_recognition_rules
      where organization_id = $1`, [f.auth.organization.id]);
    expect(result.rows).toEqual([{ registration_id: f.registrationId, compatibles: ["local,upgrade"] }]);
    expect((await readRegistry(apiDb, f.auth.organization.id, null)).modules.find(module => module.id === f.module.id)?.unmigratedRecognition)
      .toBeUndefined();
  });

  it("resolves legacy mapping evidence through the API role before and after organization migration", async () => {
    const f = await fixture("legacy-runtime-mapping", "driver-group", "curated");
    await seedLegacyModuleMapping(pool, { id: "api-legacy-mapping", organizationId: f.auth.organization.id,
      moduleId: f.module.id, matchKind: "compatible", matchValue: "legacy,runtime" });
    const input = { organizationId: f.auth.organization.id, driverModule: null, compatible: "legacy,runtime", nodeType: null };
    expect(await resolveModuleIdForBinding(apiDb, input)).toBe(f.parent.id);
    const applied = await migrateModuleStructure(ownerDb, f.auth.organization.id, true);
    expect(applied.changes).toContainEqual(expect.objectContaining({ action: "move-placement", moduleId: f.module.id }));
    expect(await resolveModuleIdForBinding(apiDb, input)).toBe(f.parent.id);
    expect(await runV05(queryOf(apiDb))).toMatchObject({ gateId: "PCAT-DB-V05" });
  });

  it.each(["recognition-mismatch", "recognition-unproven"])("keeps %s legacy rules unresolved during upgrade", async key => {
    const f = await fixture(key, "node-type", "curated");
    const rules = await apiDb.query(`select registration_id from public.registration_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    expect(rules.rows).toEqual([]);
    const mappings = await apiDb.query(`select registration_id from public.registration_recognition_migration_map where organization_id = $1`, [f.auth.organization.id]);
    expect(mappings.rows).toEqual([]);
    const legacy = await apiDb.query(`select module_id from public.module_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    expect(legacy.rows).toEqual([{ module_id: f.module.id }]);
    const displayed = (await readRegistry(apiDb, f.auth.organization.id, null)).modules.find(module => module.id === f.module.id);
    const savedSelector = key === "recognition-mismatch" ? "local,misattributed" : "local,unproven";
    expect(displayed?.unmigratedRecognition?.compatibles).toEqual([savedSelector]);
    expect(migrationNotices.some(notice => notice.includes(f.auth.organization.id) && notice.includes(f.module.id))).toBe(true);
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const snapshot = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(snapshot.resolveSubject({ driverCompatibles: [DriverCompatible(savedSelector)], nodeTypeFallback: { kind: "absent" } }).status).toBe("unknown");
    expect(snapshot.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("charger") } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_charger" } });
  });

  it("leaves a shared module rule unresolved during upgrade even when its saved subject is present", async () => {
    const f = await fixture("recognition-shared-upgrade", "driver-group", "curated");
    const rules = await apiDb.query(`select registration_id from public.registration_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    const mappings = await apiDb.query(`select registration_id from public.registration_recognition_migration_map where organization_id = $1`, [f.auth.organization.id]);
    const legacy = await apiDb.query(`select module_id from public.module_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    expect(rules.rows).toEqual([]);
    expect(mappings.rows).toEqual([]);
    expect(legacy.rows).toEqual([{ module_id: f.target.id }]);
    const displayed = (await readRegistry(apiDb, f.auth.organization.id, null)).modules.find(module => module.id === f.target.id);
    expect(displayed?.unmigratedRecognition?.compatibles).toEqual(["local,shared-upgrade"]);
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const snapshot = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(snapshot.resolveSubject({ driverCompatibles: [DriverCompatible("local,shared-upgrade")], nodeTypeFallback: { kind: "absent" } }).status)
      .toBe("unknown");
    expect(migrationNotices.some(notice => notice.includes(f.auth.organization.id) && notice.includes(f.target.id))).toBe(true);
  });

  it("reports and retains a legacy rule whose module has no placement", async () => {
    const f = await fixture("recognition-no-placement", "driver-group", "curated");
    const rules = await apiDb.query(`select registration_id from public.registration_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    const mappings = await apiDb.query(`select registration_id from public.registration_recognition_migration_map where organization_id = $1`, [f.auth.organization.id]);
    const legacy = await apiDb.query(`select module_id from public.module_recognition_rules where organization_id = $1`, [f.auth.organization.id]);
    expect(rules.rows).toEqual([]);
    expect(mappings.rows).toEqual([]);
    expect(legacy.rows).toEqual([{ module_id: unplacedRuleModuleId }]);
    expect(migrationNotices.some(notice => notice.includes(f.auth.organization.id) && notice.includes(unplacedRuleModuleId))).toBe(true);
  });

  it("retains a copied rule on its registration after it moves", async () => {
    const f = await fixture("recognition-upgrade", "driver-group", "curated");
    const service = registrationService();
    const moved = await service.execute({ kind: "move-placement", organizationId: f.auth.organization.id,
      registrationId: f.registrationId, expectedRelease: release, destinationModuleId: f.target.id,
      idempotencyKey: "upgrade-rule-move", context: { actorKind: "org-admin", principalId: f.auth.user.id } });
    expect(moved.ok).toBe(true);
    const rules = await loadOrganizationRecognitionRules(apiDb, f.auth.organization.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ module_id: f.target.id, canonical_subject_id: "csub_acme_power", compatibles: ["local,upgrade"] });
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const snapshot = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(snapshot.resolveSubject({ driverCompatibles: [DriverCompatible("local,upgrade")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
  });

  it("authorizes and audits recognition changes by registration", async () => {
    const f = await fixture("recognition-api", "driver-group", "curated");
    const foreign = await fixture("foreign-rule-boundaries", "driver-group", "curated");
    const server = createWiseEffServer({ db: apiDb });
    const viewerId = "recognition-viewer";
    await pool.query(`insert into public.users(id, organization_id, name, email, title, is_active)
      values ($1,$2,'Viewer','recognition-viewer@example.test','Viewer',true)`, [viewerId, f.auth.organization.id]);
    const path = `/api/v2/organizations/${f.auth.organization.id}/subject-registrations/${f.registrationId}/recognition`;
    const body = { compatibles: ["local,registration-api"], driverNature: "physical-device", instanceCardinality: "multiple" };
    const initial = await requestJson(server, path, { headers: { "X-WiseEff-User": f.auth.user.id } });
    expect(initial.status).toBe(200);
    const headers = { "X-WiseEff-User": f.auth.user.id, [CATALOG_RELEASE_HEADER]: release.id,
      [CATALOG_IDEMPOTENCY_HEADER]: "recognition-api-save", [CATALOG_IF_MATCH_HEADER]: initial.headers.get("etag")! };
    const saved = await requestJson(server, path, { method: "PATCH", headers, body: JSON.stringify(body) });
    expect(saved.status, saved.bodyText).toBe(200);
    const replay = await requestJson(server, path, { method: "PATCH", headers, body: JSON.stringify(body) });
    expect(replay.status).toBe(200);
    const stale = await requestJson(server, path, { method: "PATCH", headers: { ...headers, [CATALOG_IDEMPOTENCY_HEADER]: "recognition-api-stale" }, body: JSON.stringify(body) });
    expect(stale.status).toBe(409);
    const read = await requestJson<{ item: typeof body }>(server, path, { headers: { "X-WiseEff-User": f.auth.user.id } });
    expect(read.status).toBe(200);
    expect(read.body.item).toMatchObject(body);
    const denied = await requestJson(server, path, { method: "PATCH", headers: { ...headers, "X-WiseEff-User": viewerId }, body: JSON.stringify(body) });
    expect(denied.status).toBe(403);
    const foreignPath = `/api/v2/organizations/${foreign.auth.organization.id}/subject-registrations/${f.registrationId}/recognition`;
    const hidden = await requestJson(server, foreignPath, { method: "PATCH", headers: { ...headers, "X-WiseEff-User": foreign.auth.user.id }, body: JSON.stringify(body) });
    expect(hidden.status).toBe(404);
    expect((await pool.query(`select id from public.audit_events where organization_id=$1 and target_id=$2
      and kind='registration-recognition-update'`, [f.auth.organization.id, f.registrationId])).rows).toHaveLength(1);
  });

  it("rejects an old module recognition edit after a newer registration update", async () => {
    const f = await fixture("recognition-old-endpoint", "driver-group", "curated");
    const server = createWiseEffServer({ db: apiDb });
    const path = `/api/v2/organizations/${f.auth.organization.id}/subject-registrations/${f.registrationId}/recognition`;
    const initial = await requestJson(server, path, { headers: { "X-WiseEff-User": f.auth.user.id } });
    expect(initial.status).toBe(200);
    const updated = await requestJson(server, path, { method: "PATCH", headers: { "X-WiseEff-User": f.auth.user.id,
      [CATALOG_RELEASE_HEADER]: release.id, [CATALOG_IDEMPOTENCY_HEADER]: "newer-recognition-update",
      [CATALOG_IF_MATCH_HEADER]: initial.headers.get("etag")! }, body: JSON.stringify({ compatibles: ["local,newer"] }) });
    expect(updated.status, updated.bodyText).toBe(200);
    const stale = await requestJson(server, `/api/v1/parameter-modules/${f.module.id}`, { method: "PATCH",
      headers: { "X-WiseEff-User": f.auth.user.id }, body: JSON.stringify({ name: "Stale name", compatibles: ["local,stale"] }) });
    expect(stale.status).toBe(410);
    const after = await requestJson<{ item: { compatibles: string[] } }>(server, path, { headers: { "X-WiseEff-User": f.auth.user.id } });
    expect(after.body.item.compatibles).toEqual(["local,newer"]);
    expect((await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: f.module.id }))?.name).toBe(f.module.name);
  });

  it("holds the Catalog publication fence through the recognition transaction", async () => {
    const f = await fixture("recognition-release-lock", "node-type", "curated");
    const current = await readRegistrationRecognitionSettings(apiDb, f.auth.organization.id, f.registrationId);
    if (!current) throw new Error("Recognition settings unavailable");
    await apiDb.transaction(async tx => {
      await updateRegistrationRecognitionSettings(tx, { organizationId: f.auth.organization.id, registrationId: f.registrationId,
        body: { nodeTypeName: "fenced-charger" }, invocation: createUserInvocation(f.auth), requestId: "recognition-release-lock",
        ifMatch: registrationRecognitionEtag(current), idempotencyKey: "recognition-release-lock", catalogReleaseId: release.id });
      const blocked = await pool.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(688004000041::bigint) as acquired");
      expect(blocked.rows[0]?.acquired).toBe(false);
    });
    const after = await pool.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(688004000041::bigint) as acquired");
    expect(after.rows[0]?.acquired).toBe(true);
  });

  it("overlays a registration rule when another subject shares its business module", async () => {
    const f = await fixture("registration-rule-overlay", "driver-group", "curated");
    const service = registrationService();
    const moved = await service.execute({ kind: "move-placement", organizationId: f.auth.organization.id,
      registrationId: f.registrationId, expectedRelease: release, destinationModuleId: f.target.id,
      idempotencyKey: "registration-rule-shared-move", context: { actorKind: "org-admin", principalId: f.auth.user.id } });
    expect(moved.ok).toBe(true);
    const registered = await service.execute({ kind: "register", organizationId: f.auth.organization.id,
      subjectId: CatalogSubjectId("csub_acme_charger"), subjectKind: "node-type", expectedRelease: release,
      placement: { mode: "use-default" }, destinationModuleId: f.target.id, method: "explicit", proof: {},
      idempotencyKey: "registration-rule-shared", context: { actorKind: "org-admin", principalId: f.auth.user.id } });
    expect(registered.ok).toBe(true);
    await pool.query(`insert into public.registration_recognition_rules
      (organization_id, registration_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,array['local,shared-rule'],'physical-device','multiple')`, [f.auth.organization.id, f.registrationId]);
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const snapshot = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(snapshot.resolveSubject({ driverCompatibles: [DriverCompatible("local,shared-rule")],
      nodeTypeFallback: { kind: "absent" } }).status).toBe("matched");
  });

  it("does not assign an unresolved legacy rule to the subject remaining after a shared placement changes", async () => {
    const f = await fixture("ambiguous-rule", "driver-group", "curated");
    const service = registrationService();
    const move = (destinationModuleId: string, idempotencyKey: string) => service.execute({ kind: "move-placement",
      organizationId: f.auth.organization.id, registrationId: f.registrationId, expectedRelease: release,
      destinationModuleId, idempotencyKey, context: { actorKind: "org-admin", principalId: f.auth.user.id } });
    expect((await move(f.target.id, "ambiguous-rule-share")).ok).toBe(true);
    const second = await service.execute({ kind: "register", organizationId: f.auth.organization.id,
      subjectId: CatalogSubjectId("csub_acme_sensor"), subjectKind: "driver", expectedRelease: release,
      placement: { mode: "use-default" }, destinationModuleId: f.target.id, method: "explicit", proof: {},
      idempotencyKey: "ambiguous-rule-second", context: { actorKind: "org-admin", principalId: f.auth.user.id } });
    expect(second.ok).toBe(true);
    await pool.query(`insert into public.module_recognition_rules
      (organization_id, module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality)
      values ($1,$2,'csub_acme_power',array['local,ambiguous-rule'],'physical-device','multiple')`,
    [f.auth.organization.id, f.target.id]);
    expect((await move(f.parent.id, "ambiguous-rule-move-away")).ok).toBe(true);
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const effective = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    const selector = (value: string) => ({ driverCompatibles: [DriverCompatible(value)], nodeTypeFallback: { kind: "absent" as const } });
    expect(effective.resolveSubject(selector("local,ambiguous-rule")).status).toBe("unknown");
    expect(effective.resolveSubject(selector("acme,sensor"))).toMatchObject({ status: "matched", subject: { id: "csub_acme_sensor" } });
    expect(effective.resolveSubject(selector("acme,power"))).toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
  });

  it.each([
    ["auto-driver", "driver-group", "auto"], ["manual-driver", "driver-group", "curated"],
    ["auto-node", "node-type", "auto"], ["manual-node", "node-type", "curated"],
  ] as const)("keeps %s legacy metadata and placement read-only", async (key, kind, origin) => {
    const f = await fixture(key, kind, origin);
    const organizationId = f.auth.organization.id;
    expect((await readRegistry(apiDb, organizationId, null)).modules.find(m => m.id === f.module.id)?.effectiveImportance).toBe("high");
    await expect(updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { description: "Description only" }))
      .rejects.toMatchObject({ code: "GONE" });
    const server = createWiseEffServer({ db: apiDb });
    const savedResponse = await requestJson<{ item: typeof f.module }>(server, `/api/v1/parameter-modules/${f.module.id}`, {
      method: "PATCH", headers: { "X-WiseEff-User": f.auth.user.id },
      body: JSON.stringify({ name: "Edited", description: "Details", scope: "Scope", sortOrder: 7, importance: "low", kind }),
    });
    expect(savedResponse.status, savedResponse.bodyText).toBe(410);
    const movedResponse = await requestJson<{ item: typeof f.module }>(server, `/api/v1/parameter-modules/${f.module.id}/move`, {
      method: "POST", headers: { "X-WiseEff-User": f.auth.user.id }, body: JSON.stringify({ parentId: f.target.id }),
    });
    expect(movedResponse.status, movedResponse.bodyText).toBe(410);
    const reloaded = (await readRegistry(apiDb, organizationId, null)).modules.find(m => m.id === f.module.id);
    expect(reloaded).toMatchObject({ name: "Original", kind, origin, parentId: f.parent.id, effectiveImportance: "high" });
    const registration = await getRegistration(getRootPostgresPool(apiDb)!, f.placementQuery);
    expect(registration).toMatchObject({ ok: true, value: { id: f.registrationId, placement: { moduleId: f.module.id, displayName: "Original" } } });
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, f.placementQuery);
    if (!placement.ok) throw new Error(JSON.stringify(placement.error));
    expect(placement.value.version).toBe(f.placement.version);
    expect((await apiDb.query(`select kind from public.audit_events where target_id = $1 and kind like 'parameter-module-admin-%'`, [f.module.id])).rows)
      .toHaveLength(0);
  });

  it("preserves tenant, role, kind, cycle and transactional rollback boundaries", async () => {
    const f = await fixture("boundaries", "driver-group", "auto");
    const viewer: AuthContext = { ...f.auth, permissions: ["parameter:view"] };
    await expect(updateParameterModuleForAuth(apiDb, viewer, f.module.id, { name: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(moveParameterModuleForAuth(apiDb, viewer, f.module.id, { parentId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await fixture("foreign", "node-type", "curated");
    await expect(updateParameterModuleForAuth(apiDb, foreign.auth, f.module.id, { name: "Denied" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.parent.id, { parentId: foreign.parent.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // @ts-expect-error exercise a legacy kind at the runtime service boundary
    await expect(updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { kind: "node-type" })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.parent.id, { parentId: f.module.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const node = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Node", kind: "node-type" });
    const system = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unclassified", kind: "unclassified" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: node.id })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, system.id, { parentId: f.parent.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, node.id, { parentId: system.id })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, node.id, { parentId: f.module.id })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: node.id })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.parent.id, { parentId: f.target.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const business = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Rollback business" });
    await expect(apiDb.transaction(async tx => {
      await updateParameterModuleForAuth(tx, f.auth, business.id, { name: "Rolled back", importance: "low" });
      await moveParameterModuleForAuth(tx, f.auth, business.id, { parentId: f.target.id });
      throw new Error("injected-after-module-edits");
    })).rejects.toThrow("injected-after-module-edits");
    expect(await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: business.id })).toMatchObject(business);
    expect(await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: f.module.id })).toMatchObject(f.module);
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, f.placementQuery);
    expect(placement).toEqual({ ok: true, value: f.placement });
    expect((await apiDb.query(`select id from public.audit_events where target_id = $1 and kind like 'parameter-module-admin-%'`, [f.module.id])).rows).toHaveLength(0);
  });

  it("does not restore a stale name when a metadata-only update overlaps a rename", async () => {
    const f = await fixture("overlapping-edits", "node-type", "auto");
    const module = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Original business" });
    let renamed = false;
    const interleaved: Queryable = {
      async query<Row>(sql: string, values?: unknown[]) {
        const result = await apiDb.query<Row>(sql, values);
        if (!renamed && sql.includes("from parameter_modules") && sql.includes("id = $2")) {
          renamed = true;
          await updateParameterModuleForAuth(apiDb, f.auth, module.id, { name: "Concurrent rename" });
        }
        return result;
      },
    };
    await expect(updateParameterModule(interleaved, {
      organizationId: f.auth.organization.id, moduleId: module.id, description: "Concurrent details",
    })).resolves.toMatchObject({ name: "Concurrent rename", description: "Concurrent details" });
    const audits = await apiDb.query<{ metadata: { previousName: string } }>(
      `select metadata from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-update'`, [module.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.metadata.previousName).toBe("Original business");
  });

  it("serializes reciprocal business module moves before reading the tree and rejects the second cycle", async () => {
    const f = await fixture("reciprocal-moves", "node-type", "auto");
    const module = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "First", parentId: f.parent.id,
    });
    const sibling = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Sibling", parentId: f.parent.id,
    });
    let firstMoved!: () => void;
    let releaseFirst!: () => void;
    const moved = new Promise<void>(resolve => { firstMoved = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = apiDb.transaction(async tx => {
      await moveParameterModuleForAuth(tx, f.auth, module.id, { parentId: sibling.id });
      firstMoved();
      await release;
    });
    await moved;
    const second = moveParameterModuleForAuth(apiDb, f.auth, sibling.id, { parentId: module.id })
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    try {
      await expect.poll(async () => (await apiDb.query<{ waiting: boolean }>(
        `select exists (select 1 from pg_catalog.pg_locks
          where locktype = 'advisory' and not granted
            and database = (select oid from pg_database where datname = current_database())) as waiting`,
      )).rows[0]!.waiting).toBe(true);
    } finally {
      releaseFirst();
      await first;
    }
    expect(await second).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const registry = await readRegistry(apiDb, f.auth.organization.id, null);
    expect(registry.modules.find(m => m.id === module.id)?.parentId).toBe(sibling.id);
    expect(registry.modules.find(m => m.id === sibling.id)?.parentId).toBe(f.parent.id);
  });

  it("audits the committed previous parent after a competing move", async () => {
    const f = await fixture("overlapping-move-audit", "node-type", "auto");
    const module = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "First", parentId: f.parent.id,
    });
    const sibling = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Sibling", parentId: f.parent.id,
    });
    let firstMoved!: () => void;
    let releaseFirst!: () => void;
    const moved = new Promise<void>(resolve => { firstMoved = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = apiDb.transaction(async tx => {
      await moveParameterModuleForAuth(tx, f.auth, module.id, { parentId: sibling.id });
      firstMoved();
      await release;
    });
    await moved;
    const second = moveParameterModuleForAuth(apiDb, f.auth, module.id, { parentId: f.target.id });
    try {
      await expect.poll(async () => (await apiDb.query<{ waiting: boolean }>(
        `select exists (select 1 from pg_catalog.pg_locks where locktype = 'advisory' and not granted
          and database = (select oid from pg_database where datname = current_database())) as waiting`,
      )).rows[0]!.waiting).toBe(true);
    } finally {
      releaseFirst();
      await first;
    }
    await second;
    const audits = await apiDb.query<{ metadata: { previousParentId: string } }>(
      `select metadata from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-move'`, [module.id],
    );
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.map(row => row.metadata.previousParentId)).toEqual(expect.arrayContaining([f.parent.id, sibling.id]));
  });

  it("saves complete current driver rules in one HTTP edit while preserving foreign organizations and published history", async () => {
    const f = await fixture("driver-recognition", "driver-group", "auto");
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    const before = (await loadModuleRecognitionSettings(apiDb, f.auth.organization.id, catalog)).get(f.module.id)!;
    expect(before).toMatchObject({ recognitionSubjectId: "csub_acme_power", compatibles: expect.arrayContaining(["acme,power"]),
      driverNature: "physical-device", instanceCardinality: "multiple" });
    const legacy = (await apiDb.query(`select to_jsonb(driver) as row from public.driver_registrations driver
      where attribution_subject_id = $1`, [f.module.attributionSubjectId])).rows;
    await expect(updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { name: "Locally maintained" })).rejects.toMatchObject({ code: "GONE" });
    await updateRecognition(apiDb, f, { compatibles: ["local,first", "local,second"], driverNature: "logical-service", instanceCardinality: "singleton-per-project" });
    const saved = (await readRegistry(apiDb, f.auth.organization.id, catalog)).modules.find(module => module.id === f.module.id)!;
    expect(saved).toMatchObject({ name: "Original", origin: "auto", recognitionSubjectId: "csub_acme_power",
      compatibles: ["local,first", "local,second"], driverNature: "logical-service", instanceCardinality: "singleton-per-project" });
    const selector = (compatible: string) => ({ driverCompatibles: [DriverCompatible(compatible)], nodeTypeFallback: { kind: "absent" as const } });
    const local = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(local.resolveSubject(selector("local,first"))).toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
    expect(local.resolveSubject(selector("local,second"))).toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
    expect(local.resolveSubject(selector("acme,power")).status).toBe("unknown");
    expect(local.resolveSubject(selector("acme,power-v1")).status).toBe("unknown");
    const foreign = await loadOrganizationCatalogSnapshot(apiDb, "org-other-no-local-rules", catalog);
    expect(foreign.resolveSubject(selector("acme,power")).status).toBe("matched");
    expect(foreign.resolveSubject(selector("local,first")).status).toBe("unknown");
    expect(catalog.resolveSubject(selector("acme,power")).status).toBe("matched");
    const pinned = await createCatalogKernel(pool).loadPinnedCatalog(release);
    if (!pinned.ok) throw new Error(JSON.stringify(pinned.error));
    expect(pinned.value.resolveSubject(selector("acme,power")).status).toBe("matched");
    expect(pinned.value.resolveSubject(selector("local,first")).status).toBe("unknown");
    expect((await apiDb.query(`select to_jsonb(driver) as row from public.driver_registrations driver
      where attribution_subject_id = $1`, [f.module.attributionSubjectId])).rows).toEqual(legacy);
    await updateRecognition(apiDb, f, { compatibles: ["local,replaced"] });
    const refreshed = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, local);
    expect(refreshed.resolveSubject(selector("local,first")).status).toBe("unknown");
    expect(refreshed.resolveSubject(selector("local,replaced")).status).toBe("matched");
  });

  it("requires a registration for new rules, validates fields and rolls back rules with metadata and audit", async () => {
    const f = await fixture("local-rule-boundaries", "node-type", "auto");
    const localDriver = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unknown driver", kind: "driver-group" });
    const localNode = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unknown node", kind: "node-type" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localDriver.id, {
      compatibles: ["private,local"], driverNature: "logical-service", instanceCardinality: "multiple",
    })).rejects.toMatchObject({ code: "GONE" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localNode.id, { nodeTypeName: "private-controller" }))
      .rejects.toMatchObject({ code: "GONE" });
    const loaded = (await loadModuleRecognitionSettings(apiDb, f.auth.organization.id)).get(localDriver.id);
    expect(loaded).toMatchObject({ recognitionSubjectId: null, compatibles: [], overridden: false });
    await expect(updateRecognition(apiDb, f, { nodeTypeName: "controller@0" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateRecognition(apiDb, f, { driverNature: "logical-service" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const viewer: AuthContext = { ...f.auth, permissions: ["parameter:view"] };
    await expect(updateParameterModuleForAuth(apiDb, viewer, localDriver.id, { compatibles: ["denied,value"] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await fixture("foreign-rule-boundaries", "driver-group", "curated");
    await expect(updateParameterModuleForAuth(apiDb, foreign.auth, localDriver.id, { compatibles: ["denied,value"] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(apiDb.transaction(async tx => {
      await updateParameterModuleForAuth(tx, f.auth, f.parent.id, { name: "Should roll back" });
      await updateRecognition(tx, f, { nodeTypeName: "local-charger" });
      throw new Error("injected-after-recognition-edit");
    })).rejects.toThrow("injected-after-recognition-edit");
    expect(await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: f.module.id })).toMatchObject(f.module);
    expect((await apiDb.query(`select registration_id from public.registration_recognition_rules where organization_id=$1 and registration_id=$2`,
      [f.auth.organization.id, f.registrationId])).rows).toHaveLength(0);
    expect((await apiDb.query(`select id from public.audit_events where target_id=$1 and kind='registration-recognition-update'`, [f.registrationId])).rows).toHaveLength(0);
    expect((await apiDb.query(`select id from public.audit_events where target_id=$1 and kind='parameter-module-admin-update'`, [f.module.id])).rows).toHaveLength(0);
  });

  it("rejects switching existing multiple canonical instances to singleton and retains the prior rule", async () => {
    const f = await fixture("existing-capacity", "driver-group", "curated");
    const projectId = "project-existing-capacity";
    await pool.query(`insert into public.projects(id, organization_id, name, code) values ($1,$2,'Existing capacity','EC')`,
      [projectId, f.auth.organization.id]);
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(release);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    for (const logicalNodeId of ["node-capacity-first", "node-capacity-second"]) {
      const binding = await createSourceBackedBindingService(pool).stabilize({
        snapshot: loaded.value, organizationId: f.auth.organization.id, projectId, logicalNodeId,
        registrationId: f.registrationId, definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
        effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"), expectedEffectiveRevisionId: null,
      });
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    }
    const groups = await aggregateBindingDashboardHotspots(apiDb, { organizationId: f.auth.organization.id,
      projectId, dimension: "module", windowStart: "2000-01-01T00:00:00.000Z", windowEnd: "2100-01-01T00:00:00.000Z" });
    expect(groups).toEqual([expect.objectContaining({ groupId: f.module.id, parameterCount: 2, definitionCount: 1 })]);
    await expect(updateRecognition(apiDb, f, { instanceCardinality: "singleton-per-project" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await loadModuleRecognitionSettings(apiDb, f.auth.organization.id)).get(f.module.id)?.instanceCardinality).toBe("multiple");
    expect((await apiDb.query(`select id from public.audit_events where target_id=$1 and kind='parameter-module-admin-update'`, [f.module.id])).rows).toHaveLength(0);
  });

  it("retains registration recognition rules when a Subject moves to a business category", async () => {
    const f = await fixture("recognition-placement-move", "driver-group", "curated");
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    await updateRecognition(apiDb, f, { compatibles: ["local,old-module"] });
    const legacyDestination = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Destination driver", kind: "driver-group", parentId: f.target.id,
    });
    const rejected = await registrationService().execute({
      kind: "move-placement", organizationId: f.auth.organization.id, registrationId: f.registrationId,
      expectedRelease: release, destinationModuleId: legacyDestination.id, idempotencyKey: "reject-typed-recognition-placement",
      context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(rejected).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    const moved = await registrationService().execute({
      kind: "move-placement", organizationId: f.auth.organization.id, registrationId: f.registrationId,
      expectedRelease: release, destinationModuleId: f.target.id, idempotencyKey: "move-subject-recognition-placement",
      context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(moved).toMatchObject({ ok: true });
    const settings = await loadModuleRecognitionSettings(apiDb, f.auth.organization.id, catalog);
    expect(settings.get(f.module.id)).toMatchObject({ recognitionSubjectId: null, compatibles: [] });
    expect(settings.get(legacyDestination.id)).toMatchObject({ recognitionSubjectId: null });
    const selector = (value: string) => ({ driverCompatibles: [DriverCompatible(value)], nodeTypeFallback: { kind: "absent" as const } });
    const afterMove = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(afterMove.resolveSubject(selector("local,old-module")).status).toBe("matched");
    expect(afterMove.resolveSubject(selector("acme,power")).status).toBe("unknown");
    await expect(updateParameterModuleForAuth(apiDb, f.auth, legacyDestination.id, { compatibles: ["local,new-module"] }))
      .rejects.toMatchObject({ code: "GONE" });
    const afterSave = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, afterMove);
    expect(afterSave.resolveSubject(selector("local,new-module")).status).toBe("unknown");
    expect(afterSave.resolveSubject(selector("local,old-module")).status).toBe("matched");
  });

  it("keeps an unregistered legacy rule separate from later business placement and edits a legacy node selector", async () => {
    const f = await fixture("recognition-late-registration", "node-type", "auto");
    const localDriver = await createParameterModule(pool, { organizationId: f.auth.organization.id,
      name: "Previously unregistered", kind: "driver-group" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localDriver.id, { compatibles: ["local,later-registration"], instanceCardinality: "singleton-per-project" }))
      .rejects.toMatchObject({ code: "GONE" });
    const registered = await registrationService().execute({
      kind: "register", organizationId: f.auth.organization.id, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver",
      expectedRelease: release, placement: { mode: "use-default" }, destinationModuleId: f.parent.id, method: "explicit",
      proof: { reason: "Register after local rule" }, idempotencyKey: "late-register-local-rule",
      context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(registered).toMatchObject({ ok: true });
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const effective = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(effective.resolveSubject({ driverCompatibles: [DriverCompatible("local,later-registration")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "unknown" });
    expect(effective.resolveSubject({ driverCompatibles: [DriverCompatible("acme,power")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
    await updateRecognition(apiDb, f, { nodeTypeName: "local-charger" });
    const nodeEffective = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, effective);
    expect(nodeEffective.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("local-charger") } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_charger" } });
    expect(nodeEffective.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("charger") } }).status)
      .toBe("unknown");
  });

  it("rejects a stale release after publication wins the pointer lock race", async () => {
    const f = await fixture("recognition-release-race", "node-type", "curated");
    const current = await readRegistrationRecognitionSettings(apiDb, f.auth.organization.id, f.registrationId);
    if (!current) throw new Error("Recognition settings unavailable");
    const gate = await pool.connect();
    await gate.query("begin");
    await gate.query("select pg_advisory_xact_lock(688004000041::bigint)");
    const gatePid = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const bundle = retiredPowerAliasSuccessorBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const publication = installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: release, expectedTargetDigest: compiled.value.aggregateDigest });
    let pending: ReturnType<typeof updateRegistrationRecognitionSettings> | undefined;
    try {
      await vi.waitFor(async () => {
        expect((await pool.query("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [gatePid])).rows.length).toBeGreaterThan(0);
      }, { timeout: 1500, interval: 10 });
      pending = updateRegistrationRecognitionSettings(apiDb, { organizationId: f.auth.organization.id, registrationId: f.registrationId,
        body: { nodeTypeName: "stale-charger" }, invocation: createUserInvocation(f.auth), requestId: "recognition-release-race",
        ifMatch: registrationRecognitionEtag(current), idempotencyKey: "recognition-release-race", catalogReleaseId: release.id });
      const outcome = pending.then(value => ({ value, error: null }), error => ({ value: null, error }));
      await vi.waitFor(async () => {
        expect((await pool.query("select pid from pg_stat_activity where usename=$1 and wait_event='advisory'", [runtime.apiRole])).rows.length).toBeGreaterThan(0);
      }, { timeout: 1500, interval: 10 });
      await gate.query("commit");
      expect((await publication).ok).toBe(true);
      expect((await outcome).error).toMatchObject({ code: "CONFLICT" });
    } finally {
      await gate.query("rollback");
      gate.release();
      await publication.catch(() => undefined);
      await pending?.catch(() => undefined);
    }
    const after = await readRegistrationRecognitionSettings(apiDb, f.auth.organization.id, f.registrationId);
    expect(after && registrationRecognitionEtag(after)).toBe(registrationRecognitionEtag(current));
    expect((await apiDb.query(`select registration_id from public.registration_recognition_rules where organization_id=$1`,
      [f.auth.organization.id])).rows).toEqual([]);
  });
});
