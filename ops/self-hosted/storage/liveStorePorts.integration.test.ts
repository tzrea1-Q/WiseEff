import { describe, expect, it } from "vitest";

import { captureRecoveryPoint, createPostgresStorePort } from "./recoveryPoint";
import { createRedisStorePort, createS3StorePort } from "./liveStorePorts";

const postgresUrl = process.env.WISEEFF_T34A_POSTGRES_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:55441/wiseeff_t34a";
const redisUrl = process.env.WISEEFF_T34A_REDIS_URL ?? "redis://127.0.0.1:56379";
const s3Endpoint = process.env.WISEEFF_T34A_S3_ENDPOINT ?? "http://127.0.0.1:59000";
const s3Bucket = process.env.WISEEFF_T34A_S3_BUCKET ?? "wiseeff-t34a";
const s3Access = process.env.WISEEFF_T34A_S3_ACCESS_KEY ?? "t34a-minio";
const s3Secret = process.env.WISEEFF_T34A_S3_SECRET_KEY ?? "t34a-minio-secret-32chars";

const isolatedStores = process.env.CI !== "true" || Boolean(process.env.WISEEFF_T34A_POSTGRES_URL);

describe.skipIf(!isolatedStores)("T3.4a live Docker three-store capture", () => {
  it("captures postgres, minio, and redis from the isolated compose stack", async () => {
    const postgres = createPostgresStorePort(postgresUrl, { allowComposeApp: false });
    const redis = createRedisStorePort(redisUrl);
    const objectStore = createS3StorePort({
      endpoint: s3Endpoint,
      bucket: s3Bucket,
      accessKeyId: s3Access,
      secretAccessKey: s3Secret,
      region: "us-east-1",
    });
    const captured = await captureRecoveryPoint({
      runId: "t34a-live-stores",
      target: {
        deploymentId: "t34a-docker",
        hostFingerprint: "sha256:t34a-local-docker",
        postgresIdentity: postgres.declaredIdentity,
        objectStoreIdentity: objectStore.declaredIdentity,
        redisIdentity: redis.declaredIdentity,
      },
      quiescence: {
        status: "quiesced",
        writersFenced: true,
        queueDrained: true,
        proxyStopped: true,
        observedAt: new Date().toISOString(),
      },
      stores: [postgres, objectStore, redis],
      maximumAgeMs: 3_600_000,
    });
    expect(captured.ok, captured.ok ? "" : `${captured.error.kind}: ${captured.error.detail}`).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.manifest.stores.postgres.checksum.startsWith("sha256:")).toBe(true);
    expect(captured.value.manifest.stores.objectStore.checksum.startsWith("sha256:")).toBe(true);
    expect(captured.value.manifest.stores.redis.checksum.startsWith("sha256:")).toBe(true);
  });
});
