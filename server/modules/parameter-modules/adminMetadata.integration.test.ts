import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool, type Database, type Queryable, type RootDatabase } from "../../shared/database/client";
import { createManagedInstanceTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins, type ProvisionedRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle } from "../catalog-kernel/runtime/catalogChain.fixture";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogSubjectId, SubjectRegistrationId, type CatalogReleasePin } from "../parameter-catalog-contract";
import { createRegistrationService } from "../parameter-governance/registration";
import { getPlacement, getRegistration } from "../parameter-governance/queries/registration";
import { createParameterModule, getParameterModuleById, updateParameterModule } from "../parameters/parameterModuleRepository";
import { updateParameterModuleForAuth, moveParameterModuleForAuth } from "../parameters/service";
import type { AuthContext } from "../auth/types";
import { readRegistry } from "./repository";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { captureModuleRecognitionCatalog, loadModuleRecognitionSettings, loadOrganizationCatalogSnapshot } from "./recognitionSettings";
import { DriverCompatible, NormalizedNodeTypeName, createCatalogKernel } from "../catalog-kernel/interface";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract";

describe("administrator module metadata through the API database role", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let apiDb: RootDatabase;
  let runtime: ProvisionedRuntimeLogins;
  let release: CatalogReleasePin;

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("moduleadminmetadata");
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
    await database?.drop();
  });

  async function fixture(key: string, kind: "driver-group" | "node-type", origin: "auto" | "curated") {
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
    const registration = await createRegistrationService(getRootPostgresPool(apiDb)!).execute({
      kind: "register", organizationId,
      subjectId: CatalogSubjectId(kind === "driver-group" ? "csub_acme_power" : "csub_acme_charger"),
      subjectKind: kind === "driver-group" ? "driver" : "node-type", expectedRelease: release,
      placement: { mode: "use-default" }, destinationModuleId: module.id, method: "explicit",
      proof: { reason: "Administrator metadata regression" }, idempotencyKey: `register-${key}`,
      context: { actorKind: "org-admin", principalId: userId },
    });
    if (!registration.ok) throw new Error(JSON.stringify(registration.error));
    const registrationId = SubjectRegistrationId(registration.value.registrationId);
    const placementQuery = { organizationId, registrationId, observedCatalogReleaseId: release.id,
      authScope: { organizationId, principalId: userId } };
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, placementQuery);
    if (!placement.ok) throw new Error(JSON.stringify(placement.error));
    return { auth, parent, target, module, registrationId, placementQuery, placement: placement.value };
  }

  it.each([
    ["auto-driver", "driver-group", "auto"], ["manual-driver", "driver-group", "curated"],
    ["auto-node", "node-type", "auto"], ["manual-node", "node-type", "curated"],
  ] as const)("saves and reloads %s details, importance and parent without changing subject identity", async (key, kind, origin) => {
    const f = await fixture(key, kind, origin);
    const organizationId = f.auth.organization.id;
    expect((await readRegistry(apiDb, organizationId, null)).modules.find(m => m.id === f.module.id)?.effectiveImportance).toBe("high");
    await updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { description: "Description only" });
    expect((await readRegistry(apiDb, organizationId, null)).modules.find(m => m.id === f.module.id))
      .toMatchObject({ origin: "curated", effectiveImportance: "high" });
    const server = createWiseEffServer({ db: apiDb });
    const savedResponse = await requestJson<{ item: typeof f.module }>(server, `/api/v1/parameter-modules/${f.module.id}`, {
      method: "PATCH", headers: { "X-WiseEff-User": f.auth.user.id },
      body: JSON.stringify({ name: "Edited", description: "Details", scope: "Scope", sortOrder: 7, importance: "low", kind }),
    });
    expect(savedResponse.status, savedResponse.bodyText).toBe(200);
    const saved = savedResponse.body.item;
    expect(saved).toMatchObject({ name: "Edited", description: "Details", scope: "Scope", sortOrder: 7, importance: "low", origin: "curated", kind });
    const movedResponse = await requestJson<{ item: typeof f.module }>(server, `/api/v1/parameter-modules/${f.module.id}/move`, {
      method: "POST", headers: { "X-WiseEff-User": f.auth.user.id }, body: JSON.stringify({ parentId: f.target.id }),
    });
    expect(movedResponse.status, movedResponse.bodyText).toBe(200);
    const moved = movedResponse.body.item;
    expect(moved).toMatchObject({ parentId: f.target.id, path: `${f.target.id}/${f.module.id}`, depth: 2 });
    const reloaded = (await readRegistry(apiDb, organizationId, null)).modules.find(m => m.id === f.module.id);
    expect(reloaded).toMatchObject({ name: "Edited", description: "Details", scope: "Scope", sortOrder: 7,
      importance: "low", kind, origin: "curated", parentId: f.target.id, effectiveImportance: "low" });
    const registration = await getRegistration(getRootPostgresPool(apiDb)!, f.placementQuery);
    expect(registration).toMatchObject({ ok: true, value: { id: f.registrationId, placement: { moduleId: f.module.id, displayName: "Edited" } } });
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, f.placementQuery);
    if (!placement.ok) throw new Error(JSON.stringify(placement.error));
    expect(placement.value.version).not.toBe(f.placement.version);
    const stale = await createRegistrationService(getRootPostgresPool(apiDb)!).execute({
      kind: "move-placement", organizationId, registrationId: f.registrationId, expectedRelease: release,
      destinationModuleId: f.module.id, expectedPlacementVersion: f.placement.version,
      idempotencyKey: `stale-${key}`, context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(stale).toMatchObject({ ok: false, error: { kind: "placement-conflict" } });
    expect((await apiDb.query(`select kind from public.audit_events where target_id = $1 and kind like 'parameter-module-admin-%'`, [f.module.id])).rows)
      .toHaveLength(3);
  });

  it("preserves tenant, role, kind, cycle and transactional rollback boundaries", async () => {
    const f = await fixture("boundaries", "driver-group", "auto");
    const viewer: AuthContext = { ...f.auth, permissions: ["parameter:view"] };
    await expect(updateParameterModuleForAuth(apiDb, viewer, f.module.id, { name: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(moveParameterModuleForAuth(apiDb, viewer, f.module.id, { parentId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await fixture("foreign", "node-type", "curated");
    await expect(updateParameterModuleForAuth(apiDb, foreign.auth, f.module.id, { name: "Denied" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: foreign.parent.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { kind: "node-type" })).rejects.toMatchObject({ code: "GONE" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.parent.id, { parentId: f.module.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const node = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Node", kind: "node-type" });
    const system = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unclassified", kind: "unclassified" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: node.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, system.id, { parentId: f.parent.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, node.id, { parentId: system.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, node.id, { parentId: f.module.id })).resolves.toMatchObject({ parentId: f.module.id });
    await expect(moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: node.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(apiDb.transaction(async tx => {
      await updateParameterModuleForAuth(tx, f.auth, f.module.id, { name: "Rolled back", importance: "low" });
      await moveParameterModuleForAuth(tx, f.auth, f.module.id, { parentId: f.target.id });
      throw new Error("injected-after-module-edits");
    })).rejects.toThrow("injected-after-module-edits");
    expect(await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: f.module.id })).toMatchObject(f.module);
    const placement = await getPlacement(getRootPostgresPool(apiDb)!, f.placementQuery);
    expect(placement).toEqual({ ok: true, value: f.placement });
    expect((await apiDb.query(`select id from public.audit_events where target_id = $1 and kind like 'parameter-module-admin-%'`, [f.module.id])).rows).toHaveLength(0);
  });

  it("does not restore a stale name when a metadata-only update overlaps a rename", async () => {
    const f = await fixture("overlapping-edits", "node-type", "auto");
    let renamed = false;
    const interleaved: Queryable = {
      async query<Row>(sql: string, values?: unknown[]) {
        const result = await apiDb.query<Row>(sql, values);
        if (!renamed && sql.includes("from parameter_modules") && sql.includes("id = $2")) {
          renamed = true;
          await updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { name: "Concurrent rename" });
        }
        return result;
      },
    };
    await expect(updateParameterModule(interleaved, {
      organizationId: f.auth.organization.id, moduleId: f.module.id, description: "Concurrent details",
    })).resolves.toMatchObject({ name: "Concurrent rename", description: "Concurrent details" });
    const audits = await apiDb.query<{ metadata: { previousName: string } }>(
      `select metadata from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-update'`, [f.module.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.metadata.previousName).toBe("Original");
  });

  it("serializes reciprocal node moves before reading the tree and rejects the second cycle", async () => {
    const f = await fixture("reciprocal-moves", "node-type", "auto");
    const sibling = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Sibling", kind: "node-type", parentId: f.parent.id,
    });
    let firstMoved!: () => void;
    let releaseFirst!: () => void;
    const moved = new Promise<void>(resolve => { firstMoved = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = apiDb.transaction(async tx => {
      await moveParameterModuleForAuth(tx, f.auth, f.module.id, { parentId: sibling.id });
      firstMoved();
      await release;
    });
    await moved;
    const second = moveParameterModuleForAuth(apiDb, f.auth, sibling.id, { parentId: f.module.id })
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
    expect(registry.modules.find(m => m.id === f.module.id)?.parentId).toBe(sibling.id);
    expect(registry.modules.find(m => m.id === sibling.id)?.parentId).toBe(f.parent.id);
  });

  it("audits the actual previous parent after another move invalidates its preflight read", async () => {
    const f = await fixture("overlapping-move-audit", "node-type", "auto");
    const sibling = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Sibling", kind: "node-type", parentId: f.parent.id,
    });
    let moved = false;
    const interleaved: Database = {
      transaction: fn => apiDb.transaction(fn),
      async query<Row>(sql: string, values?: unknown[]) {
        const result = await apiDb.query<Row>(sql, values);
        if (!moved && sql.includes("from parameter_modules") && sql.includes("id = $2")) {
          moved = true;
          await moveParameterModuleForAuth(apiDb, f.auth, f.module.id, { parentId: sibling.id });
        }
        return result;
      },
    };
    await moveParameterModuleForAuth(interleaved, f.auth, f.module.id, { parentId: f.target.id });
    const audits = await apiDb.query<{ metadata: { previousParentId: string } }>(
      `select metadata from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-move'`, [f.module.id],
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
    const response = await requestJson(createWiseEffServer({ db: apiDb }), `/api/v1/parameter-modules/${f.module.id}`, {
      method: "PATCH", headers: { "X-WiseEff-User": f.auth.user.id }, body: JSON.stringify({
        name: "Locally maintained", compatibles: ["local,first", "local,second"], driverNature: "logical-service", instanceCardinality: "singleton-per-project",
      }),
    });
    expect(response.status, response.bodyText).toBe(200);
    const saved = (await readRegistry(apiDb, f.auth.organization.id, catalog)).modules.find(module => module.id === f.module.id)!;
    expect(saved).toMatchObject({ name: "Locally maintained", origin: "curated", recognitionSubjectId: "csub_acme_power",
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
    await updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { compatibles: ["local,replaced"] });
    const refreshed = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, local);
    expect(refreshed.resolveSubject(selector("local,first")).status).toBe("unknown");
    expect(refreshed.resolveSubject(selector("local,replaced")).status).toBe("matched");
  });

  it("supports local unregistered drivers and node types, validates fields and rolls back rules with metadata and audit", async () => {
    const f = await fixture("local-rule-boundaries", "node-type", "auto");
    const localDriver = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unknown driver", kind: "driver-group" });
    const localNode = await createParameterModule(pool, { organizationId: f.auth.organization.id, name: "Unknown node", kind: "node-type" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localDriver.id, {
      compatibles: ["private,local"], driverNature: "logical-service", instanceCardinality: "multiple",
    })).resolves.toMatchObject({ recognitionSubjectId: null, compatibles: ["private,local"], driverNature: "logical-service" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localNode.id, { nodeTypeName: "private-controller" }))
      .resolves.toMatchObject({ recognitionSubjectId: null, nodeTypeName: "private-controller" });
    const loaded = (await loadModuleRecognitionSettings(apiDb, f.auth.organization.id)).get(localDriver.id);
    expect(loaded).toMatchObject({ recognitionSubjectId: null, compatibles: ["private,local"] });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localDriver.id, { compatibles: ["private,*"] }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localNode.id, { driverNature: "logical-service" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateParameterModuleForAuth(apiDb, f.auth, localNode.id, { nodeTypeName: "controller@0" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const viewer: AuthContext = { ...f.auth, permissions: ["parameter:view"] };
    await expect(updateParameterModuleForAuth(apiDb, viewer, localDriver.id, { compatibles: ["denied,value"] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await fixture("foreign-rule-boundaries", "driver-group", "curated");
    await expect(updateParameterModuleForAuth(apiDb, foreign.auth, localDriver.id, { compatibles: ["denied,value"] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(apiDb.transaction(async tx => {
      await updateParameterModuleForAuth(tx, f.auth, f.module.id, { name: "Should roll back", nodeTypeName: "local-charger" });
      throw new Error("injected-after-recognition-edit");
    })).rejects.toThrow("injected-after-recognition-edit");
    expect(await getParameterModuleById(apiDb, { organizationId: f.auth.organization.id, moduleId: f.module.id })).toMatchObject(f.module);
    expect((await apiDb.query(`select module_id from public.module_recognition_rules where organization_id=$1 and module_id=$2`,
      [f.auth.organization.id, f.module.id])).rows).toHaveLength(0);
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
    await expect(updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { instanceCardinality: "singleton-per-project" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await loadModuleRecognitionSettings(apiDb, f.auth.organization.id)).get(f.module.id)?.instanceCardinality).toBe("multiple");
    expect((await apiDb.query(`select id from public.audit_events where target_id=$1 and kind='parameter-module-admin-update'`, [f.module.id])).rows).toHaveLength(0);
  });

  it("keeps recognition rules with modules when a canonical Subject moves to another placement", async () => {
    const f = await fixture("recognition-placement-move", "driver-group", "curated");
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    await updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { compatibles: ["local,old-module"] });
    const destination = await createParameterModule(pool, {
      organizationId: f.auth.organization.id, name: "Destination driver", kind: "driver-group", parentId: f.target.id,
    });
    const moved = await createRegistrationService(getRootPostgresPool(apiDb)!).execute({
      kind: "move-placement", organizationId: f.auth.organization.id, registrationId: f.registrationId,
      expectedRelease: release, destinationModuleId: destination.id, idempotencyKey: "move-subject-recognition-placement",
      context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(moved).toMatchObject({ ok: true });
    const settings = await loadModuleRecognitionSettings(apiDb, f.auth.organization.id, catalog);
    expect(settings.get(f.module.id)).toMatchObject({ recognitionSubjectId: null, compatibles: ["local,old-module"] });
    expect(settings.get(destination.id)).toMatchObject({ recognitionSubjectId: "csub_acme_power", compatibles: expect.arrayContaining(["acme,power"]) });
    const selector = (value: string) => ({ driverCompatibles: [DriverCompatible(value)], nodeTypeFallback: { kind: "absent" as const } });
    const afterMove = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(afterMove.resolveSubject(selector("local,old-module")).status).toBe("unknown");
    expect(afterMove.resolveSubject(selector("acme,power")).status).toBe("matched");
    await expect(updateParameterModuleForAuth(apiDb, f.auth, destination.id, { compatibles: ["local,new-module"] }))
      .resolves.toMatchObject({ recognitionSubjectId: "csub_acme_power" });
    const afterSave = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, afterMove);
    expect(afterSave.resolveSubject(selector("local,new-module")).status).toBe("matched");
    expect(afterSave.resolveSubject(selector("local,old-module")).status).toBe("unknown");
  });

  it("applies a local rule after later registration and edits a canonical node's actual fallback selector", async () => {
    const f = await fixture("recognition-late-registration", "node-type", "auto");
    const localDriver = await createParameterModule(pool, { organizationId: f.auth.organization.id,
      name: "Previously unregistered", kind: "driver-group" });
    await updateParameterModuleForAuth(apiDb, f.auth, localDriver.id, { compatibles: ["local,later-registration"], instanceCardinality: "singleton-per-project" });
    const registered = await createRegistrationService(getRootPostgresPool(apiDb)!).execute({
      kind: "register", organizationId: f.auth.organization.id, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver",
      expectedRelease: release, placement: { mode: "use-default" }, destinationModuleId: localDriver.id, method: "explicit",
      proof: { reason: "Register after local rule" }, idempotencyKey: "late-register-local-rule",
      context: { actorKind: "org-admin", principalId: f.auth.user.id },
    });
    expect(registered).toMatchObject({ ok: true });
    const catalog = await captureModuleRecognitionCatalog(apiDb);
    if (!catalog) throw new Error("Catalog is unavailable");
    const effective = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, catalog);
    expect(effective.resolveSubject({ driverCompatibles: [DriverCompatible("local,later-registration")], nodeTypeFallback: { kind: "absent" } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_power" } });
    await updateParameterModuleForAuth(apiDb, f.auth, f.module.id, { nodeTypeName: "local-charger" });
    const nodeEffective = await loadOrganizationCatalogSnapshot(apiDb, f.auth.organization.id, effective);
    expect(nodeEffective.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("local-charger") } }))
      .toMatchObject({ status: "matched", subject: { id: "csub_acme_charger" } });
    expect(nodeEffective.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName("charger") } }).status)
      .toBe("unknown");
  });
});
