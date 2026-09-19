import { createHash } from "node:crypto";

import { fail, ok } from "./checkpoints";
import type { CutoverResult } from "./interface";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type ObservedQuiescence = {
  readonly observedAt: string;
  readonly writersFenced: true;
  readonly queuesDrained: true;
  readonly publicProxyStopped: true;
  readonly publicationFrozen: true;
  readonly evidenceDigest: string;
};

const canonicalObservation = (input: {
  readonly observedAt: string;
  readonly writersFenced: boolean;
  readonly queuesDrained: boolean;
  readonly publicProxyStopped: boolean;
  readonly publicationFrozen: boolean;
}): string =>
  JSON.stringify({
    observedAt: input.observedAt,
    publicationFrozen: input.publicationFrozen,
    publicProxyStopped: input.publicProxyStopped,
    queuesDrained: input.queuesDrained,
    writersFenced: input.writersFenced,
  });

export const quiescenceEvidenceDigest = (input: {
  readonly observedAt: string;
  readonly writersFenced: boolean;
  readonly queuesDrained: boolean;
  readonly publicProxyStopped: boolean;
  readonly publicationFrozen: boolean;
}): string =>
  `sha256:${createHash("sha256").update(canonicalObservation(input)).digest("hex")}`;

export const fixtureObservedQuiescence = (
  observedAt = "2026-09-19T00:00:00.000Z",
): ObservedQuiescence => {
  const body = {
    observedAt,
    writersFenced: true as const,
    queuesDrained: true as const,
    publicProxyStopped: true as const,
    publicationFrozen: true as const,
  };
  return {
    ...body,
    evidenceDigest: quiescenceEvidenceDigest(body),
  };
};

export const assertObservedQuiescence = (value: unknown): CutoverResult<ObservedQuiescence> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "PCAT-ORC-PHASE-FAILED",
      "P2 requires observed writer/queue/proxy/publication quiescence; attestation is not proof",
    );
  }
  const record = value as Record<string, unknown>;
  const observedAt = record.observedAt;
  const evidenceDigest = record.evidenceDigest;
  const flags = {
    writersFenced: record.writersFenced === true,
    queuesDrained: record.queuesDrained === true,
    publicProxyStopped: record.publicProxyStopped === true,
    publicationFrozen: record.publicationFrozen === true,
  };
  if (typeof observedAt !== "string" || !ISO.test(observedAt)) {
    return fail("PCAT-ORC-PHASE-FAILED", "P2 quiescence observedAt must be an RFC3339 UTC timestamp");
  }
  if (!flags.writersFenced || !flags.queuesDrained || !flags.publicProxyStopped || !flags.publicationFrozen) {
    return fail(
      "PCAT-ORC-PHASE-FAILED",
      "P2 quiescence is incomplete; writers, queues, proxy, and publication freeze must all be observed true",
    );
  }
  if (typeof evidenceDigest !== "string" || !DIGEST.test(evidenceDigest)) {
    return fail("PCAT-ORC-PHASE-FAILED", "P2 quiescence evidenceDigest must be sha256:<64 hex>");
  }
  const expected = quiescenceEvidenceDigest({
    observedAt,
    ...flags,
  });
  if (evidenceDigest !== expected) {
    return fail("PCAT-ORC-PHASE-FAILED", "P2 quiescence evidenceDigest drifted from the observation");
  }
  return ok({
    observedAt,
    writersFenced: true,
    queuesDrained: true,
    publicProxyStopped: true,
    publicationFrozen: true,
    evidenceDigest,
  });
};
