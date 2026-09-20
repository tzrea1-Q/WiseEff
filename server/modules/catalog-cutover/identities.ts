import { fail, ok } from "./checkpoints";
import type { CutoverIdentityPin, CutoverResult } from "./interface";
export type { CutoverIdentityPin };

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const CUTOVER_IDENTITY_KEYS = [
  "databaseIdentity",
  "imageDigest",
  "schemaFingerprint",
  "seedDigest",
  "scopeDigest",
  "archiveDigest",
] as const;

export type CutoverIdentityKey = (typeof CUTOVER_IDENTITY_KEYS)[number];

export const fixtureCutoverIdentities = (
  seed = "s2-rehearsal",
): CutoverIdentityPin => {
  const pin = (key: string) => {
    const hex = [...`${seed}:${key}`]
      .reduce((acc, char) => acc + char.charCodeAt(0).toString(16).padStart(2, "0"), "")
      .padEnd(64, "0")
      .slice(0, 64);
    return `sha256:${hex}`;
  };
  return {
    databaseIdentity: pin("database"),
    imageDigest: pin("image"),
    schemaFingerprint: pin("schema"),
    seedDigest: pin("seed"),
    scopeDigest: pin("scope"),
    archiveDigest: pin("archive"),
  };
};

export const assertCutoverIdentities = (value: unknown): CutoverResult<CutoverIdentityPin> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "PCAT-ORC-INVALID-PLAN",
      "Cutover plan requires database/image/schema/seed/scope/archive identities",
    );
  }
  const record = value as Record<string, unknown>;
  const collected: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of CUTOVER_IDENTITY_KEYS) {
    const item = record[key];
    if (typeof item !== "string" || !DIGEST.test(item)) {
      missing.push(key);
      continue;
    }
    collected[key] = item;
  }
  if (missing.length > 0) {
    return fail(
      "PCAT-ORC-INVALID-PLAN",
      `Incomplete cutover identity inventory: ${missing.join(",")}`,
    );
  }
  return ok({
    databaseIdentity: collected.databaseIdentity,
    imageDigest: collected.imageDigest,
    schemaFingerprint: collected.schemaFingerprint,
    seedDigest: collected.seedDigest,
    scopeDigest: collected.scopeDigest,
    archiveDigest: collected.archiveDigest,
  });
};

export const assertIdentitiesMatch = (
  planned: CutoverIdentityPin,
  observed: unknown,
): CutoverResult<CutoverIdentityPin> => {
  const live = assertCutoverIdentities(observed);
  if (!live.ok) return live;
  for (const key of CUTOVER_IDENTITY_KEYS) {
    if (planned[key] !== live.value[key]) {
      return fail("PCAT-ORC-INVALID-PLAN", `Cutover identity drifted: ${key}`);
    }
  }
  return ok(live.value);
};
