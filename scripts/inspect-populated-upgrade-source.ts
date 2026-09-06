import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const SOURCE_SHA = "82344044b436a8dafecefbb85dfd724cecb05e3f";
export type MigrationEntry = { name: string; checksum: string | null };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function gitMigrationInventory(root: string, revision: string): MigrationEntry[] {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("exact-commit-required");
  const names = execFileSync("git", ["ls-tree", "--name-only", `${revision}:server/migrations`], { cwd: root, encoding: "utf8" }).trim().split("\n").filter((name) => name.endsWith(".sql")).sort();
  return names.map((name) => ({ name, checksum: hash(execFileSync("git", ["show", `${revision}:server/migrations/${name}`], { cwd: root, encoding: "utf8" })) }));
}

export function compareLedger(source: MigrationEntry[], candidate: MigrationEntry[], ledger: MigrationEntry[]) {
  const blockers: string[] = [];
  const actual = new Map(ledger.map((entry) => [entry.name, entry.checksum]));
  const packaged = new Map(candidate.map((entry) => [entry.name, entry.checksum]));
  if (actual.size !== ledger.length) blockers.push("duplicate-ledger-name");
  for (const entry of source) {
    if (packaged.get(entry.name) !== entry.checksum) blockers.push(`source-migration-mutated:${entry.name}`);
    if (!actual.has(entry.name)) blockers.push(`source-migration-missing:${entry.name}`);
  }
  for (const entry of ledger) {
    if (entry.name === "0121_classify_nodename_driver_subjects.sql") blockers.push("unsafe-historical-migration");
    if (!packaged.has(entry.name)) blockers.push(`unknown-ledger-name:${entry.name}`);
    else if (!entry.checksum || packaged.get(entry.name) !== entry.checksum) blockers.push(`checksum-drift:${entry.name}`);
  }
  const pending = candidate.filter((entry) => !actual.has(entry.name));
  if (pending.some((entry) => ledger.some((applied) => applied.name > entry.name))) blockers.push("non-prefix-ledger");
  return { blockers, pending };
}

/** Aggregate-only, one repeatable read snapshot. This does not authorize migration or prove semantics. */
export async function inspectSource(client: pg.Client, source: MigrationEntry[], candidate: MigrationEntry[]) {
  await client.query("begin isolation level repeatable read read only");
  try {
    await client.query("set local statement_timeout = '30s'");
    // PostgreSQL errors rather than silently returning an RLS-filtered inventory.
    await client.query("set local row_security = off");
    const ledger = (await client.query<MigrationEntry>("select name, checksum from public.schema_migrations order by name")).rows;
    const comparison = compareLedger(source, candidate, ledger);
    const relations = (await client.query<{ schema: string; name: string }>("select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','parameter_catalog') and c.relkind in ('r','p') order by 1,2")).rows;
    for (const name of ["parameter_specs", "parameter_spec_versions", "driver_schemas", "driver_schema_versions", "driver_registration_placements", "project_parameter_bindings", "project_parameter_binding_revisions", "parameter_spec_review_tasks", "dts_config_revisions", "project_parameter_files", "parameter_policy_targets"]) {
      if (!relations.some((relation) => relation.schema === "public" && relation.name === name)) comparison.blockers.push(`source-relation-unavailable:${name}`);
    }
    const inventory = [];
    for (const relation of relations) {
      const count = (await client.query<{ count: string }>(`select count(*)::text as count from ${quote(relation.schema)}.${quote(relation.name)}`)).rows[0].count;
      inventory.push({ ...relation, count });
    }
    const columns = (await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>("select table_schema,table_name,column_name,data_type from information_schema.columns where table_schema in ('public','parameter_catalog') order by table_schema,table_name,ordinal_position")).rows;
    const valuePresence: Record<string, string> = {};
    for (const name of ["typed_value", "canonical_value", "raw_value"]) {
      if (columns.some((column) => column.table_schema === "public" && column.table_name === "project_parameter_binding_revisions" && column.column_name === name)) {
        valuePresence[name] = (await client.query<{ count: string }>(`select count(*)::text as count from public.project_parameter_binding_revisions where ${quote(name)} is not null`)).rows[0].count;
      } else comparison.blockers.push(`value-column-unavailable:${name}`);
    }
    const canonical = relations.some((relation) => relation.schema === "parameter_catalog");
    const populated = inventory.some((relation) => relation.schema === "public" && relation.name !== "schema_migrations" && relation.count !== "0");
    const extensions = (await client.query("select name, default_version, installed_version from pg_available_extensions order by name")).rows;
    await client.query("commit");
    return { kind: comparison.blockers.length ? "blocked" : "inspected", authorization: "none", inventoryScope: "all-public-and-parameter-catalog-tables", mode: canonical ? "canonical-present-requires-separate-patch-inspection" : populated ? "populated" : "empty-public-inventory", ledger, ...comparison, inventory, columns, valuePresence, extensions };
  } catch {
    await client.query("rollback");
    throw new Error("source-inspection-query-failed");
  }
}

async function main(args: string[]) {
  if (args.length !== 2 || args[0] !== "--candidate-sha" || !/^[a-f0-9]{40}$/.test(args[1])) throw new Error("usage: --candidate-sha EXACT_SHA; private DATABASE_URL required");
  if (!process.env.DATABASE_URL) throw new Error("private-database-url-required");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = gitMigrationInventory(root, SOURCE_SHA);
  const candidate = gitMigrationInventory(root, args[1]);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await inspectSource(client, source, candidate);
    process.stdout.write(`${JSON.stringify({ sourceSha: SOURCE_SHA, candidateSha: args[1], ...result }, null, 2)}\n`);
    process.exitCode = result.kind === "blocked" ? 2 : 0;
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write("source-inspection-failed; verify private connection and exact candidate inputs\n"); process.exitCode = 1; });
}
