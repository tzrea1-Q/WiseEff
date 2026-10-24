import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { insertReloadRun } from "../dts-reload/repository";
import { RELOAD_ARTIFACT_RETENTION_DAYS } from "../dts-reload/types";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createLocalObjectStore } from "../logs/objectStore";
import {
  drainOverlayArtifactGcJobs,
  enqueueOverlayArtifactGcJobsForExpiredArtifacts,
  enqueueOverlayArtifactGcJob,
  processNextOverlayArtifactGcJob
} from "./overlayArtifactGc";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG = "org-gc";
const OTHER_ORG = "org-gc-other";
const WORKER = "overlay-artifact-gc-worker";

function expiredIso(daysBeyondRetention = 3) {
  return new Date(
    Date.now() - (RELOAD_ARTIFACT_RETENTION_DAYS + daysBeyondRetention) * 24 * 60 * 60 * 1000
  ).toISOString();
}

describe.skipIf(!databaseAvailable)("overlay-artifact-gc job", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: ORG, name: "GC Org" },
      users: [{ id: "user-gc", name: "Ops", email: "ops@example.com" }],
      projects: [{ id: "project-gc" }]
    });
    await seedCoreGraph(db, {
      organization: { id: OTHER_ORG, name: "Other GC Org" },
      projects: [{ id: "project-gc-other" }]
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  async function seedExpiredRun(input: {
    id: string;
    organizationId?: string;
    projectId?: string;
    artifactKey?: string;
    sourceKey?: string;
    artifactSha?: string;
  }) {
    const organizationId = input.organizationId ?? ORG;
    const completedAt = expiredIso();
    await insertReloadRun(db, {
      id: input.id,
      organizationId,
      projectId: input.projectId ?? "project-gc",
      configRevisionId: null,
      status: "verified",
      purpose: "ordinary",
      deviceId: null,
      restoresSourceRunId: null,
      failureCode: null,
      steps: [],
      diagnostics: [],
      toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
      overlaySourceStorageKey: input.sourceKey ?? `${organizationId}/overlay.dts`,
      overlaySourceSha256: "src-sha",
      overlayArtifactStorageKey: input.artifactKey ?? `${organizationId}/overlay.dtbo`,
      overlayArtifactSha256: input.artifactSha ?? "art-sha",
      overlayArtifactBytes: 32,
      createdByUserId: "user-gc",
      completedAt
    });
    await db.query("update dts_reload_runs set created_at = $2 where id = $1", [input.id, completedAt]);
  }

  async function jobRow(id: string) {
    const result = await db.query<{
      id: string;
      kind: string;
      organization_id: string;
      status: string;
      progress: number;
      current_stage: string | null;
      error_message: string | null;
      next_run_at: string | Date | null;
      dead_letter_reason: string | null;
      dead_lettered_at: string | Date | null;
      attempt_count: number;
    }>(
      `select id, kind, organization_id, status, progress, current_stage, error_message,
              next_run_at, dead_letter_reason, dead_lettered_at, attempt_count
       from jobs where id = $1`,
      [id]
    );
    return result.rows[0];
  }

  it("enqueues one queued overlay-artifact-gc job and reuses it while still live", async () => {
    const first = await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-1" });
    const second = await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-2" });

    expect(first).toMatchObject({
      id: "gc-job-1",
      kind: "overlay-artifact-gc",
      organizationId: ORG,
      status: "queued"
    });
    expect(second.id).toBe("gc-job-1");
    const rows = await db.query<{ id: string }>(
      `select id from jobs where kind = 'overlay-artifact-gc' and organization_id = $1`,
      [ORG]
    );
    expect(rows.rows).toEqual([{ id: "gc-job-1" }]);
  });

  it("keeps suspended artifacts queued while the sweep drains active Organizations, then resumes after restore", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "overlay-lifecycle-")), objectStore = createLocalObjectStore(directory);
    try {
      const paused = await objectStore.put({ organizationId: ORG, fileName: "paused.dtbo", contentType: "application/octet-stream", bytes: Buffer.from("paused artifact") });
      const active = await objectStore.put({ organizationId: OTHER_ORG, fileName: "active.dtbo", contentType: "application/octet-stream", bytes: Buffer.from("active artifact") });
      const pausedSource = await objectStore.put({ organizationId: ORG, fileName: "paused.dts", contentType: "text/plain", bytes: Buffer.from("paused source") });
      const activeSource = await objectStore.put({ organizationId: OTHER_ORG, fileName: "active.dts", contentType: "text/plain", bytes: Buffer.from("active source") });
      await seedExpiredRun({ id: "paused-run", artifactKey: paused.storageKey, sourceKey: pausedSource.storageKey });
      await seedExpiredRun({ id: "active-run", organizationId: OTHER_ORG, projectId: "project-gc-other", artifactKey: active.storageKey, sourceKey: activeSource.storageKey });
      await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "paused-gc" });
      await db.query("update jobs set created_at=now()-interval '1 day' where id='paused-gc'");
      await db.query("update organizations set status='suspended' where id=$1", [ORG]);
      const enqueued = await enqueueOverlayArtifactGcJobsForExpiredArtifacts(db);
      expect(enqueued.map(job => job.organizationId)).toEqual([OTHER_ORG]);
      expect(await drainOverlayArtifactGcJobs({ db, objectStore })).toEqual([{ status: "processed", digest: { scannedRuns: 1, reclaimedRuns: 1, deletedBlobs: 2 } }]);
      expect((await objectStore.get(paused.storageKey)).toString()).toBe("paused artifact");
      expect((await objectStore.get(pausedSource.storageKey)).toString()).toBe("paused source");
      await expect(objectStore.get(active.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(objectStore.get(activeSource.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await jobRow("paused-gc")).toMatchObject({ status: "queued", attempt_count: 0 });
      await db.query("update organizations set status='active' where id=$1", [ORG]);
      expect((await enqueueOverlayArtifactGcJobsForExpiredArtifacts(db)).map(job => job.id)).toEqual(["paused-gc"]);
      expect(await drainOverlayArtifactGcJobs({ db, objectStore })).toEqual([{ status: "processed", digest: { scannedRuns: 1, reclaimedRuns: 1, deletedBlobs: 2 } }]);
      await expect(objectStore.get(paused.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(objectStore.get(pausedSource.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await jobRow("paused-gc")).toMatchObject({ status: "complete", attempt_count: 1 });
      expect((await db.query("select overlay_artifact_storage_key,overlay_artifact_sha256 from dts_reload_runs where id='paused-run'")).rows).toEqual([{ overlay_artifact_storage_key: null, overlay_artifact_sha256: "art-sha" }]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reclaims expired overlay blobs, keeps run digests, writes audit, and completes", async () => {
    await seedExpiredRun({
      id: "run-expired",
      artifactKey: `${ORG}/a.dtbo`,
      sourceKey: `${ORG}/a.dts`,
      artifactSha: "digest-keep"
    });
    await seedExpiredRun({
      id: "run-other-org",
      organizationId: OTHER_ORG,
      projectId: "project-gc-other",
      artifactKey: `${OTHER_ORG}/b.dtbo`,
      sourceKey: `${OTHER_ORG}/b.dts`
    });

    const objectStore = createMemoryObjectStore();
    objectStore.entries.set(`${ORG}/a.dtbo`, Buffer.from("dtbo-a"));
    objectStore.entries.set(`${ORG}/a.dts`, Buffer.from("dts-a"));
    objectStore.entries.set(`${OTHER_ORG}/b.dtbo`, Buffer.from("dtbo-b"));

    await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-1" });

    const result = await processNextOverlayArtifactGcJob({
      db,
      objectStore,
      workerId: WORKER
    });

    expect(result).toEqual({
      status: "processed",
      digest: { scannedRuns: 1, reclaimedRuns: 1, deletedBlobs: 2 }
    });
    expect(objectStore.entries.has(`${ORG}/a.dtbo`)).toBe(false);
    expect(objectStore.entries.has(`${ORG}/a.dts`)).toBe(false);
    expect(objectStore.entries.has(`${OTHER_ORG}/b.dtbo`)).toBe(true);

    const expired = await db.query<{
      overlay_artifact_storage_key: string | null;
      overlay_source_storage_key: string | null;
      overlay_artifact_sha256: string | null;
      overlay_source_sha256: string | null;
      overlay_artifact_bytes: number | string | null;
    }>(
      `select overlay_artifact_storage_key, overlay_source_storage_key,
              overlay_artifact_sha256, overlay_source_sha256, overlay_artifact_bytes
       from dts_reload_runs where id = 'run-expired'`
    );
    expect(expired.rows[0]).toEqual({
      overlay_artifact_storage_key: null,
      overlay_source_storage_key: null,
      overlay_artifact_sha256: "digest-keep",
      overlay_source_sha256: "src-sha",
      overlay_artifact_bytes: 32
    });

    expect(await jobRow("gc-job-1")).toMatchObject({
      kind: "overlay-artifact-gc",
      status: "complete",
      progress: 100
    });

    const audits = await db.query<{
      organization_id: string | null;
      actor_type: string;
      app: string;
      kind: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select organization_id, actor_type, app, kind, action, target_type, target_id, metadata
       from audit_events
       where kind = 'overlay-artifact-gc'
       order by organization_id nulls first`
    );
    expect(audits.rows).toEqual([
      {
        organization_id: null,
        actor_type: "system",
        app: "dts-reload",
        kind: "overlay-artifact-gc",
        action: "sweep",
        target_type: "overlay-artifact-gc",
        target_id: "gc-job-1",
        metadata: {
          scannedRuns: 1,
          reclaimedRuns: 1,
          deletedBlobs: 2,
          organizationId: ORG
        }
      },
      {
        organization_id: ORG,
        actor_type: "system",
        app: "dts-reload",
        kind: "overlay-artifact-gc",
        action: "sweep",
        target_type: "overlay-artifact-gc",
        target_id: "gc-job-1",
        metadata: {
          scannedRuns: 1,
          reclaimedRuns: 1,
          deletedBlobs: 2,
          organizationId: ORG
        }
      }
    ]);
  });

  it("schedules a retry when the sweep throws, then dead-letters after max attempts", async () => {
    await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-retry" });
    const objectStore = createMemoryObjectStore();
    const now = () => new Date("2026-08-18T00:00:00.000Z");

    const first = await processNextOverlayArtifactGcJob({
      db,
      objectStore,
      workerId: WORKER,
      maxAttempts: 2,
      retryBaseDelayMs: 1000,
      now,
      sweep: async () => {
        throw new Error("object store timeout");
      }
    });
    expect(first).toMatchObject({ status: "retry" });
    expect(await jobRow("gc-job-retry")).toMatchObject({
      status: "queued",
      error_message: "object store timeout",
      dead_lettered_at: null
    });

    await db.query(`update jobs set next_run_at = now() - interval '1 second' where id = 'gc-job-retry'`);

    const second = await processNextOverlayArtifactGcJob({
      db,
      objectStore,
      workerId: WORKER,
      maxAttempts: 2,
      retryBaseDelayMs: 1000,
      now,
      sweep: async () => {
        throw new Error("object store timeout");
      }
    });
    expect(second).toMatchObject({ status: "dead-lettered" });
    expect(await jobRow("gc-job-retry")).toMatchObject({
      status: "failed",
      dead_letter_reason: "Job exhausted 2 attempts."
    });
  });

  it("can enqueue a new overlay-artifact-gc job after the previous run completes", async () => {
    await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-1" });
    await processNextOverlayArtifactGcJob({
      db,
      objectStore: createMemoryObjectStore(),
      workerId: WORKER
    });

    const next = await enqueueOverlayArtifactGcJob(db, { organizationId: ORG, id: "gc-job-2" });
    expect(next).toMatchObject({ id: "gc-job-2", status: "queued" });
    const rows = await db.query<{ id: string; status: string }>(
      `select id, status from jobs where kind = 'overlay-artifact-gc' and organization_id = $1 order by id`,
      [ORG]
    );
    expect(rows.rows).toEqual([
      { id: "gc-job-1", status: "complete" },
      { id: "gc-job-2", status: "queued" }
    ]);
  });

  it("is idle when no overlay-artifact-gc job is due", async () => {
    const result = await processNextOverlayArtifactGcJob({
      db,
      objectStore: createMemoryObjectStore(),
      workerId: WORKER
    });
    expect(result).toEqual({ status: "idle" });
  });
});
