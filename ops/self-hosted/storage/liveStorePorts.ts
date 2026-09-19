import net from "node:net";
import { createHash } from "node:crypto";

import { createS3ObjectStore } from "../../../server/modules/logs/s3ObjectStore";
import type { StoreSnapshot, StoreSnapshotPort } from "./recoveryPoint";

const sha256Prefixed = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const canonicalJson = (value: unknown): string => JSON.stringify(value);

type RedisValue = string | number | null | readonly RedisValue[];

const parseRedisReply = (raw: string, offset = 0): { value: RedisValue; next: number } => {
  const kind = raw[offset];
  if (kind === "+" || kind === "-" || kind === ":") {
    const end = raw.indexOf("\r\n", offset);
    const payload = raw.slice(offset + 1, end);
    if (kind === "-") {
      throw new Error(payload);
    }
    if (kind === ":") {
      return { value: Number(payload), next: end + 2 };
    }
    return { value: payload, next: end + 2 };
  }
  if (kind === "$") {
    const headerEnd = raw.indexOf("\r\n", offset);
    const length = Number(raw.slice(offset + 1, headerEnd));
    if (length < 0) {
      return { value: null, next: headerEnd + 2 };
    }
    const start = headerEnd + 2;
    return { value: raw.slice(start, start + length), next: start + length + 2 };
  }
  if (kind === "*") {
    const headerEnd = raw.indexOf("\r\n", offset);
    const count = Number(raw.slice(offset + 1, headerEnd));
    if (count < 0) {
      return { value: null, next: headerEnd + 2 };
    }
    let next = headerEnd + 2;
    const items: RedisValue[] = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = parseRedisReply(raw, next);
      items.push(parsed.value);
      next = parsed.next;
    }
    return { value: items, next };
  }
  throw new Error(`unsupported redis reply: ${raw.slice(offset, offset + 24)}`);
};

export const decodeRedisReply = (raw: string): RedisValue => parseRedisReply(raw).value;

export const redisCommand = async (host: string, port: number, args: readonly string[]): Promise<string> =>
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

export const redisExecUrl = async (redisUrl: string, args: readonly string[]): Promise<string> => {
  const { host, port } = parseRedisUrl(redisUrl);
  return redisCommand(host, port, args);
};

const redisKeyFingerprint = async (
  host: string,
  port: number,
  key: string,
): Promise<{ readonly key: string; readonly value: string }> => {
  const kind = String(decodeRedisReply(await redisCommand(host, port, ["TYPE", key])));
  if (kind === "string") {
    const got = decodeRedisReply(await redisCommand(host, port, ["GET", key]));
    return { key, value: got === null ? "" : String(got) };
  }
  if (kind === "list") {
    return { key, value: `llen:${String(decodeRedisReply(await redisCommand(host, port, ["LLEN", key])))}` };
  }
  if (kind === "hash") {
    return { key, value: `hlen:${String(decodeRedisReply(await redisCommand(host, port, ["HLEN", key])))}` };
  }
  if (kind === "set") {
    return { key, value: `scard:${String(decodeRedisReply(await redisCommand(host, port, ["SCARD", key])))}` };
  }
  if (kind === "zset") {
    return { key, value: `zcard:${String(decodeRedisReply(await redisCommand(host, port, ["ZCARD", key])))}` };
  }
  if (kind === "stream") {
    return { key, value: `xlen:${String(decodeRedisReply(await redisCommand(host, port, ["XLEN", key])))}` };
  }
  return { key, value: `type:${kind}` };
};

const redisStringKeys = async (
  host: string,
  port: number,
): Promise<readonly { readonly key: string; readonly value: string }[]> => {
  const keysReply = decodeRedisReply(await redisCommand(host, port, ["KEYS", "*"]));
  const keys = Array.isArray(keysReply) ? keysReply.map(String).sort() : [];
  const entries: { key: string; value: string }[] = [];
  for (const key of keys) {
    entries.push(await redisKeyFingerprint(host, port, key));
  }
  return entries;
};

export function createRedisStorePort(redisUrl: string): StoreSnapshotPort {
  const { host, port } = parseRedisUrl(redisUrl);
  const identity = `${host}:${port}`;
  return {
    kind: "redis",
    declaredIdentity: identity,
    async snapshot(now: Date): Promise<StoreSnapshot | null> {
      const ping = decodeRedisReply(await redisCommand(host, port, ["PING"]));
      const dbsize = decodeRedisReply(await redisCommand(host, port, ["DBSIZE"]));
      if (ping !== "PONG") {
        return null;
      }
      const entries = await redisStringKeys(host, port);
      return {
        kind: "redis",
        identity,
        checksum: sha256Prefixed(canonicalJson({ identity, ping, dbsize, entries })),
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
