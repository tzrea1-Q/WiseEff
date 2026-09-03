import { describe, expect, it } from "vitest";
import { catalogFailureClientBehaviors } from "@wiseeff/dto-schemas";

import { WiseEffApiError } from "@/infrastructure/http/apiClient";

import {
  catalogConflictReasons,
  catalogDomainStateKinds,
  catalogEmptyReasons,
  catalogStateFromFailure,
  catalogWritesEnabled,
  deriveCatalogDomainState
} from "./states";
import {
  CATALOG_RELEASE_ID,
  CATALOG_SUBJECT_ID,
  activeDefinition,
  catalogReviewItem,
  emptyCatalogCollection,
  readyCatalogDocument,
  registeredSubject,
  retiredDefinition,
  retiredSubject,
  unregisteredSubject
} from "./fixtures";

function failure(reason: string, details: Record<string, unknown> = {}) {
  return new WiseEffApiError("CONFLICT", "ignore this human message", { reason, ...details }, "req_1");
}

describe("catalog domain states", () => {
  it("closes over ready, unregistered, empty, loading, error, retired, and conflict", () => {
    expect([...catalogDomainStateKinds]).toEqual([
      "ready",
      "unregistered",
      "empty",
      "loading",
      "error",
      "retired",
      "conflict"
    ]);
    expect([...catalogEmptyReasons]).toEqual([
      "no-registrations",
      "no-definitions",
      "no-review-work",
      "no-filter-match"
    ]);
    expect(catalogConflictReasons).toContain("release-drift");
    expect(catalogConflictReasons).toContain("revision-conflict");
  });

  it("derives ready from a captured catalog document", () => {
    const state = deriveCatalogDomainState({ document: readyCatalogDocument });
    expect(state).toEqual({
      kind: "ready",
      catalogReleaseId: CATALOG_RELEASE_ID,
      writesEnabled: true
    });
    expect(catalogWritesEnabled(state)).toBe(true);
  });

  it("derives unregistered from a published subject without inventing placement", () => {
    const state = deriveCatalogDomainState({
      document: readyCatalogDocument,
      subject: unregisteredSubject
    });
    expect(state).toEqual({
      kind: "unregistered",
      catalogReleaseId: CATALOG_RELEASE_ID,
      subjectId: CATALOG_SUBJECT_ID,
      writesEnabled: false
    });
    expect(catalogWritesEnabled(state)).toBe(false);
  });

  it("keeps the four empty reasons distinct from error", () => {
    for (const emptyReason of catalogEmptyReasons) {
      const state = deriveCatalogDomainState({
        document: readyCatalogDocument,
        collection: emptyCatalogCollection(emptyReason)
      });
      expect(state).toEqual({
        kind: "empty",
        catalogReleaseId: CATALOG_RELEASE_ID,
        emptyReason,
        writesEnabled: false
      });
    }
  });

  it("marks loading stale against a previous release and disables writes", () => {
    const state = deriveCatalogDomainState({
      inFlight: true,
      previousReleaseId: CATALOG_RELEASE_ID,
      document: readyCatalogDocument,
      subject: registeredSubject
    });
    expect(state).toEqual({
      kind: "loading",
      catalogReleaseId: CATALOG_RELEASE_ID,
      stale: true,
      writesEnabled: false
    });
    expect(catalogWritesEnabled(state)).toBe(false);
  });

  it("maps catalog-not-ready from details.reason and never from the human message", () => {
    const error = new WiseEffApiError(
      "SERVICE_UNAVAILABLE",
      "this message must not be parsed",
      { reason: "catalog-not-ready" },
      "req_1"
    );
    const state = catalogStateFromFailure(error);
    expect(state).toMatchObject({
      kind: "error",
      reason: "catalog-not-ready",
      behavior: catalogFailureClientBehaviors["catalog-not-ready"],
      writesEnabled: false
    });
  });

  it("maps retired definition and subject lifecycle to historical-read retired", () => {
    expect(
      deriveCatalogDomainState({ document: readyCatalogDocument, definition: retiredDefinition })
    ).toMatchObject({ kind: "retired", target: "definition", writesEnabled: false });
    expect(
      deriveCatalogDomainState({ document: readyCatalogDocument, subject: retiredSubject })
    ).toMatchObject({ kind: "retired", target: "subject", writesEnabled: false });
    expect(catalogStateFromFailure(failure("legacy-surface-retired"))).toMatchObject({
      kind: "retired",
      target: "legacy-surface"
    });
  });

  it("maps conflict reasons to preserve-input and forbids silent retry", () => {
    for (const reason of catalogConflictReasons) {
      const state = catalogStateFromFailure(failure(reason, { catalogReleaseId: CATALOG_RELEASE_ID }));
      expect(state).toEqual({
        kind: "conflict",
        catalogReleaseId: CATALOG_RELEASE_ID,
        reason,
        behavior: catalogFailureClientBehaviors[reason],
        preserveInput: true,
        silentRetry: false,
        writesEnabled: false
      });
    }
  });

  it("treats a stale review candidate as release-drift conflict", () => {
    const state = deriveCatalogDomainState({
      document: readyCatalogDocument,
      definition: activeDefinition,
      reviewItem: {
        ...catalogReviewItem,
        candidateState: {
          status: "stale",
          capturedRelease: { id: "crel_old", digest: "sha256:old" },
          currentRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
        }
      }
    });
    expect(state.kind).toBe("conflict");
    if (state.kind === "conflict") {
      expect(state.reason).toBe("release-drift");
      expect(state.silentRetry).toBe(false);
      expect(state.preserveInput).toBe(true);
    }
  });

  it("maps registration-required to unregistered instead of empty or error", () => {
    const state = catalogStateFromFailure(
      failure("registration-required", { subjectId: CATALOG_SUBJECT_ID, catalogReleaseId: CATALOG_RELEASE_ID })
    );
    expect(state).toEqual({
      kind: "unregistered",
      catalogReleaseId: CATALOG_RELEASE_ID,
      subjectId: CATALOG_SUBJECT_ID,
      writesEnabled: false
    });
  });
});
