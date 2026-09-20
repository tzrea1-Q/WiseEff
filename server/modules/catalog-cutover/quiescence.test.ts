import { describe, expect, it } from "vitest";

import {
  assertObservedQuiescence,
  fixtureObservedQuiescence,
  quiescenceEvidenceDigest,
} from "./quiescence";

describe("cutover P2 observed quiescence", () => {
  it("accepts a digest-bound observation and refuses attestation-shaped objects", () => {
    const observed = fixtureObservedQuiescence();
    const accepted = assertObservedQuiescence(observed);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.evidenceDigest).toBe(
      quiescenceEvidenceDigest({
        observedAt: observed.observedAt,
        writersFenced: true,
        queuesDrained: true,
        publicProxyStopped: true,
        publicationFrozen: true,
      }),
    );

    const missing = assertObservedQuiescence(undefined);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("PCAT-ORC-PHASE-FAILED");
    expect(missing.error.detail).toMatch(/attestation is not proof/);

    const incomplete = assertObservedQuiescence({
      ...observed,
      queuesDrained: false,
      evidenceDigest: quiescenceEvidenceDigest({
        observedAt: observed.observedAt,
        writersFenced: true,
        queuesDrained: false,
        publicProxyStopped: true,
        publicationFrozen: true,
      }),
    });
    expect(incomplete.ok).toBe(false);
    if (incomplete.ok) return;
    expect(incomplete.error.detail).toMatch(/incomplete/);

    const drifted = assertObservedQuiescence({
      ...observed,
      evidenceDigest: `sha256:${"ab".repeat(32)}`,
    });
    expect(drifted.ok).toBe(false);
    if (drifted.ok) return;
    expect(drifted.error.detail).toMatch(/drifted/);
  });
});
