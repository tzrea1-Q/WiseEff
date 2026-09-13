import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { buildCompleteSuccessor } from "./completeSuccessor";
import {
  allocationFor,
  firstAcmePredecessor,
  frozenPageIdentity,
  pageIntegerChange,
} from "./predecessorHarness";

describe("frozen candidate determinism", () => {
  it("recompiles the same frozen identity and ChangeSet permutation to identical bytes, digest, and IDs", async () => {
    const predecessor = firstAcmePredecessor();
    const first = pageIntegerChange("iin_min", "Input current minimum");
    const second = pageIntegerChange("iout_max", "Output current maximum");
    const frozen = frozenPageIdentity([allocationFor("iin_min"), allocationFor("iout_max")]);
    const input = {
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      frozenIdentity: frozen,
    };

    const original = await buildCompleteSuccessor({
      ...input,
      changeSet: [first, second],
    });
    const retried = await buildCompleteSuccessor({
      ...input,
      changeSet: [first, second],
    });
    const permuted = await buildCompleteSuccessor({
      ...input,
      changeSet: [second, first],
    });

    expect(original.ok).toBe(true);
    expect(retried.ok).toBe(true);
    expect(permuted.ok).toBe(true);
    if (!original.ok || !retried.ok || !permuted.ok) return;
    if (
      original.value.kind !== "successor" ||
      retried.value.kind !== "successor" ||
      permuted.value.kind !== "successor"
    ) {
      return;
    }

    const originalBytes = Buffer.from(original.value.artifact.artifactBytes);
    expect(Buffer.compare(originalBytes, Buffer.from(retried.value.artifact.artifactBytes))).toBe(0);
    expect(Buffer.compare(originalBytes, Buffer.from(permuted.value.artifact.artifactBytes))).toBe(0);
    expect(retried.value.artifact.artifactDigest).toBe(original.value.artifact.artifactDigest);
    expect(permuted.value.artifact.artifactDigest).toBe(original.value.artifact.artifactDigest);
    expect(retried.value.candidate.id).toBe(original.value.candidate.id);
    expect(permuted.value.candidate.id).toBe(original.value.candidate.id);
    expect(retried.value.candidate.impactReportDigest).toBe(
      original.value.candidate.impactReportDigest,
    );
    expect(permuted.value.candidate.impactReportDigest).toBe(
      original.value.candidate.impactReportDigest,
    );

    const compiled = compileCatalogRelease(permuted.value.artifact.bundle);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.value.aggregateDigest).toBe(original.value.artifact.artifactDigest);
    }
  });

  it("does not claim independent previews share a digest", async () => {
    const predecessor = firstAcmePredecessor();
    const change = pageIntegerChange("iin_min", "Input current minimum");
    const first = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [change],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")], "a"),
    });
    const second = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [change],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")], "b"),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    if (first.value.kind !== "successor" || second.value.kind !== "successor") return;
    expect(first.value.artifact.artifactDigest).not.toBe(second.value.artifact.artifactDigest);
    expect(first.value.candidate.id).not.toBe(second.value.candidate.id);
  });
});
