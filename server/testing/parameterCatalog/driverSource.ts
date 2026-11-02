/**
 * Test-only driver Catalog fixture. Production Catalog publication and
 * parameter-module owners remain responsible for the setup; integration tests
 * should not duplicate their private compiler/registration SQL.
 */
import type { Database } from "../../shared/database/client";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "../../modules/auth/types";
import { getRootPostgresPool } from "../../shared/database/client";
import { validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { CatalogSubjectId, CatalogReleaseId, CatalogReleaseDigest, SubjectRegistrationId } from "../../modules/parameter-catalog-contract";
import { executeRegistration } from "../../modules/parameter-governance/registration/service";
import { writeGuardedRegistration } from "../../modules/parameter-governance/registration/internalGuardedRegistrationWriter";
import type { RegisterSubjectCommand } from "../../modules/parameter-governance/registration/command";
import { createParameterModuleForAuth } from "../../modules/parameters/service";
import { createLegacyParameterModule as createParameterModule } from "../legacyParameterModuleFixture";
import type pg from "pg";

/** Seed a historical typed placement before 0320 so upgrade tests exercise real legacy rows. */
export async function seedLegacySubjectPlacement(pool: pg.Pool, input: {
  organizationId: string; subjectId: string; moduleId: string; reason: string;
}): Promise<SubjectRegistrationId> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const applied = await client.query("select 1 from schema_migrations where name = '0320_placement_business_modules.sql'");
    if (applied.rowCount) throw new Error("Legacy fixture must be seeded before migration 0320");
    const registrationId = SubjectRegistrationId(`sreg-${randomUUID()}`);
    const placementId = `spla-${randomUUID()}`;
    await client.query(`insert into parameter_catalog.organization_subject_registrations
      (id, organization_id, subject_id, status, registration_method, proof, current_placement_id)
      values ($1, $2, $3, 'active', 'explicit', $4, $5)`,
    [registrationId, input.organizationId, input.subjectId, JSON.stringify({ reason: input.reason }), placementId]);
    await client.query(`insert into parameter_catalog.subject_placements
      (id, registration_id, organization_id, module_id, origin) values ($1, $2, $3, $4, 'curated')`,
    [placementId, registrationId, input.organizationId, input.moduleId]);
    await client.query("set constraints all immediate");
    await client.query("commit");
    return registrationId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function seedHistoricalSingletonMapping(
  db: Database,
  input: { organizationId: string; moduleId: string; compatible: string },
): Promise<void> {
  const subjectId = `${input.moduleId}-subject`;
  await db.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
    values ($1,$2,'driver-registration','Historical singleton',$3)`,
  [subjectId, input.organizationId, `compatible:${input.compatible}`]);
  await db.query(`insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
    values ($1,'logical-service','singleton-per-project')`, [subjectId]);
  await db.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
    values ($1,$2,'Historical singleton',$1,1,'driver-group','curated',$3)`,
  [input.moduleId, input.organizationId, subjectId]);
  await db.query(`insert into parameter_module_mappings(id,organization_id,parameter_module_id,match_kind,match_value)
    values ($1,$2,$3,'compatible',$4)`,
  [`${input.moduleId}-mapping`, input.organizationId, input.moduleId, input.compatible]);
}

export async function installDriverSourceFixture(
  db: Database,
  auth: AuthContext,
  input: {
    subjectId: string;
    compatible: string;
    businessName: string;
    driverName: string;
    idempotencyKey: string;
    reason: string;
    legacyPlacement?: boolean;
  },
): Promise<{ release: { id: string; digest: string }; driverModuleId: string }> {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Driver Catalog fixture requires native PostgreSQL");

  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  const bundle = {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, {
    mode: "bootstrap",
    source: jsonCatalogReleaseSource(bundle),
    expectedTargetDigest: compiled.value.aggregateDigest,
  });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));

  const business = input.legacyPlacement
    ? await createParameterModule(db, { organizationId: auth.organization.id, name: input.businessName, kind: "business" })
    : await createParameterModuleForAuth(db, auth, { name: input.businessName, kind: "business" });
  const driverId = randomUUID();
  const driver = input.legacyPlacement ? { id: driverId } : await createParameterModule(db, {
    organizationId: auth.organization.id, name: input.driverName, kind: "driver-group",
    parentId: business.id, sourceKey: `compatible:${input.compatible}`,
  });
  if (input.legacyPlacement) {
    // The current module service reads 0324 columns, so seed genuine pre-0320 rows explicitly.
    const attributionSubjectId = `asub:legacy:${driver.id}`;
    await db.query(`insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
      values ($1,$2,'driver-registration',$3,'curated',$4)`,
    [attributionSubjectId, auth.organization.id, input.driverName, `compatible:${input.compatible}`]);
    await db.query(`insert into public.parameter_modules
      (id,organization_id,parent_id,name,path,depth,kind,origin,source_key,attribution_subject_id)
      values ($1,$2,$3,$4,$5,2,'driver-group','curated',$6,$7)`,
    [driver.id, auth.organization.id, business.id, input.driverName, `${business.path}/${driver.id}`,
      `compatible:${input.compatible}`, attributionSubjectId]);
  }

  const command: RegisterSubjectCommand = {
    kind: "register",
    organizationId: auth.organization.id,
    subjectId: CatalogSubjectId(input.subjectId),
    subjectKind: "driver",
    expectedRelease: compiled.value.release,
    placement: { mode: "use-default" },
    destinationModuleId: input.legacyPlacement ? driver.id : business.id,
    method: "explicit",
    proof: { reason: input.reason },
    idempotencyKey: input.idempotencyKey,
    context: { actorKind: "org-admin", principalId: auth.user.id },
  };
  if (input.legacyPlacement) {
    await seedLegacySubjectPlacement(pool, { organizationId: auth.organization.id, subjectId: input.subjectId,
      moduleId: driver.id, reason: input.reason });
    return { release: compiled.value.release, driverModuleId: driver.id };
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const registration = await writeGuardedRegistration(client, command);
    if (!registration.ok) throw new Error(JSON.stringify(registration.error));
    await client.query("set constraints all immediate");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return { release: compiled.value.release, driverModuleId: driver.id };
}

/** Change registration through its owner while keeping Catalog internals in the native fixture. */
export async function retireDriverSourceFixture(db: Database, auth: AuthContext, input: {
  subjectId: string; release: { id: string; digest: string }; idempotencyKey: string; reason: string;
}) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Driver Catalog fixture requires native PostgreSQL");
  const registration = (await db.query<{ id: string }>(
    "select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2",
    [auth.organization.id, input.subjectId],
  )).rows[0];
  if (!registration) throw new Error("Driver Catalog fixture registration was not found");
  return executeRegistration(pool, {
    kind: "retire", organizationId: auth.organization.id, registrationId: SubjectRegistrationId(registration.id),
    expectedRelease: { id: CatalogReleaseId(input.release.id), digest: CatalogReleaseDigest(input.release.digest) },
    idempotencyKey: input.idempotencyKey, context: { actorKind: "org-admin", principalId: auth.user.id }, reason: input.reason,
  });
}
