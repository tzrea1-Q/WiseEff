import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

import { createEphemeralTestDatabase } from "../testDatabase";

/** 0137-only S2-SCH freeze. Live cloned databases also include 0138 DEFINER reachability. */
export const S2_SCH_0137_FINGERPRINT =
  "f2ad57b2af5c6e0d50841284bacf5aff927dd1dbf09039099144e20216c82453";

/**
 * Historical catalog schema fingerprint through 0158 plane-disposal allow-delete ACL.
 * 0159 only grants the disposer SECURITY DEFINER SELECT reachability and does
 * not change this schema fingerprint. The current live fixture has a separate
 * pin below because 0160/0161 add the property-delete contract.
 * 0137-only freeze is S2_SCH_0137_FINGERPRINT.
 */
export const S2_SCH_CONTRACT_FINGERPRINT =
  "7bc944915eabc1689a9976332864bae3bc602fd9c407e91ed826340dbe0f69e1";

/** 0171 historical live pin, before the forward batch draft/composition migrations. */
export const S2_SCH_0171_FINGERPRINT =
  "40db30e5fecec0de3a34e6ca34db8aaf51e70c3c57fe7154dd78b2e1f827df59";

/** Historical Catalog schema through 0178; 0177/0178 only change public tables. */
export const S2_SCH_0176_FINGERPRINT =
  "6093c85dff61c592bfa48f9d19c38fa74c737418307f70062f68a17959a186ce";

/** Historical 0179 comparison-manifest binding stage. */
export const S2_SCH_0179_FINGERPRINT =
  "79320ab6d68c846b7e75ff9e2627fe80b1abcb4d0e700fc4ca7848573580a981";

/** Historical 0180 offline capture functions, before readiness revalidation. */
export const S2_SCH_0180_FINGERPRINT =
  "1a2daa7314974e1203ea3100725f408009d2c9d69289caa4f9ea38e544ba0f3a";

/** Historical 0181 readiness-revalidation stage, retained unchanged. */
export const S2_SCH_0181_FINGERPRINT =
  "bd79fcababc6baa972d0935d1e837a5dc78195a225563d92be7a717af4e97797";

/** Historical 0182 retained-identity reader stage, retained unchanged. */
export const S2_SCH_0182_FINGERPRINT =
  "2ab9046e3ceb66ab9f91b1d7eb96e5d929f9b25f8b3fda0bb0c190fcac761fd5";

/** Historical 0201 whole-source review stage; unpublished 0190–0192 source migrations were renumbered on integration. */
export const S2_SCH_0201_FINGERPRINT =
  "abb616c58e3dfd3d7b7b95f73f5d9ae1f1c9aadbf47ee31f3513c1e2914a5682";

/**
 * Historical 0218 stage, measured with the unchanged six-category query on fresh
 * PostgreSQL. Compared with 0201: two erasure tables, 18 added attribute entries
 * (12 table columns and six index attributes), one nullable placement column,
 * five added and ten changed constraints, three indexes, three triggers, and
 * 20 added / 33 changed functions. These cover detached module placements,
 * audited erasure capabilities, source-pin provenance, archive fences/retry,
 * and the narrowly scoped immutable guards; no historical pin is replaced.
 */
export const S2_SCH_0218_FINGERPRINT =
  "b5aeee9485d4ae62070556f269ff7623e1ab9934ceb1df707a75f1bddf30487e";

/**
 * Historical 0219 private-capability stage: 32 trigger functions add the nested
 * migration-owner guard before the private erasure predicate. No other entry
 * in the six-category inventory changes from the retained 0218 pin.
 */
export const S2_SCH_0219_FINGERPRINT =
  "2bd66075a223cd87daf165f4ba353258edd9a845c8027bf1de140b25ae19fad6";

/** Retained main #1323 archive-aware erasure compatibility chain. */
export const S2_SCH_0220_COMPAT_FINGERPRINT =
  "da0aba57c65b388a140b03d8db3da6b7c61ebc70d0b92f0b2b7026751cfda412";

/**
 * Retained pre-integration 0221 stage: the unchanged six-category inventory adds only three
 * functions for direct-source receipts/mode immutability and read-only project
 * deletion preview. Relations, columns, constraints, indexes and triggers are
 * unchanged from 0219; the historical fingerprint above remains intact.
 */
export const S2_SCH_0221_FINGERPRINT =
  "d9907a04610bdcc83f0662fc3030fca1b480488858fdce4583315bd0bfd5005d";

/**
 * Retained pre-integration 0226 stage: project erasure adds one relation/primary key, while
 * member addition/removal and surviving Definition-erasure origins update
 * three constraints and nine function bodies, and add twelve functions.
 * The unchanged inventory query retains all prior schema pins above.
 */
export const S2_SCH_0226_FINGERPRINT =
  "82c8c47c82b6f4fcdbd744fa3cfcfedd74dfbd85aba811227d6d5f468c0f6e7e";

/** Retained pre-integration chain through 0228 adds only the log erasure relation,
 * its primary key/index, nine inventory attributes and six functions. All
 * preceding entries and every historical pin remain unchanged. */
export const S2_SCH_0228_FINGERPRINT =
  "60ef3ac1e6873e012fff56627136e7f1740d00482a11a73106a51a5287997e6a";

/** Retained pre-integration 0227/0230/0232 chain adds three configuration restore functions and
 * updates six source/restore/Definition-erasure bodies; all five relation,
 * attribute, constraint, index and trigger inventories above are unchanged. */
export const S2_SCH_0232_FINGERPRINT =
  "9c31755dae942bd052f9be556a106e2715c13ca09d0d36a89511eff975ee2f70";

/** 0233 adds the audited source-administration guard and extends the frozen
 * source-request guard. 0235/0236 add no Catalog inventory entries. */
export const S2_SCH_0236_FINGERPRINT =
  "413de8e2379309ca3675e8f030629d96ebc0f62d412e05660ff62872aca82864";

/** Combined main #1323 and administration chain through 0236. */
export const S2_SCH_0236_MAIN_FINGERPRINT =
  "6a450990794e80feb3ba3baf1020d810f91cfbd9608f781b46e4ccf911d9935a";

/** Retained chain through 0241; 0237 adds only zero-project replacement activation. */
export const S2_SCH_0241_FINGERPRINT =
  "cea17596201ab46874728187121ba0c5e1a4fe98e366db456fd9d2c35762d64f";

/** 0242–0245 replace one tombstone unique constraint/index (four index attributes
 * become five) and update six historical receipt/provenance functions. The
 * unchanged six-category query adds no relations, table columns, triggers or
 * functions; every earlier schema pin remains intact. */
export const S2_SCH_0245_FINGERPRINT =
  "6b373aebaeae82091d7d3e86de2a385ba1ab73786a7b14d131333c486b66db38";

/** 0251 extends the project purge function to delete project-owned deployment
 * and offline migration evidence. The other five inventory categories and
 * every historical schema pin remain unchanged. */
export const S2_SCH_0251_FINGERPRINT =
  "705cb5b5f925657a92eb852ae77d52bc850212d8cc4aef12ef9e7777188c4b70";

/** 0252 records erasure ownership in the purge INSERT and adds its organization
 * column and scoped receipt reader. 0253 only grants runtime access. */
export const S2_SCH_0253_FINGERPRINT =
  "30efc5b90c3c4e8a4a4e70744103ac63a9657d109c2efd4e873926104bdefcb6";

/** 0255 adds the root-swap receipt guard and exact-anchor restoration predicate,
 * updating three source guards. Measured on fresh PostgreSQL including 0251–0254;
 * the other five inventory categories and all historical pins remain intact. */
export const S2_SCH_0255_FINGERPRINT =
  "b91687374e810d2223f8ad7a87212032af99a5ae8dff78e9fce496d2b32d404e";

/** 0256 lets a log's uploader erase their own failed log and retry its pending
 * storage cleanup: a shared erasure-actor guard used by the lock and receipt readers,
 * plus an owner-scoped pending-cleanup listing. */
export const S2_SCH_0256_FINGERPRINT =
  "348caf501d780aec9efd1bf7f740c7e946025444f711d28be3de40aaadd916e0";

/** 0262 changes only three Catalog function definitions: the project erasure
 * actor guard, its preview caller, and source-request administration. Active
 * persisted platform administrators retain their Home identity while operating
 * on an explicit target; all earlier inventory categories and pins are intact. */
export const S2_SCH_0262_FINGERPRINT =
  "e39d15ffb9fce4500e652d9d192a8eea0ab722a9d90c20cbbc1bc1916e8a2934";

/** Combined 0262/0263 stage: the two log erasure actor/receipt functions now
 * accept a persisted active platform administrator operating on another
 * organization. Measured on fresh PostgreSQL; earlier pins remain intact. */
export const S2_SCH_0263_FINGERPRINT =
  "d4bb5881fc24a088b7ccc923366e887da97145f222ee038e3ce1131fa49de737";

/** 0275 adds organization lifecycle triggers to organization-owned Catalog
 * records. Measured on fresh PostgreSQL with the complete migration chain;
 * shared Catalog objects and every historical schema pin remain unchanged. */
export const S2_SCH_0275_FINGERPRINT =
  "644a0cf9b4632d99d0b4627bca35c4809fb374dd7cca445306cb280bf89f6db8";

/** 0276 adds the bounded, counts-only organization erasure preview capability.
 * Measured on fresh PostgreSQL through 0278; the latter's public integrity and
 * webhook column-read repairs leave the private Catalog inventory unchanged. */
export const S2_SCH_0276_FINGERPRINT =
  "b992cc5ded4403aabcafa92048bb08cea6795e55afa0888cf239821f46f0a4d9";

/** 0279 records exact Agent checkpoint ownership and replaces the erasure
 * preview's runtime and store-qualified reference seams. Measured on fresh
 * PostgreSQL; every earlier migration pin remains unchanged. */
export const S2_SCH_0279_FINGERPRINT =
  "b56e61372b4a7a0a823dbb87136669f13ac7f9cabee28ec9ad51e9dade032663";

export const S2_SCH_0285_FINGERPRINT =
  "9543f9d3582e6ed8f58b219d54afba057e3efb062b18e47f92ec5fd08c9cff60";

/** Fresh PostgreSQL through 0287 includes all four Organization erasure
 * adapters. Historical migration fingerprints remain immutable. */
export const S2_SCH_0287_FINGERPRINT =
  "bf1aabdb7b422ba0943a139971bb8c532084144ed34a063dfe0144dabc53e497";

export const S2_SCH_LIVE_FINGERPRINT = S2_SCH_0287_FINGERPRINT;

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
      // 0139 seeds the closed gate registry; that is schema, not catalog residue.
      if (table.table_name === "verification_gate_registry") {
        continue;
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

const HARNESS_RUN_NAME_PATTERN = new RegExp(
  `^${CATALOG_DATABASE_PREFIX}[rp][0-9]+_`,
);

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
      const otherHarnessRun =
        HARNESS_RUN_NAME_PATTERN.test(row.datname) && !row.datname.startsWith(runPrefix);
      if (!ownWorker && !otherHarnessRun) {
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
 * this harness consumes the current Catalog schema without owning migrations.
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
    if (schemaFingerprint !== S2_SCH_LIVE_FINGERPRINT) {
      throw new Error(
        `Live Catalog schema fingerprint mismatch: expected ${S2_SCH_LIVE_FINGERPRINT}, got ${schemaFingerprint}`,
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
