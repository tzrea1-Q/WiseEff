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
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
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

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("issue897registry");
    pool = new pg.Pool({ connectionString: database.url, max: 5 });

    const catalogFixture = await installParameterModuleRegistryProjectionFixture(pool);
    const pin = catalogFixture.pin;
    const definitionId = ParameterDefinitionId(catalogFixture.activeDefinitionIds[0]);
    const definitionRevisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");

    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'Issue 897'), ($2, 'Issue 897 foreign')`,
      [ORG, FOREIGN_ORG],
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
      registrationId,
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

  it("blocks deletion through canonical Binding ownership and keeps placement ownership during rename/move", async () => {
    await expect(deleteParameterModule(pool, { organizationId: ORG, moduleId: moduleDriverId })).rejects.toThrow(
      "referenced by parameters",
    );

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
});
