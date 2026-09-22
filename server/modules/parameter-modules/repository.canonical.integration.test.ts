import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import {
  refreshAuthoritativeSource,
  validCatalogReleaseBundle,
} from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseDefinitionDocument } from "../catalog-kernel/compiler/types";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogSnapshot,
} from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { ParameterDefinitionId, type CatalogReleasePin } from "../parameter-catalog-contract/index";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import {
  createManagedInstanceTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import {
  createParameterModule,
  deleteParameterModule,
  moveParameterModule,
  updateParameterModule,
} from "../parameters/parameterModuleRepository";
import { readRegistry } from "./repository";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins, type ProvisionedRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("Issue #897 canonical registry query requires real PostgreSQL");
}

const ORG = "org-897-canonical";
const FOREIGN_ORG = "org-897-canonical-foreign";
const PROJECT = "project-897-canonical";
const MODULE_ROOT = "module-897-root";
const MODULE_DRIVER = "module-897-driver";
const MODULE_TARGET = "module-897-target";
const FOREIGN_MODULE = "module-897-foreign";
const SUBJECT = "csub_acme_power";
const DEFINITION = ParameterDefinitionId("pdef_acme_power_iin_max");
const EXTRA_DEFINITION = ParameterDefinitionId("pdef_acme_power_iin_min");
const REVISION = "drev_acme_power_iin_max_1";
const REGISTRATION = "reg-897-canonical";
const PLACEMENT = "placement-897-canonical";

const fixtureBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const release = structuredClone(full.releases[0]!);
  const existing = release.documents.find(
    (document): document is CatalogReleaseDefinitionDocument => document.kind === "definition",
  );
  if (!existing) throw new Error("canonical fixture definition missing");
  const extra = structuredClone(existing);
  extra.content.id = EXTRA_DEFINITION;
  extra.content.propertyKey = "iin_min";
  extra.content.revision.id = "drev_acme_power_iin_min_1";
  extra.content.revision.displayName = "Input minimum limit";
  release.documents.push(extra);
  const retired = structuredClone(existing);
  retired.content.id = "pdef_acme_power_legacy_limit";
  retired.content.propertyKey = "legacy_limit";
  retired.content.revision.id = "drev_acme_power_legacy_limit_1";
  retired.content.revision.lifecycle = "retired";
  release.documents.push(retired);
  refreshAuthoritativeSource(release);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: release.manifest.release.id,
    releases: [release],
  };
};

describe.skipIf(!databaseAvailable)("Issue #897 canonical registry projection", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let catalogSnapshot: CatalogSnapshot;
  let apiDb: RootDatabase;
  let runtime: ProvisionedRuntimeLogins;

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("issue897registry");
    pool = new pg.Pool({ connectionString: database.url, max: 5 });

    const bundle = fixtureBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };

    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'Issue 897'), ($2, 'Issue 897 foreign')`,
      [ORG, FOREIGN_ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, 'Issue 897 project', 'I897')`,
      [PROJECT, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
       values ($1, $2, 'driver-registration', 'Issue 897 driver', 'compatible:acme,power')`,
      ["attr-897-canonical", ORG],
    );
    await pool.query(
      `insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
       values ($1, 'physical-device', 'multiple')`,
      ["attr-897-canonical"],
    );
    await pool.query(
      `insert into public.parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, attribution_subject_id)
       values
         ($1, $2, null, 'Issue 897 root', $1, 1, 'business', 'curated', null),
         ($3, $2, $1, 'Issue 897 driver', $1 || '/' || $3, 2, 'driver-group', 'curated', $4),
         ($5, $2, null, 'Issue 897 target', $5, 1, 'business', 'curated', null),
         ($6, $7, null, 'Issue 897 foreign', $6, 1, 'business', 'curated', null)`,
      [MODULE_ROOT, ORG, MODULE_DRIVER, "attr-897-canonical", MODULE_TARGET, FOREIGN_MODULE, FOREIGN_ORG],
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query(
        `insert into parameter_catalog.organization_subject_registrations
           (id, organization_id, subject_id, status, registration_method, proof, current_placement_id)
         values ($1, $2, $3, 'active', 'explicit', '{}'::jsonb, $4)`,
        [REGISTRATION, ORG, SUBJECT, PLACEMENT],
      );
      await client.query(
        `insert into parameter_catalog.subject_placements
           (id, registration_id, organization_id, module_id, origin)
         values ($1, $2, $3, $4, 'curated')`,
        [PLACEMENT, REGISTRATION, ORG, MODULE_DRIVER],
      );
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error("canonical fixture snapshot unavailable");
    catalogSnapshot = loaded.value;
    const binding = await createSourceBackedBindingService(pool).stabilize({
      snapshot: loaded.value,
      organizationId: ORG,
      projectId: PROJECT,
      logicalNodeId: "issue897-node",
      registrationId: REGISTRATION as never,
      definitionId: DEFINITION,
      effectiveRevisionId: REVISION as never,
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
    const root = registry.modules.find((module) => module.id === MODULE_ROOT);
    const driver = registry.modules.find((module) => module.id === MODULE_DRIVER);
    expect(driver).toEqual(expect.objectContaining({ parameterCount: 1, definitionCount: 2 }));
    expect(root).toEqual(expect.objectContaining({ parameterCount: 1, definitionCount: 2 }));
    expect(registry.modules.some((module) => module.id === MODULE_TARGET)).toBe(true);
    expect(registry.modules.some((module) => module.id === FOREIGN_MODULE)).toBe(false);
  });

  it("blocks deletion through canonical Binding ownership and keeps placement ownership during rename/move", async () => {
    await expect(deleteParameterModule(pool, { organizationId: ORG, moduleId: MODULE_DRIVER })).rejects.toThrow(
      "referenced by parameters",
    );

    const renamed = await updateParameterModule(pool, {
      organizationId: ORG,
      moduleId: MODULE_DRIVER,
      name: "Issue 897 renamed driver",
    });
    expect(renamed?.name).toBe("Issue 897 renamed driver");
    const moved = await moveParameterModule(pool, {
      organizationId: ORG,
      moduleId: MODULE_DRIVER,
      parentId: MODULE_TARGET,
    });
    expect(moved?.parentId).toBe(MODULE_TARGET);
    const placement = await pool.query<{ module_id: string }>(
      `select module_id from parameter_catalog.subject_placements where id = $1`,
      [PLACEMENT],
    );
    expect(placement.rows[0]?.module_id).toBe(MODULE_DRIVER);
  });
});
