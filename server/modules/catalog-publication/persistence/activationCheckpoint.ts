import { timeCatalogStage } from "../../../observability/catalogPublicationStages";
import type { Queryable } from "../../../shared/database/client";
import type { CatalogReleaseNode } from "../../catalog-kernel/compiler/types";
import { encodeBundleBytes, parseBundleBytes } from "../builder/bundleCodec";
import { artifactByteChunkJoin, artifactByteColumns, assembleArtifactBytes, type ArtifactByteChunkRow } from "./artifactByteTransport";
import { sha256DigestOfBytes } from "./store";

export type ActivationCheckpoint = {
  epoch: string;
  target: CatalogReleaseNode;
  proof: unknown;
  compiledReleaseDigest: string;
  toolchainDigest: string;
  materializationFingerprint: string;
};

export class CorruptActivationCheckpoint extends Error {
  constructor() { super("catalog-activation-checkpoint-corrupt"); }
}

export async function readCheckpointEpoch(db: Queryable): Promise<string | null> {
  const schema = await db.query<{ available: boolean }>(
    "select to_regclass('catalog_publication.checkpoint_epoch') is not null as available",
  );
  if (!schema.rows[0]?.available) return null;
  const result = await db.query<{ epoch: string }>(
    "select generation::text as epoch from catalog_publication.checkpoint_epoch where singleton",
  );
  if (!result.rows[0]) throw new CorruptActivationCheckpoint();
  return result.rows[0].epoch;
}

/** Take after the publication/pointer locks, in the committing write transaction. */
export async function lockCheckpointEpoch(db: Queryable, epoch: string): Promise<boolean> {
  const result = await db.query<{ matches: boolean }>(
    "select catalog_publication.lock_checkpoint_epoch()::text = $1 as matches", [epoch],
  );
  return result.rows[0]?.matches === true;
}

/** Read the small proof independently; preview already holds a checksum-verified target. */
export async function readActivationCheckpointProof(db: Queryable, digest: string, version: string, knownEpoch?: string) {
  const epoch = knownEpoch ?? await readCheckpointEpoch(db);
  if (!epoch) return null;
  const pins = await db.query<{
    artifact_id: string; release_id: string; pins_match: boolean; target_checksum: string;
    proof_bytes: Buffer; proof_checksum: string; compiled_model_digest: string;
    toolchain_digest: string; materialization_fingerprint: string;
  }>(`select a.id as artifact_id, r.id as release_id, c.target_checksum, c.proof_bytes, c.proof_checksum,
             c.compiled_model_digest, c.toolchain_digest, c.materialization_fingerprint,
             (c.generation::text = $3 and a.bytes_checksum = c.artifact_checksum
              and a.target_release_id = r.id and a.target_release_digest = r.release_digest
              and r.compiled_model_digest = c.compiled_model_digest and r.toolchain_digest = c.toolchain_digest
              and m.compiled_fingerprint = c.materialization_fingerprint and m.database_fingerprint = c.materialization_fingerprint
              and ((a.storage_format = 'full' and c.target_bytes is not null)
                or (a.storage_format = 'successor-v1' and c.target_bytes is null and c.target_checksum = a.bytes_checksum))) as pins_match
        from parameter_catalog.catalog_state s
        join parameter_catalog.catalog_releases r on r.id = s.current_catalog_release_id
        join catalog_publication.release_artifacts a on a.artifact_digest = r.release_digest
        join catalog_publication.activation_checkpoints c on c.artifact_id = a.id and c.artifact_digest = a.artifact_digest
        left join parameter_catalog.catalog_materializations m on m.release_id = r.id
       where s.singleton and r.release_digest = $1 and c.version = $2
         and exists (select from catalog_publication.checkpoint_epoch where singleton and generation::text = $3)`, [digest, version, epoch]);
  const pin = pins.rows[0];
  if (!pin) return null;
  if (!pin.pins_match || sha256DigestOfBytes(pin.proof_bytes) !== pin.proof_checksum) throw new CorruptActivationCheckpoint();
  let proof: unknown;
  try {
    proof = JSON.parse(pin.proof_bytes.toString("utf8"));
  } catch {
    throw new CorruptActivationCheckpoint();
  }
  return { epoch, pin, proof };
}

/** Use the same repeatable-read transaction that pins the candidate artifact. */
export async function readActivationCheckpoint(db: Queryable, digest: string, version: string, knownEpoch?: string): Promise<ActivationCheckpoint | null> {
  const checked = await readActivationCheckpointProof(db, digest, version, knownEpoch);
  if (!checked) return null;
  const { epoch, pin, proof } = checked;
  const targetRows = await timeCatalogStage("activation-checkpoint-read", () => db.query<ArtifactByteChunkRow>(
    `select ${artifactByteColumns} from (
       select coalesce(c.target_bytes, a.artifact_bytes) as artifact_bytes
       from catalog_publication.activation_checkpoints c join catalog_publication.release_artifacts a on a.id = c.artifact_id
       where c.artifact_id = $1 and c.version = $2
     ) artifact ${artifactByteChunkJoin} order by chunk.byte_start`, [pin.artifact_id, version],
  ), result => ({ artifactCount: result.rows.length ? 1 : 0, byteCount: result.rows[0]?.artifact_byte_length ?? 0 }));
  let target: CatalogReleaseNode;
  try {
    const bytes = assembleArtifactBytes(targetRows.rows);
    if (sha256DigestOfBytes(bytes) !== pin.target_checksum) throw new CorruptActivationCheckpoint();
    const parsed = parseBundleBytes(bytes);
    if (!parsed.ok || parsed.bundle.targetReleaseId !== pin.release_id || parsed.bundle.releases.length !== 1) {
      throw new CorruptActivationCheckpoint();
    }
    target = parsed.bundle.releases[0]!;
    if (target.manifest.release.id !== pin.release_id || target.manifest.release.digest !== digest) throw new CorruptActivationCheckpoint();
  } catch {
    throw new CorruptActivationCheckpoint();
  }
  return { epoch, target, proof, compiledReleaseDigest: pin.compiled_model_digest,
    toolchainDigest: pin.toolchain_digest, materializationFingerprint: pin.materialization_fingerprint };
}

/** Called with the current-pointer lock and a fully verified materialization. */
export async function putActivationCheckpoint(db: Queryable, checkpoint: ActivationCheckpoint & {
  version: string; artifactChecksum: string;
}): Promise<boolean> {
  if (!await lockCheckpointEpoch(db, checkpoint.epoch)) return false;
  const release = checkpoint.target.manifest.release;
  const pins = await db.query<{ id: string; storage_format: "full" | "successor-v1" }>(
    `select a.id, a.storage_format from parameter_catalog.catalog_state s
       join parameter_catalog.catalog_releases r on r.id = s.current_catalog_release_id
       join parameter_catalog.catalog_materializations m on m.release_id = r.id
       join catalog_publication.release_artifacts a on a.artifact_digest = r.release_digest
      where s.singleton and r.id = $1 and r.release_digest = $2 and a.bytes_checksum = $3
        and a.target_release_id = r.id and a.target_release_digest = r.release_digest
        and r.compiled_model_digest = $4 and r.toolchain_digest = $5
        and m.compiled_fingerprint = $6 and m.database_fingerprint = $6`,
    [release.id, release.digest, checkpoint.artifactChecksum, checkpoint.compiledReleaseDigest,
      checkpoint.toolchainDigest, checkpoint.materializationFingerprint],
  );
  const pin = pins.rows[0];
  if (!pin) return false;
  const targetBytes = pin.storage_format === "full" ? encodeBundleBytes({
    schemaVersion: "1.0.0", targetReleaseId: release.id, releases: [checkpoint.target],
  }) : null;
  const proof = Buffer.from(JSON.stringify(checkpoint.proof));
  const proofChecksum = sha256DigestOfBytes(proof);
  const targetChecksum = targetBytes ? sha256DigestOfBytes(targetBytes) : checkpoint.artifactChecksum;
  const inserted = await db.query(
    `insert into catalog_publication.activation_checkpoints (
       artifact_id, artifact_digest, version, generation, artifact_checksum, compiled_model_digest,
       toolchain_digest, materialization_fingerprint, proof_bytes, proof_checksum, target_bytes, target_checksum)
     values ($1, $2, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (artifact_id, version) do nothing returning artifact_id`,
    [pin.id, release.digest, checkpoint.version, checkpoint.epoch, checkpoint.artifactChecksum, checkpoint.compiledReleaseDigest,
      checkpoint.toolchainDigest, checkpoint.materializationFingerprint, proof, proofChecksum,
      targetBytes, targetChecksum],
  );
  if (inserted.rows.length === 0) {
    const existing = await db.query(
      `select 1 from catalog_publication.activation_checkpoints where artifact_id = $1 and version = $2
        and artifact_digest = $3 and generation = $4::bigint and artifact_checksum = $5
        and compiled_model_digest = $6 and toolchain_digest = $7 and materialization_fingerprint = $8
        and proof_bytes = $9 and proof_checksum = $10 and target_bytes is not distinct from $11::bytea and target_checksum = $12`,
      [pin.id, checkpoint.version, release.digest, checkpoint.epoch, checkpoint.artifactChecksum, checkpoint.compiledReleaseDigest,
        checkpoint.toolchainDigest, checkpoint.materializationFingerprint, proof, proofChecksum, targetBytes, targetChecksum],
    );
    if (existing.rows.length === 0) throw new CorruptActivationCheckpoint();
  }
  return true;
}

/** Called under the pointer lock. Installed release, revision and subject identifiers are permanent. */
export async function hasAvailableAppendIdentities(db: Queryable, target: CatalogReleaseNode, revisionIds: readonly string[],
  driverIds: readonly string[] = []): Promise<boolean> {
  const release = target.manifest.release;
  const result = await db.query<{ available: boolean }>(
    `select not exists (select from parameter_catalog.catalog_releases where id = $1 or release_version = $2 or release_digest = $3)
       and not exists (select from parameter_catalog.definition_revisions where id = any($4::text[]))
       and not exists (select from parameter_catalog.catalog_subjects where id = any($5::text[])) as available`,
    [release.id, release.version, release.digest, revisionIds, driverIds],
  );
  return result.rows[0]?.available === true;
}
