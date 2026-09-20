import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { redisExecUrl } from "./liveStorePorts";
import {
  observeLiveQuiescence,
  runT33aDockerRehearsal,
  T33A_FREEZE_KEY,
  T33A_QUEUE_KEY,
} from "./t33aDockerRehearsal";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const opsWrapper = path.join(projectRoot, "ops/self-hosted/scripts/parameter-catalog-cutover.sh");
const wayfinderCli = path.join(projectRoot, "scripts/wayfinder/rehearse-s2-docker.ts");

const input = {
  postgresUrl: process.env.WISEEFF_T34A_POSTGRES_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:55441/wiseeff_t34a",
  redisUrl: process.env.WISEEFF_T34A_REDIS_URL ?? "redis://127.0.0.1:56379",
  s3Endpoint: process.env.WISEEFF_T34A_S3_ENDPOINT ?? "http://127.0.0.1:59000",
  s3Bucket: process.env.WISEEFF_T34A_S3_BUCKET ?? "wiseeff-t34a",
  s3AccessKeyId: process.env.WISEEFF_T34A_S3_ACCESS_KEY ?? "t34a-minio",
  s3SecretAccessKey: process.env.WISEEFF_T34A_S3_SECRET_KEY ?? "t34a-minio-secret-32chars",
  exclusiveToken: process.env.WISEEFF_T33A_UNFREEZE_TOKEN ?? "exclusive-t33a-token",
};

const isolatedStores = process.env.CI !== "true" || Boolean(process.env.WISEEFF_T34A_POSTGRES_URL);

describe.skipIf(!isolatedStores)("T3.3a Docker S2 rehearsal", () => {
  it("observes live quiescence, exclusive-unfreezes with receipt, refreezes, and restores", async () => {
    const result = await runT33aDockerRehearsal(input);
    expect(result.quiescence.writersFenced).toBe(true);
    expect(result.quiescence.queuesDrained).toBe(true);
    expect(result.quiescence.publicProxyStopped).toBe(true);
    expect(result.quiescence.publicationFrozen).toBe(true);
    expect(result.unfreeze.frozenAfter).toBe(true);
    expect(result.unfreezeFailureRefrozen).toBe(true);
    expect(result.unfreeze.activationReceipt.startsWith("t33a-receipt-")).toBe(true);
    expect(result.restore.status).toBe("restore-authorized");
    expect(result.priorCaptureRefused).toBe(true);
    expect(result.capture.manifest.stores.postgres.checksum.startsWith("sha256:")).toBe(true);
    expect(result.capture.manifest.stores.objectStore.checksum.startsWith("sha256:")).toBe(true);
    expect(result.capture.manifest.stores.redis.checksum.startsWith("sha256:")).toBe(true);
  });

  it("fails P2 closed while a writer port is still listening", async () => {
    await redisExecUrl(input.redisUrl, ["DEL", T33A_QUEUE_KEY]);
    await redisExecUrl(input.redisUrl, ["SET", T33A_FREEZE_KEY, "1"]);
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(19991, "127.0.0.1", resolve);
    });
    try {
      await expect(observeLiveQuiescence(input)).rejects.toThrow(/writers, queues, proxy, and publication freeze/i);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("prints sanitized diagnostics from repository root and ops/self-hosted", () => {
    chmodSync(opsWrapper, 0o755);
    const fromRoot = spawnSync("npx", ["tsx", wayfinderCli], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    const fromOps = spawnSync("bash", [opsWrapper, "rehearse-s2-docker"], {
      cwd: path.join(projectRoot, "ops/self-hosted"),
      encoding: "utf8",
      timeout: 60_000,
    });
    for (const result of [fromRoot, fromOps]) {
      const text = `${result.stdout}\n${result.stderr}`;
      expect(result.status, text).toBe(0);
      expect(text).not.toContain("t34a-minio-secret-32chars");
      expect(text).toContain("restore-authorized");
      expect(text).toContain("unfreezeFailureRefrozen");
    }
  });
});
