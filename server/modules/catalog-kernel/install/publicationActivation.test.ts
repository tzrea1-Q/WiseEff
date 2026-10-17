import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import * as authorization from "../../catalog-publication/authorization/authorize";
import type { VerifiedPublicationAuthorization } from "../../catalog-publication/authorization/types";
import { encodeBundleBytes, refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import * as store from "../../catalog-publication/persistence/store";
import type { CatalogActivationReceiptRecord, PublicationCandidateRecord, PublicationJobRecord, ReleaseArtifactRecord } from "../../catalog-publication/persistence/types";
import * as freeze from "../../catalog-publication/runtime/freeze";
import { compileCatalogRelease } from "../compiler/index";
import type { CatalogReleaseDocument } from "../compiler/types";
import * as currentPointer from "./currentPointer";
import * as materialization from "./materializeRelease";
import { activateOnlinePublication, refuseRetiredOwnerDefinitionChanges } from "./publicationActivation";
import type { InstallPublishedReleaseCommand } from "../interface";

afterEach(() => vi.restoreAllMocks());

const vendor = compileVendorCatalogSuccessor();
const base = vendor.bundle.releases.find((release) => release.manifest.release.id === vendor.bundle.targetReleaseId)!;
const retiredDefinition = base.documents.find((document) => document.kind === "definition" && document.content.id === "pdef_acme_power_iin_max")!;
const activeOwner = base.documents.find((document) => document.kind === "subject" && document.content.id === "csub_drv_sc8562")!;
const activeDefinition = base.documents.find((document) => document.kind === "definition" && document.content.subjectId === activeOwner.content.id)!;
const successorId = "crel_retired_owner_activation";

function successor(documents: readonly CatalogReleaseDocument[]) {
  const target = refreshSuccessorSource({
    ...base, documents: documents.map((document) => structuredClone(document)),
    manifest: { ...base.manifest, release: {
      ...base.manifest.release, id: successorId, version: "9.0.0", sequence: base.manifest.release.sequence + 1,
      publishedAt: "2026-10-16T00:00:00Z",
      predecessor: { id: base.manifest.release.id, digest: vendor.compiled.aggregateDigest },
    } },
  });
  const bundle = { ...vendor.bundle, targetReleaseId: successorId, releases: [...vendor.bundle.releases, target] };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  return { bundle, compiled: compiled.value };
}

function revise(document: CatalogReleaseDocument, semantic = false): CatalogReleaseDocument {
  if (document.kind !== "definition") throw new Error("definition missing");
  return { ...document, content: { ...document.content, revision: {
    ...document.content.revision, id: `${document.content.revision.id}_next`, number: document.content.revision.number + 1,
    ...(semantic ? { documentation: `${document.content.revision.documentation} Updated.` } : {}),
  } } };
}

describe("stored publication candidate retired owner boundary", () => {
  it("rejects a retired owner's changed revision", () => {
    const prepared = successor(base.documents.map((document) => document === retiredDefinition ? revise(document, true) : document));
    expect(() => refuseRetiredOwnerDefinitionChanges(prepared.compiled)).toThrowError(expect.objectContaining({
      activationError: { kind: "publication-not-authorized", reason: "subject-retired", detail: expect.any(String) },
    }));
  });

  it("compares revision identity even when the semantic digest is unchanged", () => {
    const prepared = successor(base.documents);
    const target = prepared.bundle.releases.find((release) => release.manifest.release.id === successorId)!;
    const changed = refreshSuccessorSource({ ...target, documents: target.documents.map((document) => document.content.id === retiredDefinition.content.id ? revise(document) : document) });
    const snapshot = { ...prepared.compiled, model: { ...prepared.compiled.model, releases: prepared.compiled.model.releases.map((release) => release.release.id === successorId ? { ...release, documents: changed.documents } : release) } };
    expect(() => refuseRetiredOwnerDefinitionChanges(snapshot)).toThrowError("publication-not-authorized");
  });

  it("rejects a new definition under an already retired owner", () => {
    if (retiredDefinition.kind !== "definition") throw new Error("definition missing");
    const added = { ...retiredDefinition, content: { ...retiredDefinition.content,
      id: "pdef_retired_owner_new", propertyKey: "iin_new", revision: {
        ...retiredDefinition.content.revision, id: "drev_retired_owner_new_1", number: 1,
      },
    } };
    expect(() => refuseRetiredOwnerDefinitionChanges(successor([...base.documents, added]).compiled)).toThrowError("publication-not-authorized");
  });

  it("rejects a changed definition when its target owner becomes retired", () => {
    if (activeOwner.kind !== "subject") throw new Error("subject missing");
    const documents = base.documents.map((document): CatalogReleaseDocument => {
      if (document === activeDefinition) return revise(document, true);
      if (document === activeOwner) return { ...document, content: { ...document.content, lifecycle: "retired", tombstone: {
        reason: "withdrawn", withdrawnByReleaseId: successorId, previousSelector: document.content.selector.value,
      } } };
      if (document.kind === "alias" && document.content.subjectId === activeOwner.content.id) return {
        ...document, content: { ...document.content, lifecycle: "retired", tombstone: {
          reason: "withdrawn", withdrawnByReleaseId: successorId, previousSelector: document.content.normalizedSelector,
        } },
      };
      return document;
    });
    expect(() => refuseRetiredOwnerDefinitionChanges(successor(documents).compiled)).toThrowError("publication-not-authorized");
  });

  it("allows unchanged retired history and changed active-owner definitions", () => {
    expect(() => refuseRetiredOwnerDefinitionChanges(successor(base.documents).compiled)).not.toThrow();
    expect(() => refuseRetiredOwnerDefinitionChanges(successor(base.documents.map((document) => document === activeDefinition ? revise(document, true) : document)).compiled)).not.toThrow();
  });

  it("allows a definition under a newly added active subject", () => {
    if (activeOwner.kind !== "subject" || retiredDefinition.kind !== "definition") throw new Error("fixture missing");
    const subject = { ...activeOwner, content: { ...activeOwner.content, id: "csub_activation_new", canonicalKey: "driver:local,activation",
      selector: { ...activeOwner.content.selector, value: "local,activation" },
    } };
    const definition = { ...retiredDefinition, content: { ...retiredDefinition.content,
      id: "pdef_activation_new", subjectId: subject.content.id, propertyKey: "iin_new",
      revision: { ...retiredDefinition.content.revision, id: "drev_activation_new_1", number: 1 },
    } };
    expect(() => refuseRetiredOwnerDefinitionChanges(successor([...base.documents, subject, definition]).compiled)).not.toThrow();
  });

  function storedCandidate() {
    const prepared = successor(base.documents.map((document) => document === retiredDefinition ? revise(document, true) : document));
    const command = { mode: "online-publication", jobId: "cjob_old", candidateId: "ccand_old", authorizationId: "cauth_old", fencingToken: 1,
      expectedCurrent: { id: vendor.compiled.release.id, digest: vendor.compiled.aggregateDigest },
    } as Extract<InstallPublishedReleaseCommand, { mode: "online-publication" }>;
    vi.spyOn(store, "getJob").mockResolvedValue({ ok: true, value: {
      candidateId: command.candidateId, authorizationId: command.authorizationId, fencingToken: command.fencingToken,
    } as PublicationJobRecord });
    vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({ kind: "installed", current: vendor.compiled.release, predecessorReleaseId: null });
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as pg.PoolClient;
    const materialize = vi.spyOn(materialization, "materializeCompiledRelease");
    return { prepared, command, client, materialize };
  }

  it("refuses an already stored and authorized candidate before any domain write", async () => {
    const { prepared, command, client, materialize } = storedCandidate();
    vi.spyOn(store, "getReceiptByJobId").mockResolvedValue({ ok: false, error: { kind: "not-found", entity: "receipt" } });
    vi.spyOn(freeze, "isPublicationFrozen").mockResolvedValue(false);
    vi.spyOn(authorization, "verifyAuthorizationForActivation").mockResolvedValue({ ok: true, value: {} as VerifiedPublicationAuthorization });
    vi.spyOn(store, "getCandidate").mockResolvedValue({ ok: true, value: {
      artifactDigest: prepared.compiled.aggregateDigest,
      expectedBaseReleaseId: command.expectedCurrent.id, expectedBaseReleaseDigest: command.expectedCurrent.digest,
    } as PublicationCandidateRecord });
    vi.spyOn(store, "getArtifactByDigest").mockResolvedValue({ ok: true, value: {
      artifactDigest: prepared.compiled.aggregateDigest, artifactBytes: encodeBundleBytes(prepared.bundle),
      targetReleaseId: prepared.compiled.release.id, targetReleaseDigest: prepared.compiled.release.digest,
    } as ReleaseArtifactRecord });
    await expect(activateOnlinePublication(client, command)).rejects.toMatchObject({ activationError: {
      kind: "publication-not-authorized", reason: "subject-retired",
    } });
    expect(materialize).not.toHaveBeenCalled();
    expect(vi.mocked(client.query).mock.calls.every(([sql]) => typeof sql === "string" && sql.trim().startsWith("select"))).toBe(true);
  });

  it("keeps an existing successful receipt replay ahead of candidate validation", async () => {
    const { command, client, materialize } = storedCandidate();
    vi.spyOn(store, "getReceiptByJobId").mockResolvedValue({ ok: true, value: {
      id: "crct_existing", kind: "online-publication", publicationJobId: command.jobId,
      candidateId: command.candidateId, authorizationId: command.authorizationId,
      releaseId: vendor.compiled.release.id, releaseDigest: vendor.compiled.release.digest,
      predecessorReleaseId: null, predecessorReleaseDigest: null,
    } as CatalogActivationReceiptRecord });
    const candidate = vi.spyOn(store, "getCandidate");
    expect(await activateOnlinePublication(client, command)).toMatchObject({ status: "already-recorded", currentness: "active" });
    expect(candidate).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });
});
