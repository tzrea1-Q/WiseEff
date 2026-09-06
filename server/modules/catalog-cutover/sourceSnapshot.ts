import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { getMissingMigrationFiles, getPendingMigrations } from "../../shared/database/migrations";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../parameter-bindings/cutoverImport/sourceBoundary";

const VERSION = "pcat-frozen-public-source-v1";
const UNSAFE_NAME = "0121_classify_nodename_driver_subjects.sql";
type Migration = { readonly name: string; readonly checksum: string };
type Column = { readonly name: string; readonly position: number; readonly type: string };
type Relation = { readonly name: string; readonly kind: "r" | "p"; readonly columns: readonly Column[] };
type FrozenRelation = Relation & { readonly rowCount: number; readonly rowsDigest: string };

/** Private plan artifact: metadata and digests only, never source rows. The caller
 * binds its digest, source/candidate artifacts and target in the existing plan.
 * Its digest is an integrity pin, not approval or a writer-isolation receipt.
 */
export type FrozenSourceSnapshot = {
  readonly version: typeof VERSION;
  readonly target: BindingDatabaseIdentity;
  readonly sourceMigrations: readonly Migration[];
  readonly migrationSuffix: readonly Migration[];
  readonly candidateInventoryDigest: string;
  readonly relations: readonly FrozenRelation[];
  readonly digest: string;
};

export class SourceSnapshotError extends Error {
  constructor(readonly code: string) { super(`source-snapshot-${code}`); }
}
const refuse = (code: string): never => { throw new SourceSnapshotError(code); };
const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return refuse("invalid-metadata");
};
const digest = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Same filename ordering and UTF-8 SQL checksum as applyMigrations. No path cache:
 * preparation and verification must observe current bytes of the pinned checkout.
 * This bounded lane requires exact source files; historical aliases are not inferred.
 */
async function readMigrationInventory(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.name.endsWith(".sql")).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!files.length) return refuse("migration-inventory-empty");
  const entries: Migration[] = [];
  for (const file of files) {
    if (!file.isFile() || !/^[A-Za-z0-9_-]+\.sql$/.test(file.name)) return refuse("migration-file-invalid");
    if (file.name === UNSAFE_NAME) return refuse("unsafe-historical-migration");
    const handle = await open(path.join(directory, file.name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 16 * 1024 * 1024) return refuse("migration-file-invalid");
      const sql = await handle.readFile("utf8");
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return refuse("migration-file-changed");
      entries.push({ name: file.name, checksum: createHash("sha256").update(sql).digest("hex") });
    } finally { await handle.close(); }
  }
  return entries;
}

function requireCandidatePrefix(source: readonly Migration[], candidate: readonly Migration[]): Migration[] {
  if (!source.length || source.some(entry => entry.name === UNSAFE_NAME)) return refuse("unsafe-or-empty-source-ledger");
  if (getMissingMigrationFiles(candidate.map(entry => entry.name), source.map(entry => entry.name)).length ||
      !equal(candidate.slice(0, source.length), source)) return refuse("migration-prefix-drift");
  const pending = new Set(getPendingMigrations(candidate.map(entry => entry.name), source.map(entry => entry.name)));
  return candidate.filter(entry => pending.has(entry.name));
}

async function readLedger(client: pg.PoolClient): Promise<Migration[]> {
  const result = await client.query<Migration>("select name, checksum from public.schema_migrations order by name collate \"C\"");
  if (result.rows.some(entry => entry.name === UNSAFE_NAME)) return refuse("unsafe-historical-migration");
  if (result.rows.some(entry => typeof entry.name !== "string" || !/^[a-f0-9]{64}$/.test(entry.checksum)) ||
      new Set(result.rows.map(entry => entry.name)).size !== result.rows.length) return refuse("migration-ledger-invalid");
  return result.rows;
}

async function readRelations(client: pg.PoolClient): Promise<Relation[]> {
  const result = await client.query<{ name: string; kind: string; columns: Column[] }>(`
    select relation.relname as name, relation.relkind as kind,
      coalesce(json_agg(json_build_object('name',attribute.attname,'position',attribute.attnum,
        'type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)) order by attribute.attnum)
        filter(where attribute.attnum is not null),'[]') as columns
    from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    left join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid and attribute.attnum>0 and not attribute.attisdropped
    where namespace.nspname='public' and relation.relkind in ('r','p','f','m')
    group by relation.relname,relation.relkind order by relation.relname collate "C"
  `);
  if (result.rows.some(row => row.kind !== "r" && row.kind !== "p")) return refuse("source-relation-kind-unsupported");
  return result.rows as Relation[];
}

/** Hash a complete, sorted multiset of projected rows in bounded fetch pages.
 * Text stays inside this function: no JSON number coercion, bytea truncation or
 * SQL NULL/JSON null collapse. Every old FK/owner/revision ID is part of its row.
 */
async function readProjection(client: pg.PoolClient, relation: Relation, sourceNames: readonly string[]): Promise<{ rowCount: number; rowsDigest: string }> {
  const columns = relation.columns.map(column => `jsonb_build_array(source.${quote(column.name)} is null, source.${quote(column.name)}::text)`);
  const row = columns.length ? `to_jsonb(array[${columns.join(",")}])::text` : "'[]'::text";
  // The ledger is the one appendable source relation: protect every original row
  // (including applied_at) and independently check the complete allowed suffix.
  const filter = relation.name === "schema_migrations" ? "where source.name=any($1::text[])" : "";
  await client.query(`declare frozen_source_rows no scroll cursor for select row_text from (
    select ${row} as row_text from public.${quote(relation.name)} source ${filter}
    ) projected order by row_text collate "C"`, relation.name === "schema_migrations" ? [[...sourceNames]] : []);
  const hash = createHash("sha256"); let rowCount = 0;
  try {
    for (;;) {
      const page = await client.query<{ row_text: string }>("fetch forward 512 from frozen_source_rows");
      if (!page.rows.length) break;
      for (const record of page.rows) {
        if (typeof record.row_text !== "string") return refuse("projection-unavailable");
        const bytes = Buffer.from(record.row_text, "utf8");
        hash.update(`${bytes.length}:`); hash.update(bytes);
        rowCount++;
        if (!Number.isSafeInteger(rowCount)) return refuse("row-count-out-of-range");
      }
    }
  } finally { await client.query("close frozen_source_rows"); }
  return { rowCount, rowsDigest: `sha256:${hash.digest("hex")}` };
}

async function readOnly<T>(pool: pg.Pool, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient | undefined; let discard = false;
  try {
    client = await pool.connect();
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local row_security=off; set local timezone='UTC'; set local datestyle='ISO, YMD'; set local intervalstyle='postgres'; set local bytea_output='hex'; set local extra_float_digits=3; set local search_path=pg_catalog");
    return await body(client);
  } catch (error) {
    if (error instanceof SourceSnapshotError) throw error;
    throw new SourceSnapshotError("query-failure");
  } finally {
    if (client) {
      try { await client.query("rollback"); }
      catch { discard = true; }
      client.release(discard);
      if (discard) throw new SourceSnapshotError("transaction-close-unknown");
    }
  }
}

export async function captureFrozenSourceSnapshot(input: {
  pool: pg.Pool; sourceMigrationsDirectory: string; candidateMigrationsDirectory: string;
}): Promise<FrozenSourceSnapshot> {
  try {
    const source = await readMigrationInventory(input.sourceMigrationsDirectory);
    const candidate = await readMigrationInventory(input.candidateMigrationsDirectory);
    const migrationSuffix = requireCandidatePrefix(source, candidate);
    return await readOnly(input.pool, async client => {
      const sourceMigrations = await readLedger(client);
      if (!equal(sourceMigrations, source)) return refuse("migration-prefix-drift");
      const relations: FrozenRelation[] = [];
      for (const relation of await readRelations(client)) relations.push({ ...relation, ...await readProjection(client, relation, source.map(entry => entry.name)) });
      const body = { version: VERSION, target: await readBindingDatabaseIdentity(client), sourceMigrations,
        migrationSuffix, candidateInventoryDigest: digest(candidate), relations } as const;
      return { ...body, digest: digest(body) };
    });
  } catch (error) {
    if (error instanceof SourceSnapshotError) throw error;
    throw new SourceSnapshotError("capture-unavailable");
  }
}

type SnapshotVerificationInput = {
  pool: pg.Pool; descriptor: FrozenSourceSnapshot; expectedDescriptorDigest: string; candidateMigrationsDirectory: string;
};
export type FrozenSourceProgress = {
  sourceSnapshotDigest: string; candidateInventoryDigest: string; verifiedRelations: number;
  verifiedRows: number; appliedSuffix: number; complete: boolean;
};

/** Read-only inspection is not migration authorization or a completion receipt.
 * It preserves the original descriptor while known suffix files are incomplete. */
export async function inspectFrozenSourceSnapshotProgress(input: SnapshotVerificationInput): Promise<FrozenSourceProgress> {
  try {
    const { digest: recordedDigest, ...body } = structuredClone(input.descriptor);
    if (body.version !== VERSION || recordedDigest !== input.expectedDescriptorDigest || digest(body) !== input.expectedDescriptorDigest) return refuse("descriptor-mismatch");
    const candidate = await readMigrationInventory(input.candidateMigrationsDirectory);
    if (digest(candidate) !== body.candidateInventoryDigest) return refuse("candidate-inventory-drift");
    const suffix = requireCandidatePrefix(body.sourceMigrations, candidate);
    if (!equal(suffix, body.migrationSuffix)) return refuse("candidate-inventory-drift");
    return await readOnly(input.pool, async client => {
      if (!equal(await readBindingDatabaseIdentity(client), body.target)) return refuse("target-mismatch");
      const ledger = await readLedger(client);
      if (!equal(ledger.slice(0, body.sourceMigrations.length), body.sourceMigrations)) return refuse("migration-prefix-drift");
      const applied = ledger.slice(body.sourceMigrations.length);
      if (applied.length > suffix.length || !equal(applied, suffix.slice(0, applied.length))) return refuse("migration-suffix-drift");
      const current = await readRelations(client); let verifiedRows = 0;
      for (const relation of body.relations) {
        const target = current.find(row => row.name === relation.name);
        if (!target || target.kind !== relation.kind) return refuse("relation-drift");
        if (relation.columns.some(column => !target.columns.some(actual => equal(actual, column)))) return refuse("column-drift");
        const observed = await readProjection(client, relation, body.sourceMigrations.map(entry => entry.name));
        if (observed.rowCount !== relation.rowCount || observed.rowsDigest !== relation.rowsDigest) return refuse("row-drift");
        verifiedRows += observed.rowCount;
        if (!Number.isSafeInteger(verifiedRows)) return refuse("row-count-out-of-range");
      }
      return { sourceSnapshotDigest: recordedDigest, candidateInventoryDigest: body.candidateInventoryDigest,
        verifiedRelations: body.relations.length, verifiedRows, appliedSuffix: applied.length, complete: applied.length === suffix.length };
    });
  } catch (error) {
    if (error instanceof SourceSnapshotError) throw error;
    throw new SourceSnapshotError("verification-unavailable");
  }
}

export async function verifyFrozenSourceSnapshot(input: SnapshotVerificationInput): Promise<Omit<FrozenSourceProgress, "complete">> {
  const { complete, ...receipt } = await inspectFrozenSourceSnapshotProgress(input);
  if (!complete) return refuse("migration-suffix-incomplete");
  return receipt;
}
