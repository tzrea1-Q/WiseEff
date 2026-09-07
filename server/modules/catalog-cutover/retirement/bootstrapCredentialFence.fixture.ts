/** Test preparation only. Existing shared fixture writes and S7 P0–P10 precede a
 * storage-only activation. The references below are explicitly unapproved;
 * this fixture cannot authorize public P12, root retirement or startup. Its
 * older no-Binding P2 path is not a real application quiescence proof. */
import { randomBytes } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import { seedSpecBindingGraph } from "../../../testing/fixtures";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { createLocalArchiveObjectStore } from "../archive";
import { classifyFrozenP0Graph, type FrozenP0Graph } from "../classifier";
import { captureArchivedDefinitionGraph } from "../conversionManifest";
import { executeCutover, planCutover } from "../orchestrator";
import { createActivationIntent, type ActivationIdentity } from "../activation/index";
import { readFacts, persistMappingEpoch, persistActivation } from "../activation/postgres";
import { decodeBinding } from "../activation/records";
import { digestOf } from "../../release-verification/core/digest";
import { beginLegacyRetirementTransaction } from "./managementTransaction";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function prepareUnapprovedBootstrapTransportBinding(input: {
  pool: pg.Pool; target: ActivationIdentity; directory: string;
}) {
  const nonce = randomBytes(8).toString("hex"), sourceId = `transport-spec-${nonce}`, versionId = `transport-version-${nonce}`;
  const organizationId = null;
  const source = await input.pool.connect();
  try {
    await source.query("begin");
    // The existing shared fixture supports a legacy definition without a DTS
    // property surface. Do not pass structural keys through the modern DTS
    // repository, whose historical 0081 constraint correctly rejects them.
    await seedSpecBindingGraph(source, { organizationId, specs: [{
      id: sourceId, specificationKey: "synthetic-transport/residual", sourceKind: "dts",
      versions: [{ id: versionId, displayName: "Synthetic residual", lifecycle: "draft" }],
    }] });
    const captured = await captureArchivedDefinitionGraph(source, sourceId);
    const expectedSource = { id: sourceId, organization_id: organizationId, source_kind: "dts",
      specification_key: "synthetic-transport/residual", attribution_subject_id: null,
      definition_lifecycle: "draft", property_key: null };
    const row = record(captured?.sourcePayload);
    const relation = record(captured?.relationGraph);
    if (!row ||
        Object.entries(expectedSource).some(([key, value]) => row[key] !== value) ||
        !relation || !Array.isArray(relation.revisions) ||
        relation.revisions.length !== 1) throw new Error("bootstrap-transport-source-identity-mismatch");
    const revision = record(relation.revisions[0]);
    if (!revision || revision.id !== versionId ||
        revision.parameter_spec_id !== sourceId || revision.version !== 1 || revision.lifecycle !== "draft" ||
        revision.version_status !== "draft") throw new Error("bootstrap-transport-source-version-mismatch");
    await source.query("commit");
  } finally { try { await source.query("rollback"); } finally { source.release(true); } }
  const graph: FrozenP0Graph = {
    catalog: "parameter-catalog-p0-graph",
    identities: [{ id: `identity-${nonce}`, sourceSystem: "synthetic-transport", sourceKind: "parameter-spec",
      ownerScopeKind: "platform", ownerScopeId: "platform", sourceId }],
    specs: [{ id: sourceId, organizationId, sourceKind: "dts",
      specificationKey: "synthetic-transport/residual", attributionSubjectId: null,
      definitionLifecycle: "draft", propertyKey: null }],
    specVersions: [{ id: versionId, parameterSpecId: sourceId, version: 1, lifecycle: "draft", versionStatus: "draft" }],
    dtsPropertySpecs: [],
    subjects: [], driverRegistrations: [], nodeTypeDefinitions: [], driverSchemas: [], driverSchemaVersions: [],
    modules: [], placements: [], bindings: [], bindingRevisions: [],
  };
  const classified = classifyFrozenP0Graph(graph);
  if (!classified.ok || classified.value.assignments.length !== 1 ||
      classified.value.assignments[0].rClass !== "R10" || classified.value.assignments[0].disposition !== "archived")
    throw new Error("bootstrap-transport-residual-classification-mismatch");
  const identity = graph.identities[0];
  await input.pool.query(`insert into parameter_catalog.legacy_identities
    (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,$2,$3,$4,$5,$6)`,
  [identity.id, identity.sourceSystem, identity.sourceKind, identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId]);
  const full = validCatalogReleaseBundle();
  const bundle = { ...full, targetReleaseId: full.releases[0].manifest.release.id, releases: [full.releases[0]] };
  const catalogReleaseSource = jsonCatalogReleaseSource(bundle);
  const planned = await planCutover({ graph, targetArtifactSha: "e".repeat(40),
    targetCatalogReleaseDigest: bundle.releases[0].manifest.release.digest, catalogReleaseSource });
  if (!planned.ok) throw new Error(`bootstrap-transport-plan-${planned.error.code}`);
  const executed = await executeCutover({ pool: input.pool, graph, plan: planned.value, catalogReleaseSource,
    archiveObjectStore: createLocalArchiveObjectStore(path.join(input.directory, "transport-archive")),
    archiveEncryptionKey: randomBytes(32), operatorAuditRef: "unapproved-storage-transport-component" });
  if (!executed.ok) {
    const progress = (await input.pool.query<{ current_phase: string; state: string }>(
      "select current_phase,state from parameter_catalog.parameter_catalog_cutover_runs where plan_digest=$1", [planned.value.planDigest])).rows;
    const phase = progress.length === 1 && /^P(?:[0-9]|1[0-6])$/.test(progress[0].current_phase) ? progress[0].current_phase : "unavailable";
    const known = ["invalid-release", "storage-failure", "drift", "digest-conflict", "unsupported-lineage",
      "historical-release-unavailable", "switch-back-forbidden", "binding-phase-query-failure"];
    const reason = known.includes(executed.error.detail) ? executed.error.detail :
      executed.error.detail === "refusing to persist plaintext archive bytes" ? "archive-plaintext-leak" : "unclassified-domain-refusal";
    throw new Error(`bootstrap-transport-cutover-${executed.error.code}:last-committed-${phase}:${reason}`);
  }
  if (executed.value.checkpoints.map(row => row.phase).join(",") !== "P0,P1,P2,P3,P4,P5,P6,P7,P8,P9,P10")
    throw new Error("bootstrap-transport-predecessor-incomplete");
  const client = await input.pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    await beginLegacyRetirementTransaction(client);
    let facts = await readFacts(client, input.target, executed.value.runId, planned.value.planDigest);
    await persistMappingEpoch(client, facts);
    facts = await readFacts(client, input.target, executed.value.runId, planned.value.planDigest);
    const intent = createActivationIntent({ runId: executed.value.runId, attemptId: `storage-only-${nonce}`,
      target: input.target, planDigest: planned.value.planDigest, predecessorBindingDigest: null,
      reportDigest: digestOf("unapproved-storage-reference"), expectedObservationDigest: digestOf("no-release-observation") });
    const body = { version: "pcat-activation-v1" as const, intent, mode: "canonical" as const,
      sourceSnapshotFingerprint: facts.run.source_snapshot_fingerprint, catalog: facts.catalog,
      mapping: { epoch: facts.mappingEpoch!, headDigest: facts.headDigest }, comparisonReportDigest: digestOf("unapproved-storage-comparison") };
    const binding = decodeBinding({ ...body, bindingDigest: digestOf(body) });
    await persistActivation(client, facts, binding);
    await client.query("commit");
    return binding;
  } finally { try { await client.query("rollback"); } finally { client.release(true); } }
}
