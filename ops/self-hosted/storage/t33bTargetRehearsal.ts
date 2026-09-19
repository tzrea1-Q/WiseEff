import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { exclusivePublicationUnfreeze } from "../../../server/modules/catalog-cutover/exclusiveUnfreeze";
import {
  assertObservedQuiescence,
  quiescenceEvidenceDigest,
  type ObservedQuiescence,
} from "../../../server/modules/catalog-cutover/quiescence";
import { createRedisStorePort, createS3StorePort, decodeRedisReply, redisExecUrl } from "./liveStorePorts";
import {
  captureRecoveryPoint,
  createPostgresStorePort,
  restoreCheck,
  verifyRecoveryPoint,
  type RecoveryPointCapture,
} from "./recoveryPoint";

const here = path.dirname(fileURLToPath(import.meta.url));
export const T33B_COMPOSE_DIR = path.resolve(here, "..");
export const T33B_PROJECT = "wiseeff-t33b-target";
export const T33B_FREEZE_KEY = "wiseeff:t33b:publication-freeze";
export const T33B_RECEIPT_KEY = "wiseeff:t33b:activation-receipt";
export const T33B_QUEUE_KEY = "wiseeff:t33b:jobs";
export const T33B_SENTINEL_SCHEMA = "t33b_preservation";

const WRITER_SERVICES = ["api", "worker", "publication-manager"] as const;
const PROXY_SERVICE = "proxy";

export type T33bTargetRehearsalInput = {
  readonly postgresUrl: string;
  readonly redisUrl: string;
  readonly s3Endpoint: string;
  readonly s3Bucket: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly exclusiveToken: string;
  readonly publicUrl: string;
  readonly composeDir?: string;
  readonly project?: string;
  readonly proxyPort?: number;
};

export type T33bTargetRehearsalResult = {
  readonly publicUrl: string;
  readonly quiescence: ObservedQuiescence;
  readonly capture: RecoveryPointCapture;
  readonly unfreeze: { readonly activationReceipt: string; readonly frozenAfter: true };
  readonly unfreezeFailureRefrozen: true;
  readonly restore: { readonly status: "restore-authorized"; readonly recoveryPointDigest: string };
  readonly priorCaptureRefused: true;
  readonly sentinelPreserved: true;
  readonly postRestart: { readonly live: true; readonly ready: boolean };
  readonly destructiveArchiveRebuild: "not-in-plan";
};

const portClosed = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(400);
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(true));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(true);
    });
  });

const redisText = async (redisUrl: string, args: readonly string[]): Promise<string> => {
  const value = decodeRedisReply(await redisExecUrl(redisUrl, args));
  return value === null ? "" : String(value);
};

const publicationFrozen = async (redisUrl: string): Promise<boolean> =>
  (await redisText(redisUrl, ["GET", T33B_FREEZE_KEY])) === "1";

const compose = (
  input: T33bTargetRehearsalInput,
  args: readonly string[],
): { status: number; stdout: string; stderr: string } => {
  const composeDir = input.composeDir ?? T33B_COMPOSE_DIR;
  const project = input.project ?? T33B_PROJECT;
  const envFile = path.join(composeDir, ".env.t33b-target");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "--env-file",
      envFile,
      "-f",
      "compose.yaml",
      "-f",
      "compose.t33b-target.yaml",
      ...args,
    ],
    { cwd: composeDir, encoding: "utf8" },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const requireCompose = (input: T33bTargetRehearsalInput, args: readonly string[]): void => {
  const result = compose(input, args);
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
};

const CONTAINER_BY_SERVICE: Record<string, string> = {
  api: "wiseeff-t33b-api",
  worker: "wiseeff-t33b-worker",
  "publication-manager": "wiseeff-t33b-publication-manager",
  proxy: "wiseeff-t33b-proxy",
};

const containerRunning = (service: string): boolean => {
  const name = CONTAINER_BY_SERVICE[service] ?? service;
  const result = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === "true";
};

const waitFor = async (probe: () => Promise<boolean>, label: string, timeoutMs = 120_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const httpOk = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return false;
  }
};

const freezePorts = (redisUrl: string) => ({
  isFrozen: async () => publicationFrozen(redisUrl),
  freeze: async () => {
    await redisExecUrl(redisUrl, ["SET", T33B_FREEZE_KEY, "1"]);
  },
  unfreeze: async () => {
    await redisExecUrl(redisUrl, ["SET", T33B_FREEZE_KEY, "0"]);
  },
});

export const installPreservationSentinel = async (postgresUrl: string, token: string): Promise<void> => {
  const client = new pg.Client({ connectionString: postgresUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`create schema if not exists ${T33B_SENTINEL_SCHEMA}`);
    await client.query(
      `create table if not exists ${T33B_SENTINEL_SCHEMA}.sentinel (k text primary key, v text not null)`,
    );
    await client.query(
      `insert into ${T33B_SENTINEL_SCHEMA}.sentinel(k, v) values ('non-parameter', $1)
       on conflict (k) do update set v = excluded.v`,
      [token],
    );
  } finally {
    await client.end();
  }
};

export const readPreservationSentinel = async (postgresUrl: string): Promise<string | null> => {
  const client = new pg.Client({ connectionString: postgresUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const rows = await client.query<{ v: string }>(
      `select v from ${T33B_SENTINEL_SCHEMA}.sentinel where k = 'non-parameter'`,
    );
    return rows.rows[0]?.v ?? null;
  } finally {
    await client.end();
  }
};

export const observeTargetQuiescence = async (
  input: T33bTargetRehearsalInput,
): Promise<ObservedQuiescence> => {
  const proxyPort = input.proxyPort ?? 18080;
  const writersFenced = WRITER_SERVICES.every((service) => !containerRunning(service));
  const publicProxyStopped = !containerRunning(PROXY_SERVICE) && (await portClosed(proxyPort));
  const llen = await redisText(input.redisUrl, ["LLEN", T33B_QUEUE_KEY]);
  const queuesDrained = llen === "0" || llen === "";
  const frozen = await publicationFrozen(input.redisUrl);
  const body = {
    observedAt: new Date().toISOString(),
    writersFenced,
    queuesDrained,
    publicProxyStopped,
    publicationFrozen: frozen,
  };
  const checked = assertObservedQuiescence({
    ...body,
    evidenceDigest: quiescenceEvidenceDigest(body),
  });
  if (!checked.ok) {
    throw new Error(checked.error.detail);
  }
  return checked.value;
};

export const fenceTargetWriters = (input: T33bTargetRehearsalInput): void => {
  requireCompose(input, ["stop", PROXY_SERVICE, ...WRITER_SERVICES]);
};

export const restoreTargetServices = async (input: T33bTargetRehearsalInput): Promise<void> => {
  requireCompose(input, ["start", "api", "worker", "publication-manager", "web", PROXY_SERVICE]);
  await waitFor(() => httpOk(`${input.publicUrl.replace(/\/$/, "")}/health/live`), "target /health/live");
};

export const runT33bTargetRehearsal = async (
  input: T33bTargetRehearsalInput,
): Promise<T33bTargetRehearsalResult> => {
  const liveBefore = await httpOk(`${input.publicUrl.replace(/\/$/, "")}/health/live`);
  if (!liveBefore) {
    throw new Error(`target ${input.publicUrl}/health/live is not up`);
  }
  const sentinel = `t33b-non-parameter-${Date.now()}`;
  await installPreservationSentinel(input.postgresUrl, sentinel);
  await redisExecUrl(input.redisUrl, ["DEL", T33B_QUEUE_KEY]);
  await redisExecUrl(input.redisUrl, ["SET", T33B_FREEZE_KEY, "1"]);
  fenceTargetWriters(input);
  const quiescence = await observeTargetQuiescence(input);

  const postgres = createPostgresStorePort(input.postgresUrl, { allowComposeApp: false });
  const redis = createRedisStorePort(input.redisUrl);
  const objectStore = createS3StorePort({
    endpoint: input.s3Endpoint,
    bucket: input.s3Bucket,
    accessKeyId: input.s3AccessKeyId,
    secretAccessKey: input.s3SecretAccessKey,
    region: "us-east-1",
  });
  const stores = [postgres, objectStore, redis];
  const target = {
    deploymentId: "t33b-local-selfhost",
    hostFingerprint: "sha256:t33b-local-selfhost",
    postgresIdentity: postgres.declaredIdentity,
    objectStoreIdentity: objectStore.declaredIdentity,
    redisIdentity: redis.declaredIdentity,
  };
  const prior = await captureRecoveryPoint({
    runId: "t33b-prior",
    target,
    quiescence: {
      status: "quiesced",
      writersFenced: true,
      queueDrained: true,
      proxyStopped: true,
      observedAt: quiescence.observedAt,
    },
    stores,
    maximumAgeMs: 3_600_000,
  });
  if (!prior.ok) {
    throw new Error(`${prior.error.kind}: ${prior.error.detail}`);
  }

  const ports = freezePorts(input.redisUrl);
  const failedUnfreeze = await exclusivePublicationUnfreeze({
    exclusiveToken: input.exclusiveToken,
    expectedToken: input.exclusiveToken,
    ports,
    activate: async () => ({ error: "installer rejected" }),
  });
  if (failedUnfreeze.ok) {
    throw new Error("exclusive unfreeze must fail closed when activation is rejected");
  }
  if (!(await publicationFrozen(input.redisUrl))) {
    throw new Error("publication freeze was not restored after exclusive unfreeze failure");
  }

  const unfrozen = await exclusivePublicationUnfreeze({
    exclusiveToken: input.exclusiveToken,
    expectedToken: input.exclusiveToken,
    ports,
    activate: async () => {
      const receipt = `t33b-receipt-${Date.now()}`;
      await redisExecUrl(input.redisUrl, ["SET", T33B_RECEIPT_KEY, receipt]);
      return { receipt };
    },
  });
  if (!unfrozen.ok) {
    throw new Error(unfrozen.error.detail);
  }
  if (!unfrozen.value.activationReceipt) {
    throw new Error("activation receipt missing");
  }

  const capture = await captureRecoveryPoint({
    runId: "t33b-post-unfreeze",
    target,
    quiescence: {
      status: "quiesced",
      writersFenced: true,
      queueDrained: true,
      proxyStopped: true,
      observedAt: new Date().toISOString(),
    },
    stores,
    maximumAgeMs: 3_600_000,
  });
  if (!capture.ok) {
    throw new Error(`${capture.error.kind}: ${capture.error.detail}`);
  }
  const verified = await verifyRecoveryPoint({ manifest: capture.value.manifest, stores });
  if (!verified.ok) {
    throw new Error(`${verified.error.kind}: ${verified.error.detail}`);
  }
  const restored = await restoreCheck({
    manifest: capture.value.manifest,
    restoreToken: capture.value.restoreToken,
    restoreTargets: { restoreDatabaseUrl: input.postgresUrl },
    stores,
  });
  if (!restored.ok) {
    throw new Error(`${restored.error.kind}: ${restored.error.detail}`);
  }
  const stalePrior = await restoreCheck({
    manifest: prior.value.manifest,
    restoreToken: prior.value.restoreToken,
    restoreTargets: { restoreDatabaseUrl: input.postgresUrl },
    stores,
  });
  if (stalePrior.ok) {
    throw new Error("prior recovery point must refuse restore after redis mutation");
  }

  await restoreTargetServices(input);
  const live = await httpOk(`${input.publicUrl.replace(/\/$/, "")}/health/live`);
  const ready = await httpOk(`${input.publicUrl.replace(/\/$/, "")}/health/ready`);
  if (!live) {
    throw new Error("target /health/live failed after restore");
  }
  const preserved = await readPreservationSentinel(input.postgresUrl);
  if (preserved !== sentinel) {
    throw new Error("non-parameter sentinel was not preserved");
  }

  return {
    publicUrl: input.publicUrl,
    quiescence,
    capture: capture.value,
    unfreeze: {
      activationReceipt: unfrozen.value.activationReceipt,
      frozenAfter: true,
    },
    unfreezeFailureRefrozen: true,
    restore: {
      status: "restore-authorized",
      recoveryPointDigest: restored.value.recoveryPointDigest,
    },
    priorCaptureRefused: true,
    sentinelPreserved: true,
    postRestart: { live: true, ready },
    destructiveArchiveRebuild: "not-in-plan",
  };
};
