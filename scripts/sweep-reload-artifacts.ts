import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { reclaimStaleDeployingReloadRuns } from "../server/modules/dts-reload/service";
import {
  drainOverlayArtifactGcJobs,
  enqueueOverlayArtifactGcJobsForExpiredArtifacts
} from "../server/modules/jobs/overlayArtifactGc";

// DTS reload housekeeping for a scheduled ops invocation (cron); safe to run repeatedly:
//   1. reclaim runs wedged in `deploying` by a crashed deployer (reset to failed → deployable again)
//   2. enqueue overlay-artifact-gc jobs (one live job per org) and drain them through the jobs worker
const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run reload housekeeping.");
}

const db = createPostgresDatabase(env.DATABASE_URL);
const objectStore = createObjectStoreFromEnv(env);

const reclaimed = await reclaimStaleDeployingReloadRuns(db);
const enqueued = await enqueueOverlayArtifactGcJobsForExpiredArtifacts(db);
const results = await drainOverlayArtifactGcJobs({ db, objectStore });

const processed = results.filter((result) => result.status === "processed");
const retried = results.filter((result) => result.status === "retry").length;
const deadLettered = results.filter((result) => result.status === "dead-lettered").length;
const scannedRuns = processed.reduce((sum, result) => sum + result.digest.scannedRuns, 0);
const reclaimedRuns = processed.reduce((sum, result) => sum + result.digest.reclaimedRuns, 0);
const deletedBlobs = processed.reduce((sum, result) => sum + result.digest.deletedBlobs, 0);

console.log(
  `Reload housekeeping: reclaimed ${reclaimed.reclaimedRuns} stale deploying run(s); ` +
    `enqueued ${enqueued.length} overlay-artifact-gc job(s); ` +
    `artifact sweep scanned ${scannedRuns} expired run(s), reclaimed ${reclaimedRuns}, deleted ${deletedBlobs} blob(s)` +
    (retried || deadLettered ? `; retrying ${retried}, dead-lettered ${deadLettered}` : "") +
    "."
);

process.exit(deadLettered > 0 ? 1 : 0);
