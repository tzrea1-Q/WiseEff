import { afterEach, describe, expect, it, vi } from "vitest";

import * as codec from "./bundleCodec";
import { buildCompleteSuccessor } from "./completeSuccessor";
import { allocationFor, firstAcmePredecessor, frozenPageIdentity, pageIntegerChange } from "./predecessorHarness";
import { preparePredecessorArtifact, preparedPredecessorBundle } from "./preparedPredecessor";

afterEach(() => vi.restoreAllMocks());

describe("request-owned predecessor snapshots", () => {
  it("parses once and produces the same complete successor bytes and identities", async () => {
    const predecessor = firstAcmePredecessor();
    const input = {
      changeSet: [pageIntegerChange("iin_min", "Minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    };
    const original = await buildCompleteSuccessor({ ...input, predecessorArtifact: predecessor });
    const parse = vi.spyOn(codec, "parseBundleBytes");
    const prepared = preparePredecessorArtifact(predecessor);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.detail);
    const reused = await buildCompleteSuccessor({ ...input, predecessorArtifact: prepared.artifact });
    expect(reused.ok).toBe(true);
    expect(reused).toEqual(original);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("owns an immutable graph independent of the input bytes and other requests", () => {
    const predecessor = firstAcmePredecessor();
    const first = preparePredecessorArtifact(predecessor);
    const second = preparePredecessorArtifact(predecessor);
    if (!first.ok || !second.ok) throw new Error("fixture preparation failed");
    const bundle = preparedPredecessorBundle(first.artifact)!;
    expect(bundle).not.toBe(preparedPredecessorBundle(second.artifact));
    predecessor.bytes.fill(0);
    expect(bundle).toEqual(predecessor.bundle);
    expect(() => { Object.assign(bundle.releases[0]!.manifest.release, { id: "changed" }); }).toThrow(TypeError);
    expect(() => { Object.assign(first.artifact, { digest: "changed" }); }).toThrow(TypeError);
  });

  it("does not accept a copied or serialized handle as a validated predecessor", async () => {
    const predecessor = firstAcmePredecessor();
    const prepared = preparePredecessorArtifact(predecessor);
    if (!prepared.ok) throw new Error(prepared.detail);
    const forged = { ...prepared.artifact };
    expect(preparedPredecessorBundle(forged)).toBeUndefined();
    const result = await buildCompleteSuccessor({
      predecessorArtifact: forged,
      changeSet: [pageIntegerChange("iin_min", "Minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(result).toEqual({ ok: false, error: { kind: "artifact-missing" } });
  });

  it.each(["digest", "source"] as const)("still rejects a prepared predecessor with invalid %s", async (fault) => {
    const predecessor = firstAcmePredecessor();
    const bundle = structuredClone(predecessor.bundle);
    if (fault === "source") Object.assign(bundle.releases[0]!.sources[0]!, { bytes: Buffer.from("invalid source").toString("base64") });
    const input = {
      digest: fault === "digest" ? `sha256:${"a".repeat(64)}` : predecessor.digest,
      bytes: codec.encodeBundleBytes(bundle),
    };
    const prepared = preparePredecessorArtifact(input);
    if (!prepared.ok) throw new Error(prepared.detail);
    const buildInput = {
      changeSet: [pageIntegerChange("iin_min", "Minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    };
    const direct = await buildCompleteSuccessor({ ...buildInput, predecessorArtifact: input });
    const reused = await buildCompleteSuccessor({ ...buildInput, predecessorArtifact: prepared.artifact });
    expect(reused.ok).toBe(false);
    expect(reused).toEqual(direct);
  });
});
