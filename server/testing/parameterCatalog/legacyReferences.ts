import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

import { createArchiveAdapter, createLocalArchiveObjectStore } from "../../modules/catalog-cutover/archive";
import { classifyFrozenP0Graph } from "../../modules/catalog-cutover/classifier";
import { insertPlannedRun, loadRunById } from "../../modules/catalog-cutover/checkpoints";
import { fixtureCutoverIdentities } from "../../modules/catalog-cutover/identities";
import { appendMappingVersion, readCurrentMappingHead } from "../../modules/catalog-cutover/mapping";
import { planCutover } from "../../modules/catalog-cutover/orchestrator";
import { captureInventoryDump, countProducerResidue } from "../../modules/catalog-cutover/recovery";
import { populatedCutoverGraph, seedPopulatedCutover } from "./cutoverPopulatedFixture";

/** A real S7 historical reference, initially unmapped; all Archive/Mapping writes use their owners. */
export async function installLegacyReferenceFixture(pool: pg.Pool, storageRoot: string,
  release: { id: string; digest: string }) {
  const objectStore = createLocalArchiveObjectStore(storageRoot);
  const graph = populatedCutoverGraph();
  const identity = graph.identities[0]!;
  const classification = classifyFrozenP0Graph(graph);
  if (!classification.ok) throw new Error(JSON.stringify(classification.error));
  const plan = await planCutover({ graph, targetArtifactSha: "b".repeat(40),
    targetCatalogReleaseDigest: release.digest, identities: fixtureCutoverIdentities("kb903-history") });
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const client = await pool.connect();
  try { await seedPopulatedCutover(client, graph); }
  finally { client.release(); }
  const encryptionKey = randomBytes(32);
  let runId: string | undefined;
  let archiveId: string | undefined;
  return {
    specId: identity.sourceId,
    async archive(entryId: string) {
      const client = await pool.connect();
      try {
        const run = await insertPlannedRun(client, { runId: "kb903-history", plan: plan.value });
        const result = await createArchiveAdapter({ client, objectStore, encryptionKey }).persistArchive({
          actor: { role: "cutover-operator", auditRef: "audit-kb903-history" },
          legacyIdentityId: identity.id, ownerScopeKind: identity.ownerScopeKind,
          ownerScopeId: identity.ownerScopeId, rClass: "R1", reason: "historical compatibility fixture",
          sourceGraph: { sourcePayload: { ...graph.specs[0]! }, relationGraph: { entryId } },
          protectedReferences: [{ kind: "knowledge-entry", id: entryId }],
          cutoverRunId: run.id, catalogReleaseId: release.id,
          successAuditRef: "audit-kb903-history", retainUntil: new Date("2027-10-01T00:00:00Z")
        });
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        const mapped = await appendMappingVersion({ client, cutoverRunId: run.id,
          classification: classification.value, identityId: identity.id,
          sourceChecksum: result.value.sourceChecksum, expectedHead: null,
          outcome: { kind: "archived", archiveId: result.value.archiveId } });
        if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
        runId = run.id;
        archiveId = result.value.archiveId;
      } finally { client.release(); }
    },
    async snapshot() {
      if (!runId || !archiveId) throw new Error("Archive the fixture before capturing its state.");
      const client = await pool.connect();
      try {
        const archive = await createArchiveAdapter({ client, objectStore, encryptionKey }).restoreArchive({
          actor: { role: "cutover-operator", auditRef: "audit-kb903-history-read" }, archiveId
        });
        if (!archive.ok) throw new Error(JSON.stringify(archive.error));
        const objects = await Promise.all((await objectStore.listRefs()).sort().map(async (ref) => ({
          ref, sha256: createHash("sha256").update(await objectStore.get(ref)).digest("hex")
        })));
        return { run: await loadRunById(client, runId),
          inventory: await captureInventoryDump(client), residue: await countProducerResidue(client, runId),
          head: await readCurrentMappingHead({ client, identityId: identity.id }), archive: archive.value, objects };
      } finally { client.release(); }
    }
  };
}
