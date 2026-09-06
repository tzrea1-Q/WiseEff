import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { stringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { validCatalogReleaseBundle, refreshReleaseAggregateDigest } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { createLocalArchiveObjectStore } from "./archive";
import { fingerprintP0Graph, type FrozenP0Graph } from "./classifier";
import { captureConversionSourceInventory, type ConversionManifest } from "./conversionManifest";
import { executeCutover, planCutover } from "./orchestrator";

const digest = (value: ContractJsonValue) => `sha256:${createHash("sha256").update(serializeContract(value)).digest("hex")}`;
const bundleWithTwoDefinitions = () => {
  const full = validCatalogReleaseBundle();
  const release = structuredClone(full.releases[0]) as any;
  const first = release.documents.find((doc: any) => doc.kind === "definition");
  const second = structuredClone(first);
  second.content.id = "pdef_explicit_second";
  second.content.propertyKey = "explicit_second";
  second.content.revision.id = "drev_explicit_second_1";
  second.content.revision.matching.sourceProperty = "explicit_second";
  const revision = second.content.revision;
  revision.contentDigest = digest({ "/lifecycle": revision.lifecycle, "/displayName": revision.displayName, "/documentation": revision.documentation, "/unit": revision.unit, "/valueSchema": revision.valueSchema, "/matching": revision.matching });
  second.normalizedDigest = digest(second.content);
  release.documents.push(second);
  const bytes = Buffer.from(stringify({ schemaVersion: "1.0.0", documents: release.documents.map((doc: any) => ({ kind: doc.kind, content: doc.content })) }, { lineWidth: 0 }));
  const sourceDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  release.sources[0].bytes = bytes.toString("base64");
  release.manifest.files[0].digest = sourceDigest;
  for (const doc of release.documents) doc.source.digest = sourceDigest;
  release.manifest.documents = release.documents.map((doc: any) => ({ sourcePath: doc.source.path, kind: doc.kind, documentId: doc.content.id, normalizedDigest: doc.normalizedDigest }));
  refreshReleaseAggregateDigest(release);
  return { schemaVersion: full.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
};

describe("S7 exact conversion identity producer, real PostgreSQL", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let root: string;
  const bundle = bundleWithTwoDefinitions();
  const source = jsonCatalogReleaseSource(bundle);
  const graph: FrozenP0Graph = {
    catalog: "parameter-catalog-p0-graph",
    identities: ["left", "right", "archive"].map((id) => ({ id: `lid-${id}`, sourceSystem: "synthetic-owned-source", sourceKind: "parameter-spec", ownerScopeKind: "platform", ownerScopeId: "platform", sourceId: `spec-${id}` })),
    specs: ["left", "right", "archive"].map((id) => ({ id: `spec-${id}`, organizationId: null, sourceKind: "dts", specificationKey: `synthetic.${id}`, attributionSubjectId: null, definitionLifecycle: id === "archive" ? "active" : "deprecated", propertyKey: id === "archive" ? "status" : `property_${id}` })),
    specVersions: [], subjects: [], driverRegistrations: [], nodeTypeDefinitions: [], driverSchemas: [], driverSchemaVersions: [], dtsPropertySpecs: [], modules: [], placements: [], bindings: [], bindingRevisions: [],
  };
  let manifest: ConversionManifest;
  beforeAll(async () => {
    expect(compileCatalogRelease(bundle).ok).toBe(true);
    database = await createDisposableParameterCatalogDatabase("conversionidentity");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    client = new pg.Client({ connectionString: database.url }); await client.connect();
    root = await mkdtemp(path.join(os.tmpdir(), "conversion-identity-"));
    for (const spec of graph.specs) await client.query("insert into public.parameter_specs (id, source_kind, specification_key, definition_lifecycle, property_key) values ($1,$2,$3,$4,$5)", [spec.id, spec.sourceKind, spec.specificationKey, spec.definitionLifecycle, spec.propertyKey]);
    for (const identity of graph.identities) await client.query("insert into parameter_catalog.legacy_identities (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values ($1,$2,$3,$4,$5,$6)", [identity.id, identity.sourceSystem, identity.sourceKind, identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId]);
    manifest = {
      version: "pcat-conversion-manifest-v1", sourceSnapshotFingerprint: fingerprintP0Graph(graph), sourceInventoryFingerprint: await captureConversionSourceInventory(client), targetCatalogReleaseDigest: bundle.releases[0].manifest.release.digest,
      // Independent explicit oracle deliberately reverses lexical source/target ordering.
      mappings: [
        { legacyIdentityId: "lid-left", targetKind: "parameter-definition", targetId: "pdef_explicit_second", targetSourceDigest: bundle.releases[0].manifest.files[0].digest },
        { legacyIdentityId: "lid-right", targetKind: "parameter-definition", targetId: "pdef_acme_power_iin_max", targetSourceDigest: bundle.releases[0].manifest.files[0].digest },
      ],
    };
  }, 120000);
  afterAll(async () => { await client?.end(); await pool?.end(); await database?.close(); if (root) await rm(root, { recursive: true, force: true }); }, 120000);
  it("maps two formal identities to their explicitly bound targets, never the first head", async () => {
    const planned = await planCutover({ graph, targetArtifactSha: "c".repeat(40), targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest, catalogReleaseSource: source, conversionManifest: manifest });
    expect(planned.ok).toBe(true); if (!planned.ok) return;
    const input = { pool, plan: planned.value, graph, catalogReleaseSource: source, conversionManifest: manifest, archiveObjectStore: createLocalArchiveObjectStore(root), archiveEncryptionKey: randomBytes(32), operatorAuditRef: "synthetic-conversion-operator" };
    expect(await executeCutover({ ...input, failBeforePhase: "P8" })).toMatchObject({ ok: false, error: { code: "PCAT-ORC-CRASH" } });
    const result = await executeCutover(input);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const rows = await client.query("select legacy_identity_id, target_id from parameter_catalog.legacy_mapping_versions where legacy_identity_id in ('lid-left','lid-right') order by legacy_identity_id");
    expect(rows.rows).toEqual([{ legacy_identity_id: "lid-left", target_id: "pdef_explicit_second" }, { legacy_identity_id: "lid-right", target_id: "pdef_acme_power_iin_max" }]);
    expect(await executeCutover(input)).toMatchObject({ ok: true, value: { resumed: true } });
    expect((await client.query("select id from parameter_catalog.legacy_mapping_versions where legacy_identity_id in ('lid-left','lid-right')")).rowCount).toBe(2);
  }, 60000);
  it("serializes different plans for one database before touching a journal", async () => {
    const planned = await planCutover({ graph, targetArtifactSha: "e".repeat(40), targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest, catalogReleaseSource: source, conversionManifest: manifest });
    expect(planned.ok).toBe(true); if (!planned.ok) return;
    await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'), hashtext(current_database()))");
    try {
      expect(await executeCutover({ pool, plan: planned.value, graph, catalogReleaseSource: source, conversionManifest: manifest, archiveObjectStore: createLocalArchiveObjectStore(root), archiveEncryptionKey: randomBytes(32), operatorAuditRef: "synthetic-conversion-operator" })).toEqual({ ok: false, error: { code: "PCAT-ORC-PHASE-FAILED", detail: "cutover-target-lock-held" } });
      expect((await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1", [planned.value.planDigest])).rows).toEqual([]);
    } finally { await client.query("select pg_advisory_unlock(hashtext('s7-orc-cutover-target'), hashtext(current_database()))"); }
  }, 60000);
  it("refuses omission, retargeting, repeated identities and unimplemented Binding history in planning", async () => {
    const input = { graph, targetArtifactSha: "f".repeat(40), targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest, catalogReleaseSource: source, conversionManifest: manifest };
    expect(await planCutover({ ...input, conversionManifest: undefined })).toMatchObject({ ok: false, error: { detail: "conversion-manifest-required" } });
    expect(await planCutover({ ...input, conversionManifest: { ...manifest, mappings: [manifest.mappings[0], manifest.mappings[0]] } })).toMatchObject({ ok: false, error: { detail: "conversion-mapping-conservation" } });
    expect(await planCutover({ ...input, conversionManifest: { ...manifest, mappings: [{ ...manifest.mappings[0], targetId: "pdef_not_in_bundle" }, manifest.mappings[1]] } })).toMatchObject({ ok: false, error: { detail: "conversion-target-authority-mismatch" } });
    expect(await planCutover({ ...input, graph: { ...graph, bindings: [{ id: "source-binding", organizationId: "org-one", parameterSpecId: "spec-left", moduleId: "module-one" }] } })).toMatchObject({ ok: false });
  });
  it("distinguishes SQL NULL from JSON null in the full source boundary", async () => {
    await client.query("create table public.synthetic_null_boundary (id text primary key, payload jsonb)");
    await client.query("insert into public.synthetic_null_boundary values ('one', null)");
    const absent = await captureConversionSourceInventory(client);
    await client.query("update public.synthetic_null_boundary set payload = 'null'::jsonb");
    expect(await captureConversionSourceInventory(client)).not.toBe(absent);
    await client.query("drop table public.synthetic_null_boundary");
    expect(await captureConversionSourceInventory(client)).toBe(manifest.sourceInventoryFingerprint);
  }, 60000);
  it("rejects a rehashed classifier graph that does not describe the actual source rows", async () => {
    const forged = { ...graph, specs: graph.specs.map((spec) => spec.id === "spec-left" ? { ...spec, specificationKey: "forged-before-plan" } : spec) };
    const forgedManifest = { ...manifest, sourceSnapshotFingerprint: fingerprintP0Graph(forged) };
    const planned = await planCutover({ graph: forged, targetArtifactSha: "a".repeat(40), targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest, catalogReleaseSource: source, conversionManifest: forgedManifest });
    expect(planned.ok).toBe(true); if (!planned.ok) return;
    expect(await executeCutover({ pool, plan: planned.value, graph: forged, catalogReleaseSource: source, conversionManifest: forgedManifest, archiveObjectStore: createLocalArchiveObjectStore(root), archiveEncryptionKey: randomBytes(32), operatorAuditRef: "synthetic-conversion-operator" })).toMatchObject({ ok: false, error: { detail: "conversion-source-graph-mismatch" } });
  }, 60000);
  it("refuses changed source bytes before creating a new run", async () => {
    const planned = await planCutover({ graph, targetArtifactSha: "d".repeat(40), targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest, catalogReleaseSource: source, conversionManifest: manifest });
    expect(planned.ok).toBe(true); if (!planned.ok) return;
    await client.query("update public.parameter_specs set specification_key = 'changed' where id = 'spec-left'");
    const result = await executeCutover({ pool, plan: planned.value, graph, catalogReleaseSource: source, conversionManifest: manifest, archiveObjectStore: createLocalArchiveObjectStore(root), archiveEncryptionKey: randomBytes(32), operatorAuditRef: "synthetic-conversion-operator" });
    expect(result).toEqual({ ok: false, error: { code: "PCAT-ORC-INVALID-PLAN", detail: "conversion-source-inventory-drift" } });
    const rows = await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1", [planned.value.planDigest]); expect(rows.rows).toEqual([]);
  }, 60000);
});
