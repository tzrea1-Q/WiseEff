import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  CatalogReleaseVersion,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import {
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  compileVendorCatalogSuccessor,
} from "../../../../scripts/compile-vendor-catalog-release";
import { buildCompleteSuccessor } from "./completeSuccessor";
import {
  allocationFor,
  firstAcmePredecessor,
  frozenPageIdentity,
  integerContent,
  pageIntegerChange,
} from "./predecessorHarness";

describe("buildCompleteSuccessor", () => {
  it("adds one definition under the existing acme subject and keeps predecessor identities", async () => {
    const predecessor = firstAcmePredecessor();
    expect(predecessor.compiled.release.id).toBe(FIRST_ACME_RELEASE_ID);
    expect(predecessor.digest).toBe(FIRST_ACME_RELEASE_DIGEST);

    const change = pageIntegerChange("iin_min", "Input current minimum");
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [change],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;

    const recompiled = compileCatalogRelease(result.value.artifact.bundle);
    expect(recompiled.ok).toBe(true);
    if (!recompiled.ok) return;
    expect(result.value.artifact.artifactDigest).toBe(recompiled.value.aggregateDigest);
    expect(recompiled.value.counts.definitions).toBe(predecessor.compiled.counts.definitions + 1);
    expect(recompiled.value.predecessor).toEqual({
      id: predecessor.compiled.release.id,
      digest: predecessor.digest,
    });

    const target = result.value.artifact.bundle.releases.find(
      (release) => release.manifest.release.id === result.value.artifact.targetReleaseId,
    );
    expect(target).toBeDefined();
    if (!target) return;
    const added = target.documents.find(
      (document) => document.kind === "definition" && document.content.id === "pdef_acme_power_iin_min",
    );
    expect(added?.kind).toBe("definition");
    if (added?.kind !== "definition") return;
    expect(added.content.revision.id).toBe("drev_acme_power_iin_min_1");
    expect(added.content.revision.number).toBe(1);
    expect(added.content.propertyKey).toBe("iin_min");

    const predecessorDefinitions = predecessor.first.documents.filter(
      (document) => document.kind === "definition",
    );
    for (const previous of predecessorDefinitions) {
      const current = target.documents.find(
        (document) => document.kind === "definition" && document.content.id === previous.content.id,
      );
      expect(current?.kind).toBe("definition");
      if (current?.kind !== "definition" || previous.kind !== "definition") continue;
      expect(current.content).toEqual(previous.content);
    }

    expect(result.value.impact.definitions.added).toEqual([
      {
        definitionId: "pdef_acme_power_iin_min",
        subjectId: "csub_acme_power",
        propertyKey: "iin_min",
        revisionId: "drev_acme_power_iin_min_1",
      },
    ]);
    expect(result.value.impact.definitions.changed).toEqual([]);
    expect(result.value.impact.existingContractsTighten).toBe(false);
    expect(result.value.impact.matcher.fallbackImpact).toBe(false);
    expect(result.value.impact.matcher.existingMatchRulesChanged).toBe(false);
    expect("riskClass" in result.value.candidate).toBe(false);
    expect(result.value.capabilityContract.revision).toBe("catalog-capability/v1");
  });

  it("fails closed for missing predecessor bytes and digest mismatch without persisting", async () => {
    const predecessor = firstAcmePredecessor();
    const missing = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(missing).toEqual({ ok: false, error: { kind: "artifact-missing" } });

    const mismatch = await buildCompleteSuccessor({
      predecessorArtifact: {
        digest: `sha256:${"a".repeat(64)}`,
        bytes: predecessor.bytes,
      },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.kind).toBe("artifact-digest-mismatch");
    }
  });

  it("rejects structural, empty, and whitespace property keys via S0-ID", async () => {
    const predecessor = firstAcmePredecessor();
    const identity = frozenPageIdentity([allocationFor("status")]);
    for (const propertyKey of ["status", "", " iin_min"] as const) {
      const result = await buildCompleteSuccessor({
        predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
        changeSet: [
          {
            op: "create-definition",
            subjectId: "csub_acme_power",
            propertyKey,
            content: integerContent("Bad key", "Rejected."),
          },
        ],
        frozenIdentity: identity,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe("invalid-property-key");
      if (result.error.kind === "invalid-property-key") {
        expect(["structural-property", "empty", "surrounding-whitespace"]).toContain(
          result.error.reason,
        );
      }
    }
  });

  it("rejects duplicate natural keys in the ChangeSet and against the predecessor", async () => {
    const predecessor = firstAcmePredecessor();
    const duplicateInSet = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [
        pageIntegerChange("iin_min", "Input current minimum"),
        pageIntegerChange("iin_min", "Input current minimum copy"),
      ],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(duplicateInSet.ok).toBe(false);
    if (!duplicateInSet.ok) {
      expect(duplicateInSet.error).toMatchObject({
        kind: "conflict",
        reason: "duplicate-natural-key",
        subjectId: "csub_acme_power",
        propertyKey: "iin_min",
      });
    }

    const againstPredecessor = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [pageIntegerChange("iin_max", "Input current limit")],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_max")]),
    });
    expect(againstPredecessor.ok).toBe(false);
    if (!againstPredecessor.ok) {
      expect(againstPredecessor.error).toMatchObject({
        kind: "conflict",
        reason: "duplicate-natural-key",
        propertyKey: "iin_max",
      });
    }
  });

  it("rejects unsupported schema tags without dropping unknown fields", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [
        {
          op: "create-definition",
          subjectId: "csub_acme_power",
          propertyKey: "iin_min",
          content: {
            displayName: "Mixed",
            documentation: "Vendor mixed shape.",
            valueSchema: { description: "mixed" },
          } as never,
        },
      ],
      frozenIdentity: frozenPageIdentity([allocationFor("iin_min")]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported-catalog-capability");
    }
  });

  it("keeps every vendor and acme member when the predecessor is the vendor successor", async () => {
    const vendor = compileVendorCatalogSuccessor();
    const bytes = new TextEncoder().encode(
      serializeContract(vendor.bundle as unknown as ContractJsonValue),
    );
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: vendor.compiled.aggregateDigest, bytes },
      changeSet: [pageIntegerChange("iin_min", "Input current minimum")],
      frozenIdentity: {
        ...frozenPageIdentity([allocationFor("iin_min")], "vendor"),
        releaseVersion: CatalogReleaseVersion("1.2.0"),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    const predecessorIds = new Set(
      vendor.bundle.releases
        .find((release) => release.manifest.release.id === vendor.bundle.targetReleaseId)
        ?.documents.map((document) => `${document.kind}:${document.content.id}`) ?? [],
    );
    const successorIds = new Set(
      result.value.artifact.bundle.releases
        .find((release) => release.manifest.release.id === result.value.artifact.targetReleaseId)
        ?.documents.map((document) => `${document.kind}:${document.content.id}`) ?? [],
    );
    for (const id of predecessorIds) {
      expect(successorIds.has(id)).toBe(true);
    }
    expect(successorIds.size).toBe(predecessorIds.size + 1);
  });

  it("rejects M2 ops on the default M1 product path", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [
        {
          op: "revise-definition",
          definitionId: "pdef_acme_power_iin_max",
          class: "documentation",
          content: integerContent("Input current limit", "Changed docs."),
        },
      ],
      frozenIdentity: frozenPageIdentity([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "unsupported-change-op", op: "revise-definition" });
    }
  });

  it("returns a typed no-op revise after verifying the predecessor", async () => {
    const predecessor = firstAcmePredecessor();
    const existing = predecessor.first.documents.find(
      (document) => document.kind === "definition" && document.content.id === "pdef_acme_power_iin_max",
    );
    if (existing?.kind !== "definition") throw new Error("fixture definition missing");
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [
        {
          op: "revise-definition",
          definitionId: "pdef_acme_power_iin_max",
          class: "documentation",
          content: {
            displayName: existing.content.revision.displayName,
            documentation: existing.content.revision.documentation,
            unit: "mA",
            valueSchema: { type: "integer", minimum: 0 },
          },
        },
      ],
      frozenIdentity: frozenPageIdentity([]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: "noop-revise",
      definitionId: "pdef_acme_power_iin_max",
      revisionId: existing.content.revision.id,
    });
  });
});
