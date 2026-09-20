import net from "node:net";

import { exclusivePublicationUnfreeze } from "../../../server/modules/catalog-cutover/exclusiveUnfreeze";
import {
  assertObservedQuiescence,
  quiescenceEvidenceDigest,
  type ObservedQuiescence,
} from "../../../server/modules/catalog-cutover/quiescence";
import {
  captureRecoveryPoint,
  createPostgresStorePort,
  restoreCheck,
  verifyRecoveryPoint,
  type RecoveryPointCapture,
} from "./recoveryPoint";
import { createRedisStorePort, createS3StorePort, decodeRedisReply, redisExecUrl } from "./liveStorePorts";

export const T33A_FREEZE_KEY = "wiseeff:t33a:publication-freeze";
export const T33A_RECEIPT_KEY = "wiseeff:t33a:activation-receipt";
export const T33A_QUEUE_KEY = "wiseeff:t33a:jobs";
const FREEZE_KEY = T33A_FREEZE_KEY;
const RECEIPT_KEY = T33A_RECEIPT_KEY;
const QUEUE_KEY = T33A_QUEUE_KEY;

export type T33aDockerRehearsalInput = {
  readonly postgresUrl: string;
  readonly redisUrl: string;
  readonly s3Endpoint: string;
  readonly s3Bucket: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly exclusiveToken: string;
  readonly writerPorts?: readonly number[];
  readonly proxyPort?: number;
};

export type T33aDockerRehearsalResult = {
  readonly quiescence: ObservedQuiescence;
  readonly capture: RecoveryPointCapture;
  readonly unfreeze: { readonly activationReceipt: string; readonly frozenAfter: true };
  readonly unfreezeFailureRefrozen: true;
  readonly restore: { readonly status: "restore-authorized"; readonly recoveryPointDigest: string };
  readonly priorCaptureRefused: true;
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
  (await redisText(redisUrl, ["GET", FREEZE_KEY])) === "1";

const freezePorts = (redisUrl: string) => ({
  isFrozen: async () => publicationFrozen(redisUrl),
  freeze: async () => {
    await redisExecUrl(redisUrl, ["SET", FREEZE_KEY, "1"]);
  },
  unfreeze: async () => {
    await redisExecUrl(redisUrl, ["SET", FREEZE_KEY, "0"]);
  },
});

export const observeLiveQuiescence = async (
  input: T33aDockerRehearsalInput,
): Promise<ObservedQuiescence> => {
  const writerPorts = input.writerPorts ?? [19991];
  const proxyPort = input.proxyPort ?? 19992;
  const writersFenced = (await Promise.all(writerPorts.map((port) => portClosed(port)))).every(Boolean);
  const publicProxyStopped = await portClosed(proxyPort);
  const llen = await redisText(input.redisUrl, ["LLEN", QUEUE_KEY]);
  const queuesDrained = llen === "0" || llen === "";
  const frozen = await publicationFrozen(input.redisUrl);
  const observedAt = new Date().toISOString();
  const body = {
    observedAt,
    writersFenced,
    queuesDrained,
    publicProxyStopped,
    publicationFrozen: frozen,
  };
  const observed = {
    ...body,
    evidenceDigest: quiescenceEvidenceDigest(body),
  };
  const checked = assertObservedQuiescence(observed);
  if (!checked.ok) {
    throw new Error(checked.error.detail);
  }
  return checked.value;
};

export const runT33aDockerRehearsal = async (
  input: T33aDockerRehearsalInput,
): Promise<T33aDockerRehearsalResult> => {
  await redisExecUrl(input.redisUrl, ["DEL", QUEUE_KEY]);
  await redisExecUrl(input.redisUrl, ["SET", FREEZE_KEY, "1"]);
  const quiescence = await observeLiveQuiescence(input);
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
  const prior = await captureRecoveryPoint({
    runId: "t33a-prior",
    target: {
      deploymentId: "t33a-docker",
      hostFingerprint: "sha256:t33a-local-docker",
      postgresIdentity: postgres.declaredIdentity,
      objectStoreIdentity: objectStore.declaredIdentity,
      redisIdentity: redis.declaredIdentity,
    },
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
      const receipt = `t33a-receipt-${Date.now()}`;
      await redisExecUrl(input.redisUrl, ["SET", RECEIPT_KEY, receipt]);
      return { receipt };
    },
  });
  if (!unfrozen.ok) {
    throw new Error(unfrozen.error.detail);
  }
  if (!unfrozen.value.activationReceipt) {
    throw new Error("activation receipt missing");
  }
  if (!(await publicationFrozen(input.redisUrl))) {
    throw new Error("publication freeze was not restored after exclusive unfreeze success");
  }

  const capture = await captureRecoveryPoint({
    runId: "t33a-post-unfreeze",
    target: {
      deploymentId: "t33a-docker",
      hostFingerprint: "sha256:t33a-local-docker",
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

  return {
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
  };
};
