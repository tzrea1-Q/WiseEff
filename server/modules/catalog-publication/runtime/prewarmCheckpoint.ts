import type pg from "pg";
import { timeCatalogStage } from "../../../observability/catalogPublicationStages";
import { buildCatalogInstallProof, compileCatalogRelease, isCatalogInstallProof } from "../../catalog-kernel/compiler/index";
import { acquireCurrentPointerLockExclusive } from "../../catalog-kernel/install/lockProtocol";
import { asQueryable, setSynchronizerRole } from "../../catalog-kernel/install/publicationActivation";
import { targetReleaseOf } from "../builder/bundleCodec";
import { ACTIVATION_CHECKPOINT_VERSION, admitCompiledReleaseSchemas } from "../builder/capabilities";
import { identitySnapshotOf } from "../builder/identitySnapshot";
import { putActivationCheckpoint, readActivationCheckpoint, readCheckpointEpoch } from "../persistence/activationCheckpoint";
import { decodeStoredArtifact, getValidatedPreviewSnapshot, putValidatedPreviewSnapshot, readArtifactLineage } from "../persistence/store";

// Coalesce expensive prewarms across manager processes. Publication takes the
// pointer lock only during the final compare-and-insert transaction.
const lockKey = "hashtextextended('wiseeff.catalog-publication.prewarm/v1', 0)";

async function loadCurrent(client: pg.PoolClient) {
  const db = asQueryable(client);
  const epoch = await readCheckpointEpoch(db);
  if (!epoch) throw new Error("checkpoint-migration-required");
  const current = (await db.query<{ digest: string }>(
    `select r.release_digest as digest from parameter_catalog.catalog_state s
       join parameter_catalog.catalog_releases r on r.id = s.current_catalog_release_id where s.singleton`,
  )).rows[0];
  if (!current) return { status: "no-current-release" } as const;
  const { digest } = current;
  const preview = await getValidatedPreviewSnapshot(db, digest);
  if (!preview.ok && preview.error.kind !== "not-found") throw new Error("invalid-preview-checkpoint");
  const checkpoint = await readActivationCheckpoint(db, digest, ACTIVATION_CHECKPOINT_VERSION);
  if (checkpoint) {
    const { proof } = checkpoint;
    if (!isCatalogInstallProof(proof) || proof.releaseId !== checkpoint.target.manifest.release.id ||
        proof.releaseDigest !== digest || proof.compiledReleaseDigest !== checkpoint.compiledReleaseDigest ||
        proof.toolchainDigest !== checkpoint.toolchainDigest || proof.materializationFingerprint !== checkpoint.materializationFingerprint) {
      throw new Error("invalid-activation-checkpoint");
    }
    if (preview.ok) return { status: "already-warm" } as const;
  }
  const lineage = await readArtifactLineage(db, digest);
  if (!lineage.ok) throw new Error("prewarm-current-artifact-unreadable");
  return { status: "loaded", epoch, lineage: lineage.value } as const;
}

async function prepareCurrent(input: Extract<Awaited<ReturnType<typeof loadCurrent>>, { status: "loaded" }>) {
  const decoded = await timeCatalogStage("lineage-verify-decode", () => decodeStoredArtifact(input.lineage));
  if (!decoded.ok) throw new Error("prewarm-artifact-integrity-failed");
  const bundle = decoded.value;
  const result = await timeCatalogStage("compile", () => compileCatalogRelease(bundle));
  const target = targetReleaseOf(bundle);
  const artifact = input.lineage.target;
  if (!result.ok || !target || result.value.aggregateDigest !== artifact.artifactDigest ||
      result.value.release.id !== artifact.targetReleaseId || result.value.release.digest !== artifact.targetReleaseDigest) {
    throw new Error("prewarm-compiler-pins-mismatch");
  }
  const compiled = result.value;
  if (!admitCompiledReleaseSchemas(compiled).ok) throw new Error("prewarm-unsupported-capability");
  return {
    checkpoint: {
      epoch: input.epoch, target, version: ACTIVATION_CHECKPOINT_VERSION, proof: buildCatalogInstallProof(compiled),
      artifactChecksum: artifact.bytesChecksum, compiledReleaseDigest: compiled.compiledReleaseDigest,
      toolchainDigest: compiled.toolchainDigest, materializationFingerprint: compiled.materializationFingerprint,
    },
    preview: identitySnapshotOf(bundle, target), storageFormat: artifact.storageFormat,
  };
}

export async function prewarmCatalogCheckpoint(pool: pg.Pool) {
  const client = await pool.connect();
  let discard = false;
  let locked = false;
  try {
    locked = (await client.query<{ acquired: boolean }>(`select pg_try_advisory_lock(${lockKey}) as acquired`)).rows[0]?.acquired === true;
    if (!locked) return { status: "prewarm-in-progress" } as const;
    await client.query("begin isolation level repeatable read read only");
    await setSynchronizerRole(client);
    const current = await loadCurrent(client);
    await client.query("commit");
    if (current.status !== "loaded") return current;
    const { checkpoint, preview, storageFormat } = await prepareCurrent(current);
    await client.query("begin");
    await setSynchronizerRole(client);
    await acquireCurrentPointerLockExclusive(client);
    const db = asQueryable(client);
    if (!await putActivationCheckpoint(db, checkpoint)) {
      await client.query("rollback");
      return { status: "current-pins-changed" } as const;
    }
    const saved = await putValidatedPreviewSnapshot(db, checkpoint.target.manifest.release.digest, preview, storageFormat);
    if (!saved.ok || !(await getValidatedPreviewSnapshot(db, checkpoint.target.manifest.release.digest)).ok) {
      throw new Error("prewarm-preview-write-failed");
    }
    await client.query("commit");
    return { status: "warmed" } as const;
  } catch (error) {
    await client.query("rollback").catch(() => { discard = true; });
    throw error;
  } finally {
    if (locked && !discard) await client.query(`select pg_advisory_unlock(${lockKey})`).catch(() => { discard = true; });
    client.release(discard);
  }
}
