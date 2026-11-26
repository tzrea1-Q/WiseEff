import { afterEach, describe, expect, it, vi } from "vitest";

import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import { createUserInvocation } from "../../auth/trustedInvocation";
import * as currentPointer from "../../catalog-kernel/install/currentPointer";
import * as bundleCodec from "../../catalog-publication/builder/bundleCodec";
import * as successorBuilder from "../../catalog-publication/builder/completeSuccessor";
import { encodeBundleBytes, sha256Digest } from "../../catalog-publication/builder/bundleCodec";
import { firstAcmePredecessor, integerContent } from "../../catalog-publication/builder/predecessorHarness";
import { serializeMarkdownRevision } from "../../catalog-publication/import/markdownImport";
import type { ReleaseArtifactRecord } from "../../catalog-publication/persistence/types";
import * as publicationStore from "../../catalog-publication/persistence/store";
import { CatalogArtifactId } from "../../parameter-catalog-contract/index";
import type { Database } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { mapPublicationFailure } from "./errors";
import { bindCatalogPublicationCommands } from "./ports";

afterEach(() => vi.restoreAllMocks());

function mockStoredArtifact(target: ReleaseArtifactRecord) {
  return vi.spyOn(publicationStore, "readArtifactLineage").mockResolvedValue({
    ok: true, value: { target, records: new Map([[target.artifactDigest, target]]) },
  });
}

describe("publication preview memory work", () => {
  it.each(["cold", "warm", "unproven", "unchanged"] as const)("bounds Markdown predecessor reads for a %s preview", async (mode) => {
    const predecessor = firstAcmePredecessor();
    const load = mockStoredArtifact({
      id: CatalogArtifactId("cart_import_memory"), artifactDigest: predecessor.digest,
      bytesChecksum: sha256Digest(predecessor.bytes), artifactBytes: predecessor.bytes,
      sourceKind: "adopted-preexisting", targetReleaseId: predecessor.compiled.release.id,
      targetReleaseDigest: predecessor.digest, predecessorReleaseId: null, predecessorReleaseDigest: null,
      toolchain: {}, createdAt: "2026-11-17T00:00:00Z",
    });
    const snapshot = vi.spyOn(publicationStore, "getValidatedPreviewSnapshot").mockResolvedValue(mode === "cold"
      ? { ok: false, error: { kind: "not-found", entity: "artifact" } }
      : { ok: true, value: { target: predecessor.first, coversSubjectSpellings: true, hasSubjectRules: false, hasDtsExamples: false } });
    vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({
      kind: "installed", current: predecessor.compiled.release, predecessorReleaseId: null, subjectOwnerEpoch: "0",
    });
    const persist = vi.spyOn(successorBuilder, "persistSuccessorBuild").mockImplementation(async (_request, artifact, candidate) => ({
      kind: "persisted",
      artifact: { ...artifact, bytesChecksum: sha256Digest(artifact.artifactBytes), createdAt: "2026-11-17T00:00:00Z" },
      candidate: { ...candidate, artifactDigest: artifact.artifactDigest, createdAt: "2026-11-17T00:00:00Z" },
    }));
    const parse = vi.spyOn(bundleCodec, "parseBundleBytes");
    const compactBuild = vi.spyOn(successorBuilder, "buildSuccessorFromSnapshot");
    const fullBuild = vi.spyOn(successorBuilder, "buildCompleteSuccessor");
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ available: true, can_read: true, usable: mode !== "unproven" }] }),
      transaction: (work: (tx: Database) => Promise<unknown>) => work(db),
    } as unknown as Database;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const commands = bindCatalogPublicationCommands({ db, pool: { query } as Parameters<typeof currentPointer.readCurrentCatalogPointer>[0] });
    const result = await commands.previewCandidate({
      trustedActor: createUserInvocation(makeTestAuthContext()),
      organizationId: "org-import-memory", principalId: "author", actorKind: "org-admin",
      permissions: ["catalog:author"], catalogReleaseId: predecessor.compiled.release.id,
      markdownImport: { fileName: "memory.md", document: mode === "unchanged"
        ? serializeMarkdownRevision(predecessor.first, ["pdef_acme_power_iin_max"]).document
        : "# Driver `acme,power`\n## `memory_new` New definition\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n" },
    });
    const historyReads = mode === "cold" || mode === "unproven" ? 1 : 0;
    expect(load).toHaveBeenCalledTimes(historyReads);
    expect(parse).toHaveBeenCalledTimes(historyReads);
    if (mode === "unproven") {
      expect(fullBuild.mock.calls[0]?.[0].frozenIdentity).toBe(compactBuild.mock.calls[0]![0].frozenIdentity);
    }
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("registration_recognition_rules"), ["org-import-memory"]);
    if (mode === "unchanged") {
      expect(result).toMatchObject({ ok: true, value: { candidate: null, noChange: true, entries: [{ outcome: "skip" }] } });
      expect(persist).not.toHaveBeenCalled();
      return;
    }
    expect(result).toMatchObject({ ok: true, value: {
      candidate: { expectedBaseReleaseId: predecessor.compiled.release.id, impactSummary: { addedDefinitionCount: 1 } },
      entries: [{ outcome: "create", propertyKey: "memory_new" }],
    } });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]![1]).toMatchObject({ sourceKind: "markdown-import" });
  });
});

describe("publication preview duplicate definitions", () => {
  it.each(["predecessor", "changeSet"] as const)(
    "reports a duplicate in the %s as a definition conflict without persisting",
    async (source) => {
      const predecessor = firstAcmePredecessor();
      mockStoredArtifact({
        id: CatalogArtifactId("cart_duplicate_definition"),
        artifactDigest: predecessor.digest,
        bytesChecksum: sha256Digest(predecessor.bytes),
        artifactBytes: predecessor.bytes,
        sourceKind: "adopted-preexisting",
        targetReleaseId: predecessor.compiled.release.id,
        targetReleaseDigest: predecessor.digest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
        createdAt: "2026-10-26T00:00:00Z",
      });
      vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({
        kind: "installed", current: predecessor.compiled.release, predecessorReleaseId: null, subjectOwnerEpoch: "0",
      });
      const db = { query: vi.fn(), transaction: vi.fn() } as unknown as Database;
      const commands = bindCatalogPublicationCommands({ db, pool: {} as Parameters<typeof currentPointer.readCurrentCatalogPointer>[0] });
      const change = {
        op: "create-definition",
        subjectId: "csub_acme_power",
        propertyKey: source === "predecessor" ? "iin_max" : "rx_iout_ctrl_para",
        content: {
          displayName: "rx_iout_ctrl_para",
          documentation: "无线buck的动态调流配置，实现阶梯调流，防止拉挂：\n从左到右依次为：\nRX平均电流下限，单位: mA\nRX平均电流上限，单位: mA\nbuck限流值，单位: mA",
          valueSchema: { type: "array", items: { type: "integer", minimum: 0 } },
          examples: [[0, 100, 200, 100, 200, 300, 200, 300, 400, 300, 400, 500, 400, 500, 600, 500, 600, 700, 600, 700, 800, 700, 800, 900, 800, 9999, 1100]],
        },
      };
      const result = await commands.previewCandidate({
        trustedActor: createUserInvocation(makeTestAuthContext()),
        organizationId: "org-duplicate-definition", principalId: "author", actorKind: "org-admin",
        permissions: ["catalog:author"], catalogReleaseId: predecessor.compiled.release.id,
        changeSet: source === "predecessor" ? [change] : [change, change],
      });
      expect(result).toEqual({ ok: false, error: { kind: "reason", reason: "definition-already-exists" } });
      if (result.ok) throw new Error("duplicate definition preview was accepted");
      expect(mapPublicationFailure(result.error, "duplicate-definition")).toMatchObject({
        status: 409,
        body: { error: { code: "CONFLICT", details: { reason: "definition-already-exists", retryable: false } } },
      });
      expect(db.query).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
});

describe("publication preview retired owner boundary", () => {
  it.each(["create-definition", "revise-definition", "retire-definition", "restore-definition"] as const)(
    "reports %s as subject-retired before any persistence", async (op) => {
      const vendor = compileVendorCatalogSuccessor();
      const bytes = encodeBundleBytes(vendor.bundle);
      mockStoredArtifact({
        id: CatalogArtifactId("cart_retired_owner"),
        artifactDigest: vendor.compiled.aggregateDigest,
        bytesChecksum: sha256Digest(bytes),
        artifactBytes: bytes,
        sourceKind: "adopted-preexisting",
        targetReleaseId: vendor.compiled.release.id,
        targetReleaseDigest: vendor.compiled.aggregateDigest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
        createdAt: "2026-10-16T00:00:00Z",
      });
      vi.spyOn(currentPointer, "readCurrentCatalogPointer").mockResolvedValue({
        kind: "installed", current: vendor.compiled.release, predecessorReleaseId: null, subjectOwnerEpoch: "0",
      });
      const db = { query: vi.fn(), transaction: vi.fn() } as unknown as Database;
      const commands = bindCatalogPublicationCommands({ db, pool: {} as Parameters<typeof currentPointer.readCurrentCatalogPointer>[0] });
      const content = integerContent("Input current limit", "Retired subject remains read-only.");
      const change = op === "create-definition"
        ? { op, subjectId: "csub_acme_power", propertyKey: "iin_new", content }
        : { op, definitionId: "pdef_acme_power_iin_max", class: "documentation", content };
      const result = await commands.previewCandidate({
        trustedActor: createUserInvocation(makeTestAuthContext()),
        organizationId: "org-retired-owner", principalId: "author", actorKind: "org-admin",
        permissions: ["catalog:author"], catalogReleaseId: vendor.compiled.release.id,
        changeSet: [change],
      });
      expect(result).toEqual({ ok: false, error: { kind: "reason", reason: "subject-retired" } });
      if (result.ok) throw new Error("retired subject preview was accepted");
      expect(mapPublicationFailure(result.error, "retired-owner")).toMatchObject({
        status: 409,
        body: { error: { details: { reason: "subject-retired", retryable: false } } },
      });
      expect(db.query).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
});
