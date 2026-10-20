import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { archiveGraphChecksum, buildArchiveAad, checksumContract, encryptArchiveObject,
  type ArchiveObjectStore } from "../../catalog-cutover/archive";
import type { ObjectStore } from "../../logs/objectStore";
import { archiveDigestOf, type ArchivedPlaneDocument } from "../../parameter-bindings/seedInitialization/archive";
import { deleteErasedArchiveObject, eraseDefinitionFromPlaneArchive, prepareDefinitionArchiveErasure,
  type DefinitionDeletionInventory } from "./archives";

const inventory = (): DefinitionDeletionInventory => ({
  definition: { id: "defA", propertyKey: "a", subjectName: "driver" },
  catalogRelease: { id: "release", digest: "digest" }, fingerprint: "fingerprint", counts: {},
  targets: { "parameter_catalog.project_parameter_bindings": ["bindA"] },
  organizationIds: [], projectIds: [], legacySpecIds: ["specA"], planeArchives: [], catalogArchives: [],
});
const document = (relations: ArchivedPlaneDocument["relations"]): ArchivedPlaneDocument => ({
  schemaVersion: "project-parameter-plane-archive/v2", organizationId: "org", projectId: "project",
  capturedAt: "2026-10-20T00:00:00Z", truncated: false,
  counts: Object.fromEntries(Object.entries(relations).map(([key, rows]) => [key, rows.length])),
  relations, objects: { "original.json": { checksumSha256: "checksum", sizeBytes: 4, bytesBase64: "e30K" } },
});

describe("definition archive erasure", () => {
  it("removes archived-only bindings, values, drafts and candidate snapshots while preserving original files", () => {
    const original = document({
      canonical_bindings: [{ id: "bindA", definition_id: "defA" }, { id: "bindB", definition_id: "defB" }],
      canonical_values: [{ id: "valueA", binding_id: "bindA", raw_value: 99 },
        { id: "valueB", binding_id: "bindB", raw_value: { definitionId: "defA" } }],
      parameter_drafts: [{ id: "draftA", data: { canonicalBindingId: "bindA", targetValue: 99 } }],
      project_parameter_file_candidates: [{ id: "candidate", storage_key: "original.json", parsed_index: { definitionId: "defA" },
        impact: { items: [{ definitionId: "defA", targetValue: 99 }, { definitionId: "defB", targetValue: 10 }] },
        frozen_binding_manifest: [{ sourceProjectValueId: "valueA" }], source_revision_context: { definitionId: "defA" } }],
      project_parameter_file_versions: [{ id: "version", storage_key: "original.json", parsed_index: { property: "a" } }],
    });
    const next = eraseDefinitionFromPlaneArchive(original, inventory());
    expect(next.relations.canonical_values).toEqual([{ id: "valueB", binding_id: "bindB", raw_value: { definitionId: "defA" } }]);
    expect(next.relations.parameter_drafts).toEqual([]);
    expect(next.relations.project_parameter_file_candidates).toEqual([{ id: "candidate", storage_key: "original.json", parsed_index: { definitionId: "defA" },
      impact: { items: [{ definitionId: "defB", targetValue: 10 }] }, frozen_binding_manifest: [], source_revision_context: {} }]);
    expect(next.objects).toBe(original.objects);
    expect(next.relations.project_parameter_file_versions).toBe(original.relations.project_parameter_file_versions);
    expect(original.relations.canonical_values).toHaveLength(2);
    expect(next.counts.parameter_drafts).toBe(0);
  });

  it("drops an indivisible mixed approval while retaining other parameters' values, history and delete pins", () => {
    const next = eraseDefinitionFromPlaneArchive(document({
      project_parameter_value_change_targets: [{ id: "targetA", request_id: "request", binding_id: "bindA" },
        { id: "targetB", request_id: "request", binding_id: "bindB" }],
      project_parameter_value_change_requests: [{ id: "request" }],
      canonical_values: [{ id: "valueB", binding_id: "bindB", definition_id: "defB", raw_value: 12,
        replaced_from_definition_id: "defA", replaced_from_value_id: "valueA" }],
      binding_history_events: [{ id: "historyB", binding_id: "bindB", applied_request_id: "request" }],
      canonical_source_pins: [{ id: "pinB", binding_id: "bindB", delete_request_id: "request", delete_target_id: "targetB" }],
    }), inventory());
    expect(next.relations.project_parameter_value_change_targets).toEqual([]);
    expect(next.relations.project_parameter_value_change_requests).toEqual([]);
    expect(next.relations.canonical_values).toEqual([{ id: "valueB", binding_id: "bindB", definition_id: "defB", raw_value: 12,
      replaced_from_definition_id: null, replaced_from_value_id: null }]);
    expect(next.relations.binding_history_events).toEqual([{ id: "historyB", binding_id: "bindB", applied_request_id: null }]);
    expect(next.relations.canonical_source_pins).toEqual([{ id: "pinB", binding_id: "bindB", delete_request_id: null, delete_target_id: null }]);
  });

  it("checks archives read-only during preview and replaces only sanitized relation bytes during execution", async () => {
    const bytes = Buffer.from(JSON.stringify(document({ canonical_bindings: [{ id: "bindA", definition_id: "defA" }, { id: "bindB", definition_id: "defB" }] })));
    const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const input = inventory();
    const counts = { canonical_bindings: 2 };
    input.planeArchives = [{ id: "archive", organization_id: "org", object_ref: "old", content_digest: contentDigest,
      archive_digest: archiveDigestOf({ scope: "legacy-parameter-plane", counts, contentDigest }), scope: "legacy-parameter-plane", counts }];
    const put = vi.fn(async (_input: Parameters<ObjectStore["put"]>[0]) => ({ storageKey: "new", checksumSha256: "new", sizeBytes: 1 }));
    const objectStore = { getBounded: async () => bytes, put, delete: vi.fn() } as unknown as ObjectStore;
    const preview = await prepareDefinitionArchiveErasure(input, { objectStore }, { dryRun: true });
    expect(preview.affectedArchiveRecords).toBe(1);
    expect(put).not.toHaveBeenCalled();
    const plan = await prepareDefinitionArchiveErasure(input, { objectStore });
    expect(plan.pendingObjectRefs).toEqual(["plane::old"]);
    expect(plan.planeUpdates[0]?.counts).toEqual({ canonical_bindings: 1 });
    expect(JSON.parse(put.mock.calls[0]![0]!.bytes.toString()).objects["original.json"]).toBeDefined();
  });

  it("preserves legacy requests and history for other parameters in a shared submission round", () => {
    const next = eraseDefinitionFromPlaneArchive(document({
      parameter_submission_items: [{ id: "itemA", parameter_spec_id: "specA", submission_round_id: "round" },
        { id: "itemB", parameter_spec_id: "specB", submission_round_id: "round" }],
      parameter_change_requests: [{ id: "requestA", parameter_spec_id: "specA", submission_round_id: "round" },
        { id: "requestB", parameter_spec_id: "specB", submission_round_id: "round" }],
      parameter_history_entries: [{ id: "historyB", parameter_spec_id: "specB", request_id: "requestB" }],
    }), inventory());
    expect(next.relations.parameter_change_requests).toEqual([{ id: "requestB", parameter_spec_id: "specB", submission_round_id: "round" }]);
    expect(next.relations.parameter_history_entries).toEqual([{ id: "historyB", parameter_spec_id: "specB", request_id: "requestB" }]);
  });

  it("refuses corrupt archives before writing any sanitized object", async () => {
    const input = inventory();
    input.planeArchives = [{ id: "archive", organization_id: "org", object_ref: "old", content_digest: "wrong",
      archive_digest: "wrong", scope: "legacy-parameter-plane", counts: {} }];
    const objectStore = { getBounded: async () => Buffer.from("{}"), put: vi.fn(), delete: vi.fn() } as unknown as ObjectStore;
    await expect(prepareDefinitionArchiveErasure(input, { objectStore })).rejects.toMatchObject({ details: { reason: "definition-archive-integrity-failed" } });
    expect(objectStore.put).not.toHaveBeenCalled();
  });

  it("validates encrypted ownership and refuses mixed original-file graphs before deletion", async () => {
    const input = inventory();
    input.targets["parameter_catalog.parameter_catalog_archives"] = ["archive"];
    input.targets["parameter_catalog.legacy_identities"] = ["identityA"];
    const key = Buffer.alloc(32, 7);
    const graph = { sourcePayload: { kind: "legacy-source-row", specId: "specA", token: "value" },
      relationGraph: { identityId: "identityA", edges: [{ from: "identityA", to: "specA", kind: "source-row" }] } };
    const references = [{ kind: "legacy-identity", id: "identityA" }];
    const metadata = { id: "archive", legacy_identity_id: "identityA", cutover_run_id: "run", encrypted_object_ref: "cipher",
      source_checksum: checksumContract(graph.sourcePayload), graph_checksum: archiveGraphChecksum({ relationGraph: graph.relationGraph, protectedReferences: references }), protected_references: references };
    input.catalogArchives = [metadata];
    const encrypt = () => encryptArchiveObject({ key, aad: buildArchiveAad({ archiveId: metadata.id, legacyIdentityId: metadata.legacy_identity_id,
      cutoverRunId: metadata.cutover_run_id, sourceChecksum: metadata.source_checksum, graphChecksum: metadata.graph_checksum }), plaintext: Buffer.from(JSON.stringify(graph)) });
    const catalogArchiveStore = { exists: async () => true, get: async () => encrypt(), remove: vi.fn() } as unknown as ArchiveObjectStore;
    expect((await prepareDefinitionArchiveErasure(input, { catalogArchiveStore, catalogArchiveKey: key })).pendingObjectRefs).toEqual(["catalog::cipher"]);
    Object.assign(graph.sourcePayload, { originalFile: "preserve me" });
    metadata.source_checksum = checksumContract(graph.sourcePayload);
    await expect(prepareDefinitionArchiveErasure(input, { catalogArchiveStore, catalogArchiveKey: key })).rejects.toMatchObject({ details: { reason: "definition-catalog-archive-mixed-graph" } });
    expect(catalogArchiveStore.remove).not.toHaveBeenCalled();
  });

  it("never physically deletes an object retained by an original file or another archive", async () => {
    const remove = vi.fn();
    const db = { query: async () => ({ rows: [{ referenced: true }], rowCount: 1 }) };
    await expect(deleteErasedArchiveObject("plane::source", { objectStore: { delete: remove } as unknown as ObjectStore }, db as never)).rejects.toThrow("retained references");
    expect(remove).not.toHaveBeenCalled();
  });
});
