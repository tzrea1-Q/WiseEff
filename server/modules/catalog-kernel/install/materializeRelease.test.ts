import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { acquireCurrentPointerLockExclusive } from "./lockProtocol";
import {
  CatalogMaterializationInjectedFailure,
  materializeCompiledRelease,
} from "./materializeRelease";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-INS materialize tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-INS materialize tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
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

const compileFirst = () => {
  const compiled = compileCatalogRelease(firstReleaseBundle());
  if (!compiled.ok) {
    throw new Error("first-release fixture failed to compile");
  }
  return compiled.value;
};

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function residue(client: pg.Client) {
  const result = await client.query<{
    releases: string;
    subjects: string;
    definitions: string;
    revisions: string;
    heads: string;
    materializations: string;
    pointer: string;
  }>(`
    select
      (select count(*)::text from parameter_catalog.catalog_releases) as releases,
      (select count(*)::text from parameter_catalog.catalog_subjects) as subjects,
      (select count(*)::text from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::text from parameter_catalog.definition_revisions) as revisions,
      (select count(*)::text from parameter_catalog.catalog_release_definition_heads) as heads,
      (select count(*)::text from parameter_catalog.catalog_materializations) as materializations,
      (select count(*)::text from parameter_catalog.catalog_state) as pointer
  `);
  return result.rows[0]!;
}

describe("materializeCompiledRelease", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3insmat");
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await database?.drop();
  });

  it("stages a compiled first release with a driver canonical selector, not a prefixed key", async () => {
    const compiled = compileFirst();
    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    const staged = await materializeCompiledRelease(client, compiled);
    await client.query("set constraints all immediate");
    await client.query("commit");

    expect(staged).toEqual({ status: "staged" });
    const subject = await client.query<{ canonical_key: string }>(
      `select canonical_key from parameter_catalog.catalog_subjects where id = 'csub_acme_power'`,
    );
    expect(subject.rows).toEqual([{ canonical_key: "acme,power" }]);
    expect(subject.rows[0]?.canonical_key).not.toBe("driver:acme,power");
    const counts = await residue(client);
    expect(counts.releases).toBe("1");
    expect(counts.subjects).toBe("1");
    expect(counts.definitions).toBe("1");
    expect(counts.revisions).toBe("1");
    expect(counts.heads).toBe("1");
    expect(counts.materializations).toBe("1");
    expect(counts.pointer).toBe("0");
  });

  it.each([
    "before-write",
    "releases",
    "subjects",
    "aliases",
    "definitions",
    "revisions",
    "heads",
    "evidence",
  ] as const)("rolls back to zero residue when injected after %s", async (stage) => {
    const compiled = compileFirst();
    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await expect(
      materializeCompiledRelease(client, compiled, { failAfter: stage }),
    ).rejects.toBeInstanceOf(CatalogMaterializationInjectedFailure);
    await client.query("rollback");

    expect(await residue(client)).toEqual({
      releases: "0",
      subjects: "0",
      definitions: "0",
      revisions: "0",
      heads: "0",
      materializations: "0",
      pointer: "0",
    });
  });

  it("refuses a colliding id with different bytes as digest-conflict and leaves the first projection", async () => {
    const compiled = compileFirst();
    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await materializeCompiledRelease(client, compiled);
    await client.query("commit");

    const collidingBundle = firstReleaseBundle();
    const target = collidingBundle.releases[0]!;
    target.manifest.release.publishedAt = "2026-09-03T00:00:00Z";
    refreshReleaseAggregateDigest(target);
    const colliding = compileCatalogRelease(collidingBundle);
    expect(colliding.ok).toBe(true);
    if (!colliding.ok) return;

    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await expect(materializeCompiledRelease(client, colliding.value)).rejects.toMatchObject({
      kernelError: { kind: "digest-conflict", releaseId: compiled.release.id },
    });
    await client.query("rollback");

    const stored = await client.query<{ release_digest: string }>(
      `select release_digest from parameter_catalog.catalog_releases where id = $1`,
      [compiled.release.id],
    );
    expect(stored.rows).toEqual([{ release_digest: compiled.release.digest }]);
  });
});
