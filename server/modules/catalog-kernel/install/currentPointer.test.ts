import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { seedCompiledCatalogProjection } from "../runtime/currentSnapshot";
import {
  advanceCurrentPointer,
  readCurrentCatalogPointer,
  restoreCurrentDefinitionHeads,
  switchCurrentPointerTo,
} from "./currentPointer";
import { acquireCurrentPointerLockExclusive } from "./lockProtocol";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-INS pointer tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-INS pointer tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

describe("current catalog pointer", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3insptr");
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await database?.drop();
  });

  it("reads empty catalog_state as an empty pointer", async () => {
    expect(await readCurrentCatalogPointer(client)).toEqual({ kind: "empty" });
  });

  it("switches back to the recorded previous pin and restores that release's heads", async () => {
    const pins = await seedCompiledCatalogProjection(database.url);
    const before = await readCurrentCatalogPointer(client);
    expect(before).toMatchObject({
      kind: "installed",
      current: { id: pins.current.id, digest: pins.current.digest },
    });

    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await restoreCurrentDefinitionHeads(client, pins.previous.id);
    await switchCurrentPointerTo(client, pins.previous.id);
    await client.query("set constraints all immediate");
    await client.query("commit");

    const after = await readCurrentCatalogPointer(client);
    expect(after).toMatchObject({
      kind: "installed",
      current: { id: pins.previous.id, digest: pins.previous.digest },
    });
    const head = await client.query<{ current_revision_id: string }>(
      `select current_revision_id
         from parameter_catalog.parameter_definitions
        where id = 'pdef_acme_power_iin_max'`,
    );
    expect(head.rows).toEqual([{ current_revision_id: "drev_acme_power_iin_max_1" }]);
  });

  it("advances the pointer back to the successor without rewriting immutable rows", async () => {
    const pins = await seedCompiledCatalogProjection(database.url);
    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await restoreCurrentDefinitionHeads(client, pins.previous.id);
    await switchCurrentPointerTo(client, pins.previous.id);
    await client.query("commit");

    const releasesBefore = await client.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.catalog_releases`,
    );

    await client.query("begin");
    await client.query("set constraints all deferred");
    await acquireCurrentPointerLockExclusive(client);
    await restoreCurrentDefinitionHeads(client, pins.current.id);
    await advanceCurrentPointer(client, pins.current.id);
    await client.query("commit");

    const after = await readCurrentCatalogPointer(client);
    expect(after).toMatchObject({
      kind: "installed",
      current: { id: pins.current.id, digest: pins.current.digest },
    });
    const releasesAfter = await client.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.catalog_releases`,
    );
    expect(releasesAfter.rows).toEqual(releasesBefore.rows);
  });
});
