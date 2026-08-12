import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import {
  reclaimStaleDeployingReloadRuns,
  sweepExpiredReloadArtifacts
} from "../server/modules/dts-reload/service";

// DTS reload housekeeping for a scheduled ops invocation (cron); safe to run repeatedly:
//   1. reclaim runs wedged in `deploying` by a crashed deployer (reset to failed → deployable again)
//   2. physically reclaim overlay blobs for runs past RELOAD_ARTIFACT_RETENTION_DAYS
const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run reload housekeeping.");
}

const db = createPostgresDatabase(env.DATABASE_URL);
const objectStore = createObjectStoreFromEnv(env);

const reclaimed = await reclaimStaleDeployingReloadRuns(db);
const swept = await sweepExpiredReloadArtifacts(db, objectStore);

console.log(
  `Reload housekeeping: reclaimed ${reclaimed.reclaimedRuns} stale deploying run(s); ` +
    `artifact sweep scanned ${swept.scannedRuns} expired run(s), reclaimed ${swept.reclaimedRuns}, deleted ${swept.deletedBlobs} blob(s).`
);

process.exit(0);
