import { describe, expect, it } from "vitest";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { FROZEN_P0_GRAPH_FIXTURE } from "./classifier/__fixtures__/p0GraphFixture";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "./classifier";
import {
  inspectConversionManifest,
  type ConversionManifest,
} from "./conversionManifest";
import { planCutover } from "./orchestrator";

// A validator unit graph, not a replacement for complete physical P0 capture.
function fixture() {
  const source = structuredClone(FROZEN_P0_GRAPH_FIXTURE);
  const spec = source.specs.find(row => row.id === "s7cls-spec-r2-root")!;
  const schema = source.driverSchemas.find(row => row.parameterSpecId === spec.id)!;
  const version = source.specVersions.find(row => row.parameterSpecId === spec.id)!;
  const subject = source.subjects.find(row => row.id === schema.attributionSubjectId)!;
  const schemaVersion = source.driverSchemaVersions.find(row => row.driverSchemaId === schema.id)!;
  const identities = ([ ["parameter-spec", spec.id], ["driver-schema", schema.id],
    ["parameter-spec-version", version.id], ["parameter-subject", subject.id], ["driver-schema-version", schemaVersion.id] ] as const)
    .map(([sourceKind, sourceId]) => ({ id: `unit:${sourceKind}`, sourceKind, sourceId, sourceSystem: "wiseeff-v1",
      ownerScopeKind: "platform" as const, ownerScopeId: "platform" }));
  const graph: FrozenP0Graph = { catalog: "parameter-catalog-p0-graph", identities,
    specs: [spec], specVersions: [version], subjects: [subject], driverSchemas: [schema], driverSchemaVersions: [schemaVersion],
    driverRegistrations: [{ attributionSubjectId: subject.id }], nodeTypeDefinitions: [], dtsPropertySpecs: [],
    modules: [], placements: [], bindings: [], bindingRevisions: [] };
  const all = validCatalogReleaseBundle(), release = all.releases[0]!;
  const bundle = { ...all, targetReleaseId: release.manifest.release.id, releases: [release] };
  const target = release.documents.find(document => document.kind === "subject")!;
  const manifest: ConversionManifest = { version: "pcat-conversion-manifest-v1",
    sourceSnapshotFingerprint: fingerprintP0Graph(graph), sourceInventoryFingerprint: `sha256:${"a".repeat(64)}`,
    targetCatalogReleaseDigest: release.manifest.release.digest,
    mappings: identities.slice(0, 3).map(identity => ({ legacyIdentityId: identity.id, targetKind: "catalog-subject",
      targetId: target.content.id, targetSourceDigest: target.source.digest })) };
  return { graph, bundle, manifest, release };
}

describe("explicit Subject conversion for a provable DriverSchema root version", () => {
  it("consumes a pre-authored bundle and explicit manifest before plan generation", async () => {
    const f = fixture();
    const compiled = compileCatalogRelease(f.bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(f.manifest.mappings).toHaveLength(3);
    expect(f.manifest.mappings.every((mapping) => mapping.targetKind === "catalog-subject")).toBe(true);
    expect(new Set(f.manifest.mappings.map((mapping) => mapping.targetId))).toEqual(new Set(["csub_acme_power"]));
    expect(inspectConversionManifest({
      graph: f.graph,
      bundle: f.bundle,
      manifest: f.manifest,
      targetCatalogReleaseDigest: compiled.value.release.digest,
    })).toBeNull();
    const planned = await planCutover({
      graph: f.graph,
      targetArtifactSha: "a".repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      catalogReleaseSource: jsonCatalogReleaseSource(f.bundle),
      conversionManifest: f.manifest,
    });
    expect(planned).toMatchObject({ ok: true });
  });

  it("retains the actual parent root Subject rather than requiring a fabricated Definition revision", () => {
    const f = fixture(), classification = classifyFrozenP0Graph(f.graph);
    expect(classification.ok).toBe(true);
    if (!classification.ok) throw new Error("unit-classification-unavailable");
    expect(Object.fromEntries(classification.value.assignments.map(row => [row.sourceKind, row.rClass]))).toEqual({
      "parameter-spec": "R2", "driver-schema": "R2", "parameter-spec-version": "R2",
      "parameter-subject": "R10", "driver-schema-version": "R10",
    });
    expect(inspectConversionManifest({ ...f, targetCatalogReleaseDigest: f.release.manifest.release.digest })).toBeNull();
  });
  it.each(["wrong-parent", "missing-parent-identity", "different-target", "historical-subject-pin"])("refuses %s with freshly consistent outer pins", mode => {
    const f = fixture();
    const graph = structuredClone(f.graph), manifest = structuredClone(f.manifest);
    if (mode === "wrong-parent") Object.assign(graph.specVersions[0]!, { parameterSpecId: "another-spec" });
    if (mode === "missing-parent-identity") {
      Object.assign(graph, { identities: graph.identities.filter(row => row.sourceKind !== "parameter-spec") });
      Object.assign(manifest, { mappings: manifest.mappings.filter(row => row.legacyIdentityId !== "unit:parameter-spec") });
    }
    if (mode === "different-target") Object.assign(manifest.mappings[2]!, { targetId: "another-subject" });
    if (mode === "historical-subject-pin") Object.assign(manifest.mappings[2]!, { retainedReleaseId: f.release.manifest.release.id });
    Object.assign(manifest, { sourceSnapshotFingerprint: fingerprintP0Graph(graph) });
    expect(inspectConversionManifest({ ...f, graph, manifest, targetCatalogReleaseDigest: f.release.manifest.release.digest })).not.toBeNull();
  });
});
