import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createMigratedSelfHostedPg16Database } from "../../../../server/testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../../server/shared/database/client";
import { canonicalJson, sha256Prefixed } from "./journal";
import { withHostOperationLock, type HandoffPlan } from "./handoff";
import { observeRuntimeRoles, openRuntimeRoleSource } from "./runtimeRoleSource";

// These are actual LOGIN/config/session proofs on a parent-owned cluster. The
// scoped handoff fixture is not prepareHandoff/P12/report/startup approval.
let target: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
let admin: RootDatabase;
let receipt: { id: string; imageId: string; daemonId: string; dataVolume: { name: string } };
const suffix = randomBytes(8).toString("hex");
const roles = { manager: `role_source_manager_${suffix}`, api: `role_source_api_${suffix}`,
  worker: `role_source_worker_${suffix}`, governance: `role_source_governance_${suffix}` };
const secrets = Object.fromEntries(Object.keys(roles).map(key => [key, randomBytes(24).toString("hex")]));
const connection = (key: keyof typeof roles) => {
  const url = new URL(target.url); url.username = roles[key]; url.password = secrets[key]; return url.href;
};
beforeAll(async () => {
  assertOwnedUpgradeTestTarget();
  try {
    receipt = JSON.parse(await readFile(process.env.UPG_TEST_TARGET_RECEIPT!, "utf8"));
    target = await createMigratedSelfHostedPg16Database("runtime_roles");
    admin = createPostgresDatabase(target.url);
    for (const [key, name] of Object.entries(roles)) await admin.query(`create role ${pg.escapeIdentifier(name)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${secrets[key]}'`);
    await admin.query(`grant catalog_migration_owner to ${pg.escapeIdentifier(roles.manager)} with inherit false, set true, admin false`);
    for (const name of [roles.api, roles.worker]) await admin.query(`grant catalog_runtime_reader_role to ${pg.escapeIdentifier(name)} with inherit true, set false, admin false`);
    await admin.query(`grant parameter_governance_writer_role to ${pg.escapeIdentifier(roles.governance)} with inherit true, set false, admin false`);
  } catch { throw new Error("runtime-role-fixture-setup-failed"); }
}, 60_000);
afterAll(async () => {
  const results = await Promise.allSettled([(async () => { await admin?.close(); })()]);
  try { await target?.close(); } catch { results.push({ status: "rejected", reason: undefined }); }
  if (results.some(result => result.status === "rejected")) throw new Error("runtime-role-fixture-cleanup-failed");
});

async function fixture(options: { api?: string; worker?: string; governance?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "runtime-roles-pg-")));
  const contents = {
    main: `WISEEFF_API_ENV_FILE=${directory}/api\nWISEEFF_WORKER_ENV_FILE=${directory}/worker\nWISEEFF_MANAGEMENT_ENV_FILE=${directory}/management\n`,
    api: `NODE_ENV=production\nDATABASE_URL=${options.api ?? connection("api")}\n${options.governance ? `CATALOG_GOVERNANCE_DATABASE_URL=${connection("governance")}\n` : ""}`,
    worker: `NODE_ENV=production\nDATABASE_URL=${options.worker ?? connection("worker")}\n`, management: `DATABASE_URL=${connection("manager")}\n`,
  };
  const pins: Record<string, { path: string; device: string; inode: string; digest: string }> = {};
  for (const [name, bytes] of Object.entries(contents)) {
    const filename = path.join(directory, name);
    await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
    const stat = await lstat(filename);
    pins[name] = { path: filename, device: String(stat.dev), inode: String(stat.ino), digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  }
  const docker = createIsolatedUpgradeDocker();
  const actual = JSON.parse(docker.command(["inspect", receipt.id]).toString())[0];
  const mount = actual.Mounts.find((entry: { Name?: string }) => entry.Name === receipt.dataVolume.name);
  if (!mount) throw new Error("runtime-role-fixture-target-failed");
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { runId: `roles_${suffix}`,
    expectedDaemonId: receipt.daemonId, privateConfigPath: pins.main.path, lockRoot: directory, journalPath: path.join(directory, "journal.json"),
    source: { applications: [], stores: [{ service: "postgres", containerId: receipt.id, volumeName: receipt.dataVolume.name, destination: mount.Destination }] } },
  observation: { privateConfigurations: { main: pins.main, runtime: { WISEEFF_API_ENV_FILE: pins.api, WISEEFF_WORKER_ENV_FILE: pins.worker, WISEEFF_MANAGEMENT_ENV_FILE: pins.management } },
    stores: [{ service: "postgres", id: receipt.id, imageId: receipt.imageId }] } };
  const plan = { ...body, digest: sha256Prefixed(canonicalJson(body)) } as unknown as HandoffPlan;
  return { directory, plan };
}
async function within(options: Parameters<typeof fixture>[0], run: (f: Awaited<ReturnType<typeof fixture>>, lock: Parameters<Parameters<typeof withHostOperationLock>[1]>[0]) => Promise<void>) {
  const f = await fixture(options);
  try { await withHostOperationLock(f.directory, lock => run(f, lock)); }
  finally { await rm(f.directory, { recursive: true }); }
}

it("observes actual application and optional governance LOGIN OIDs without startup admission", async () => {
  await within({ governance: true }, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      const observation = await observeRuntimeRoles(source);
      expect(observation.scope).toBe("management-time-configured-logins-only");
      const actual = await admin.query<{ oid: string; name: string }>("select oid::text,rolname as name from pg_catalog.pg_roles where rolname=any($1::text[])", [[roles.api, roles.worker, roles.governance]]);
      expect(observation.roles).toEqual([
        { service: "api", purpose: "application", ...actual.rows.find(row => row.name === roles.api) },
        { service: "worker", purpose: "application", ...actual.rows.find(row => row.name === roles.worker) },
        { service: "api", purpose: "catalog-governance-command", ...actual.rows.find(row => row.name === roles.governance) },
      ]);
      const text = JSON.stringify(observation);
      expect(Object.values(secrets).some(secret => text.includes(secret))).toBe(false);
    } finally { await source.close(); }
    await expect(observeRuntimeRoles(source)).rejects.toThrow("CLOSED-OR-LOST");
  });
});

it("refuses the actual bootstrap LOGIN hidden by the old V13 postgres exclusion", async () => {
  // Independently prove this URL authenticates as the actual bootstrap identity.
  expect((await admin.query("select oid::text,rolsuper from pg_catalog.pg_roles where rolname=session_user")).rows)
    .toEqual([{ oid: "10", rolsuper: true }]);
  await within({ api: target.url }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock }))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
  });
});

it.each(["manager", "governance"] as const)("rejects actual %s credentials used in an application configuration", async key => {
  await within({ api: connection(key) }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock })).rejects.toThrow("PCAT-RUNTIME-");
  });
});

it("refuses an unproven endpoint before authenticating a retargeted URL", async () => {
  const wrong = new URL(connection("api")); wrong.port = wrong.port === "1" ? "2" : "1";
  await within({ api: wrong.href }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock })).rejects.toThrow("TARGET-ENDPOINT-MISMATCH");
  });
});

it("refuses replacement of the pinned file after actual LOGIN authentication", async () => {
  await within({}, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      const filename = path.join(f.directory, "api"), original = await readFile(filename);
      await rename(filename, `${filename}.original`); await writeFile(filename, original, { mode: 0o600 });
      await expect(observeRuntimeRoles(source)).rejects.toThrow("OBSERVATION-UNAVAILABLE");
    } finally { await source.close(); }
  });
});

it("observes a runtime privilege change after issuance instead of trusting cached identity", async () => {
  await within({}, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      await admin.query(`alter role ${pg.escapeIdentifier(roles.worker)} createdb`);
      await expect(observeRuntimeRoles(source)).rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
    } finally {
      await source.close(); await admin.query(`alter role ${pg.escapeIdentifier(roles.worker)} nocreatedb`);
    }
  });
});
