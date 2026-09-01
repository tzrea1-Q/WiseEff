import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";

const databaseAvailable = await isTestDatabaseAvailable();

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function captureDatabaseError(action: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(pg.DatabaseError);
    return error as pg.DatabaseError;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

async function waitForAdvisoryLockWait(observer: pg.Client, processId: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(`
      select coalesce(
        (
          select wait_event_type = 'Lock' and wait_event = 'advisory'
          from pg_catalog.pg_stat_activity
          where pid = $1
        ),
        false
      ) as waiting
    `, [processId]);
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${processId} did not wait for the Catalog advisory lock`);
}

async function seedCurrentRelease(client: pg.Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`
      insert into parameter_catalog.catalog_releases (
        id, release_version, release_digest, compiled_model_digest, toolchain_digest
      ) values ('crel-a', '1.0.0', 'sha256:release-a', 'sha256:compiled-a', 'sha256:toolchain-a');

      insert into parameter_catalog.catalog_subjects (id, kind, canonical_key) values
        ('csub-active', 'driver', 'driver:active'),
        ('csub-retired', 'node-type', 'node-type:retired');

      insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
      values ('csub-active', 'physical-device', 'multiple');

      insert into parameter_catalog.catalog_node_types (subject_id, family)
      values ('csub-retired', 'device');

      insert into parameter_catalog.catalog_release_subjects (
        release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
      ) values
        ('crel-a', 'csub-active', 'active', '{}', '{}', null),
        ('crel-a', 'csub-retired', 'retired', '{}', '{}', '{"reason":"withdrawn"}');

      insert into parameter_catalog.catalog_materializations (
        release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
      ) values ('crel-a', 'sha256:compiled-fp-a', 'sha256:database-fp-a', 'attempt-a', 'audit-a');

      insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
      values (true, 'crel-a');

      set constraints all immediate;
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

describe.skipIf(!databaseAvailable)("transaction-local Catalog current-release guard", () => {
  let database: EphemeralTestDatabase;
  let primary: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("pcatguard");
    primary = await connect(database.url);
    await seedCurrentRelease(primary);
  });

  afterEach(async () => {
    await primary?.end().catch(() => undefined);
    await database?.drop();
  });

  it("is an execute-only void SECURITY DEFINER function with a fixed safe search path", async () => {
    const result = await primary.query<{
      return_type: string;
      security_definer: boolean;
      config: string[];
      public_execute: boolean;
    }>(`
      select
        pg_catalog.format_type(proc.prorettype, null) as return_type,
        proc.prosecdef as security_definer,
        proc.proconfig as config,
        pg_catalog.has_function_privilege(
          'public',
          'parameter_catalog.assert_catalog_subject_active(text,text,text,text)',
          'execute'
        ) as public_execute
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'parameter_catalog'
        and proc.proname = 'assert_catalog_subject_active'
    `);

    expect(result.rows).toEqual([
      {
        return_type: "void",
        security_definer: true,
        config: ["search_path=pg_catalog, parameter_catalog"],
        public_execute: false
      }
    ]);
  });

  it("returns success only for the exact current release pin and active Subject", async () => {
    await expect(
      primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        ["crel-a", "sha256:release-a", "csub-active", "active"]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it.each([
    {
      name: "Subject membership",
      setupSql: `
        begin;
        insert into parameter_catalog.catalog_subjects (id, kind, canonical_key)
        values ('csub-late', 'node-type', 'node-type:late');
        insert into parameter_catalog.catalog_node_types (subject_id, family)
        values ('csub-late', 'device');
        set constraints all immediate;
        commit
      `,
      mutationSql: `
        insert into parameter_catalog.catalog_release_subjects (
          release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
        ) values ('crel-a', 'csub-late', 'active', '{}', '{}', null)
      `,
      residueSql: "select count(*)::text as count from parameter_catalog.catalog_release_subjects where release_id = 'crel-a' and subject_id = 'csub-late'"
    },
    {
      name: "Subject alias membership",
      setupSql: `
        insert into parameter_catalog.catalog_subject_aliases (
          id, subject_id, selector_kind, normalized_selector
        ) values ('calias-late', 'csub-active', 'driver-compatible', 'late,selector')
      `,
      mutationSql: `
        insert into parameter_catalog.catalog_release_subject_aliases (
          release_id, subject_id, alias_id, lifecycle, selector_provenance, tombstone_provenance
        ) values ('crel-a', 'csub-active', 'calias-late', 'active', '{}', null)
      `,
      residueSql: "select count(*)::text as count from parameter_catalog.catalog_release_subject_aliases where release_id = 'crel-a' and alias_id = 'calias-late'"
    },
    {
      name: "Definition revision",
      setupSql: `
        begin;
        insert into parameter_catalog.catalog_releases (
          id, release_version, release_digest, compiled_model_digest, toolchain_digest
        ) values ('crel-late', 'late', 'sha256:release-late', 'sha256:compiled-late', 'sha256:toolchain-late');
        insert into parameter_catalog.parameter_definitions (
          id, subject_id, property_key, current_revision_id
        ) values ('pdef-late', 'csub-active', 'late-property', 'drev-late');
        insert into parameter_catalog.definition_revisions (
          id, definition_id, revision_number, catalog_release_id, content_digest, content
        ) values ('drev-late', 'pdef-late', 1, 'crel-late', 'sha256:drev-late', '{}');
        set constraints all immediate;
        commit
      `,
      mutationSql: `
        insert into parameter_catalog.definition_revisions (
          id, definition_id, revision_number, catalog_release_id, content_digest, content
        ) values ('drev-late-sealed', 'pdef-late', 2, 'crel-a', 'sha256:drev-late-sealed', '{}')
      `,
      residueSql: "select count(*)::text as count from parameter_catalog.definition_revisions where id = 'drev-late-sealed'"
    },
    {
      name: "Definition head",
      setupSql: `
        begin;
        insert into parameter_catalog.catalog_releases (
          id, release_version, release_digest, compiled_model_digest, toolchain_digest
        ) values ('crel-late', 'late', 'sha256:release-late', 'sha256:compiled-late', 'sha256:toolchain-late');
        insert into parameter_catalog.parameter_definitions (
          id, subject_id, property_key, current_revision_id
        ) values ('pdef-late', 'csub-active', 'late-property', 'drev-late');
        insert into parameter_catalog.definition_revisions (
          id, definition_id, revision_number, catalog_release_id, content_digest, content
        ) values ('drev-late', 'pdef-late', 1, 'crel-late', 'sha256:drev-late', '{}');
        set constraints all immediate;
        commit
      `,
      mutationSql: `
        insert into parameter_catalog.catalog_release_definition_heads (
          release_id, definition_id, revision_id
        ) values ('crel-a', 'pdef-late', 'drev-late')
      `,
      residueSql: "select count(*)::text as count from parameter_catalog.catalog_release_definition_heads where release_id = 'crel-a' and definition_id = 'pdef-late'"
    }
  ])("rejects a post-materialization $name append without changing the exact guard", async ({
    setupSql,
    mutationSql,
    residueSql
  }) => {
    await primary.query(setupSql);
    await primary.query("begin");
    const error = await captureDatabaseError(primary.query(mutationSql));
    expect(error.code).toBe("55000");
    expect(error.constraint).toBe("catalog_release_sealed_ck");
    await primary.query("rollback");

    const residue = await primary.query<{ count: string }>(residueSql);
    expect(residue.rows[0]?.count).toBe("0");
    await expect(
      primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        ["crel-a", "sha256:release-a", "csub-active", "active"]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    const release = await primary.query<{ release_digest: string }>(
      "select release_digest from parameter_catalog.catalog_releases where id = 'crel-a'"
    );
    expect(release.rows).toEqual([{ release_digest: "sha256:release-a" }]);
  });

  it.each([
    {
      name: "stale release pin",
      input: ["crel-stale", "sha256:release-a", "csub-active", "active"],
      sqlState: "PCA01",
      detail: "PCAT-GUARD-RELEASE-MISMATCH"
    },
    {
      name: "stale release digest",
      input: ["crel-a", "sha256:release-stale", "csub-active", "active"],
      sqlState: "PCA01",
      detail: "PCAT-GUARD-RELEASE-MISMATCH"
    },
    {
      name: "unknown Subject",
      input: ["crel-a", "sha256:release-a", "csub-unknown", "active"],
      sqlState: "PCA02",
      detail: "PCAT-GUARD-SUBJECT-NOT-PUBLISHED"
    },
    {
      name: "retired Subject",
      input: ["crel-a", "sha256:release-a", "csub-retired", "active"],
      sqlState: "PCA03",
      detail: "PCAT-GUARD-SUBJECT-RETIRED"
    },
    {
      name: "malformed scalar",
      input: [" crel-a", "sha256:release-a", "csub-active", "active"],
      sqlState: "PCA04",
      detail: "PCAT-GUARD-DRIFT"
    },
    {
      name: "unsupported expected lifecycle",
      input: ["crel-a", "sha256:release-a", "csub-active", "retired"],
      sqlState: "PCA04",
      detail: "PCAT-GUARD-DRIFT"
    },
    {
      name: "null scalar",
      input: ["crel-a", "sha256:release-a", null, "active"],
      sqlState: "PCA04",
      detail: "PCAT-GUARD-DRIFT"
    }
  ])("serializes $name as a stable SQLSTATE/detail pair", async ({ input, sqlState, detail }) => {
    const error = await captureDatabaseError(
      primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        input
      )
    );

    expect(error.code).toBe(sqlState);
    expect(error.detail).toBe(detail);
  });

  it("makes shared guard and exclusive pointer locks mutually exclusive until transaction end", async () => {
    const contender = await connect(database.url);
    try {
      await primary.query("begin");
      await primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        ["crel-a", "sha256:release-a", "csub-active", "active"]
      );

      await contender.query("begin");
      const startedAt = Date.now();
      const error = await captureDatabaseError(
        contender.query(`
          update parameter_catalog.catalog_state
          set current_catalog_release_id = current_catalog_release_id
        `)
      );
      expect(error.code).toBe("PCA05");
      expect(error.detail).toBe("PCAT-GUARD-SYNCHRONIZATION-BUSY");
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
      expect(Date.now() - startedAt).toBeLessThan(3_500);
      await contender.query("rollback");

      await primary.query("rollback");
      await contender.query("begin");
      await expect(
        contender.query("select parameter_catalog.acquire_current_pointer_lock_exclusive()")
      ).resolves.toMatchObject({ rowCount: 1 });
      await contender.query("rollback");
    } finally {
      await primary.query("rollback").catch(() => undefined);
      await contender.query("rollback").catch(() => undefined);
      await contender.end();
    }
  });

  it("lets the same exclusive pointer update continue after the shared guard transaction ends", async () => {
    const contender = await connect(database.url);
    try {
      await primary.query("begin");
      await primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        ["crel-a", "sha256:release-a", "csub-active", "active"]
      );

      await contender.query("begin");
      const pointerAttempt = contender
        .query(`
          update parameter_catalog.catalog_state
          set current_catalog_release_id = current_catalog_release_id
        `)
        .then(
          (result) => ({ result, error: null }),
          (error: pg.DatabaseError) => ({ result: null, error })
        );
      await waitForAdvisoryLockWait(primary, contender.processID);

      await primary.query("commit");

      await expect(pointerAttempt).resolves.toMatchObject({
        result: { rowCount: 1 },
        error: null
      });
      await contender.query("rollback");
    } finally {
      await primary.query("rollback").catch(() => undefined);
      await contender.query("rollback").catch(() => undefined);
      await contender.end();
    }
  });

  it("releases an exclusive pointer lock on rollback and leaves zero candidate residue", async () => {
    const guardSession = await connect(database.url);
    try {
      await primary.query("begin");
      await primary.query("select parameter_catalog.acquire_current_pointer_lock_exclusive()");
      await primary.query(`
        insert into parameter_catalog.catalog_releases (
          id, release_version, release_digest, predecessor_release_id,
          compiled_model_digest, toolchain_digest
        ) values (
          'crel-b', '2.0.0', 'sha256:release-b', 'crel-a',
          'sha256:compiled-b', 'sha256:toolchain-b'
        );

        insert into parameter_catalog.catalog_release_subjects (
          release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
        ) values
          ('crel-b', 'csub-active', 'retired', '{}', '{}', '{"reason":"withdrawn"}'),
          ('crel-b', 'csub-retired', 'retired', '{}', '{}', '{"reason":"still-retired"}');

        insert into parameter_catalog.catalog_materializations (
          release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
        ) values ('crel-b', 'sha256:compiled-fp-b', 'sha256:database-fp-b', 'attempt-b', 'audit-b');

        update parameter_catalog.catalog_state
        set current_catalog_release_id = 'crel-b';

        set constraints all immediate;
      `);

      const guardAttempt = guardSession
        .query(
          "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
          ["crel-a", "sha256:release-a", "csub-active", "active"]
        )
        .then(
          (result) => ({ result, error: null }),
          (error: pg.DatabaseError) => ({ result: null, error })
        );
      await waitForAdvisoryLockWait(primary, guardSession.processID);

      await primary.query("rollback");

      await expect(guardAttempt).resolves.toMatchObject({
        result: { rowCount: 1 },
        error: null
      });

      const state = await guardSession.query<{ current_catalog_release_id: string }>(
        "select current_catalog_release_id from parameter_catalog.catalog_state"
      );
      const residue = await guardSession.query<{ count: string }>(
        "select count(*)::text as count from parameter_catalog.catalog_releases where id = 'crel-b'"
      );
      expect(state.rows[0]?.current_catalog_release_id).toBe("crel-a");
      expect(residue.rows[0]?.count).toBe("0");
    } finally {
      await primary.query("rollback").catch(() => undefined);
      await guardSession.end();
    }
  });

  it("waits for a pointer commit and reports retirement from the newly current release", async () => {
    const guardSession = await connect(database.url);
    try {
      await primary.query("begin");
      await primary.query("select parameter_catalog.acquire_current_pointer_lock_exclusive()");
      await primary.query(`
        insert into parameter_catalog.catalog_releases (
          id, release_version, release_digest, predecessor_release_id,
          compiled_model_digest, toolchain_digest
        ) values (
          'crel-retirement', '2.0.0-retirement', 'sha256:release-retirement', 'crel-a',
          'sha256:compiled-retirement', 'sha256:toolchain-retirement'
        );

        insert into parameter_catalog.catalog_release_subjects (
          release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
        ) values
          ('crel-retirement', 'csub-active', 'retired', '{}', '{}', '{"reason":"withdrawn"}'),
          ('crel-retirement', 'csub-retired', 'retired', '{}', '{}', '{"reason":"still-retired"}');

        insert into parameter_catalog.catalog_materializations (
          release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
        ) values (
          'crel-retirement', 'sha256:compiled-fp-retirement', 'sha256:database-fp-retirement',
          'attempt-retirement', 'audit-retirement'
        );

        update parameter_catalog.catalog_state
        set current_catalog_release_id = 'crel-retirement';

        set constraints all immediate;
      `);

      const guardAttempt = guardSession
        .query(
          "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
          ["crel-retirement", "sha256:release-retirement", "csub-active", "active"]
        )
        .then(
          (result) => ({ result, error: null }),
          (error: pg.DatabaseError) => ({ result: null, error })
        );
      await waitForAdvisoryLockWait(primary, guardSession.processID);

      await primary.query("commit");

      const outcome = await guardAttempt;
      expect(outcome.result).toBeNull();
      expect(outcome.error?.code).toBe("PCA03");
      expect(outcome.error?.detail).toBe("PCAT-GUARD-SUBJECT-RETIRED");

      const state = await guardSession.query<{ current_catalog_release_id: string }>(
        "select current_catalog_release_id from parameter_catalog.catalog_state"
      );
      expect(state.rows[0]?.current_catalog_release_id).toBe("crel-retirement");
    } finally {
      await primary.query("rollback").catch(() => undefined);
      await guardSession.end();
    }
  });
});
