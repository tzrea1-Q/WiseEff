import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { QueryResult } from "../shared/database/client";
import { applyMigrations } from "../shared/database/migrations";
import { provisionPublicationRuntimeLogins } from "../modules/catalog-publication/runtime/provisionRuntimeLogins";
import { provisionPublicationRuntimeLogins as provisionLabRuntimeLogins } from "./labRuntimeLogins";
import { isEphemeralTestDatabaseName } from "../modules/catalog-publication/authorization";
import { applyTestMigrations, migrationsDir, withAdminClient, withTempDatabase } from "./tempDatabase";
import { readCanonicalSchemaFingerprint } from "./parameterCatalog";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  createSerializedTestQueryable,
  dropTestDatabase,
  hasTestClusterRoleCatalogLock,
  isTestDatabaseAvailable,
  testDatabasePrefixPattern,
  withTestClusterRoleCatalogLock,
  type InMemoryTestDatabase
} from "./testDatabase";

describe("test database query scheduling", () => {
  it("routes server test migration imports through the cluster lease wrapper", () => {
    expect(applyMigrations).toBe(applyTestMigrations);
    expect(provisionPublicationRuntimeLogins).toBe(provisionLabRuntimeLogins);
  });

  it("serializes concurrent service queries on the transaction client", async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    const execute = vi.fn(async <Row>(text: string): Promise<QueryResult<Row>> => {
      activeQueries += 1;
      maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      activeQueries -= 1;
      return { rows: [{ text }] as Row[], rowCount: 1 };
    });
    const queryable = createSerializedTestQueryable(execute);

    const results = await Promise.all([
      queryable.query<{ text: string }>("first"),
      queryable.query<{ text: string }>("second"),
      queryable.query<{ text: string }>("third")
    ]);

    expect(maximumConcurrentQueries).toBe(1);
    expect(results.map((result) => result.rows[0]?.text)).toEqual(["first", "second", "third"]);
  });
});

const databaseAvailable = await isTestDatabaseAvailable();

describe("literal test database namespace isolation", () => {
  it("preserves unique suffixes within PostgreSQL's identifier limit for a maximum-length lane", async () => {
    vi.stubEnv("WISEEFF_TEST_DATABASE_PREFIX", "t1080ci2_maximum");
    vi.stubEnv("WISEEFF_TEST_RUN_TOKEN", "r1234567");
    vi.resetModules();
    let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>> | undefined;
    let second: Awaited<ReturnType<typeof createEphemeralTestDatabase>> | undefined;
    try {
      const { createEphemeralTestDatabase: createMaximumLaneDatabase, teardownTestDatabaseRun } = await import("./testDatabase");
      database = await createMaximumLaneDatabase("longlabel");
      const name = new URL(database.url).pathname.slice(1);
      expect(name.length).toBeLessThanOrEqual(63);
      expect(isEphemeralTestDatabaseName(name)).toBe(true);
      second = await createMaximumLaneDatabase("longlabel");
      expect(second.url).not.toBe(database.url);
      expect(new URL(second.url).pathname.slice(1).length).toBeLessThanOrEqual(63);
      const client = new pg.Client({ connectionString: database.url });
      await client.connect();
      try {
        expect((await client.query("select current_database() as name")).rows).toEqual([{ name }]);
      } finally {
        await client.end();
      }
      await teardownTestDatabaseRun();
      await withAdminClient(async (admin) => {
        expect((await admin.query("select datname from pg_database where datname = any($1)",
          [[name, new URL(second!.url).pathname.slice(1)]])).rows).toEqual([]);
      });
    } finally {
      await second?.drop();
      await database?.drop();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("keeps maximum-length worker names within PostgreSQL's identifier limit before DDL", async () => {
    vi.stubEnv("WISEEFF_TEST_DATABASE_PREFIX", "t1080ci2_maximum");
    vi.stubEnv("WISEEFF_TEST_RUN_TOKEN", "r1234567");
    vi.stubEnv("VITEST_POOL_ID", "1234567");
    vi.resetModules();
    const original = pg.Client.prototype.query;
    let workerName: string | undefined;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, sql: unknown, values?: unknown) {
      if (typeof sql === "string" && sql.startsWith("create database wiseeff_test_wk_16_t1080ci2_maximum_")) {
        workerName = sql.split(" ")[2];
        return Promise.reject(new Error("stop before worker DDL"));
      }
      return Reflect.apply(original, this, [sql, values]);
    } as typeof original);
    try {
      const { resolveWorkerDatabaseUrl } = await import("./testDatabase");
      await expect(resolveWorkerDatabaseUrl()).rejects.toThrow("stop before worker DDL");
      expect(workerName).toBeDefined();
      expect(workerName!.length).toBeLessThanOrEqual(63);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("keeps lane-isolated database names eligible for the unchanged publication test policy", async () => {
    const database = await createEphemeralTestDatabase("policy");
    try {
      const name = new URL(database.url).pathname.slice(1);
      const prefix = process.env.WISEEFF_TEST_DATABASE_PREFIX?.trim() || "wiseeff";
      expect(isEphemeralTestDatabaseName(name)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(63);
      const namespace = `wiseeff_test_wk_${prefix.length}_${prefix}_`;
      expect(name.startsWith(namespace)).toBe(true);
      const foreign = name.replace(namespace, `wiseeff_test_wk_${prefix.length + 2}_${prefix}_x_`);
      await withAdminClient(async (admin) => {
        expect((await admin.query("select datname from unnest($1::text[]) as fixture(datname) where datname like $2",
          [[name, foreign], testDatabasePrefixPattern(namespace)])).rows).toEqual([{ datname: name }]);
      });
    } finally {
      await database.drop();
    }
  });

  it.each(["tpl", "wk"])("matches only the literal %s namespace on PostgreSQL", async (kind) => {
    expect(databaseAvailable).toBe(true);
    const prefix = process.env.WISEEFF_TEST_DATABASE_PREFIX?.trim() || "wiseeff";
    const owned = `${prefix}_a_b_test_${kind}_probe`;
    const foreign = `${prefix}_axb_test_${kind}_probe`;
    await withAdminClient(async (admin) => {
      const result = await admin.query<{ datname: string }>(
        "select datname from unnest($1::text[]) as fixture(datname) where datname like $2 order by datname",
        [[owned, foreign], testDatabasePrefixPattern(`${prefix}_a_b_test_${kind}_`)],
      );
      expect(result.rows).toEqual([{ datname: owned }]);
    });
  });

  it("keeps temporary template builds in the configured namespace before any DDL", async () => {
    expect(databaseAvailable).toBe(true);
    const prefix = process.env.WISEEFF_TEST_DATABASE_PREFIX?.trim() || "wiseeff";
    const original = pg.Client.prototype.query;
    let buildName: string | undefined;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, sql: unknown, values?: unknown) {
      if (typeof sql === "string" && Array.isArray(values)) {
        if (sql.includes("select true as ok from pg_database") && String(values[0]).startsWith(`${prefix}_test_tpl_`)) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes("from pg_stat_activity where datname = $1") && String(values[0]).includes("_test_tplbuild_")) {
          buildName = String(values[0]);
          return Promise.reject(new Error("stop before template DDL"));
        }
      }
      return Reflect.apply(original, this, [sql, values]);
    } as typeof original);
    try {
      await expect(createEphemeralTestDatabase("prefix")).rejects.toThrow("stop before template DDL");
      expect(buildName).toBe(`${prefix}_test_tplbuild_${process.pid}`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe.skipIf(!databaseAvailable)("test database fixture transactions", () => {
  let db: InMemoryTestDatabase | undefined;

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("commits nested transactions and rolls back only the failing inner scope", async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`create temporary table fixture_tx_rows (label text) on commit drop`);

    await db.transaction(async (tx) => {
      await tx.query(`insert into fixture_tx_rows (label) values ('outer')`);
      await tx
        .transaction(async (inner) => {
          await inner.query(`insert into fixture_tx_rows (label) values ('inner')`);
          throw new Error("inner failure");
        })
        .catch(() => undefined);
      await tx.query(`insert into fixture_tx_rows (label) values ('after')`);
    });

    const rows = await db.query<{ label: string }>(`select label from fixture_tx_rows order by label`);
    expect(rows.rows.map((row) => row.label)).toEqual(["after", "outer"]);
  });

  it("rolls back a failed service transaction without aborting the fixture session", async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`create temporary table fixture_tx_rows (label text) on commit drop`);

    await expect(
      db.transaction(async (tx) => {
        await tx.query(`insert into fixture_tx_rows (label) values ('doomed')`);
        // Force a real Postgres error so the transaction enters the aborted state.
        await tx.query(`select * from fixture_missing_table`);
      })
    ).rejects.toThrow();

    // The savepoint rollback must recover the session: further queries succeed
    // and the doomed write is gone.
    const rows = await db.query<{ label: string }>(`select label from fixture_tx_rows`);
    expect(rows.rows).toEqual([]);
  });

  it("keeps ephemeral committed writes off the shared worker rollback fixture", async () => {
    const ephemeral = await createEphemeralTestDatabase("pollute");
    const client = new pg.Client({ connectionString: ephemeral.url });
    await client.connect();
    try {
      await client.query(
        `insert into organizations (id, name) values ('org-eph-leak', 'Eph Leak')`
      );
    } finally {
      await client.end();
    }

    db = await createInMemoryTestDatabase();
    try {
      const leaked = await db.query<{ id: string }>(
        `select id from organizations where id = 'org-eph-leak'`
      );
      expect(leaked.rows).toEqual([]);
    } finally {
      await ephemeral.drop();
    }
  });

  it("waits for a closing client before dropping its ephemeral database", async () => {
    const ephemeral = await createEphemeralTestDatabase("closing");
    const client = new pg.Client({ connectionString: ephemeral.url });
    const errors: string[] = [];
    client.on("error", (error) => errors.push((error as Error & { code?: string }).code ?? error.message));
    await client.connect();
    const close = new Promise<void>((resolve, reject) => {
      setTimeout(() => void client.end().then(resolve, reject), 200);
    });

    try {
      await ephemeral.drop();
      await close;
      expect(errors).toEqual([]);
    } finally {
      await close;
      await ephemeral.drop();
    }
  });

  it("waits for a closing client in the temporary database helper", async () => {
    const errors: string[] = [];
    let close: Promise<void> | undefined;
    await withTempDatabase({ prefix: "cleanup_race", migrate: false }, async ({ connectionString }) => {
      const client = new pg.Client({ connectionString });
      client.on("error", (error) => errors.push((error as Error & { code?: string }).code ?? error.message));
      await client.connect();
      close = new Promise<void>((resolve, reject) => {
        setTimeout(() => void client.end().then(resolve, reject), 200);
      });
    });
    await close;
    expect(errors).toEqual([]);
  });

  it("reports the blocking connection and permits a later safe drop", async () => {
    const ephemeral = await createEphemeralTestDatabase("timeout");
    const client = new pg.Client({ connectionString: ephemeral.url });
    await client.connect();
    const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
    try {
      await expect(ephemeral.drop()).rejects.toThrow(new RegExp(`Timed out waiting to drop test database .*${pid}`));
      expect((await client.query("select 1")).rowCount).toBe(1);
    } finally {
      await client.end();
      await ephemeral.drop();
    }
  });

  it("reports a connection that arrives between observation and drop", async () => {
    const ephemeral = await createEphemeralTestDatabase("lateconn");
    const name = new URL(ephemeral.url).pathname.slice(1);
    const adminUrl = new URL(ephemeral.url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    const late = new pg.Client({ connectionString: ephemeral.url });
    await admin.connect();
    let injected = false;
    let latePid = 0;
    let close: Promise<void> | undefined;
    const gatedAdmin = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        if (text.startsWith("drop database") && !injected) {
          injected = true;
          await late.connect();
          latePid = (await late.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
          close = new Promise<void>((resolve, reject) => {
            setTimeout(() => void late.end().then(resolve, reject), 6_000);
          });
        }
        return admin.query<Row>(text, values);
      }
    } as pg.Client;
    try {
      const dropError = await dropTestDatabase(gatedAdmin, name).then(() => null, (error: Error) => error);
      expect(dropError?.message).toMatch(new RegExp(`Timed out waiting to drop test database .*${latePid}`));
      expect(injected).toBe(true);
    } finally {
      await close;
      await admin.end();
      await ephemeral.drop();
    }
  });

  it("retries a transient late connection within the cleanup deadline", async () => {
    const ephemeral = await createEphemeralTestDatabase("lateclose");
    const name = new URL(ephemeral.url).pathname.slice(1);
    const adminUrl = new URL(ephemeral.url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    const late = new pg.Client({ connectionString: ephemeral.url });
    await admin.connect();
    let injected = false;
    let close: Promise<void> | undefined;
    const gatedAdmin = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        if (text.startsWith("drop database") && !injected) {
          injected = true;
          await late.connect();
          close = new Promise<void>((resolve, reject) => {
            setTimeout(() => void late.end().then(resolve, reject), 200);
          });
          throw Object.assign(new Error("database is being accessed by other users"), { code: "55006" });
        }
        return admin.query<Row>(text, values);
      }
    } as pg.Client;
    try {
      await dropTestDatabase(gatedAdmin, name);
      expect(injected).toBe(true);
    } finally {
      await close;
      await admin.end();
      await ephemeral.drop();
    }
  });
});

describe.skipIf(!databaseAvailable)("explicit migrated template fixtures", () => {
  it("uses a new fingerprint for changed SQL and never publishes a failed build", async () => {
    const prefix = process.env.WISEEFF_TEST_DATABASE_PREFIX?.trim() || "wiseeff";
    const last = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort().at(-1)!;
    const sqlPath = path.join(migrationsDir, last);
    const readFile = fs.readFile;
    let originalUrl = "";
    const original = await createEphemeralTestDatabase("fingerprintold");
    originalUrl = original.url;
    await original.drop();
    for (const [suffix, fails] of [["\n-- test fingerprint successor\n", false], ["\nselect * from template_build_failure_probe;\n", true]] as const) {
      const hash = createHash("sha256");
      for (const file of (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
        hash.update(file).update("\0").update(await readFile(path.join(migrationsDir, file), "utf8"));
        if (file === last) hash.update(suffix);
        hash.update("\0");
      }
      const fingerprint = hash.digest("hex").slice(0, 12);
      const ownedNames = [`${prefix}_test_tpl_${fingerprint}`, `${prefix}_test_tplbuild_${process.pid}`];
      if (fails) await withAdminClient(async (admin) => {
        expect((await admin.query("select datname from pg_database where datname=any($1::text[])", [ownedNames])).rows).toEqual([]);
      });
      const spy = vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof readFile>) => {
        const result = await readFile(...args);
        return args[0] === sqlPath && args[1] === "utf8" ? `${result}${suffix}` : result;
      });
      vi.resetModules();
      try {
        const { createEphemeralTestDatabase: changed } = await import("./testDatabase");
        if (fails) {
          await expect(changed("fingerprintbad")).rejects.toMatchObject({ code: "42P01" });
          await withAdminClient(async (admin) => {
            expect((await admin.query("select datname from pg_database where datname=any($1::text[])", [ownedNames])).rows).toEqual([]);
            expect((await admin.query("select pid from pg_stat_activity where datname=any($1::text[])", [ownedNames])).rows).toEqual([]);
          });
        } else {
          const next = await changed("fingerprintnew");
          try {
            expect(new URL(next.url).pathname).toContain(`_${fingerprint}_`);
            expect(new URL(originalUrl).pathname).not.toContain(`_${fingerprint}_`);
            const client = new pg.Client({ connectionString: next.url });
            await client.connect();
            try { expect((await client.query("select name from schema_migrations order by name desc limit 1")).rows).toEqual([{ name: last }]); }
            finally { await client.end(); }
          } finally { await next.drop(); }
        }
      } finally { spy.mockRestore(); vi.resetModules(); }
    }
  });

  it("keeps real fresh execution and the empty upgrade path distinct from a complete clone", async () => {
    let cloneReceipts: unknown[] = [];
    let cloneOrganizations: unknown[] = [];
    let cloneAcl: unknown[] = [];
    let cloneSchema = "";
    const acl = async (db: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => (await db.query(`
      select 'relation' as kind, n.nspname::text as schema, c.relname::text as name,
             pg_get_userbyid(c.relowner) as owner, c.relacl::text as acl
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','parameter_catalog','catalog_publication')
      union all
      select 'function', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             pg_get_userbyid(p.proowner), p.proacl::text
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','parameter_catalog','catalog_publication')
      union all
      select 'column', n.nspname, c.relname || '.' || a.attname,
             pg_get_userbyid(c.relowner), a.attacl::text
        from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','parameter_catalog','catalog_publication') and a.attnum>0 and not a.attisdropped
      union all
      select 'schema', n.nspname, '', pg_get_userbyid(n.nspowner), n.nspacl::text
        from pg_namespace n where n.nspname in ('public','parameter_catalog','catalog_publication')
      union all
      select 'database', '', '', pg_get_userbyid(d.datdba), d.datacl::text
        from pg_database d where d.datname=current_database()
      union all
      select 'default', coalesce(n.nspname,''), pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text,
             pg_get_userbyid(d.defaclrole), d.defaclacl::text
        from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
      union all
      select 'constraint', n.nspname, c.relname || '.' || k.conname,
             pg_get_userbyid(c.relowner), pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','parameter_catalog','catalog_publication')
      union all
      select 'trigger', n.nspname, c.relname || '.' || case when t.tgisinternal
               then coalesce(k.conname,t.tgname) || ':' || p.proname || ':' || t.tgtype::text else t.tgname end,
             pg_get_userbyid(c.relowner), case when t.tgisinternal
               then replace(pg_get_triggerdef(t.oid), quote_ident(t.tgname), quote_ident('internal_' || coalesce(k.conname,t.tgname) || '_' || p.proname || '_' || t.tgtype::text))
               else pg_get_triggerdef(t.oid) end
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        join pg_proc p on p.oid=t.tgfoid left join pg_constraint k on k.oid=t.tgconstraint
       where n.nspname in ('public','parameter_catalog','catalog_publication')
      order by 1,2,3,4,5
    `)).rows;
    await withTempDatabase({ prefix: "tplcompare", migrate: "template" }, async ({ db, connectionString }) => {
      cloneReceipts = (await db.query("select name, checksum from schema_migrations order by name")).rows;
      cloneOrganizations = (await db.query("select id,name from organizations order by id")).rows;
      cloneAcl = await acl(db);
      const constraintNames = (await db.query<{ name: string }>(`
        select c.relname::text || '.' || k.conname::text as name
          from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='catalog_publication' order by name
      `)).rows.map(({ name }) => name);
      expect(constraintNames.some((name) => name.length > 63)).toBe(true);
      expect((cloneAcl as { kind: string; schema: string; name: string }[])
        .filter((row) => row.kind === "constraint" && row.schema === "catalog_publication")
        .map(({ name }) => name)).toEqual(constraintNames);
      cloneSchema = await readCanonicalSchemaFingerprint(connectionString);
    });
    await withTempDatabase({ prefix: "freshcompare" }, async ({ db, connectionString }) => {
      expect((await db.query("select name, checksum from schema_migrations order by name")).rows).toEqual(cloneReceipts);
      expect((await db.query("select id,name from organizations order by id")).rows).toEqual(cloneOrganizations);
      expect(await acl(db)).toEqual(cloneAcl);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(cloneSchema);
    });
    await withTempDatabase({ prefix: "emptycompare", migrate: false }, async ({ db, connectionString }) => {
      expect((await db.query("select to_regclass('public.schema_migrations') as migrations")).rows).toEqual([{ migrations: null }]);
      expect(await applyTestMigrations(db, migrationsDir, { through: "0001_m0_foundation.sql" })).toEqual(["0001_m0_foundation.sql"]);
      expect((await applyTestMigrations(db, migrationsDir)).length).toBeGreaterThan(0);
      expect((await db.query("select name, checksum from schema_migrations order by name")).rows).toEqual(cloneReceipts);
      expect(await acl(db)).toEqual(cloneAcl);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(cloneSchema);
    });
  });

  it("gives two complete fixtures separate committed business state", async () => {
    await withTempDatabase({ prefix: "tplfirst", migrate: "template" }, async ({ db: first, connectionString: firstUrl }) => {
      await first.query("insert into organizations (id,name) values ('tpl-owned','first clone')");
      await withTempDatabase({ prefix: "tplsecond", migrate: "template" }, async ({ db: second, connectionString: secondUrl }) => {
        expect(secondUrl).not.toBe(firstUrl);
        expect((await second.query("select id from organizations where id='tpl-owned'")).rows).toEqual([]);
        expect((await first.query("select id from organizations where id='tpl-owned'")).rows).toEqual([{ id: "tpl-owned" }]);
      });
    });
  });

  it("cleans an exclusive clone after callback and connection setup failures", async () => {
    let name = "";
    await expect(withTempDatabase({ prefix: "tplthrow", migrate: "template" }, async ({ db, connectionString }) => {
      name = new URL(connectionString).pathname.slice(1);
      await db.query("insert into organizations (id,name) values ('tpl-throw','must not leak')");
      throw new Error("template callback probe");
    })).rejects.toThrow("template callback probe");
    await withAdminClient(async (admin) => {
      expect((await admin.query("select datname from pg_database where datname=$1", [name])).rows).toEqual([]);
      expect((await admin.query("select pid from pg_stat_activity where datname=$1", [name])).rows).toEqual([]);
    });
    const original = pg.Client.prototype.connect;
    const spy = vi.spyOn(pg.Client.prototype, "connect").mockImplementation(function (this: pg.Client) {
      if (this.database?.includes("_esetupf_")) {
        name = this.database;
        return Promise.reject(new Error("template connect probe"));
      }
      return original.call(this);
    });
    try {
      await expect(withTempDatabase({ prefix: "setupf", migrate: "template" }, async () => {
        throw new Error("callback must not run");
      })).rejects.toThrow("template connect probe");
    } finally { spy.mockRestore(); }
    await withAdminClient(async (admin) => {
      expect((await admin.query("select datname from pg_database where datname=$1", [name])).rows).toEqual([]);
      expect((await admin.query("select pid from pg_stat_activity where datname=$1", [name])).rows).toEqual([]);
    });
  });

  it("borrows only the active outer lease without unlocking it or permitting nested lifecycles", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      await Promise.all(["outertpl1", "outertpl2"].map((prefix) =>
        withTempDatabase({ prefix, migrate: "template" }, async ({ db }) => {
          expect((await db.query("select count(*)::int as n from schema_migrations")).rows[0].n).toBeGreaterThan(0);
        })
      ));
      await expect(withTestClusterRoleCatalogLock(async () => undefined)).rejects.toThrow("Nested test cluster role catalog lease");
      await withAdminClient(async (observer) => {
        expect((await observer.query("select pg_try_advisory_lock($1) as acquired", [4_201_659])).rows).toEqual([{ acquired: false }]);
      });
    });
    await expect(withTestClusterRoleCatalogLock(async () => "released")).resolves.toBe("released");
  });

  it("preserves default fresh role guards when a cluster role is invalid", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      await withAdminClient(async (admin) => {
        await admin.query("alter role catalog_legacy_identity_reader_role login");
        try {
          await expect(withTempDatabase({ prefix: "freshguard" }, async () => {
            throw new Error("callback must not run");
          })).rejects.toMatchObject({ code: "P0001" });
        } finally { await admin.query("alter role catalog_legacy_identity_reader_role nologin"); }
        expect((await admin.query("select rolcanlogin from pg_roles where rolname='catalog_legacy_identity_reader_role'")).rows).toEqual([{ rolcanlogin: false }]);
        expect((await admin.query("select datname from pg_database where datname like 'wiseeff_freshguard_%'")).rows).toEqual([]);
      });
    });
  });

  it("makes an expired inherited lease reacquire the lock behind the current owner", async () => {
    let resume!: () => void;
    let inherited!: Promise<void>;
    let entered = false;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    await withTestClusterRoleCatalogLock(async () => {
      inherited = gate.then(() => withTempDatabase({ prefix: "expiredtpl", migrate: "template" }, async () => {
        entered = true;
      }));
    });
    await withTestClusterRoleCatalogLock(async () => {
      resume();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(entered).toBe(false);
    });
    await inherited;
    expect(entered).toBe(true);
  });

  it("retains the outer lease through an in-flight copy and its queued successor", async () => {
    let copied!: () => void, releaseFirst!: () => void, secondLookup!: () => void;
    const firstReady = new Promise<void>((resolve) => { copied = resolve; });
    const firstReturn = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondReached = new Promise<void>((resolve) => { secondLookup = resolve; });
    let secondCreated = false;
    let first!: ReturnType<typeof createEphemeralTestDatabase>, second!: ReturnType<typeof createEphemeralTestDatabase>;
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, sql: unknown, values?: unknown) {
      if (typeof sql === "string" && sql.startsWith("create database") && sql.includes("_equeone_")) {
        copied();
        return firstReturn.then(() => Reflect.apply(original, this, [sql, values]));
      }
      const result = Reflect.apply(original, this, [sql, values]);
      if (typeof sql === "string" && sql.includes("pg_database") && Array.isArray(values) && values[0]?.includes("_equetwo_")) {
        return result.then((value: unknown) => { secondLookup(); return value; });
      }
      if (typeof sql === "string" && sql.startsWith("create database") && sql.includes("_equetwo_")) secondCreated = true;
      return result;
    } as typeof original);
    try {
      let outerEnded = false;
      const outer = withTestClusterRoleCatalogLock(async () => {
        first = createEphemeralTestDatabase("queone");
        await firstReady;
        second = createEphemeralTestDatabase("quetwo");
        await secondReached;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }).then(() => { outerEnded = true; });
      await secondReached;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(outerEnded).toBe(false);
      expect(secondCreated).toBe(false);
      await withAdminClient(async (observer) => {
        expect((await observer.query("select pg_try_advisory_lock($1) as acquired", [4_201_659])).rows).toEqual([{ acquired: false }]);
      });
      releaseFirst();
      await outer;
      await second;
      expect(secondCreated).toBe(true);
    } finally {
      releaseFirst();
      spy.mockRestore();
      await (await first)?.drop();
      await (await second)?.drop();
    }
  });
});

describe.skipIf(!databaseAvailable)("cluster role lifecycle lease", () => {
  it("serializes role migrations across databases while ordinary queries remain parallel", async () => {
    await withTempDatabase({ prefix: "role_lease_a", migrate: false }, async ({ db: a }) => {
      await withTempDatabase({ prefix: "role_lease_b", migrate: false }, async ({ db: b }) => {
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const acquired = new Promise<void>((resolve) => { entered = resolve; });
        const first = withTestClusterRoleCatalogLock(async () => {
          entered();
          await expect(withTestClusterRoleCatalogLock(async () => undefined))
            .rejects.toThrow("Nested test cluster role catalog lease");
          await held;
        });
        await acquired;
        let secondEntered = false;
        const second = withTestClusterRoleCatalogLock(async () => { secondEntered = true; });
        try {
          expect((await Promise.all([a.query("select 1"), b.query("select 1")])).map((r) => r.rows))
            .toEqual([[{ "?column?": 1 }], [{ "?column?": 1 }]]);
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(secondEntered).toBe(false);
        } finally {
          release();
          await Promise.all([first, second]);
        }
        expect(secondEntered).toBe(true);
        const applied = await Promise.all([
          applyTestMigrations(a, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }),
          applyTestMigrations(b, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }),
        ]);
        expect(applied.map((names) => names.at(-1))).toEqual([
          "0180_mod_d02_offline_capture.sql",
          "0180_mod_d02_offline_capture.sql",
        ]);
        await withTestClusterRoleCatalogLock(async () => {
          expect(await applyTestMigrations(a, migrationsDir, { through: "0180_mod_d02_offline_capture.sql" }))
            .toEqual([]);
        });
      });
    });
  }, 180_000);

  it("releases the lease after a callback throws", async () => {
    await expect(withTestClusterRoleCatalogLock(async () => {
      throw new Error("lease probe");
    })).rejects.toThrow("lease probe");
    await expect(withTestClusterRoleCatalogLock(async () => "acquired")).resolves.toBe("acquired");
    let releaseProbe!: () => void;
    const gate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    let inheritedContext!: Promise<boolean>;
    await withTestClusterRoleCatalogLock(async () => {
      inheritedContext = gate.then(() => hasTestClusterRoleCatalogLock());
    });
    releaseProbe();
    expect(await inheritedContext).toBe(false);
  });
});
