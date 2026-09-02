import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, type Database } from "../server/shared/database/client";
import { applyMigrations } from "../server/shared/database/migrations";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "migrations");

export const DB_SCHEMA_DOC_PATH = path.resolve("docs/generated/db-schema.md");

function baseConnectionString() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}

function connectionStringFor(database: string) {
  const url = new URL(baseConnectionString());
  url.pathname = `/${database}`;
  return url.toString();
}

export async function isDatabaseReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseConnectionString(), connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The committed db-schema artifact is pgvector-canonical: migration 0104 creates
 * `knowledge_chunks.embedding` only when the vector extension is installable, so
 * rendering on an extension-less server would produce a different (non-canonical)
 * document. Generation requires pgvector; the check skips honestly without it.
 */
export async function isVectorExtensionAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseConnectionString(), connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    const result = await client.query("select 1 from pg_available_extensions where name = 'vector' limit 1");
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

type ColumnRow = {
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_expr: string | null;
};

type ConstraintRow = {
  conname: string;
  definition: string;
};

type IndexRow = {
  indexname: string;
  indexdef: string;
};

type EnumRow = {
  schema_name: string;
  typname: string;
  labels: string[];
};

type TableRow = {
  schema_name: string;
  table_name: string;
};

async function listTables(db: Database): Promise<TableRow[]> {
  const result = await db.query<TableRow>(
    `select table_schema as schema_name, table_name
     from information_schema.tables
     where table_type = 'BASE TABLE'
       and table_schema not in ('pg_catalog', 'information_schema')
       and table_schema not like 'pg_toast%'
       and table_schema not like 'pg_temp_%'
     order by table_schema, table_name`
  );
  return result.rows;
}

async function listColumns(db: Database, schema: string, table: string): Promise<ColumnRow[]> {
  const result = await db.query<ColumnRow>(
    `select a.attname as column_name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            a.attnotnull as not_null,
            pg_get_expr(d.adbin, d.adrelid) as default_expr
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
     order by a.attnum`,
    [schema, table]
  );
  return result.rows;
}

async function listConstraints(db: Database, schema: string, table: string): Promise<ConstraintRow[]> {
  const result = await db.query<ConstraintRow>(
    `select c.conname, pg_get_constraintdef(c.oid) as definition
     from pg_constraint c
     join pg_class rel on rel.oid = c.conrelid
     join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = $1 and rel.relname = $2
     order by c.conname`,
    [schema, table]
  );
  return result.rows;
}

async function listIndexes(db: Database, schema: string, table: string): Promise<IndexRow[]> {
  const result = await db.query<IndexRow>(
    `select indexname, indexdef
     from pg_indexes
     where schemaname = $1 and tablename = $2
     order by indexname`,
    [schema, table]
  );
  return result.rows;
}

async function listEnums(db: Database): Promise<EnumRow[]> {
  const result = await db.query<{ schema_name: string; typname: string; label: string }>(
    `select n.nspname as schema_name, t.typname, e.enumlabel as label
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and n.nspname not like 'pg_toast%'
       and n.nspname not like 'pg_temp_%'
     order by n.nspname, t.typname, e.enumsortorder`
  );
  const byType = new Map<string, EnumRow>();
  for (const row of result.rows) {
    const key = `${row.schema_name}\0${row.typname}`;
    const current = byType.get(key) ?? {
      schema_name: row.schema_name,
      typname: row.typname,
      labels: [],
    };
    current.labels.push(row.label);
    byType.set(key, current);
  }
  return [...byType.values()];
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|");
}

function displayRelationName(schema: string, name: string): string {
  return schema === "public" ? name : `${schema}.${name}`;
}

function relationAnchor(schema: string, name: string): string {
  return displayRelationName(schema, name).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export async function renderDbSchemaFromDatabase(db: Database): Promise<string> {
  const migrationFiles = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const lastMigration = migrationFiles.at(-1) ?? "none";
  const tables = await listTables(db);
  const enums = await listEnums(db);

  const lines: string[] = [];
  lines.push("# Database Schema (Generated)");
  lines.push("");
  lines.push(
    `Generated by \`npm run db:schema-doc\` from \`server/migrations/\` (${migrationFiles.length} migrations, through \`${lastMigration}\`).`
  );
  lines.push("");
  lines.push(
    "Do not edit by hand: `npm run docs:check` regenerates this document against a disposable database and fails on drift. " +
      "Migration files remain the executable source of truth. " +
      "Xiaoze LangGraph checkpoint tables are ensured at runtime by `scripts/migrate.ts` outside `schema_migrations` and are not listed here."
  );
  lines.push("");
  lines.push(`## Tables (${tables.length})`);
  lines.push("");
  for (const table of tables) {
    const displayName = displayRelationName(table.schema_name, table.table_name);
    lines.push(`- [\`${displayName}\`](#${relationAnchor(table.schema_name, table.table_name)})`);
  }
  lines.push("");

  for (const table of tables) {
    const columns = await listColumns(db, table.schema_name, table.table_name);
    const constraints = await listConstraints(db, table.schema_name, table.table_name);
    const constraintNames = new Set(constraints.map((constraint) => constraint.conname));
    const indexes = (await listIndexes(db, table.schema_name, table.table_name)).filter(
      (index) => !constraintNames.has(index.indexname),
    );

    lines.push(`### ${displayRelationName(table.schema_name, table.table_name)}`);
    lines.push("");
    lines.push("| Column | Type | Nullable | Default |");
    lines.push("| --- | --- | --- | --- |");
    for (const column of columns) {
      lines.push(
        `| \`${column.column_name}\` | \`${escapeCell(column.data_type)}\` | ${column.not_null ? "no" : "yes"} | ${
          column.default_expr ? `\`${escapeCell(column.default_expr)}\`` : "—"
        } |`
      );
    }
    lines.push("");
    if (constraints.length > 0) {
      lines.push("Constraints:");
      lines.push("");
      for (const constraint of constraints) {
        lines.push(`- \`${constraint.conname}\`: ${constraint.definition}`);
      }
      lines.push("");
    }
    if (indexes.length > 0) {
      lines.push("Indexes:");
      lines.push("");
      for (const index of indexes) {
        lines.push(`- \`${index.indexname}\`: ${index.indexdef.replace(/^CREATE /, "")}`);
      }
      lines.push("");
    }
  }

  if (enums.length > 0) {
    lines.push("## Enum types");
    lines.push("");
    for (const item of enums) {
      lines.push(
        `- \`${displayRelationName(item.schema_name, item.typname)}\`: ${item.labels
          .map((label) => `\`${label}\``)
          .join(", ")}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Renders the schema doc from a disposable database migrated from scratch, so
 * the document always reflects exactly what the migration chain produces.
 */
export async function renderDbSchemaDoc(): Promise<string> {
  const dbName = `wiseeff_schema_doc_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const admin = new pg.Client({ connectionString: connectionStringFor("postgres") });
  await admin.connect();
  await admin.query(`create database ${dbName}`);

  const client = new pg.Client({ connectionString: connectionStringFor(dbName) });
  try {
    await client.connect();
    const db = createDatabase({
      query: async (text, values = []) => {
        const result = await client.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      }
    });
    await applyMigrations(db, migrationsDir);
    return await renderDbSchemaFromDatabase(db);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
