import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

import { createEphemeralTestDatabase } from "../testDatabase";

/** Frozen S2-SCH canonical schema fingerprint consumed by this harness. */
export const S2_SCH_CONTRACT_FINGERPRINT =
  "f2ad57b2af5c6e0d50841284bacf5aff927dd1dbf09039099144e20216c82453";

const CATALOG_DATABASE_PREFIX = "wiseeff_pcat_";
const FAKE_ENGINE_PATTERN = /pglite|postgres-js|pg-mem|sqlite|:memory:|memory:\/\//i;

const USER_OBJECT_COUNT_SQL = `
with user_namespaces as (
  select oid
  from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    and nspname !~ '^pg_(temp|toast_temp)_'
), object_counts(value) as (
  values
    ((select count(*) from pg_namespace where oid in (select oid from user_namespaces) and nspname <> 'public')),
    ((select count(*) from pg_class where relnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_proc where pronamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_type where typnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_operator where oprnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_collation where collnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_conversion where connamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_ts_config where cfgnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_ts_dict where dictnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_ts_parser where prsnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_ts_template where tmplnamespace in (select oid from user_namespaces))),
    ((select count(*) from pg_extension where extname <> 'plpgsql')),
    ((select count(*) from pg_language where lanname not in ('internal', 'c', 'sql', 'plpgsql'))),
    ((select count(*) from pg_largeobject_metadata)),
    ((select count(*) from pg_event_trigger)),
    ((select count(*) from pg_publication)),
    ((select count(*) from pg_subscription where subdbid = (select oid from pg_database where datname = current_database()))),
    ((select count(*) from pg_foreign_data_wrapper)),
    ((select count(*) from pg_foreign_server)),
    ((select count(*) from pg_user_mapping))
)
select coalesce(sum(value), 0)::bigint as object_count from object_counts
`;

const liveCatalogDatabases = new Set<string>();
const abandonedCatalogDatabases = new Set<string>();

export type CatalogServerIdentity = {
  version: string;
  serverVersion: string;
  pgvectorVersion: string;
  pgvectorInstalled: boolean;
};

export type ParameterCatalogDatabase = {
  name: string;
  url: string;
  serverVersion: string;
  pgvectorVersion: string;
  schemaFingerprint: string | null;
  close: () => Promise<void>;
  abandon: () => Promise<void>;
};

export function resolveCatalogDatabaseUrl(): string {
  const connectionString =
    process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Parameter catalog harness requires DATABASE_URL or TEST_DATABASE_URL pointing at a real pgvector PostgreSQL server",
    );
  }
  assertRealPostgresUrl(connectionString);
  return connectionString;
}

export function assertRealPostgresUrl(connectionString: string): URL {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    throw new Error(
      "Parameter catalog harness rejects empty connection strings as catalog evidence",
    );
  }
  if (FAKE_ENGINE_PATTERN.test(trimmed)) {
    throw new Error(
      "Parameter catalog harness rejects PGLite, SQLite, in-memory, and fake databases as catalog evidence",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      "Parameter catalog harness requires a postgres:// URL to a real PostgreSQL server",
    );
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `Parameter catalog harness rejects ${url.protocol} as catalog evidence; real PostgreSQL is required`,
    );
  }
  if (url.hostname === "memory" || url.pathname.includes("memory")) {
    throw new Error(
      "Parameter catalog harness rejects in-memory database URLs as catalog evidence",
    );
  }
  return url;
}

export function connectionStringFor(
  database: string,
  source = resolveCatalogDatabaseUrl(),
): string {
  assertSafeDatabaseName(database);
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

export function databaseNameFromUrl(connectionString: string): string {
  const name = new URL(connectionString).pathname.replace(/^\//, "");
  if (!name) {
    throw new Error("Parameter catalog connection string is missing a database name");
  }
  return name;
}

async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(connectionStringFor("postgres"), fn);
}

function currentRunToken(): string {
  return (process.env.WISEEFF_TEST_RUN_TOKEN?.trim() || `p${process.pid}`).replace(
    /[^a-z0-9_]/gi,
    "",
  );
}

function currentWorkerId(): string {
  return (
    (process.env.VITEST_POOL_ID?.trim() || String(process.pid)).replace(/[^a-z0-9_]/gi, "") ||
    "0"
  );
}

export function parameterCatalogRunDatabasePrefix(): string {
  return `${CATALOG_DATABASE_PREFIX}${currentRunToken()}_`;
}

export function parameterCatalogWorkerDatabasePrefix(): string {
  return `${parameterCatalogRunDatabasePrefix()}${currentWorkerId()}_`;
}

function catalogDatabaseName(label: string): string {
  const safeLabel = label.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "empty";
  const rand = randomBytes(4).toString("hex");
  const name = `${parameterCatalogWorkerDatabasePrefix()}${safeLabel}_${rand}`.slice(0, 63);
  assertSafeDatabaseName(name);
  return name;
}

function assertSafeDatabaseName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new Error(`Unsafe PostgreSQL database name: ${name}`);
  }
}

export async function readCatalogServerIdentity(
  connectionString: string,
  options: { requireInstalledVector?: boolean } = {},
): Promise<CatalogServerIdentity> {
  assertRealPostgresUrl(connectionString);
  return withClient(connectionString, async (client) => {
    const version = await client.query<{ version: string; server_version: string }>(
      `select version() as version, current_setting('server_version') as server_version`,
    );
    const row = version.rows[0];
    if (!row?.version.includes("PostgreSQL")) {
      throw new Error(
        "Parameter catalog harness requires a real PostgreSQL server; PGLite/fakes are not catalog evidence",
      );
    }

    const available = await client.query<{ default_version: string }>(
      `select default_version from pg_catalog.pg_available_extensions where name = 'vector'`,
    );
    const offered = available.rows[0]?.default_version;
    if (!offered) {
      throw new Error(
        "Parameter catalog harness requires pgvector to be available on the real PostgreSQL server",
      );
    }

    const installed = await client.query<{ extversion: string }>(
      `select extversion from pg_catalog.pg_extension where extname = 'vector'`,
    );
    const pgvectorInstalled = Boolean(installed.rows[0]?.extversion);
    if (options.requireInstalledVector && !pgvectorInstalled) {
      throw new Error(
        "Parameter catalog harness requires pgvector (extension vector) installed in the disposable database",
      );
    }

    return {
      version: row.version,
      serverVersion: row.server_version,
      pgvectorVersion: installed.rows[0]?.extversion ?? offered,
      pgvectorInstalled,
    };
  });
}

export async function readCanonicalSchemaFingerprint(
  connectionString: string,
): Promise<string> {
  return withClient(connectionString, async (client) => {
    const relations = await client.query<{
      relation_name: string;
      relation_kind: string;
    }>(`
      select class.relname as relation_name, class.relkind::text as relation_kind
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relkind in ('r', 'p', 'S')
      order by class.relname
    `);
    const columns = await client.query<{
      relation_name: string;
      ordinal: number;
      column_name: string;
      data_type: string;
      not_null: boolean;
      default_expression: string | null;
    }>(`
      select
        class.relname as relation_name,
        attribute.attnum as ordinal,
        attribute.attname as column_name,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as data_type,
        attribute.attnotnull as not_null,
        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) as default_expression
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class class on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid = attribute.attrelid
       and default_value.adnum = attribute.attnum
      where namespace.nspname = 'parameter_catalog'
        and attribute.attnum > 0
        and not attribute.attisdropped
      order by class.relname, attribute.attnum
    `);
    const constraints = await client.query<{
      relation_name: string;
      constraint_name: string;
      definition: string;
    }>(`
      select
        class.relname as relation_name,
        constraint_record.conname as constraint_name,
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true) as definition
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class class on class.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
      order by class.relname, constraint_record.conname
    `);
    const indexes = await client.query<{
      relation_name: string;
      index_name: string;
      definition: string;
    }>(`
      select
        table_record.relname as relation_name,
        index_record.relname as index_name,
        pg_catalog.pg_get_indexdef(index_record.oid) as definition
      from pg_catalog.pg_index index_metadata
      join pg_catalog.pg_class table_record on table_record.oid = index_metadata.indrelid
      join pg_catalog.pg_class index_record on index_record.oid = index_metadata.indexrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = table_record.relnamespace
      where namespace.nspname = 'parameter_catalog'
      order by table_record.relname, index_record.relname
    `);
    const triggers = await client.query<{
      relation_name: string;
      trigger_name: string;
      definition: string;
    }>(`
      select
        class.relname as relation_name,
        trigger_record.tgname as trigger_name,
        pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition
      from pg_catalog.pg_trigger trigger_record
      join pg_catalog.pg_class class on class.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and not trigger_record.tgisinternal
      order by class.relname, trigger_record.tgname
    `);
    const functions = await client.query<{
      function_name: string;
      identity_arguments: string;
      definition: string;
    }>(`
      select
        procedure.proname as function_name,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'parameter_catalog'
      order by procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    `);

    return createHash("sha256")
      .update(
        JSON.stringify({
          relations: relations.rows,
          columns: columns.rows,
          constraints: constraints.rows,
          indexes: indexes.rows,
          triggers: triggers.rows,
          functions: functions.rows,
        }),
      )
      .digest("hex");
  });
}

export async function countUserDefinedObjects(
  connectionString: string,
): Promise<number> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ object_count: string }>(USER_OBJECT_COUNT_SQL);
    return Number(result.rows[0]?.object_count ?? 0);
  });
}

export async function assertCheckedEmptyDatabase(
  connectionString: string,
): Promise<void> {
  const objectCount = await countUserDefinedObjects(connectionString);
  if (objectCount !== 0) {
    throw new Error(
      `Target database contains ${objectCount} user-defined objects; refusing to overwrite or merge`,
    );
  }
}

export async function assertCheckedEmptyCatalog(
  connectionString: string,
): Promise<void> {
  await withClient(connectionString, async (client) => {
    const schema = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_namespace where nspname = 'parameter_catalog'
       ) as exists`,
    );
    if (schema.rows[0]?.exists !== true) {
      throw new Error(
        "Checked-empty catalog assertion requires the frozen parameter_catalog schema",
      );
    }

    const rehearsal = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_namespace where nspname = 'wayfinder_rehearsal'
       ) as exists`,
    );
    if (rehearsal.rows[0]?.exists === true) {
      throw new Error(
        "Target database is not checked-empty: wayfinder_rehearsal leftover is present",
      );
    }

    const tables = await client.query<{ table_name: string }>(`
      select class.relname as table_name
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relkind = 'r'
      order by class.relname
    `);
    if (tables.rows.length === 0) {
      throw new Error("Frozen parameter_catalog schema has no base tables");
    }

    for (const table of tables.rows) {
      if (!/^[a-z0-9_]+$/.test(table.table_name)) {
        throw new Error(`Unexpected catalog table name ${table.table_name}`);
      }
      const count = await client.query<{ n: string }>(
        `select count(*)::bigint as n from parameter_catalog.${table.table_name}`,
      );
      if (Number(count.rows[0]?.n ?? 0) !== 0) {
        throw new Error(
          `Target catalog is not checked-empty: parameter_catalog.${table.table_name} has rows`,
        );
      }
    }

    const organizations = await client.query<{ n: string }>(`
      select case
        when to_regclass('public.organizations') is null then 0
        else (select count(*)::bigint from public.organizations where id like 'wf671-%')
      end as n
    `);
    if (Number(organizations.rows[0]?.n ?? 0) !== 0) {
      throw new Error(
        "Target database is not checked-empty: leftover wf671 fixture rows are present",
      );
    }
  });
}

async function dropCatalogDatabase(name: string): Promise<void> {
  assertSafeDatabaseName(name);
  await withAdminClient(async (admin) => {
    await admin.query(`drop database if exists ${name} with (force)`);
  });
  liveCatalogDatabases.delete(name);
  abandonedCatalogDatabases.delete(name);
}

async function dropIdleCatalogDatabaseWithAdmin(
  admin: pg.Client,
  name: string,
): Promise<boolean> {
  if (liveCatalogDatabases.has(name)) {
    return false;
  }
  assertSafeDatabaseName(name);
  const liveBackends = await admin.query<{ exists: boolean }>(
    `select exists(select 1 from pg_stat_activity where datname = $1) as exists`,
    [name],
  );
  if (liveBackends.rows[0]?.exists === true) {
    return false;
  }
  try {
    // No force: if another live worker connects between the check and the drop,
    // the drop fails and we leave their database alone.
    await admin.query(`drop database if exists ${name}`);
    abandonedCatalogDatabases.delete(name);
    return true;
  } catch {
    return false;
  }
}

async function dropIdleCatalogDatabase(name: string): Promise<boolean> {
  return withAdminClient((admin) => dropIdleCatalogDatabaseWithAdmin(admin, name));
}

export async function cleanupLeftoverParameterCatalogDatabases(): Promise<string[]> {
  const dropped: string[] = [];
  const workerPrefix = parameterCatalogWorkerDatabasePrefix();
  const runPrefix = parameterCatalogRunDatabasePrefix();

  await withAdminClient(async (admin) => {
    const leftovers = await admin.query<{ datname: string }>(
      `select datname
       from pg_database
       where datname like $1
       order by datname`,
      [`${CATALOG_DATABASE_PREFIX}%`],
    );
    for (const row of leftovers.rows) {
      const ownWorker = row.datname.startsWith(workerPrefix);
      const otherRun = !row.datname.startsWith(runPrefix);
      if (!ownWorker && !otherRun) {
        continue;
      }
      if (await dropIdleCatalogDatabaseWithAdmin(admin, row.datname)) {
        dropped.push(row.datname);
      }
    }

    for (const name of [...abandonedCatalogDatabases]) {
      if (dropped.includes(name)) {
        continue;
      }
      if (await dropIdleCatalogDatabaseWithAdmin(admin, name)) {
        dropped.push(name);
      }
    }
  });

  return dropped;
}

function registerHandle(
  name: string,
  url: string,
  identity: CatalogServerIdentity,
  schemaFingerprint: string | null,
  drop: () => Promise<void>,
): ParameterCatalogDatabase {
  liveCatalogDatabases.add(name);
  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    abandonedCatalogDatabases.delete(name);
    liveCatalogDatabases.delete(name);
    await drop();
  };
  return {
    name,
    url,
    serverVersion: identity.serverVersion,
    pgvectorVersion: identity.pgvectorVersion,
    schemaFingerprint,
    close,
    abandon: async () => {
      if (closed) {
        return;
      }
      closed = true;
      liveCatalogDatabases.delete(name);
      abandonedCatalogDatabases.add(name);
      if (!name.startsWith(CATALOG_DATABASE_PREFIX)) {
        await dropIdleCatalogDatabase(name);
      }
    },
  };
}

/**
 * Create a brand-new database with no user objects. Used to prove checked-empty
 * and leftover DROP behavior; it does not own schema or migrations.
 */
export async function createCheckedEmptyDatabase(
  label: string,
): Promise<ParameterCatalogDatabase> {
  const baseUrl = resolveCatalogDatabaseUrl();
  await readCatalogServerIdentity(baseUrl);
  await cleanupLeftoverParameterCatalogDatabases();
  const name = catalogDatabaseName(label);
  liveCatalogDatabases.add(name);
  try {
    await withAdminClient(async (admin) => {
      await admin.query(`create database ${name}`);
    });
    const url = connectionStringFor(name);
    await assertCheckedEmptyDatabase(url);
    const identity = await readCatalogServerIdentity(url, {
      requireInstalledVector: false,
    });
    return registerHandle(name, url, identity, null, () => dropCatalogDatabase(name));
  } catch (error) {
    liveCatalogDatabases.delete(name);
    await dropCatalogDatabase(name).catch(() => undefined);
    throw error;
  }
}

/**
 * Clone the migrations-fingerprinted template via the shared test helper so
 * this harness consumes the frozen S2-SCH schema without owning migrations.
 */
export async function createDisposableParameterCatalogDatabase(
  label: string,
): Promise<ParameterCatalogDatabase> {
  resolveCatalogDatabaseUrl();
  const ephemeral = await createEphemeralTestDatabase(`pc${label}`);
  const name = databaseNameFromUrl(ephemeral.url);
  liveCatalogDatabases.add(name);
  try {
    const identity = await readCatalogServerIdentity(ephemeral.url, {
      requireInstalledVector: true,
    });
    const schemaFingerprint = await readCanonicalSchemaFingerprint(ephemeral.url);
    if (schemaFingerprint !== S2_SCH_CONTRACT_FINGERPRINT) {
      throw new Error(
        `Frozen S2-SCH schema fingerprint mismatch: expected ${S2_SCH_CONTRACT_FINGERPRINT}, got ${schemaFingerprint}`,
      );
    }
    await assertCheckedEmptyCatalog(ephemeral.url);
    return registerHandle(name, ephemeral.url, identity, schemaFingerprint, async () => {
      liveCatalogDatabases.delete(name);
      abandonedCatalogDatabases.delete(name);
      await ephemeral.drop();
    });
  } catch (error) {
    liveCatalogDatabases.delete(name);
    abandonedCatalogDatabases.delete(name);
    await ephemeral.drop().catch(() => undefined);
    throw error;
  }
}
