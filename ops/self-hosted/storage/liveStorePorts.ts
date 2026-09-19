import net from "node:net";
import { createHash } from "node:crypto";

import { createS3ObjectStore } from "../../../server/modules/logs/s3ObjectStore";
import type { StoreSnapshot, StoreSnapshotPort } from "./recoveryPoint";

const sha256Prefixed = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const canonicalJson = (value: unknown): string => JSON.stringify(value);

const redisCommand = async (host: string, port: number, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const chunks: Buffer[] = [];
    const payload = `*${args.length}\r\n${args
      .map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`)
      .join("")}`;
    socket.setTimeout(5_000);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("redis snapshot timed out"));
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.write(payload, () => socket.end());
  });

const parseRedisUrl = (url: string): { host: string; port: number } => {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 6379 };
};

export function createRedisStorePort(redisUrl: string): StoreSnapshotPort {
  const { host, port } = parseRedisUrl(redisUrl);
  const identity = `${host}:${port}`;
  return {
    kind: "redis",
    declaredIdentity: identity,
    async snapshot(now: Date): Promise<StoreSnapshot | null> {
      const ping = await redisCommand(host, port, ["PING"]);
      const dbsize = await redisCommand(host, port, ["DBSIZE"]);
      const info = await redisCommand(host, port, ["INFO", "persistence"]);
      if (!ping.includes("PONG")) {
        return null;
      }
      return {
        kind: "redis",
        identity,
        checksum: sha256Prefixed(canonicalJson({ identity, ping: ping.trim(), dbsize: dbsize.trim(), info: info.trim() })),
        capturedAt: now.toISOString(),
      };
    },
  };
}

export type S3StorePortInput = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string;
};

export function createS3StorePort(input: S3StorePortInput): StoreSnapshotPort {
  const identity = `${input.endpoint.replace(/\/$/, "")}/${input.bucket}`;
  const store = createS3ObjectStore({
    endpoint: input.endpoint,
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: input.region,
  });
  return {
    kind: "object-store",
    declaredIdentity: identity,
    async snapshot(now: Date): Promise<StoreSnapshot | null> {
      const health = await store.checkHealth();
      if (!health.ok) {
        return null;
      }
      return {
        kind: "object-store",
        identity,
        checksum: sha256Prefixed(canonicalJson({ identity, status: health.status, message: health.message ?? "" })),
        capturedAt: now.toISOString(),
      };
    },
  };
};
