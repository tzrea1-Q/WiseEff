import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { withOwnerAwarePostgres, type OwnerAwarePostgresDeadline, type OwnerAwarePostgresSession } from "../../../scripts/owner-aware-postgres";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  readNestedRuntimeManifest,
  recordNestedDatabaseTemplate,
  type NestedDatabaseTemplateRecord,
} from "./nestedRuntimeManifest";

type TemplateIdentity = NestedDatabaseTemplateRecord & { ownerRunId: string };
type TemplateMarker = TemplateIdentity & { kind: "wiseeff-post-cutover-template"; migrationRunId?: string };
const localRunId = process.env.WISEEFF_ACCEPTANCE_TEMPLATE_RUN_ID ?? randomUUID();
process.env.WISEEFF_ACCEPTANCE_TEMPLATE_RUN_ID = localRunId;
const localTemplates = new Map<string, { adminUrl: string; identity: TemplateIdentity }>();

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function postCutoverTemplateFingerprint(root = process.cwd()) {
  const digest = createHash("sha256");
  async function addDirectory(directory: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await addDirectory(filename);
      else if (entry.isFile()) digest.update(path.relative(root, filename)).update("\0").update(await readFile(filename)).update("\0");
      else throw new Error("Migration template fingerprint refuses non-regular files.");
    }
  }
  for (const directory of [
    "server/migrations", "server/cutovers", "schemas/dts",
    "server/modules/catalog-kernel", "server/modules/parameter-catalog-contract",
    "server/modules/catalog-publication/import", "server/testing/parameterCatalog",
  ]) await addDirectory(path.join(root, directory));
  for (const filename of [
    "e2e/acceptance/helpers/postCutoverDatabaseTemplate.ts",
    "e2e/acceptance/helpers/disposablePostCutoverRuntime.ts",
    "e2e/acceptance/helpers/cast.ts",
    "server/modules/auth/baselineCatalog.ts",
    "server/modules/parameter-topology/migration.ts",
    "server/shared/database/migrations.ts",
    "server/testing/parameterCatalog/seedPublishedCatalog.ts",
    "scripts/compile-vendor-catalog-release.ts",
  ]) digest.update(filename).update("\0").update(await readFile(path.join(root, filename))).update("\0");
  return digest.digest("hex");
}

function databaseUrl(baseUrl: string, databaseName: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withTemplateLock<Result>(adminUrl: string, templateKey: string, action: (client: OwnerAwarePostgresSession) => Promise<Result>, owner?: OwnerAwarePostgresDeadline) {
  const lockKey = BigInt.asIntN(64, BigInt(`0x${templateKey.slice(0, 16)}`)).toString();
  if (owner) return withOwnerAwarePostgres({ connectionString: adminUrl, owner, stage: "database template cleanup" }, async (client) => {
    await client.query("select pg_advisory_lock($1::bigint)", [lockKey]);
    return action(client);
  });
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 30_000, statement_timeout: 110_000, query_timeout: 120_000 });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1::bigint)", [lockKey]);
    return await action({ query: async <Row>(text: string, values: readonly unknown[] = []) => {
      const result = await client.query(text, [...values]);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    } });
  } finally {
    await client.end();
  }
}

async function readOwnedTemplate(client: OwnerAwarePostgresSession, identity: TemplateIdentity) {
  if (!/^[a-f0-9]{64}$/u.test(identity.templateKey) ||
      identity.databaseName !== `wiseeff_acceptance_template_${identity.templateKey.slice(0, 32)}` ||
      !identity.ownerRunId) throw new Error("Refusing invalid database template identity.");
  const result = await client.query<{ marker: string | null; owned: boolean }>(
    `select shobj_description(oid, 'pg_database') as marker,
            datdba = (select oid from pg_roles where rolname = current_user) as owned
     from pg_database where datname = $1`,
    [identity.databaseName],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  let marker: TemplateMarker | undefined;
  try { marker = row.marker ? JSON.parse(row.marker) as TemplateMarker : undefined; } catch {}
  if (
    !row.owned || marker?.kind !== "wiseeff-post-cutover-template" ||
    marker.databaseName !== identity.databaseName || marker.templateKey !== identity.templateKey ||
    marker.ownerRunId !== identity.ownerRunId
  ) throw new Error(`Refusing foreign database template use or cleanup: ${identity.databaseName}.`);
  return marker;
}

async function writeTemplateMarker(client: OwnerAwarePostgresSession, marker: TemplateMarker) {
  await client.query(`comment on database ${marker.databaseName} is '${JSON.stringify(marker).replaceAll("'", "''")}'`);
}

export async function clonePostCutoverDatabase(input: {
  baseDatabaseUrl: string;
  databaseName: string;
  catalog?: "fixture-owned";
  prepare(databaseUrl: string): Promise<string>;
}) {
  if (!/^wiseeff_acceptance_disposable_[a-z0-9_]+$/u.test(input.databaseName) || input.databaseName.length > 63) {
    throw new Error("Refusing unsafe disposable clone name.");
  }
  const manifestPath = process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]?.trim();
  const manifest = manifestPath ? readNestedRuntimeManifest(manifestPath) : undefined;
  const ownerRunId = manifest?.parentRunId ?? localRunId;
  const server = new URL(input.baseDatabaseUrl);
  const fingerprint = await postCutoverTemplateFingerprint();
  const templateKey = sha256(JSON.stringify([
    server.hostname, server.port || "5432", server.username, path.resolve(process.cwd()),
    ownerRunId, manifest?.sourceCommit, input.catalog ?? "seeded", fingerprint,
  ]));
  const identity: TemplateIdentity = {
    databaseName: `wiseeff_acceptance_template_${templateKey.slice(0, 32)}`,
    templateKey,
    fingerprint,
    ownerRunId,
    state: "provisioning",
  };
  const adminUrl = databaseUrl(input.baseDatabaseUrl, "postgres");
  return withTemplateLock(adminUrl, templateKey, async (client) => {
    let marker = await readOwnedTemplate(client, identity);
    if (manifestPath) recordNestedDatabaseTemplate(manifestPath, identity);
    else localTemplates.set(templateKey, { adminUrl, identity });
    if (marker && (marker.fingerprint !== identity.fingerprint || marker.state !== "ready")) {
      await client.query(`drop database ${identity.databaseName}`);
      marker = undefined;
    }
    if (!marker) {
      await client.query(`create database ${identity.databaseName}`);
      marker = { ...identity, kind: "wiseeff-post-cutover-template" };
      await writeTemplateMarker(client, marker);
      try {
        await client.query("select pg_advisory_lock(4201659)");
        try {
          marker.migrationRunId = await input.prepare(databaseUrl(input.baseDatabaseUrl, identity.databaseName));
        } finally {
          await client.query("select pg_advisory_unlock(4201659)");
        }
        marker.state = "ready";
        await writeTemplateMarker(client, marker);
      } catch (error) {
        await dropOwnedTemplate(client, identity);
        if (manifestPath) recordNestedDatabaseTemplate(manifestPath, { ...identity, state: "removed" });
        else localTemplates.delete(templateKey);
        throw error;
      }
    }
    if (!marker.migrationRunId) throw new Error("Ready database template has no cutover run identity.");
    if (manifestPath) recordNestedDatabaseTemplate(manifestPath, { ...identity, state: "ready" });
    await client.query(`create database ${input.databaseName} template ${identity.databaseName}`);
    return marker.migrationRunId;
  });
}

async function dropOwnedTemplate(client: OwnerAwarePostgresSession, identity: TemplateIdentity) {
  if (await readOwnedTemplate(client, identity)) await client.query(`drop database ${identity.databaseName}`);
  const result = await client.query("select 1 from pg_database where datname = $1", [identity.databaseName]);
  if (result.rows.length) throw new Error("Owned database template remains after cleanup.");
}

export async function cleanupPostCutoverDatabaseTemplates(baseDatabaseUrl: string, manifestPath: string, owner?: OwnerAwarePostgresDeadline) {
  const manifest = readNestedRuntimeManifest(manifestPath);
  for (const template of manifest.databaseTemplates ?? []) {
    await withTemplateLock(databaseUrl(baseDatabaseUrl, "postgres"), template.templateKey, async (client) => {
      await dropOwnedTemplate(client, { ...template, ownerRunId: manifest.parentRunId });
      recordNestedDatabaseTemplate(manifestPath, { ...template, state: "removed" });
    }, owner);
  }
}

export async function cleanupLocalPostCutoverDatabaseTemplates(baseDatabaseUrl: string) {
  const adminUrl = databaseUrl(baseDatabaseUrl, "postgres");
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 30_000, query_timeout: 30_000 });
  await client.connect();
  try {
    const result = await client.query<{ database_name: string; marker: string | null }>(
      `select datname as database_name, shobj_description(oid, 'pg_database') as marker
       from pg_database where datname like 'wiseeff_acceptance_template_%'`,
    );
    for (const row of result.rows) {
      let marker: TemplateMarker | undefined;
      try { marker = row.marker ? JSON.parse(row.marker) as TemplateMarker : undefined; } catch {}
      if (marker?.kind !== "wiseeff-post-cutover-template" || marker.ownerRunId !== localRunId) continue;
      if (!/^[a-f0-9]{64}$/u.test(marker.templateKey) || row.database_name !== `wiseeff_acceptance_template_${marker.templateKey.slice(0, 32)}`) {
        throw new Error("Refusing invalid local template cleanup identity.");
      }
      await withTemplateLock(adminUrl, marker.templateKey, (locked) => dropOwnedTemplate(locked, marker!));
    }
  } finally {
    await client.end();
  }
}

process.once("beforeExit", async () => {
  try {
    for (const { adminUrl, identity } of localTemplates.values()) {
      await withTemplateLock(adminUrl, identity.templateKey, (client) => dropOwnedTemplate(client, identity));
    }
  } catch (error) {
    console.error("Disposable database template cleanup failed:", error);
    process.exitCode = 1;
  }
});
