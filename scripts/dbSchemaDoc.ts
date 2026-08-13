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
  typname: string;
  labels: string[];
};

async function listTables(db: Database): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`
  );
  return result.rows.map((row) => row.table_name);
}

async function listColumns(db: Database, table: string): Promise<ColumnRow[]> {
  const result = await db.query<ColumnRow>(
    `select a.attname as column_name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            a.attnotnull as not_null,
            pg_get_expr(d.adbin, d.adrelid) as default_expr
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
     order by a.attnum`,
    [table]
  );
  return result.rows;
}

async function listConstraints(db: Database, table: string): Promise<ConstraintRow[]> {
  const result = await db.query<ConstraintRow>(
    `select c.conname, pg_get_constraintdef(c.oid) as definition
     from pg_constraint c
     join pg_class rel on rel.oid = c.conrelid
     join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = $1
     order by c.conname`,
    [table]
  );
  return result.rows;
}

async function listIndexes(db: Database, table: string): Promise<IndexRow[]> {
  const result = await db.query<IndexRow>(
    `select indexname, indexdef
     from pg_indexes
     where schemaname = 'public' and tablename = $1
     order by indexname`,
    [table]
  );
  return result.rows;
}

async function listEnums(db: Database): Promise<EnumRow[]> {
  const result = await db.query<{ typname: string; label: string }>(
    `select t.typname, e.enumlabel as label
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     order by t.typname, e.enumsortorder`
  );
  const byType = new Map<string, string[]>();
  for (const row of result.rows) {
    byType.set(row.typname, [...(byType.get(row.typname) ?? []), row.label]);
  }
  return [...byType.entries()].map(([typname, labels]) => ({ typname, labels }));
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|");
}

async function renderFromDatabase(db: Database): Promise<string> {
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
    lines.push(`- [\`${table}\`](#${table.replaceAll("_", "")})`);
  }
  lines.push("");

  for (const table of tables) {
    const columns = await listColumns(db, table);
    const constraints = await listConstraints(db, table);
    const constraintNames = new Set(constraints.map((constraint) => constraint.conname));
    const indexes = (await listIndexes(db, table)).filter((index) => !constraintNames.has(index.indexname));

    lines.push(`### ${table}`);
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
      lines.push(`- \`${item.typname}\`: ${item.labels.map((label) => `\`${label}\``).join(", ")}`);
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
    return await renderFromDatabase(db);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
