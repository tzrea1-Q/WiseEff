import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import * as authorization from "../../catalog-publication/authorization/authorize";
import type { VerifiedPublicationAuthorization } from "../../catalog-publication/authorization/types";
import * as bundleCodec from "../../catalog-publication/builder/bundleCodec";
import { encodeBundleBytes, refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import * as store from "../../catalog-publication/persistence/store";
import type { CatalogActivationReceiptRecord, PublicationJobRecord, ReleaseArtifactRecord } from "../../catalog-publication/persistence/types";
import { CatalogArtifactId, PublicationPolicyRevision } from "../../parameter-catalog-contract/index";
import * as freeze from "../../catalog-publication/runtime/freeze";
import * as compiler from "../compiler/index";
import type { CatalogReleaseDocument } from "../compiler/types";
import * as verification from "../verification/index";
import * as currentPointer from "./currentPointer";
import { installPublishedRelease } from "./installer";
import * as materialization from "./materializeRelease";
import { prepareOnlinePublication, refuseRetiredOwnerDefinitionChanges } from "./publicationActivation";
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
  const compiled = compiler.compileCatalogRelease(bundle);
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

  function storedCandidate(changed = retiredDefinition, storedBytes?: Uint8Array) {
    const prepared = successor(base.documents.map((document) => document === changed ? revise(document, true) : document));
    const command = { mode: "online-publication", jobId: "cjob_old", candidateId: "ccand_old", authorizationId: "cauth_old", fencingToken: 1,
      expectedCurrent: { id: vendor.compiled.release.id, digest: vendor.compiled.aggregateDigest },
    } as Extract<InstallPublishedReleaseCommand, { mode: "online-publication" }>;
    vi.spyOn(store, "getJob").mockResolvedValue({ ok: true, value: {
      candidateId: command.candidateId, authorizationId: command.authorizationId, fencingToken: command.fencingToken,
    } as PublicationJobRecord });
    vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({
      kind: "installed", current: vendor.compiled.release, predecessorReleaseId: null, subjectOwnerEpoch: "0",
    });
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
      rows: sql.includes("from catalog_publication.release_artifacts") ? [{ present: true }] : [], rowCount: 0,
    }));
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release } as unknown as pg.PoolClient));
    const pool = { connect } as unknown as pg.Pool;
    const materialize = vi.spyOn(materialization, "materializeCompiledRelease");
    const candidate = {
      id: command.candidateId, artifactId: CatalogArtifactId("cart_old"),
      artifactDigest: prepared.compiled.aggregateDigest,
      expectedBaseReleaseId: command.expectedCurrent.id, expectedBaseReleaseDigest: command.expectedCurrent.digest,
      proposalId: null, proposalRevisionId: null, identityAllocation: {},
      impactReportDigest: "sha256:fixture-impact", capabilityContract: {}, createdAt: "2026-10-16T00:00:00Z",
    };
    const candidateRead = vi.spyOn(store, "getCandidate").mockResolvedValue({ ok: true, value: candidate });
    const artifactBytes = storedBytes ?? encodeBundleBytes(prepared.bundle);
    const target: ReleaseArtifactRecord = {
      id: candidate.artifactId, bytesChecksum: store.sha256DigestOfBytes(artifactBytes), sourceKind: "typed-changeset",
      artifactDigest: candidate.artifactDigest, artifactBytes,
      targetReleaseId: prepared.compiled.release.id, targetReleaseDigest: prepared.compiled.release.digest,
      predecessorReleaseId: command.expectedCurrent.id, predecessorReleaseDigest: command.expectedCurrent.digest,
      toolchain: {}, createdAt: "2026-10-16T00:00:00Z",
    };
    const artifactRead = vi.spyOn(store, "readArtifactLineage").mockResolvedValue({ ok: true, value: {
      target, records: new Map([[target.artifactDigest, target]]),
    } });
    vi.spyOn(freeze, "isPublicationFrozen").mockResolvedValue(false);
    const policyRevision = PublicationPolicyRevision(1);
    const authorized: VerifiedPublicationAuthorization = {
      candidate, riskClass: "low",
      policy: {
        revision: policyRevision, publicationEnabled: true, lowRiskSingleActorPublish: true, capabilityContractRevision: "v1",
        updatedAt: candidate.createdAt, updatedByPrincipalId: "user-catalog-publisher",
      },
      authorization: {
        id: command.authorizationId, candidateId: candidate.id, eventKind: "approve", artifactDigest: candidate.artifactDigest,
        expectedBaseReleaseId: candidate.expectedBaseReleaseId, expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
        proposalRevisionId: null, impactReportDigest: candidate.impactReportDigest, capabilityContractDigest: "sha256:fixture-contract",
        policyRevision, actorPrincipalId: "user-catalog-publisher", approvedAuthorizationId: null, createdAt: candidate.createdAt,
      },
    };
    const authorize = vi.spyOn(authorization, "verifyAuthorizationForActivation").mockResolvedValue({
      ok: true, value: authorized,
    });
    const receiptRead = vi.spyOn(store, "getReceiptByJobId").mockResolvedValue({ ok: false, error: { kind: "not-found", entity: "receipt" } });
    return { prepared, target, command, pool, query, release, connect, materialize, candidateRead, artifactRead, authorize, receiptRead };
  }

  function compactCandidate() {
    const fixture = storedCandidate(activeDefinition);
    const { prepared, target } = fixture;
    const baseBytes = encodeBundleBytes(vendor.bundle);
    const parent: ReleaseArtifactRecord = { ...target, id: CatalogArtifactId("cart_parent"),
      targetReleaseId: vendor.compiled.release.id, targetReleaseDigest: vendor.compiled.aggregateDigest,
      artifactDigest: vendor.compiled.aggregateDigest, artifactBytes: baseBytes, bytesChecksum: store.sha256DigestOfBytes(baseBytes),
    };
    const compactBytes = encodeBundleBytes({ ...prepared.bundle, releases: [prepared.bundle.releases.at(-1)!] });
    const compact: ReleaseArtifactRecord = { ...target, storageFormat: "successor-v1", artifactBytes: compactBytes,
      bytesChecksum: store.sha256DigestOfBytes(compactBytes) };
    const useLineage = (tip: ReleaseArtifactRecord, ancestor: ReleaseArtifactRecord) => {
      fixture.artifactRead.mockResolvedValue({ ok: true, value: { target: tip,
        records: new Map([[tip.artifactDigest, tip], [ancestor.artifactDigest, ancestor]]) } });
    };
    useLineage(compact, parent);
    return { ...fixture, compact, parent, useLineage };
  }

  it("compiles the independently decoded physical rows once and pins the physical tip under the lock", async () => {
    const { command, pool, release, compact, prepared } = compactCandidate();
    const parse = vi.spyOn(bundleCodec, "parseBundleBytes");
    const encode = vi.spyOn(bundleCodec, "encodeBundleBytes");
    const result = await prepareOnlinePublication(pool, command);
    expect(result.kind).toBe("prepared");
    if (result.kind !== "prepared") throw new Error("preparation failed");
    expect(result.artifact.bytesChecksum).toBe(compact.bytesChecksum);
    expect(result.compiled.compiledReleaseDigest).toBe(prepared.compiled.compiledReleaseDigest);
    expect(result.compiled.materializationFingerprint).toBe(prepared.compiled.materializationFingerprint);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(parse.mock.invocationCallOrder[0]!);
    expect(encode).not.toHaveBeenCalled();
  });

  it.each(["ancestor-checksum", "predecessor-id", "noncanonical-number"] as const)(
    "rejects compact lineage with %s before calling the compiler", async failure => {
      const { command, pool, compact, parent, useLineage } = compactCandidate();
      if (failure === "ancestor-checksum") {
        useLineage(compact, { ...parent, artifactBytes: Buffer.from("different bytes") });
      } else if (failure === "predecessor-id") {
        useLineage({ ...compact, predecessorReleaseId: compact.targetReleaseId }, parent);
      } else {
        const invalid = Buffer.from(Buffer.from(parent.artifactBytes).toString("utf8").replace('"manifest": {', '"unused": -0, "manifest": {'));
        useLineage(compact, { ...parent, artifactBytes: invalid, bytesChecksum: store.sha256DigestOfBytes(invalid) });
      }
      const compile = vi.spyOn(compiler, "compileCatalogRelease");
      await expect(installPublishedRelease(pool, command)).resolves.toEqual({ ok: false, error: { kind: "artifact-unreadable" } });
      expect(compile).not.toHaveBeenCalled();
    });

  it("keeps a checksum mismatch on a full artifact distinct from invalid compact lineage", async () => {
    const { command, pool, target, artifactRead } = storedCandidate();
    artifactRead.mockResolvedValue({ ok: true, value: { target: { ...target, bytesChecksum: "corrupt" }, records: new Map() } });
    await expect(installPublishedRelease(pool, command)).resolves.toMatchObject({ ok: false, error: {
      kind: "publication-not-authorized", reason: "candidate-tampered",
    } });
  });

  it("reports unreadable bytes when the stored package exists and its checksum matches", async () => {
    const { command, pool, materialize } = storedCandidate(retiredDefinition, Buffer.from('{"schemaVersion":'));
    await expect(installPublishedRelease(pool, command)).resolves.toEqual({ ok: false, error: { kind: "artifact-unreadable" } });
    expect(materialize).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "not-found", entity: "artifact" }, { kind: "artifact-missing" }],
    [{ kind: "invalid-input", reason: "invalid-artifact-lineage" }, { kind: "artifact-unreadable" }],
    [{ kind: "permission-denied", sqlstate: "42501", message: "denied" }, { kind: "artifact-read-failed", retryable: false }],
    [{ kind: "constraint-violation", sqlstate: "40001", message: "serialization failure" }, { kind: "artifact-read-failed", retryable: true }],
  ] as const)("classifies a %j read failure before materialization", async (error, expected) => {
    const { command, pool, materialize, artifactRead } = storedCandidate();
    artifactRead.mockResolvedValue({ ok: false, error });
    await expect(installPublishedRelease(pool, command)).resolves.toEqual({ ok: false, error: expected });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("releases the artifact reader before compiling and authorizes under the write lock", async () => {
    const { command, pool, query, release, materialize, artifactRead, authorize } = storedCandidate();
    const compile = vi.spyOn(compiler, "compileCatalogRelease");
    await expect(installPublishedRelease(pool, command)).resolves.toMatchObject({ ok: false, error: {
      kind: "publication-not-authorized", reason: "subject-retired",
    } });
    const compileOrder = compile.mock.invocationCallOrder[0]!;
    const lockIndex = query.mock.calls.findIndex(([sql]) => sql.includes("acquire_current_pointer_lock_exclusive"));
    expect(lockIndex).toBeGreaterThan(0);
    const lockOrder = query.mock.invocationCallOrder[lockIndex]!;
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(compileOrder);
    expect(compileOrder).toBeLessThan(lockOrder);
    expect(lockOrder).toBeLessThan(authorize.mock.invocationCallOrder[0]!);
    expect(artifactRead).toHaveBeenCalledTimes(1);
    expect(materialize).not.toHaveBeenCalled();
  });

  it("requires the prepared artifact identity to still match before materialization", async () => {
    const { command, pool, query, materialize, artifactRead } = storedCandidate();
    query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await expect(installPublishedRelease(pool, command)).resolves.toMatchObject({ ok: false, error: {
      kind: "publication-not-authorized", reason: "candidate-stale",
    } });
    expect(query.mock.calls.find(([sql]) => sql.includes("from catalog_publication.release_artifacts"))?.[1]).toEqual([
      "cart_old", expect.stringMatching(/^sha256:/), expect.stringMatching(/^sha256:/), successorId, expect.stringMatching(/^sha256:/),
    ]);
    expect(artifactRead).toHaveBeenCalledTimes(1);
    expect(materialize).not.toHaveBeenCalled();
  });

  it("rechecks the approver after preparation and before authorizing under the lock", async () => {
    const { command, pool, query, materialize, authorize, artifactRead } = storedCandidate();
    const refreshTrustedActor = vi.fn(async () => null);
    await expect(installPublishedRelease(pool, { ...command, refreshTrustedActor })).resolves.toMatchObject({ ok: false, error: {
      kind: "publication-not-authorized", reason: "publication-capability-missing",
    } });
    const guardIndex = query.mock.calls.findIndex(([sql]) => sql.includes("acquire_publication_guard_lock"));
    const guardOrder = query.mock.invocationCallOrder[guardIndex]!;
    expect(artifactRead.mock.invocationCallOrder[0]).toBeLessThan(guardOrder);
    expect(guardOrder).toBeLessThan(refreshTrustedActor.mock.invocationCallOrder[0]!);
    expect(authorize).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  it("stops before acquiring the write lock when compilation crossed the deadline", async () => {
    const { prepared, command, pool, connect, query } = storedCandidate();
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(compiler, "compileCatalogRelease").mockImplementation(() => {
      now = 201;
      return { ok: true, value: prepared.compiled };
    });
    await expect(installPublishedRelease(pool, { ...command, activationDeadlineMs: 200 })).resolves.toEqual({
      ok: false, error: { kind: "activation-timeout" },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => sql.includes("acquire_current_pointer_lock_exclusive"))).toBe(false);
  });

  it("rolls back when activation crosses the deadline before commit", async () => {
    const { command, pool, query, materialize } = storedCandidate(activeDefinition);
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    query.mockImplementation(async (sql) => {
      if (sql.includes("mark_job_activated")) now = 201;
      return { rows: sql.includes("from catalog_publication.release_artifacts") ? [{ present: true }] : [], rowCount: 0 };
    });
    materialize.mockResolvedValue({} as Awaited<ReturnType<typeof materialization.materializeCompiledRelease>>);
    vi.spyOn(verification, "verifyStagedReleaseProjection").mockResolvedValue({ ok: true });
    vi.spyOn(store, "insertReceipt").mockResolvedValue({ ok: true, value: { id: "crct_test" } as CatalogActivationReceiptRecord });
    await expect(installPublishedRelease(pool, { ...command, activationDeadlineMs: 200 })).resolves.toEqual({
      ok: false, error: { kind: "activation-timeout" },
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("mark_job_activated"))).toBe(true);
    expect(query.mock.calls.filter(([sql]) => sql === "commit")).toHaveLength(1); // Read-only preparation committed.
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });

  it.each(["artifact-read", "receipt-write"] as const)("reports a canceled %s as an activation timeout", async (stage) => {
    const { command, pool, query, materialize, artifactRead } = storedCandidate(activeDefinition);
    if (stage === "artifact-read") artifactRead.mockRestore();
    materialize.mockResolvedValue({} as Awaited<ReturnType<typeof materialization.materializeCompiledRelease>>);
    vi.spyOn(verification, "verifyStagedReleaseProjection").mockResolvedValue({ ok: true });
    const canceled = new pg.DatabaseError("statement canceled", 0, "error");
    canceled.code = "57014";
    const target = stage === "artifact-read" ? "from catalog_publication.release_artifacts" : "insert into parameter_catalog.catalog_activation_receipts";
    query.mockImplementation(async (sql) => {
      if (sql.includes(target)) throw canceled;
      return { rows: sql.includes("from catalog_publication.release_artifacts") ? [{ present: true }] : [], rowCount: 0 };
    });
    await expect(installPublishedRelease(pool, { ...command, activationDeadlineMs: Date.now() + 60_000 })).resolves.toEqual({
      ok: false, error: { kind: "activation-timeout" },
    });
    expect(query.mock.calls.some(([sql]) => sql.includes(target))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });

  it("keeps an existing successful receipt replay ahead of candidate validation", async () => {
    const { command, pool, materialize, candidateRead, receiptRead, artifactRead } = storedCandidate();
    receiptRead.mockResolvedValue({ ok: true, value: {
      id: "crct_existing", kind: "online-publication", publicationJobId: command.jobId,
      candidateId: command.candidateId, authorizationId: command.authorizationId,
      releaseId: vendor.compiled.release.id, releaseDigest: vendor.compiled.release.digest,
      predecessorReleaseId: null, predecessorReleaseDigest: null,
    } as CatalogActivationReceiptRecord });
    expect(await installPublishedRelease(pool, command)).toMatchObject({ ok: true, value: { status: "already-recorded", currentness: "active" } });
    expect(candidateRead).not.toHaveBeenCalled();
    expect(artifactRead).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });
});
