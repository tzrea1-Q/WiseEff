import { randomBytes } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { withCatalogStageLogging } from "../../../observability/catalogPublicationStages";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { bootstrapFirstAcme, connect, domainSnapshot, persistPredecessorArtifact, provisionOnlineActivation } from "../../catalog-kernel/install/publicationTestHarness";
import { identitySnapshotOf } from "../builder/identitySnapshot";
import { asQueryable } from "../persistence/integrationHarness";
import { putValidatedPreviewSnapshot } from "../persistence/store";
import { prewarmCatalogCheckpoint } from "./prewarmCheckpoint";

async function withRuntime(url: string, run: (owner: pg.Client, installer: pg.Pool, manager: pg.Pool) => Promise<void>) {
  const token = randomBytes(8).toString("hex");
  const roles = await provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: token });
  const owner = await connect(url);
  const installer = new pg.Pool({ connectionString: url });
  const manager = new pg.Pool({ connectionString: roles.managerUrl, application_name: "prewarm-test" });
  try {
    await run(owner, installer, manager);
  } finally {
    await Promise.all([owner.end(), installer.end(), manager.end()]);
    await dropLabRuntimeLogins(url, token);
  }
}

it("warms an installed pre-upgrade release and repairs a missing preview while preserving publication history", async () => {
  await withTempDatabase({ prefix: "prewarmupgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { before: "0376" });
    await withRuntime(connectionString, async (owner, installer, manager) => {
      const built = await provisionOnlineActivation(installer, owner);
      expect(await installPublishedRelease(manager, built.command)).toMatchObject({ ok: true, value: { status: "installed" } });
      const publicationRows = async () => (await owner.query(
        `select to_jsonb(j) as job, to_jsonb(r) as receipt from catalog_publication.publication_jobs j
           join parameter_catalog.catalog_activation_receipts r on r.publication_job_id = j.id order by j.id`,
      )).rows;
      const before = await domainSnapshot(owner);
      const rows = await publicationRows();
      expect(rows).toHaveLength(1);
      await applyMigrations(db, migrationsDir);
      const events: Record<string, string | number>[] = [];
      const warm = () => withCatalogStageLogging({ requestId: "prewarm-regression" },
        () => prewarmCatalogCheckpoint(manager), entry => events.push(entry));
      expect(await warm()).toEqual({ status: "warmed" });
      expect(events.some(e => e.stage === "artifact-read" && e.state === "finished" && Number(e.byteCount) > 0)).toBe(true);
      events.length = 0;
      expect(await warm()).toEqual({ status: "already-warm" });
      expect(events.some(e => e.stage === "artifact-read")).toBe(false);
      const checkpoints = () => owner.query("select * from catalog_publication.activation_checkpoints");
      const checkpoint = (await checkpoints()).rows;
      expect(checkpoint).toHaveLength(1);
      expect((await owner.query("delete from catalog_publication.preview_snapshots where artifact_digest = $1", [before.currentDigest])).rowCount).toBe(1);
      expect(await warm()).toEqual({ status: "warmed" });
      expect(await warm()).toEqual({ status: "already-warm" });
      expect((await checkpoints()).rows).toEqual(checkpoint);
      await owner.query("delete from catalog_publication.activation_checkpoints");
      expect((await owner.query(
        "update catalog_publication.preview_snapshots set target_bytes = $1 where artifact_digest = $2",
        [Buffer.from("corrupt certified target"), before.currentDigest],
      )).rowCount).toBe(1);
      await expect(warm()).rejects.toThrow("invalid-preview-checkpoint");
      expect((await checkpoints()).rowCount).toBe(0);
      expect(await domainSnapshot(owner)).toEqual(before);
      expect(await publicationRows()).toEqual(rows);
    });
  });
}, 120_000);

it.each(["epoch change", "corrupt concurrent preview"])("coalesces prewarms and discards a stale result after %s", async race => {
  await withTempDatabase({ prefix: "prewarmrace" }, ({ connectionString }) => withRuntime(connectionString, async (owner, installer, manager) => {
    const base = await bootstrapFirstAcme(installer);
    await persistPredecessorArtifact(owner, base);
    await owner.query("begin");
    const lock = await owner.query<{ pid: number }>("select pg_backend_pid() as pid from catalog_publication.checkpoint_epoch for update");
    const first = prewarmCatalogCheckpoint(manager);
    try {
      await vi.waitFor(async () => expect((await installer.query(
        `select 1 from pg_stat_activity where application_name='prewarm-test' and $1::integer = any(pg_blocking_pids(pid))`, [lock.rows[0]!.pid],
      )).rowCount).toBe(1), { interval: 20, timeout: 10_000 });
      expect(await prewarmCatalogCheckpoint(manager)).toEqual({ status: "prewarm-in-progress" });
      if (race === "epoch change") {
        await owner.query("update catalog_publication.checkpoint_epoch set generation=generation+1 where singleton");
      } else {
        const saved = await putValidatedPreviewSnapshot(asQueryable(owner), base.digest, identitySnapshotOf(base.bundle, base.first));
        expect(saved.ok).toBe(true);
        await owner.query("update catalog_publication.preview_snapshots set target_bytes=$1", [Buffer.from("corrupt concurrent write")]);
      }
      const outcome = race === "epoch change"
        ? expect(first).resolves.toEqual({ status: "current-pins-changed" })
        : expect(first).rejects.toThrow("prewarm-preview-write-failed");
      await owner.query("commit");
      await outcome;
      expect((await owner.query("select * from catalog_publication.activation_checkpoints")).rowCount).toBe(0);
      expect((await owner.query("delete from catalog_publication.preview_snapshots")).rowCount).toBe(race === "epoch change" ? 0 : 1);
      expect(await prewarmCatalogCheckpoint(manager)).toEqual({ status: "warmed" });
    } finally {
      await owner.query("rollback");
      await first.catch(() => undefined);
    }
  }));
}, 60_000);

it("rejects corrupt history without installing either checkpoint or changing the active release", async () => {
  await withTempDatabase({ prefix: "prewarmcorrupt" }, ({ connectionString }) => withRuntime(connectionString, async (owner, installer, manager) => {
    expect(await prewarmCatalogCheckpoint(manager)).toEqual({ status: "no-current-release" });
    const base = await bootstrapFirstAcme(installer);
    await persistPredecessorArtifact(owner, { ...base, bytes: Buffer.from("not a release bundle") });
    const before = await domainSnapshot(owner);
    await expect(prewarmCatalogCheckpoint(manager)).rejects.toThrow("prewarm-artifact-integrity-failed");
    expect((await owner.query("select * from catalog_publication.activation_checkpoints")).rowCount).toBe(0);
    expect((await owner.query("select * from catalog_publication.preview_snapshots")).rowCount).toBe(0);
    expect(await domainSnapshot(owner)).toEqual(before);
  }));
}, 60_000);
