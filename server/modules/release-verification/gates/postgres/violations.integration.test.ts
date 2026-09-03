import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReleaseVerificationService } from "../../core/service";
import { digestOf } from "../../core/digest";
import type { PrepareVerificationInput } from "../../core/types";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase,
} from "../../../../testing/testDatabase";
import { PARAMETER_GOVERNANCE_WRITER_ROLE } from "../../../catalog-kernel/security/catalogRoleManifest";
import { createPostgresGateAdapters, loadPackagedMigrationInventory } from "./index";
import { DEFAULT_MIGRATIONS_DIR } from "./inventory";
import { catalogRelation, definitionRelation, quoteIdent } from "./relations";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-VMP violation tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-VMP violation tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const emptySourceSnapshot = digestOf({
  archives: 0,
  identities: 0,
  ledger: 0,
  mappings: 0,
  registrations: 0,
});

const validPrepare = (
  inventoryDigest: string,
  schemaVersion: string,
  targetId: string,
): PrepareVerificationInput => ({
  subject: {
    targetId,
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "fresh",
  lineage: {
    phaseSnapshot: "P11",
    predecessorReportDigests: [],
    p12State: "not-started",
    p13State: "not-started",
    writerRetirementFingerprint: null,
    runtimePinGeneration: null,
    pointerRollbackStatus: "open",
    trafficIsolationState: "isolated",
  },
  pins: {
    artifact: {
      gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      releaseTag: "v-s10-vmp",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "",
      releaseDigest: "",
      compiledModelDigest: "",
      materializationFingerprint: "",
    },
    database: {
      targetIdentity: "pg-s10-vmp",
      schemaVersion,
      migrationInventoryDigest: inventoryDigest,
    },
    cutover: {
      planDigest: "sha256:cutover",
      contractVersion: "v1",
      sourceSnapshotFingerprint: emptySourceSnapshot,
    },
    mappingArchive: {
      mappingEpoch: "epoch-1",
      mappingHeadDigest: "sha256:map",
      archiveManifestDigest: "sha256:archive",
    },
    recovery: {
      recoveryPointId: "rp-1",
      recoveryPointDigest: "sha256:rp",
    },
    acceptance: {
      openApiDigest: "sha256:openapi",
      browserBundleSha: "sha256:browser",
    },
    target: {
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-vmp",
      verifierRole: "catalog_verifier",
    },
  },
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:cutover",
    acceptanceContractDigest: "sha256:accept",
  },
});

const expectOk = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

describe("false-zero and no-repair PostgreSQL gates", () => {
  let db: InMemoryTestDatabase;
  let inventoryDigest: string;
  let schemaVersion: string;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    const inventory = await loadPackagedMigrationInventory(DEFAULT_MIGRATIONS_DIR);
    inventoryDigest = inventory.digest;
    schemaVersion = inventory.schemaVersionPrefix;
  }, 60_000);

  afterAll(async () => {
    await db.rollback();
  });

  it("counts duplicate current Definitions instead of reporting a false zero", async () => {
    const definitions = catalogRelation(definitionRelation());
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    try {
    await db.query(`
      insert into ${catalogRelation("catalog_releases")} (
        id, release_sequence, release_version, release_digest,
        compiled_model_digest, toolchain_digest, published_at
      ) values (
        'crel-v01-dup', 88001, 'v01-dup', 'sha256:v01-dup',
        'sha256:v01-dup-model', 'sha256:v01-dup-toolchain', '2026-09-03T00:00:00Z'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_subjects")} (
        id, introduced_release_id, kind, canonical_key
      ) values (
        'csub-v01-dup', 'crel-v01-dup', 'driver', 'v01dup,driver'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_drivers")} (subject_id, nature, cardinality)
      values ('csub-v01-dup', 'physical-device', 'multiple')
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_release_subjects")} (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
      ) values ('crel-v01-dup', 'csub-v01-dup', 'active', '{}', '{}')
    `);
    const unique = await db.query<{ conname: string }>(
      `
      select constraint_record.conname
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class class on class.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relname = $1
        and constraint_record.contype = 'u'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%(subject_id, property_key)%'
      `,
      [definitionRelation()],
    );
    expect(unique.rows[0]?.conname).toBeTruthy();
    await db.query(
      `alter table ${definitions} drop constraint ${quoteIdent(unique.rows[0]!.conname)}`,
    );
    await db.query(`
      insert into ${definitions} (
        id, introduced_release_id, subject_id, property_key, current_revision_id
      ) values
        ('pdef-v01-a', 'crel-v01-dup', 'csub-v01-dup', 'iin_max', 'drev-v01-a'),
        ('pdef-v01-b', 'crel-v01-dup', 'csub-v01-dup', 'iin_max', 'drev-v01-b')
    `);
    await db.query(`
      insert into ${catalogRelation("definition_revisions")} (
        id, definition_id, revision_number, catalog_release_id, content_digest, content
      ) values
        ('drev-v01-a', 'pdef-v01-a', 1, 'crel-v01-dup', 'sha256:v01-a', '{}'),
        ('drev-v01-b', 'pdef-v01-b', 1, 'crel-v01-dup', 'sha256:v01-b', '{}')
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_release_definition_heads")} (
        release_id, definition_id, revision_id
      ) values
        ('crel-v01-dup', 'pdef-v01-a', 'drev-v01-a'),
        ('crel-v01-dup', 'pdef-v01-b', 'drev-v01-b')
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_state")} (singleton, current_catalog_release_id)
      values (true, 'crel-v01-dup')
    `);
    } finally {
      await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
    }

    const before = await db.query<{ count: string }>(
      `select count(*)::text as count from ${definitions} where subject_id = 'csub-v01-dup'`,
    );
    expect(before.rows[0]?.count).toBe("2");

    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(validPrepare(inventoryDigest, schemaVersion, "target-v01")),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const v01 = attempt.results.find((result) => result.gateId === "PCAT-DB-V01");
    expect(v01?.status).toBe("failed");
    expect(v01?.failureCode).toBe("PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION");

    const after = await db.query<{ count: string }>(
      `select count(*)::text as count from ${definitions} where subject_id = 'csub-v01-dup'`,
    );
    expect(after.rows[0]?.count).toBe("2");
  });

  it("fails V17 fresh mode when a Registration exists", async () => {
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    try {
    await db.query(`
      insert into public.organizations (id, name)
      values ('org-v17-reg', 'S10-VMP V17')
      on conflict (id) do nothing
    `);
    await db.query(`
      insert into public.attribution_subjects (
        id, organization_id, subject_kind, display_name, source_key
      ) values (
        'asub-v17-reg', 'org-v17-reg', 'driver-registration',
        'S10-VMP V17', 'compatible:v17reg,driver'
      )
    `);
    await db.query(`
      insert into public.driver_registrations (
        attribution_subject_id, driver_nature, instance_cardinality
      ) values ('asub-v17-reg', 'physical-device', 'multiple')
    `);
    await db.query(`
      insert into public.parameter_modules (
        id, organization_id, name, path, depth, kind, origin, attribution_subject_id
      ) values (
        'pmod-v17-reg', 'org-v17-reg', 'S10-VMP V17',
        'pmod-v17-reg', 1, 'driver-group', 'curated', 'asub-v17-reg'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_releases")} (
        id, release_sequence, release_version, release_digest,
        compiled_model_digest, toolchain_digest, published_at
      ) values (
        'crel-v17-reg', 88017, 'v17-reg', 'sha256:v17-reg',
        'sha256:v17-reg-model', 'sha256:v17-reg-toolchain', '2026-09-03T00:00:00Z'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("catalog_subjects")} (
        id, introduced_release_id, kind, canonical_key
      ) values (
        'csub-v17-reg', 'crel-v17-reg', 'driver', 'v17reg,driver'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("organization_subject_registrations")} (
        id, organization_id, subject_id, status, registration_method, proof, current_placement_id
      ) values (
        'reg-v17', 'org-v17-reg', 'csub-v17-reg', 'active', 'explicit', '{}', 'place-v17'
      )
    `);
    await db.query(`
      insert into ${catalogRelation("subject_placements")} (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'place-v17', 'reg-v17', 'org-v17-reg', 'pmod-v17-reg', 'curated'
      )
    `);
    } finally {
      await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
    }

    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(validPrepare(inventoryDigest, schemaVersion, "target-v17")),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const v17 = attempt.results.find((result) => result.gateId === "PCAT-DB-V17");
    expect(v17?.status).toBe("failed");
    expect(v17?.failureCode).toBe("PCAT-VRF-V17-MODE-RESULT-MISMATCH");
    const remaining = await db.query<{ count: string }>(
      `select count(*)::text as count from ${catalogRelation("organization_subject_registrations")}
       where id = 'reg-v17'`,
    );
    expect(remaining.rows[0]?.count).toBe("1");
  });

  it("fails M02 when an applied migration file is missing from the package", async () => {
    await db.query(
      "insert into schema_migrations (name, checksum) values ('9999_not_packaged.sql', 'deadbeef')",
    );
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(validPrepare(inventoryDigest, schemaVersion, "target-m02")),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const m02 = attempt.results.find((result) => result.gateId === "PCAT-DB-M02");
    expect(m02?.status).toBe("failed");
    expect(m02?.failureCode).toBe("PCAT-MIG-APPLIED-FILE-MISSING");
    const leftover = await db.query<{ count: string }>(
      "select count(*)::text as count from schema_migrations where name = '9999_not_packaged.sql'",
    );
    expect(leftover.rows[0]?.count).toBe("1");
  });

  it("fails P01 after a writer INSERT grant instead of treating the bypass as success", async () => {
    await db.query(
      `grant insert on table ${catalogRelation("catalog_releases")} to ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`,
    );
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(validPrepare(inventoryDigest, schemaVersion, "target-p01-bypass")),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const p01 = attempt.results.find((result) => result.gateId === "PCAT-DB-P01");
    expect(p01?.status).toBe("failed");
    expect(p01?.failureCode).toBe("PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS");
    const inserted = await db.query<{ count: string }>(
      `select count(*)::text as count from ${catalogRelation("catalog_releases")} where id = 'crel-p01-probe'`,
    );
    expect(inserted.rows[0]?.count).toBe("0");
  });
});
