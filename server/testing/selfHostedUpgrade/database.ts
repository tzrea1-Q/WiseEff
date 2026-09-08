import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import { assertOwnedUpgradeTestTarget } from "../../../scripts/upgrade-test-target";
import { assertCheckedEmptyDatabase } from "../parameterCatalog/database";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";

type Receipt = {
  profile: "selfhost-postgres16-alpine-v1";
  label: "wiseeff.upgrade.conversion"; run: string; id: string; net: string; daemonId: string; imageId: string;
  url: string; systemIdentifier: string; databaseOid: string;
  dataVolume: { name: string; createdAt: string };
};
class SelfHostedFixtureRefusal extends Error {}
const failure = (reason: string) => new SelfHostedFixtureRefusal(`selfhost-pg16-fixture-${reason}`);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function readReceipt(filename: string): Promise<{ receipt: Receipt; digest: string }> {
  try {
    if (!filename) throw failure("receipt-invalid");
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 16384) throw failure("receipt-invalid");
      bytes = Buffer.alloc(stat.size + 1);
      let read = 0;
      while (read < bytes.length) {
        const part = await file.read(bytes, read, bytes.length - read, read);
        if (!part.bytesRead) break;
        read += part.bytesRead;
      }
      if (read !== stat.size) throw failure("receipt-invalid");
      bytes = bytes.subarray(0, read);
    } finally { await file.close(); }
    const receipt = JSON.parse(bytes.toString()) as Receipt;
    const url = new URL(receipt.url);
    if (receipt.profile !== "selfhost-postgres16-alpine-v1" || receipt.label !== "wiseeff.upgrade.conversion"
      || !/^conversion-[a-f0-9]+$/.test(receipt.run) || !/^[a-f0-9]{64}$/.test(receipt.id) || !/^[a-f0-9]{64}$/.test(receipt.net)
      || !receipt.daemonId || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId)
      || !/^[1-9][0-9]*$/.test(receipt.systemIdentifier) || !/^[1-9][0-9]*$/.test(receipt.databaseOid)
      || !receipt.dataVolume || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(receipt.dataVolume.name) || !Number.isFinite(Date.parse(receipt.dataVolume.createdAt))
      || !["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !url.port || !url.username || !url.password
      || !/^\/[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) throw failure("receipt-invalid");
    return { receipt, digest: sha(bytes) };
  } catch { throw failure("receipt-invalid"); }
}

/** Separate fixture for component suites that previously requested a migrated
 * database. Uses the real current-tree migration runner, never a template or a
 * claimed Catalog-lane fingerprint. Empty-source tests use the function above. */
export async function createMigratedSelfHostedPg16Database(label: string): Promise<{ url: string; close(): Promise<void> }> {
  const fixture = await createSelfHostedPg16Database(label);
  const database = createPostgresDatabase(fixture.url);
  try {
    await applyMigrations(database, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations"));
    await database.close();
    return fixture;
  } catch {
    await database.close().catch(() => {});
    await fixture.close().catch(() => {});
    throw failure("migration-failed");
  }
}

/** Extra self-hosted deployment-shape matrix. This never changes the pgvector
 * prerequisite of the Catalog lane and never provisions a Docker target.
 * The caller's private receipt must describe its newly owned PG16 cluster.
 * No ambient URL fallback, template clone, prefix cleanup, or FORCE drop exists.
 */
export async function createSelfHostedPg16Database(label: string): Promise<{ url: string; close(): Promise<void> }> {
  const filename = process.env.UPG_TEST_TARGET_RECEIPT ?? "";
  const pinned = await readReceipt(filename);
  const { receipt } = pinned;
  // Retain the existing pre-collection guard's strict URL/daemon contract too.
  // Explicit disagreement is an error; never replace the environment silently.
  assertOwnedUpgradeTestTarget();
  const docker = createIsolatedUpgradeDocker();
  const checkDocker = async () => {
    if ((await readReceipt(filename)).digest !== pinned.digest || docker.daemonId !== receipt.daemonId) throw failure("target-drift");
    const container = docker.assertOwned(receipt.id, receipt.label, receipt.run);
    const network = JSON.parse(docker.command(["network", "inspect", receipt.net]).toString())[0];
    const volume = JSON.parse(docker.command(["volume", "inspect", receipt.dataVolume.name]).toString())[0];
    const image = JSON.parse(docker.command(["image", "inspect", "postgres:16-alpine"]).toString())[0];
    const consumers = docker.command(["ps", "-a", "--no-trunc", "--filter", `volume=${receipt.dataVolume.name}`, "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    const networks = Object.values(container.NetworkSettings.Networks) as { NetworkID: string }[];
    const published = container.NetworkSettings.Ports as Record<string, { HostIp: string; HostPort: string }[] | null>;
    const ports = published["5432/tcp"];
    if (!container.State.Running || container.State.Restarting || container.Image !== receipt.imageId || image.Id !== receipt.imageId
      || network.Id !== receipt.net || network.Labels?.[receipt.label] !== receipt.run || network.Driver !== "bridge" || network.Internal !== false
      || network.Options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false"
      || Object.keys(network.Containers ?? {}).join(",") !== receipt.id || networks.length !== 1 || networks[0].NetworkID !== receipt.net
      || ports?.length !== 1 || ports[0].HostIp !== "127.0.0.1" || ports[0].HostPort !== new URL(receipt.url).port
      || Object.entries(published).some(([port, bindings]) => port !== "5432/tcp" && Boolean(bindings?.length))
      || container.Mounts.length !== 1 || container.Mounts[0].Type !== "volume" || container.Mounts[0].Name !== receipt.dataVolume.name
      || container.Mounts[0].Destination !== "/var/lib/postgresql/data"
      || volume.Name !== receipt.dataVolume.name || volume.CreatedAt !== receipt.dataVolume.createdAt || volume.Driver !== "local"
      || Object.keys(volume.Options ?? {}).length || volume.Labels?.[receipt.label] !== receipt.run
      || consumers.length !== 1 || consumers[0] !== receipt.id) throw failure("target-drift");
  };
  const withAdmin = async <T>(body: (client: pg.Client) => Promise<T>): Promise<T> => {
    await checkDocker();
    const client = new pg.Client({ connectionString: receipt.url, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    try {
      await client.connect();
      const identity = (await client.query(`select system_identifier::text as system_id,
        (select oid::text from pg_database where datname=current_database()) as database_oid,
        current_setting('server_version_num')::integer as version from pg_control_system()`)).rows[0];
      if (identity?.system_id !== receipt.systemIdentifier || identity?.database_oid !== receipt.databaseOid
        || !Number.isInteger(identity.version) || identity.version < 160000 || identity.version >= 170000) throw failure("database-identity-drift");
      await checkDocker();
      return await body(client);
    } finally { await client.end().catch(() => {}); }
  };
  const name = `upg16_${label.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase()}_${randomBytes(12).toString("hex")}`;
  let owned: { oid: string; owner: string } | undefined;
  let closed = false;
  let unknown = false;
  const close = async () => {
    if (closed) return;
    if (!owned || unknown) throw failure("database-outcome-unknown");
    try { await withAdmin(async admin => {
      const actual = (await admin.query("select oid::text as oid,datdba::text as owner from pg_database where datname=$1", [name])).rows[0];
      if (!actual || actual.oid !== owned!.oid || actual.owner !== owned!.owner) throw failure("database-ownership-drift");
      // No FORCE: a connection arriving after this check makes DROP refuse.
      const sessions = (await admin.query("select count(*)::int as n from pg_stat_activity where datname=$1", [name])).rows[0];
      if (sessions?.n !== 0) throw failure("database-still-in-use");
      await checkDocker();
      try { await admin.query(`drop database ${pg.escapeIdentifier(name)}`); }
      catch { unknown = true; throw failure("database-outcome-unknown"); }
      closed = true;
    }); } catch (error) {
      if (error instanceof SelfHostedFixtureRefusal) throw error;
      throw failure("close-failed");
    }
  };
  try {
    await withAdmin(async admin => {
      const offered = (await admin.query("select name from pg_available_extensions where name in ('vector','pg_trgm') order by name")).rows;
      if (offered.length !== 1 || offered[0].name !== "pg_trgm") throw failure("extension-profile-unsupported");
      try { await admin.query(`create database ${pg.escapeIdentifier(name)} template template0`); }
      catch { unknown = true; throw failure("database-outcome-unknown"); }
      const row = (await admin.query("select oid::text as oid,datdba::text as owner from pg_database where datname=$1 and datdba=(select oid from pg_roles where rolname=current_user)", [name])).rows[0];
      if (!row?.oid || !row.owner) { unknown = true; throw failure("database-outcome-unknown"); }
      owned = row;
    });
    const url = new URL(receipt.url); url.pathname = `/${name}`;
    await checkDocker();
    await assertCheckedEmptyDatabase(url.toString());
    const probe = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, query_timeout: 10000 });
    try {
      await probe.connect();
      const actual = (await probe.query("select system_identifier::text as system_id,(select oid::text from pg_database where datname=current_database()) as database_oid from pg_control_system()")).rows[0];
      if (actual?.system_id !== receipt.systemIdentifier || actual?.database_oid !== owned?.oid) throw failure("database-identity-drift");
      await checkDocker();
      await probe.query("create extension pg_trgm");
      const extension = (await probe.query("select extversion from pg_extension where extname='pg_trgm'")).rows[0];
      const exercised = (await probe.query("select similarity('selfhost','selfhost') as value")).rows[0];
      if (!extension?.extversion || exercised?.value !== 1) throw failure("extension-profile-unsupported");
      // This exact extension was created by this probe in the recorded new DB.
      await probe.query("drop extension pg_trgm");
    } finally { await probe.end().catch(() => {}); }
    await assertCheckedEmptyDatabase(url.toString());
    await checkDocker();
    return { url: url.toString(), close };
  } catch (error) {
    if (owned && !unknown) await close().catch(() => {});
    // Never expose connection strings or raw driver/Docker diagnostics.
    if (error instanceof SelfHostedFixtureRefusal) throw error;
    throw failure("setup-failed");
  }
}
