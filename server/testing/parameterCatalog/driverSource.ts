/**
 * Test-only driver Catalog fixture. Production Catalog publication and
 * parameter-module owners remain responsible for the setup; integration tests
 * should not duplicate their private compiler/registration SQL.
 */
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../../modules/auth/types";
import { getRootPostgresPool } from "../../shared/database/client";
import { validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { CatalogSubjectId } from "../../modules/parameter-catalog-contract";
import { writeGuardedRegistration } from "../../modules/parameter-governance/registration/internalGuardedRegistrationWriter";
import type { RegisterSubjectCommand } from "../../modules/parameter-governance/registration/command";
import { createParameterModuleForAuth } from "../../modules/parameters/service";

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

  const business = await createParameterModuleForAuth(db, auth, {
    name: input.businessName,
    kind: "business",
  });
  const driver = await createParameterModuleForAuth(db, auth, {
    name: input.driverName,
    kind: "driver-group",
    parentId: business.id,
    compatibles: [input.compatible],
  });

  const command: RegisterSubjectCommand = {
    kind: "register",
    organizationId: auth.organization.id,
    subjectId: CatalogSubjectId(input.subjectId),
    subjectKind: "driver",
    expectedRelease: compiled.value.release,
    placement: { mode: "use-default" },
    destinationModuleId: driver.id,
    method: "explicit",
    proof: { reason: input.reason },
    idempotencyKey: input.idempotencyKey,
    context: { actorKind: "org-admin", principalId: auth.user.id },
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const registration = await writeGuardedRegistration(client, command);
    if (!registration.ok) {
      await client.query("rollback");
      throw new Error(JSON.stringify(registration.error));
    }
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
