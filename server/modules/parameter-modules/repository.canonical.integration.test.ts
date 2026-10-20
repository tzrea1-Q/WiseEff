import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCatalogKernel,
  type CatalogSnapshot,
} from "../catalog-kernel/interface";
import {
  CatalogSubjectId,
  CatalogPageLimit,
  DefinitionRevisionId,
  ParameterDefinitionId,
  SubjectRegistrationId,
} from "../parameter-catalog-contract/index";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import {
  createManagedInstanceTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import {
  countCanonicalPlacementsForModule,
  countParametersForModule,
  createParameterModule,
  deleteParameterModule,
  moveParameterModule,
  updateParameterModule,
} from "../parameters/parameterModuleRepository";
import { readRegistry } from "./repository";
import { deleteParameterModuleForAuth } from "../parameters/service";
import { getRegistration } from "../parameter-governance/queries/registration";
import type { AuthContext } from "../auth/types";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins, type ProvisionedRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import {
  installParameterModuleRegistryProjectionFixture,
  registerParameterModuleRegistryProjectionDriver,
} from "../../testing/parameterCatalog/registryProjection";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("Issue #897 canonical registry query requires real PostgreSQL");
}

const ORG = "org-897-canonical";
const FOREIGN_ORG = "org-897-canonical-foreign";
const PROJECT = "project-897-canonical";
const SUBJECT = CatalogSubjectId("csub_acme_power");

describe.skipIf(!databaseAvailable)("Issue #897 canonical registry projection", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let catalogSnapshot: CatalogSnapshot;
  let apiDb: RootDatabase;
  let runtime: ProvisionedRuntimeLogins;
  let moduleRootId: string;
  let moduleDriverId: string;
  let moduleTargetId: string;
  let foreignModuleId: string;
  let registrationId: string;
  let catalogReleaseId: string;
  const auth: AuthContext = {
    user: { id: "user-leaf-delete", organizationId: ORG, name: "Admin", email: "admin@leaf.test", title: "Admin", isActive: true },
    organization: { id: ORG, name: "Issue 897" },
    roles: [{ roleId: "admin", projectId: null }],
    permissions: ["admin:access", "parameter:view"],
  };

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("issue897registry");
    pool = new pg.Pool({ connectionString: database.url, max: 5 });

    const catalogFixture = await installParameterModuleRegistryProjectionFixture(pool);
    const pin = catalogFixture.pin;
    catalogReleaseId = pin.id;
    const definitionId = ParameterDefinitionId(catalogFixture.activeDefinitionIds[0]);
    const definitionRevisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");

    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'Issue 897'), ($2, 'Issue 897 foreign')`,
      [ORG, FOREIGN_ORG],
    );
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Admin', 'admin@leaf.test', 'Admin', true)`, [auth.user.id, ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, 'Issue 897 project', 'I897')`,
      [PROJECT, ORG],
    );
    const root = await createParameterModule(pool, {
      organizationId: ORG,
      name: "Issue 897 root",
      kind: "business",
    });
    moduleRootId = root.id;
    const driver = await createParameterModule(pool, {
      organizationId: ORG,
      parentId: root.id,
      name: "Issue 897 driver",
      kind: "driver-group",
      sourceKey: "compatible:acme,power",
    });
    moduleDriverId = driver.id;
    const target = await createParameterModule(pool, {
      organizationId: ORG,
      name: "Issue 897 target",
      kind: "business",
    });
    moduleTargetId = target.id;
    const foreignModule = await createParameterModule(pool, {
      organizationId: FOREIGN_ORG,
      name: "Issue 897 foreign",
      kind: "business",
    });
    foreignModuleId = foreignModule.id;

    registrationId = await registerParameterModuleRegistryProjectionDriver(pool, {
      organizationId: ORG,
      subjectId: SUBJECT,
      destinationModuleId: driver.id,
      release: pin,
    });

    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error("canonical fixture snapshot unavailable");
    catalogSnapshot = loaded.value;
    const lifecycleFacts = catalogSnapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "subject", subjectId: SUBJECT },
      lifecycles: ["active", "deprecated", "retired"],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(10), after: { kind: "absent" } },
    });
    if (lifecycleFacts.status !== "found") throw new Error("definition lifecycle fixture unavailable");
    expect(lifecycleFacts.page.items.map((definition) => definition.id)).toContain(
      catalogFixture.retiredDefinitionId,
    );
    expect(lifecycleFacts.page.items.filter(
      (definition) => definition.selectedRevision.content.lifecycle === "active",
    )).toHaveLength(2);
    const binding = await createSourceBackedBindingService(pool).stabilize({
      snapshot: loaded.value,
      organizationId: ORG,
      projectId: PROJECT,
      logicalNodeId: "issue897-node",
      registrationId: SubjectRegistrationId(registrationId),
      definitionId,
      effectiveRevisionId: definitionRevisionId,
      expectedEffectiveRevisionId: null,
    });
    if (!binding.ok) throw new Error(JSON.stringify(binding.error));
    runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: `issue897${process.pid}`.slice(0, 24) });
    apiDb = createPostgresDatabase(runtime.apiUrl);
    const apiCatalogPool = new pg.Pool({ connectionString: runtime.apiUrl, max: 2 });
    try {
      const apiLoaded = await createCatalogKernel(apiCatalogPool).loadPinnedCatalog(pin);
      if (!apiLoaded.ok) throw new Error("role-faithful API Catalog snapshot unavailable");
      catalogSnapshot = apiLoaded.value;
    } finally {
      await apiCatalogPool.end();
    }
  }, 120_000);

  afterAll(async () => {
    await apiDb?.close();
    await pool?.end();
    if (runtime?.runToken) {
      const cleanup = await dropLabRuntimeLogins(database.url, runtime.runToken);
      if (cleanup.failed.length) throw new Error(`Runtime role cleanup failed: ${cleanup.failed.join(",")}`);
    }
    await database?.drop();
  });

  it("projects one canonical Binding and both active registered Definitions into the placement subtree", async () => {
    const registry = await readRegistry(apiDb, ORG, catalogSnapshot);
    const root = registry.modules.find((module) => module.id === moduleRootId);
    const driver = registry.modules.find((module) => module.id === moduleDriverId);
    expect(driver).toEqual(expect.objectContaining({ parameterCount: 1, definitionCount: 2 }));
    expect(root).toEqual(expect.objectContaining({ parameterCount: 1, definitionCount: 2 }));
    expect(registry.modules.some((module) => module.id === moduleTargetId)).toBe(true);
    expect(registry.modules.some((module) => module.id === foreignModuleId)).toBe(false);
    await expect(countParametersForModule(pool, {
      organizationId: ORG,
      moduleId: moduleDriverId,
    })).resolves.toBe(1);
    await expect(countParametersForModule(pool, {
      organizationId: FOREIGN_ORG,
      moduleId: moduleDriverId,
    })).resolves.toBe(0);
    await expect(countCanonicalPlacementsForModule(pool, {
      organizationId: ORG,
      moduleId: moduleDriverId,
    })).resolves.toBe(1);
    await expect(countCanonicalPlacementsForModule(pool, {
      organizationId: FOREIGN_ORG,
      moduleId: moduleDriverId,
    })).resolves.toBe(0);
  });

  it("keeps placement ownership during rename/move", async () => {
    const renamed = await updateParameterModule(pool, {
      organizationId: ORG,
      moduleId: moduleDriverId,
      name: "Issue 897 renamed driver",
    });
    expect(renamed?.name).toBe("Issue 897 renamed driver");
    const moved = await moveParameterModule(pool, {
      organizationId: ORG,
      moduleId: moduleDriverId,
      parentId: moduleTargetId,
    });
    expect(moved?.parentId).toBe(moduleTargetId);
    await expect(countCanonicalPlacementsForModule(pool, {
      organizationId: ORG,
      moduleId: moduleDriverId,
    })).resolves.toBe(1);
  });

  it("refuses a parent, a foreign module, and an unauthorized actor without detaching anything", async () => {
    await expect(deleteParameterModuleForAuth(apiDb, auth, moduleTargetId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deleteParameterModuleForAuth(apiDb, auth, foreignModuleId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteParameterModuleForAuth(apiDb, { ...auth, permissions: ["parameter:view"] }, moduleDriverId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(countCanonicalPlacementsForModule(apiDb, { organizationId: ORG, moduleId: moduleDriverId })).resolves.toBe(1);
  });

  it("rolls back module detachment, retained Binding state and audit together", async () => {
    await expect(apiDb.transaction(async (tx) => {
      await deleteParameterModuleForAuth(tx, auth, moduleDriverId);
      throw new Error("injected-after-delete");
    })).rejects.toThrow("injected-after-delete");
    await expect(countParametersForModule(apiDb, { organizationId: ORG, moduleId: moduleDriverId })).resolves.toBe(1);
    const audits = await apiDb.query(`select id from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-delete'`, [moduleDriverId]);
    expect(audits.rows).toHaveLength(0);
  });

  it("deletes a populated canonical leaf through the API role and preserves unset registration, definitions, Binding and audit", async () => {
    const before = await apiDb.query<{ id: string; version: string }>(
      `select id, updated_at::text as version from parameter_catalog.subject_placements where registration_id = $1`, [registrationId],
    );
    await deleteParameterModuleForAuth(apiDb, auth, moduleDriverId);
    const after = await getRegistration(getRootPostgresPool(apiDb)!, {
      organizationId: ORG, registrationId: SubjectRegistrationId(registrationId), observedCatalogReleaseId: catalogReleaseId,
      authScope: { organizationId: ORG, principalId: auth.user.id },
    });
    expect(after).toMatchObject({ ok: true, value: {
      id: registrationId, status: "active", placement: { id: before.rows[0]!.id, displayName: "未设置模块 (unset)" },
      impact: { bindingCount: 1, projectCount: 1 },
    } });
    if (!after.ok) throw new Error(JSON.stringify(after.error));
    expect(after.value.placement.moduleId).toBeUndefined();
    const retained = await apiDb.query<{ module_id: string | null; version: string }>(
      `select module_id, updated_at::text as version from parameter_catalog.subject_placements where registration_id = $1`, [registrationId],
    );
    expect(retained.rows[0]!.module_id).toBeNull();
    expect(retained.rows[0]!.version).not.toBe(before.rows[0]!.version);
    const registry = await readRegistry(apiDb, ORG, catalogSnapshot);
    expect(registry.modules.some((module) => module.id === moduleDriverId)).toBe(false);
    const bindings = await apiDb.query(`select id from parameter_catalog.current_project_parameter_bindings where registration_id = $1`, [registrationId]);
    expect(bindings.rows).toHaveLength(1);
    const audits = await apiDb.query(`select id from public.audit_events where target_id = $1 and kind = 'parameter-module-admin-delete'`, [moduleDriverId]);
    expect(audits.rows).toHaveLength(1);
    await expect(deleteParameterModuleForAuth(apiDb, auth, moduleDriverId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("detaches a populated legacy driver placement through the API role while retaining legacy rows", async () => {
    const subjectId = "subject-delete-legacy";
    await pool.query(`insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
                      values ($1, $2, 'driver-registration', 'Legacy retained', 'legacy:delete-test')`, [subjectId, ORG]);
    await pool.query(`insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
                      values ($1, 'physical-device', 'multiple')`, [subjectId]);
    const module = await createParameterModule(pool, { organizationId: ORG, name: "Legacy leaf", kind: "driver-group", attributionSubjectId: subjectId });
    await pool.query(`insert into public.driver_registration_placements (id, organization_id, attribution_subject_id, driver_group_module_id)
                      values ('legacy-placement-retained', $1, $2, $3)`, [ORG, subjectId, module.id]);
    await pool.query(`insert into public.parameter_definitions
      (id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk, parameter_module_id)
      values ('definition-legacy-retained', $1, 'retained', '', '', 'ENV', 'Legacy leaf', '', '', 'Low', $2)`, [ORG, module.id]);
    await deleteParameterModuleForAuth(apiDb, auth, module.id);
    expect((await apiDb.query(`select driver_group_module_id from public.driver_registration_placements where id = 'legacy-placement-retained'`)).rows)
      .toEqual([{ driver_group_module_id: null }]);
    expect((await apiDb.query(`select parameter_module_id, module from public.parameter_definitions where id = 'definition-legacy-retained'`)).rows)
      .toEqual([{ parameter_module_id: null, module: "unset" }]);
    expect((await apiDb.query(`select attribution_subject_id from public.driver_registrations where attribution_subject_id = $1`, [subjectId])).rows)
      .toHaveLength(1);
  });
});
