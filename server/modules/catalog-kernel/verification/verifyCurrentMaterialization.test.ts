import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  catalogVerificationCheckCodes,
  type CatalogDriftViolationCode,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import {
  validCatalogReleaseBundle,
  type CatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../interface";
import { installPublishedRelease } from "../install/installer";
import { CATALOG_SYNCHRONIZER_ROLE } from "../security/catalogRoleManifest";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  THREAT_MATRIX,
  createCatalogVerifier,
  verifyCurrentMaterialization,
} from "./verifyCurrentMaterialization";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-VFY verifier tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-VFY verifier tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`fixture failed to compile: ${compiled.error.kind}`);
  }
  return compiled.value;
};

const connect = async (url: string): Promise<pg.Client> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
};

const residue = async (client: pg.Client) => {
  const result = await client.query<{
    releases: string;
    materializations: string;
    pointer: string;
    current: string | null;
    subjects: string;
    aliases: string;
    definitions: string;
    revisions: string;
    heads: string;
  }>(`
    select
      (select count(*)::text from parameter_catalog.catalog_releases) as releases,
      (select count(*)::text from parameter_catalog.catalog_materializations) as materializations,
      (select count(*)::text from parameter_catalog.catalog_state) as pointer,
      (select current_catalog_release_id from parameter_catalog.catalog_state) as current,
      (select count(*)::text from parameter_catalog.catalog_subjects) as subjects,
      (select count(*)::text from parameter_catalog.catalog_subject_aliases) as aliases,
      (select count(*)::text from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::text from parameter_catalog.definition_revisions) as revisions,
      (select count(*)::text from parameter_catalog.catalog_release_definition_heads) as heads
  `);
  return result.rows[0]!;
};

const withReplica = async <T>(
  client: pg.Client,
  work: () => Promise<T>,
): Promise<T> => {
  await client.query(
    "select pg_catalog.set_config('session_replication_role', 'replica', false)",
  );
  try {
    return await work();
  } finally {
    await client.query(
      "select pg_catalog.set_config('session_replication_role', 'origin', false)",
    );
  }
};

const writerPool = (url: string): pg.Pool => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const connectClient = pool.connect.bind(pool);
  pool.connect = (async () => {
    const client = await connectClient();
    await client.query(`set role ${CATALOG_SYNCHRONIZER_ROLE}`);
    return client;
  }) as typeof pool.connect;
  return pool;
};

describe("independent current materialization verifier", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3vfyvrf");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("freezes the threat matrix with leftover assertions for every required row", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });

  it("verifies a matching pin and fingerprint through the shipped adapter", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    const before = await residue(observer);

    const verifier = createCatalogVerifier(pool);
    const verified = await verifier.verifyCurrentMaterialization({
      source: jsonCatalogReleaseSource(bundle),
      expected: { id: compiled.release.id, digest: compiled.release.digest },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.status).toBe("verified");
    expect(verified.value.release).toEqual({
      id: compiled.release.id,
      version: compiled.release.version,
      digest: compiled.release.digest,
    });
    expect(verified.value.materializationFingerprint).toBe(
      compiled.materializationFingerprint,
    );
    expect(verified.value.counts).toEqual(compiled.counts);
    expect(verified.value.checks.map((check) => check.code)).toEqual([
      ...catalogVerificationCheckCodes,
    ]);
    expect(verified.value.checks.every((check) => check.status === "passed")).toBe(
      true,
    );
    expect(await residue(observer)).toEqual(before);
  });

  it("returns release-mismatch when the current pointer is stale versus the expected pin", async () => {
    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const successorBundle = validCatalogReleaseBundle();
    const successor = compileOrThrow(successorBundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstBundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    const before = await residue(observer);

    const stale = await verifyCurrentMaterialization(pool, {
      source: jsonCatalogReleaseSource(successorBundle),
      expected: { id: successor.release.id, digest: successor.release.digest },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind === "release-mismatch" || stale.error.kind === "drift").toBe(
      true,
    );
    if (stale.error.kind === "release-mismatch") {
      expect(stale.error.expected).toEqual({
        id: successor.release.id,
        digest: successor.release.digest,
      });
      expect(stale.error.actual).toEqual({
        id: first.release.id,
        version: first.release.version,
        digest: first.release.digest,
      });
    }
    if (stale.error.kind === "drift") {
      expect(stale.error.violations.map((violation) => violation.code)).toContain(
        "current-pointer-mismatch",
      );
    }
    expect(await residue(observer)).toEqual(before);
  });

  it("rejects a poisoned materialization fingerprint as exact drift without repairing", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    const before = await residue(observer);
    await withReplica(observer, async () => {
      await observer.query(
        `update parameter_catalog.catalog_materializations
            set compiled_fingerprint = $1
          where release_id = $2`,
        [`sha256:${"b".repeat(64)}`, compiled.release.id],
      );
    });

    const drifted = await verifyCurrentMaterialization(pool, {
      source: jsonCatalogReleaseSource(bundle),
      expected: { id: compiled.release.id, digest: compiled.release.digest },
    });
    expect(drifted).toMatchObject({
      ok: false,
      error: {
        kind: "drift",
        scope: "current",
        expected: { id: compiled.release.id, digest: compiled.release.digest },
        violations: [{ code: "materialization-fingerprint-mismatch" }],
      },
    });
    expect((await residue(observer)).current).toBe(before.current);
    expect((await residue(observer)).materializations).toBe(before.materializations);
  });

  it.each([
    {
      code: "subject-membership-mismatch" as const,
      relation: "catalog_release_subjects",
      tamper: async (client: pg.Client, releaseId: string) => {
        await client.query(
          `update parameter_catalog.catalog_release_subjects
              set lifecycle = 'retired',
                  tombstone_provenance = '{"reason":"s3-vfy-tamper"}'::jsonb
            where release_id = $1`,
          [releaseId],
        );
      },
    },
    {
      code: "alias-membership-mismatch" as const,
      relation: "catalog_release_subject_aliases",
      tamper: async (client: pg.Client, releaseId: string) => {
        await client.query(
          `update parameter_catalog.catalog_release_subject_aliases
              set lifecycle = 'retired',
                  tombstone_provenance = '{"reason":"s3-vfy-tamper"}'::jsonb
            where release_id = $1`,
          [releaseId],
        );
      },
    },
    {
      code: "definition-head-mismatch" as const,
      relation: "catalog_release_definition_heads",
      tamper: async (client: pg.Client, releaseId: string) => {
        await client.query(
          `insert into parameter_catalog.catalog_releases (
             id, release_sequence, release_version, release_digest,
             compiled_model_digest, toolchain_digest, published_at
           ) values (
             'crel_tamper_head', 99, '9.9.9-head', $1,
             $1, $1, '2026-09-03T00:00:00Z'
           )`,
          [`sha256:${"d".repeat(64)}`],
        );
        await client.query(
          `insert into parameter_catalog.definition_revisions (
             id, definition_id, revision_number, catalog_release_id, content_digest, content
           ) values (
             'drev_tamper_head', 'pdef_acme_power_iin_max', 2, 'crel_tamper_head',
             $1, '{}'::jsonb
           )`,
          [`sha256:${"e".repeat(64)}`],
        );
        await client.query(
          `update parameter_catalog.catalog_release_definition_heads
              set revision_id = 'drev_tamper_head'
            where release_id = $1
              and definition_id = 'pdef_acme_power_iin_max'`,
          [releaseId],
        );
      },
    },
    {
      code: "definition-revision-mismatch" as const,
      relation: "definition_revisions",
      tamper: async (_client: pg.Client, releaseId: string) => {
        await observer.query(
          `update parameter_catalog.definition_revisions
              set content_digest = $1
            where catalog_release_id = $2`,
          [`sha256:${"c".repeat(64)}`, releaseId],
        );
      },
    },
    {
      code: "subject-root-mismatch" as const,
      relation: "catalog_subjects",
      tamper: async () => {
        await observer.query(
          `update parameter_catalog.catalog_subjects
              set canonical_key = 'acme,other'
            where id = 'csub_acme_power'`,
        );
      },
    },
    {
      code: "release-identity-mismatch" as const,
      relation: "catalog_releases",
      tamper: async () => {
        await observer.query(
          `update parameter_catalog.catalog_releases
              set release_version = '9.9.9'
            where id = 'crel_acme_1'`,
        );
      },
    },
    {
      code: "unexpected-catalog-row" as const,
      relation: "catalog_release_subjects",
      tamper: async (client: pg.Client, releaseId: string) => {
        await client.query("begin");
        await client.query("set constraints all deferred");
        await client.query(
          `insert into parameter_catalog.catalog_subjects (
             id, introduced_release_id, kind, canonical_key
           ) values ('csub_acme_extra', $1, 'driver', 'acme,extra')`,
          [releaseId],
        );
        await client.query(
          `insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
           values ('csub_acme_extra', 'physical-device', 'multiple')`,
        );
        await client.query(
          `insert into parameter_catalog.catalog_release_subjects (
             release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
           ) values (
             $1, 'csub_acme_extra', 'active',
             '{"kind":"driver-compatible","values":["acme,extra"]}'::jsonb,
             '{"source":"s3-vfy"}'::jsonb
           )`,
          [releaseId],
        );
        await client.query("commit");
      },
    },
  ] satisfies ReadonlyArray<{
    code: CatalogDriftViolationCode;
    relation: string;
    tamper: (client: pg.Client, releaseId: string) => Promise<void>;
  }>)(
    "returns drift $code for a partial or mutated projection",
    async ({ code, relation, tamper }) => {
      const bundle = firstReleaseBundle();
      const compiled = compileOrThrow(bundle);
      await installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.aggregateDigest,
      });
      const before = await residue(observer);
      await withReplica(observer, () => tamper(observer, compiled.release.id));

      const drifted = await verifyCurrentMaterialization(pool, {
        source: jsonCatalogReleaseSource(bundle),
        expected: { id: compiled.release.id, digest: compiled.release.digest },
      });
      expect(drifted.ok).toBe(false);
      if (drifted.ok) return;
      expect(drifted.error.kind).toBe("drift");
      if (drifted.error.kind !== "drift") return;
      expect(drifted.error.scope).toBe("current");
      expect(drifted.error.violations.some((violation) => violation.code === code)).toBe(
        true,
      );
      expect(
        drifted.error.violations.some((violation) => violation.relation === relation),
      ).toBe(true);
      expect((await residue(observer)).current).toBe(before.current);
    },
  );

  it("returns permission-denied when the verifier is given a writer credential", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    const before = await residue(observer);
    const writers = writerPool(database.url);
    try {
      const denied = await verifyCurrentMaterialization(writers, {
        source: jsonCatalogReleaseSource(bundle),
        expected: { id: compiled.release.id, digest: compiled.release.digest },
      });
      expect(denied).toEqual({
        ok: false,
        error: {
          kind: "permission-denied",
          operation: "verifyCurrentMaterialization",
        },
      });
    } finally {
      await writers.end();
    }
    expect(await residue(observer)).toEqual(before);
  });

  it("keeps current versus pinned namespace isolation for the expected pin", async () => {
    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const successorBundle = validCatalogReleaseBundle();
    const successor = compileOrThrow(successorBundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstBundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(successorBundle),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });

    const current = await verifyCurrentMaterialization(pool, {
      source: jsonCatalogReleaseSource(successorBundle),
      expected: { id: successor.release.id, digest: successor.release.digest },
    });
    expect(current.ok).toBe(true);

    const pinnedPrevious = await verifyCurrentMaterialization(pool, {
      source: jsonCatalogReleaseSource(firstBundle),
      expected: { id: first.release.id, digest: first.release.digest },
    });
    expect(pinnedPrevious.ok).toBe(false);
    if (pinnedPrevious.ok) return;
    expect(
      pinnedPrevious.error.kind === "release-mismatch" ||
        pinnedPrevious.error.kind === "drift",
    ).toBe(true);
  });

  it("does not treat organization overlay rows as catalog structure", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    await observer.query("begin");
    await observer.query("set constraints all deferred");
    await observer.query(`
      insert into public.organizations (id, name)
      values ('org-s3vfy', 'S3-VFY');
      insert into public.attribution_subjects (
        id, organization_id, subject_kind, display_name, source_key
      ) values (
        'attr-s3vfy', 'org-s3vfy', 'driver-registration', 'S3VFY driver', 'compatible:acme,power'
      );
      insert into public.driver_registrations (
        attribution_subject_id, driver_nature, instance_cardinality
      ) values ('attr-s3vfy', 'physical-device', 'multiple');
      insert into public.parameter_modules (
        id, organization_id, name, path, depth, kind, origin, attribution_subject_id
      ) values (
        'pmod-s3vfy', 'org-s3vfy', 'Driver', 'pmod-s3vfy', 1, 'driver-group', 'curated', 'attr-s3vfy'
      );
    `);
    await observer.query(
      `insert into parameter_catalog.organization_subject_registrations (
         id, organization_id, subject_id, status, registration_method, proof, current_placement_id
       ) values (
         'oreg-s3vfy', 'org-s3vfy', $1, 'active', 'explicit', '{}', 'place-s3vfy'
       )`,
      ["csub_acme_power"],
    );
    await observer.query(`
      insert into parameter_catalog.subject_placements (
        id, registration_id, organization_id, module_id, origin
      ) values (
        'place-s3vfy', 'oreg-s3vfy', 'org-s3vfy', 'pmod-s3vfy', 'curated'
      );
    `);
    await observer.query("commit");

    const verified = await verifyCurrentMaterialization(pool, {
      source: jsonCatalogReleaseSource(bundle),
      expected: { id: compiled.release.id, digest: compiled.release.digest },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.value.checks.some(
        (check) => check.code === "organization-structural-absence",
      ),
    ).toBe(true);
  });
});
