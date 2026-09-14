import type { Queryable } from "../../../shared/database/client";
import { readPublicationFreeze } from "../runtime/freeze";
import { getPolicy } from "../persistence/store";
import { isEphemeralTestDatabaseName } from "./policyNames";
import type { PublicationPolicyInstanceSnapshot } from "./types";

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function collectPublicationPolicyInstanceSnapshot(
  db: Queryable,
): Promise<PublicationPolicyInstanceSnapshot> {
  const identity = await db.query<{ database_oid: string; database_name: string }>(
    `select d.oid::text as database_oid, current_database() as database_name
       from pg_catalog.pg_database d
      where d.datname = current_database()`,
  );
  const databaseOid = asText(identity.rows[0]?.database_oid) ?? "";
  const databaseName = asText(identity.rows[0]?.database_name) ?? "";

  const current = await db.query<{
    current_catalog_release_id: string;
    release_digest: string;
  }>(
    `select
       state.current_catalog_release_id,
       release.release_digest
     from parameter_catalog.catalog_state state
     join parameter_catalog.catalog_releases release
       on release.id = state.current_catalog_release_id`,
  );
  const currentReleaseId = asText(current.rows[0]?.current_catalog_release_id);
  const currentReleaseDigest = asText(current.rows[0]?.release_digest);

  const artifact =
    currentReleaseId && currentReleaseDigest
      ? await db.query<{ artifact_digest: string; source_kind: string }>(
          `select artifact_digest, source_kind
             from catalog_publication.release_artifacts
            where target_release_id = $1
              and target_release_digest = $2
            order by id
            limit 1`,
          [currentReleaseId, currentReleaseDigest],
        )
      : { rows: [] as { artifact_digest: string; source_kind: string }[] };
  const artifactDigest = asText(artifact.rows[0]?.artifact_digest);
  const artifactSourceKind = asText(artifact.rows[0]?.source_kind);

  const receipts =
    currentReleaseId && currentReleaseDigest
      ? await db.query<{ kind: string }>(
          `select kind
             from parameter_catalog.catalog_activation_receipts
            where release_id = $1
              and release_digest = $2
            order by created_at`,
          [currentReleaseId, currentReleaseDigest],
        )
      : { rows: [] as { kind: string }[] };
  const receiptKinds = receipts.rows
    .map((row) => asText(row.kind))
    .filter((kind): kind is string => kind !== null);

  const policy = await getPolicy(db);
  const freeze = await readPublicationFreeze(db);

  const adopted =
    currentReleaseId !== null &&
    currentReleaseDigest !== null &&
    artifactDigest !== null &&
    receiptKinds.length > 0;

  return {
    databaseOid,
    databaseName,
    ephemeralName: isEphemeralTestDatabaseName(databaseName),
    currentReleaseId,
    currentReleaseDigest,
    artifactDigest,
    artifactSourceKind,
    adopted,
    receiptKinds,
    policyRevision: policy.ok ? policy.value.revision : 0,
    publicationEnabled: policy.ok ? policy.value.publicationEnabled : false,
    lowRiskSingleActorPublish: policy.ok ? policy.value.lowRiskSingleActorPublish : false,
    frozen: freeze?.frozen === true,
    capabilityContractRevision: policy.ok ? policy.value.capabilityContractRevision : null,
  };
}
