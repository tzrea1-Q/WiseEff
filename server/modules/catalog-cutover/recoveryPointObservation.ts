import { createHash } from "node:crypto";

import { fail, ok } from "./checkpoints";
import type { CutoverResult } from "./interface";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type ObservedRecoveryPoint = {
  readonly postgresIdentity: string;
  readonly objectStoreIdentity: string;
  readonly redisIdentity: string;
  readonly postgresChecksum: string;
  readonly objectStoreChecksum: string;
  readonly redisChecksum: string;
  readonly evidenceDigest: string;
};

const canonicalRecoveryPoint = (input: Omit<ObservedRecoveryPoint, "evidenceDigest">): string =>
  JSON.stringify({
    objectStoreChecksum: input.objectStoreChecksum,
    objectStoreIdentity: input.objectStoreIdentity,
    postgresChecksum: input.postgresChecksum,
    postgresIdentity: input.postgresIdentity,
    redisChecksum: input.redisChecksum,
    redisIdentity: input.redisIdentity,
  });

export const recoveryPointEvidenceDigest = (
  input: Omit<ObservedRecoveryPoint, "evidenceDigest">,
): string => `sha256:${createHash("sha256").update(canonicalRecoveryPoint(input)).digest("hex")}`;

export const fixtureObservedRecoveryPoint = (
  seed = "s2-stores",
): ObservedRecoveryPoint => {
  const pin = (key: string) => {
    const hex = [...`${seed}:${key}`]
      .reduce((acc, char) => acc + char.charCodeAt(0).toString(16).padStart(2, "0"), "")
      .padEnd(64, "0")
      .slice(0, 64);
    return `sha256:${hex}`;
  };
  const body = {
    postgresIdentity: pin("pg-id"),
    objectStoreIdentity: pin("obj-id"),
    redisIdentity: pin("redis-id"),
    postgresChecksum: pin("pg-sum"),
    objectStoreChecksum: pin("obj-sum"),
    redisChecksum: pin("redis-sum"),
  };
  return { ...body, evidenceDigest: recoveryPointEvidenceDigest(body) };
};

export const assertObservedRecoveryPoint = (
  value: unknown,
): CutoverResult<ObservedRecoveryPoint> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "PCAT-ORC-PHASE-FAILED",
      "P3 requires verified postgres/object-store/redis recovery point; inventory dump is not a backup",
    );
  }
  const record = value as Record<string, unknown>;
  const fields = [
    "postgresIdentity",
    "objectStoreIdentity",
    "redisIdentity",
    "postgresChecksum",
    "objectStoreChecksum",
    "redisChecksum",
    "evidenceDigest",
  ] as const;
  const body: Record<string, string> = {};
  for (const key of fields) {
    const item = record[key];
    if (typeof item !== "string" || !DIGEST.test(item)) {
      return fail(
        "PCAT-ORC-PHASE-FAILED",
        "P3 requires verified postgres/object-store/redis recovery point; inventory dump is not a backup",
      );
    }
    body[key] = item;
  }
  const expected = recoveryPointEvidenceDigest({
    postgresIdentity: body.postgresIdentity,
    objectStoreIdentity: body.objectStoreIdentity,
    redisIdentity: body.redisIdentity,
    postgresChecksum: body.postgresChecksum,
    objectStoreChecksum: body.objectStoreChecksum,
    redisChecksum: body.redisChecksum,
  });
  if (body.evidenceDigest !== expected) {
    return fail("PCAT-ORC-PHASE-FAILED", "P3 recovery point evidenceDigest drifted from the observation");
  }
  return ok(body as unknown as ObservedRecoveryPoint);
};
