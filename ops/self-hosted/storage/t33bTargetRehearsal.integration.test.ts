import { describe, expect, it } from "vitest";

import { runT33bTargetRehearsal } from "./t33bTargetRehearsal";

const input = {
  postgresUrl:
    process.env.WISEEFF_T33B_POSTGRES_URL ??
    "postgres://wiseeff:t33b-postgres-secret-32chars@127.0.0.1:55442/wiseeff",
  redisUrl: process.env.WISEEFF_T33B_REDIS_URL ?? "redis://127.0.0.1:56380",
  s3Endpoint: process.env.WISEEFF_T33B_S3_ENDPOINT ?? "http://127.0.0.1:59010",
  s3Bucket: process.env.WISEEFF_T33B_S3_BUCKET ?? "wiseeff",
  s3AccessKeyId: process.env.WISEEFF_T33B_S3_ACCESS_KEY ?? "t33b-minio",
  s3SecretAccessKey: process.env.WISEEFF_T33B_S3_SECRET_KEY ?? "t33b-minio-secret-32chars",
  exclusiveToken: process.env.WISEEFF_T33B_UNFREEZE_TOKEN ?? "exclusive-t33b-token",
  publicUrl: process.env.WISEEFF_T33B_PUBLIC_URL ?? "http://127.0.0.1:18080",
};

describe("T3.3b local self-hosted target rehearsal", () => {
  it("fences live services, exclusive-unfreezes, restores, and preserves non-parameter data", { timeout: 180_000 }, async () => {
    const result = await runT33bTargetRehearsal(input);
    expect(result.quiescence.writersFenced).toBe(true);
    expect(result.quiescence.queuesDrained).toBe(true);
    expect(result.quiescence.publicProxyStopped).toBe(true);
    expect(result.quiescence.publicationFrozen).toBe(true);
    expect(result.unfreeze.frozenAfter).toBe(true);
    expect(result.unfreezeFailureRefrozen).toBe(true);
    expect(result.unfreeze.activationReceipt.startsWith("t33b-receipt-")).toBe(true);
    expect(result.restore.status).toBe("restore-authorized");
    expect(result.priorCaptureRefused).toBe(true);
    expect(result.sentinelPreserved).toBe(true);
    expect(result.postRestart.live).toBe(true);
    expect(result.destructiveArchiveRebuild).toBe("not-in-plan");
    expect(result.publicUrl).toBe(input.publicUrl);
  });
});
