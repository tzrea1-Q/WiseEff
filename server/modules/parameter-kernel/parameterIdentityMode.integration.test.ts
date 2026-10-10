import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedSpecBindingGraph } from "../../testing/fixtures";
import { createManagedInstanceTestDatabase } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { seedCanonicalParameterFixture, type CanonicalParameterFixture } from "../agent/testing/canonicalParameterFixture";
import { createLocalObjectStore } from "../logs/objectStore";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "./parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";

describe("parameter identity startup on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createManagedInstanceTestDatabase>>;
  let db: RootDatabase;
  let directory: string;
  let fixture: CanonicalParameterFixture;

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("1080id");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-1080ci2-identity-"));
    fixture = await seedCanonicalParameterFixture(db, createLocalObjectStore(directory));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    setParameterIdentityMode(null);
    await db?.close();
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps fresh canonical production databases in their pre-cutover mode without writes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await db.transaction(async (tx) => {
      await tx.query("set transaction read only");
      expect(await resolveParameterIdentityMode(tx)).toBe("legacy");
    });
  });

  it("selects semantic identity for a clean fresh canonical development database without writes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await db.transaction(async (tx) => {
      await tx.query("set transaction read only");
      expect(await resolveParameterIdentityMode(tx)).toBe("semantic");
    });
  });

  it.each(["production", "development"])("keeps mixed canonical and retained legacy databases in legacy mode in %s", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    await db.transaction(async (tx) => {
      await tx.query("savepoint mixed_identity");
      try {
        await seedSpecBindingGraph(tx, {
          organizationId: fixture.organizationId,
          specs: [{ id: "spec-1080ci2-mixed", specificationKey: "retained-history" }]
        });
        expect(await resolveParameterIdentityMode(tx)).toBe("legacy");
      } finally {
        await tx.query("rollback to savepoint mixed_identity");
      }
    });
  });

  it.each(["production", "development"])("keeps populated post-cutover databases semantic in %s", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    await db.transaction(async (tx) => {
      await tx.query("savepoint completed_cutover");
      try {
        await tx.query(`insert into parameter_identity_migration_runs (id, mode, status)
          values ('run-1080ci2', 'apply', 'completed')`);
        await tx.query(`insert into parameter_identity_cutovers (id, migration_run_id)
          values ('cutover-1080ci2', 'run-1080ci2')`);
        expect(await resolveParameterIdentityMode(tx)).toBe("semantic");
      } finally {
        await tx.query("rollback to savepoint completed_cutover");
      }
    });
  });

  it("retains semantic resolution for renamed legacy tables without a marker in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await db.transaction(async (tx) => {
      await tx.query("savepoint retired_tables");
      try {
        await tx.query(`alter table ${LEGACY_IDENTITY_SQL.definitionsTable} rename to t1080ci2_retired_definitions`);
        expect(await resolveParameterIdentityMode(tx)).toBe("semantic");
      } finally {
        await tx.query("rollback to savepoint retired_tables");
      }
    });
  });

  it("refuses local canonical resolution when flat identity rows remain", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await db.transaction(async (tx) => {
      await tx.query("savepoint dirty_flat_identity");
      try {
        await tx.query(`insert into ${LEGACY_IDENTITY_SQL.definitionsTable}
          (id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk)
          values ('flat-1080ci2', $1, 'retained', '', '', 'json', '', '', '', '')`, [fixture.organizationId]);
        await expect(resolveParameterIdentityMode(tx)).rejects.toThrow(/legacy flat identity/);
        expect(await resolveParameterIdentityMode(tx, { NODE_ENV: "production" })).toBe("legacy");
      } finally {
        await tx.query("rollback to savepoint dirty_flat_identity");
      }
    });
  });

  it("keeps unseeded databases legacy when the canonical source plane is empty", async () => {
    const empty = await createManagedInstanceTestDatabase("1080empty");
    const emptyDb = createPostgresDatabase(empty.url);
    try {
      await emptyDb.transaction(async (tx) => {
        await tx.query("set transaction read only");
        expect(await resolveParameterIdentityMode(tx, { NODE_ENV: "development" })).toBe("legacy");
        expect(await resolveParameterIdentityMode(tx, { NODE_ENV: "production" })).toBe("legacy");
      });
    } finally {
      await emptyDb.close();
      await empty.drop();
    }
  });

  it("tolerates absent canonical tables in a pre-canonical development database", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await withTempDatabase({ prefix: "test_t1080ci2_identity", migrate: false }, async ({ db: emptyDb }) => {
      await emptyDb.query(`create table ${LEGACY_IDENTITY_SQL.definitionsTable} (id text primary key)`);
      expect(await resolveParameterIdentityMode(emptyDb)).toBe("legacy");
    });
  });
});
