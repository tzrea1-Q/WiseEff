import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { buildCompleteSuccessor } from "./completeSuccessor";
import {
  allocationForRevision,
  firstAcmePredecessor,
  frozenPageIdentity,
} from "./predecessorHarness";
import type { CatalogReleaseDefinitionDocument } from "../../catalog-kernel/compiler/types";

const EXISTING_DEFINITION_ID = "pdef_acme_power_iin_max";
const EXISTING_PROPERTY_KEY = "iin_max";

const existingDefinition = (predecessor: ReturnType<typeof firstAcmePredecessor>) => {
  const found = predecessor.first.documents.find(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition" && document.content.id === EXISTING_DEFINITION_ID,
  );
  if (!found) throw new Error("fixture definition missing");
  return found;
};

const contentOf = (definition: CatalogReleaseDefinitionDocument) => ({
  displayName: definition.content.revision.displayName,
  documentation: definition.content.revision.documentation,
  valueSchema: definition.content.revision.valueSchema,
});

const targetDefinition = async (changeSet: Parameters<typeof buildCompleteSuccessor>[0]["changeSet"]) => {
  const predecessor = firstAcmePredecessor();
  const existing = existingDefinition(predecessor);
  const currentNumber = existing.content.revision.number;
  const result = await buildCompleteSuccessor({
    predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
    productPath: "m2-core",
    changeSet,
    frozenIdentity: frozenPageIdentity([allocationForRevision(EXISTING_PROPERTY_KEY, currentNumber + 1)]),
  });
  expect(result.ok).toBe(true);
  if (!result.ok || result.value.kind !== "successor") return null;
  const recompiled = compileCatalogRelease(result.value.artifact.bundle);
  expect(recompiled.ok).toBe(true);
  const release = result.value.artifact.bundle.releases.find(
    (candidate) => candidate.manifest.release.id === result.value.artifact.targetReleaseId,
  );
  const definition = release?.documents.find(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition" && document.content.id === EXISTING_DEFINITION_ID,
  );
  return { definition, existing };
};

/**
 * Issue #847 decision 10: the historical deprecate action maps to canonical soft
 * retirement (`retired`), which blocks new matching/use while preserving the
 * stable identity, revisions and pinned historical references. Restoration
 * publishes `active` for the same identity and key. `deprecated` stays a
 * distinct existing state and is never written by these operations.
 */
describe("definition lifecycle authoring", () => {
  it("retires an active definition without changing identity, key or history", async () => {
    const predecessor = firstAcmePredecessor();
    const existing = existingDefinition(predecessor);
    const built = await targetDefinition([
      {
        op: "retire-definition",
        definitionId: EXISTING_DEFINITION_ID,
        content: contentOf(existing),
      },
    ]);
    if (!built?.definition) throw new Error("retire successor missing");
    expect(built.definition.content.revision.lifecycle).toBe("retired");
    expect(built.definition.content.id).toBe(EXISTING_DEFINITION_ID);
    expect(built.definition.content.subjectId).toBe(existing.content.subjectId);
    expect(built.definition.content.propertyKey).toBe(EXISTING_PROPERTY_KEY);
    // The predecessor revision stays byte-identical and readable.
    expect(existing.content.revision.lifecycle).toBe("active");
    expect(existing.content.revision.id).toBe("drev_acme_power_iin_max_1");
    expect(built.definition.content.revision.id).not.toBe(existing.content.revision.id);
  });

  it("restores a retired definition to active for the same identity and key", async () => {
    const predecessor = firstAcmePredecessor();
    const retired = structuredClone(existingDefinition(predecessor));
    retired.content.revision.lifecycle = "retired";
    const changeSet = [
      {
        op: "restore-definition" as const,
        definitionId: EXISTING_DEFINITION_ID,
        content: {
          displayName: retired.content.revision.displayName,
          documentation: retired.content.revision.documentation,
          valueSchema: retired.content.revision.valueSchema,
        },
      },
    ];
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet,
      frozenIdentity: frozenPageIdentity([
        allocationForRevision(EXISTING_PROPERTY_KEY, retired.content.revision.number + 1),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    const release = result.value.artifact.bundle.releases.find(
      (candidate) => candidate.manifest.release.id === result.value.artifact.targetReleaseId,
    );
    const definition = release?.documents.find(
      (document): document is CatalogReleaseDefinitionDocument =>
        document.kind === "definition" && document.content.id === EXISTING_DEFINITION_ID,
    );
    expect(definition?.content.revision.lifecycle).toBe("active");
    expect(definition?.content.propertyKey).toBe(EXISTING_PROPERTY_KEY);
  });

  it("is a typed no-op when the definition is already in the requested lifecycle", async () => {
    const predecessor = firstAcmePredecessor();
    const existing = existingDefinition(predecessor);
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [
        {
          op: "restore-definition",
          definitionId: EXISTING_DEFINITION_ID,
          content: contentOf(existing),
        },
      ],
      frozenIdentity: frozenPageIdentity([]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: "noop-revise",
        definitionId: EXISTING_DEFINITION_ID,
      });
    }
  });

  it("rejects an unknown definition and unknown fields", async () => {
    const predecessor = firstAcmePredecessor();
    const existing = existingDefinition(predecessor);
    const unknownDefinition = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [
        {
          op: "retire-definition",
          definitionId: "pdef_acme_power_absent",
          content: contentOf(existing),
        },
      ],
      frozenIdentity: frozenPageIdentity([]),
    });
    expect(unknownDefinition.ok).toBe(false);
    if (!unknownDefinition.ok) {
      expect(unknownDefinition.error).toMatchObject({ kind: "invalid-input" });
    }

    const unknownField = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [
        {
          op: "retire-definition",
          definitionId: EXISTING_DEFINITION_ID,
          content: contentOf(existing),
          reason: "retire for the acceptance matrix",
          bogusField: "not part of the lifecycle contract",
        },
      ],
      frozenIdentity: frozenPageIdentity([
        allocationForRevision(EXISTING_PROPERTY_KEY, existing.content.revision.number + 1),
      ]),
    });
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.error).toMatchObject({
        kind: "unsupported-catalog-capability",
        detail: "unknown-field",
      });
    }
  });

  it("keeps the description across a documentation revise", async () => {
    const predecessor = firstAcmePredecessor();
    const existing = existingDefinition(predecessor);
    const result = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [
        {
          op: "revise-definition",
          definitionId: EXISTING_DEFINITION_ID,
          class: "documentation",
          content: {
            ...contentOf(existing),
            description: "Short author description.",
          },
        },
      ],
      frozenIdentity: frozenPageIdentity([
        allocationForRevision(EXISTING_PROPERTY_KEY, existing.content.revision.number + 1),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    const release = result.value.artifact.bundle.releases.find(
      (candidate) => candidate.manifest.release.id === result.value.artifact.targetReleaseId,
    );
    const definition = release?.documents.find(
      (document): document is CatalogReleaseDefinitionDocument =>
        document.kind === "definition" && document.content.id === EXISTING_DEFINITION_ID,
    );
    expect(definition?.content.revision.description).toBe("Short author description.");
  });
});
