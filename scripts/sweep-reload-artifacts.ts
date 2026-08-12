import "dotenv/config";
import { loadServerEnv } from "../server/config/env";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { sweepExpiredReloadArtifacts } from "../server/modules/dts-reload/service";

// Physically reclaims overlay blobs for reload runs past RELOAD_ARTIFACT_RETENTION_DAYS.
// Intended for a scheduled ops invocation (cron); safe to run repeatedly.
const env = loadServerEnv(process.env);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to sweep reload artifacts.");
}

const db = createPostgresDatabase(env.DATABASE_URL);
const objectStore = createObjectStoreFromEnv(env);

const result = await sweepExpiredReloadArtifacts(db, objectStore);

console.log(
  `Reload artifact sweep: scanned ${result.scannedRuns} expired run(s), reclaimed ${result.reclaimedRuns}, deleted ${result.deletedBlobs} blob(s).`
);

process.exit(0);
