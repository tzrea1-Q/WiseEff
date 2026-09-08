import { digestOf } from "../../release-verification/core/digest";
import { isDeepStrictEqual } from "node:util";
import { legacyMappingSourceKinds } from "../../parameter-catalog-contract/legacyIdentifiers";
import { lookupProtectedIdentity } from "./lookup";
import type { MappingHead, MappingQueryable, ProtectedIdentityKey } from "./types";

export type MappingInventoryHead = {
  legacy_identity_id: string; current_version_id: string; cas_version: string;
  version: unknown; identity: unknown;
};
type InventoryVersion = { id: string; version: unknown; identity: unknown };
export class MappingInventoryError extends Error {
  constructor() { super("PCAT-MAP-INVENTORY-INCOMPLETE"); }
}

export type MappingSourceIdentity = Omit<Extract<ProtectedIdentityKey, { kind: "source-tuple" }>, "kind"> & {
  readonly legacyIdentityId: string;
};
export type MappingSnapshotMember = {
  readonly sourceIdentity: MappingSourceIdentity;
  readonly head: MappingHead;
  readonly headDigest: string;
};

/** Exact public MappingHead under the existing canonical core codec. This
 * includes the mapping version, CAS version, run, source and evidence archive;
 * it is intentionally different from the historical raw complete-set codec. */
export const mappingHeadDigest = (head: MappingHead): string => digestOf(head);

/** Public management projection. The caller holds one database snapshot and
 * the existing writer fence across this read and all consumer queries. No
 * epoch is synthesized here: activation owns its persisted epoch association. */
export async function readMappingSnapshot(client: MappingQueryable) {
  const inventory = await readMappingInventory(client);
  const members: MappingSnapshotMember[] = [];
  for (const raw of inventory.heads) {
    const identity = raw.identity as Record<string, unknown>;
    const strings = [identity.id, identity.source_system, identity.source_kind,
      identity.owner_scope_kind, identity.owner_scope_id, identity.source_id];
    if (strings.some(value => typeof value !== "string" || !value) || identity.id !== raw.legacy_identity_id ||
      !(legacyMappingSourceKinds as readonly unknown[]).includes(identity.source_kind) ||
      !["platform", "organization", "project"].includes(String(identity.owner_scope_kind))) throw new MappingInventoryError();
    const sourceIdentity: MappingSourceIdentity = { legacyIdentityId: String(identity.id), sourceSystem: String(identity.source_system),
      sourceKind: identity.source_kind as MappingSourceIdentity["sourceKind"],
      ownerScopeKind: identity.owner_scope_kind as MappingSourceIdentity["ownerScopeKind"],
      ownerScopeId: String(identity.owner_scope_id), sourceId: String(identity.source_id) };
    const { legacyIdentityId, ...tuple } = sourceIdentity;
    const found = await lookupProtectedIdentity({ client, identity: { kind: "source-tuple", ...tuple } });
    if (!found.ok || found.value.outcome === "blocked") throw new MappingInventoryError();
    const head = structuredClone(found.value.head);
    if (head.legacyIdentityId !== legacyIdentityId || head.currentVersionId !== raw.current_version_id ||
      !Number.isSafeInteger(head.casVersion) || head.casVersion < 1 || String(head.casVersion) !== raw.cas_version ||
      !Number.isSafeInteger(head.version.versionNumber) || head.version.versionNumber < 1) throw new MappingInventoryError();
    const version = raw.version as Record<string, unknown>;
    if (!isDeepStrictEqual(head.version, {
      id: version.id, legacyIdentityId: version.legacy_identity_id, cutoverRunId: version.cutover_run_id,
      versionNumber: Number(version.version_number), sourceChecksum: version.source_checksum,
      graphFingerprint: version.graph_fingerprint, rClass: version.r_class, targetKind: version.target_kind,
      targetId: version.target_id, archiveId: version.archive_id, evidenceArchiveId: version.evidence_archive_id,
      supersedesVersionId: version.supersedes_version_id,
    })) throw new MappingInventoryError();
    members.push({ sourceIdentity, head, headDigest: mappingHeadDigest(head) });
  }
  // Re-observe the whole inventory, not just the selected heads. An unheld
  // snapshot may drift; this rejects observed drift rather than claiming ABA
  // protection without the caller's actual management boundary.
  if (!isDeepStrictEqual(inventory, await readMappingInventory(client))) throw new MappingInventoryError();
  return { headDigest: inventory.headDigest, versionInventoryDigest: inventory.versionInventoryDigest, members };
}

/** Read-only projection of the existing activation codec. The transaction
 * owner holds its management snapshot and write fence. These raw inventory
 * digests are not a per-head digest, an epoch, or an authorization receipt.
 * Retain the original SQL row shape/order: persisted activation epochs bind it.
 */
export async function readMappingInventory(client: MappingQueryable) {
  const heads = structuredClone((await client.query<MappingInventoryHead>(`select h.legacy_identity_id,h.current_version_id,h.cas_version::text,to_jsonb(v) as version,to_jsonb(i) as identity
    from parameter_catalog.legacy_mapping_heads h left join parameter_catalog.legacy_mapping_versions v
    on v.id=h.current_version_id and v.legacy_identity_id=h.legacy_identity_id
    left join parameter_catalog.legacy_identities i on i.id=h.legacy_identity_id order by h.legacy_identity_id collate "C"`)).rows);
  if (!heads.length || heads.some(row => !row.version || !row.identity) || new Set(heads.map(row => row.legacy_identity_id)).size !== heads.length) throw new MappingInventoryError();
  const versions = structuredClone((await client.query<InventoryVersion>(`select v.id,to_jsonb(v) as version,to_jsonb(i) as identity
    from parameter_catalog.legacy_mapping_versions v left join parameter_catalog.legacy_identities i on i.id=v.legacy_identity_id order by v.id collate "C"`)).rows);
  if (!versions.length || versions.some(row => !row.identity) || new Set(versions.map(row => row.id)).size !== versions.length) throw new MappingInventoryError();
  const identities = (await client.query<{ id: string }>("select id from parameter_catalog.legacy_identities order by id")).rows;
  if (identities.length !== heads.length || identities.some(identity => !heads.some(head => head.legacy_identity_id === identity.id))) throw new MappingInventoryError();
  return { heads, versions, headDigest: digestOf(heads), versionInventoryDigest: digestOf(versions) };
}
