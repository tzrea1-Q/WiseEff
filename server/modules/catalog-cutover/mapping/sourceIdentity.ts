import { isDeepStrictEqual } from "node:util";
import type { LegacyMappingSourceKind } from "../../parameter-catalog-contract/index";
import { legacyMappingSourceKinds } from "../../parameter-catalog-contract/legacyIdentifiers";
import { digestOf } from "../../release-verification/core/digest";
import { readProtectedIdentityInventory, type MappingSourceIdentity } from "./snapshot";
import type { MappingQueryable } from "./types";

type SourceKey = { readonly sourceKind: LegacyMappingSourceKind; readonly sourceId: string };
type SourceOwner = Pick<MappingSourceIdentity, "ownerScopeKind" | "ownerScopeId">;
type SourceRegistryEntry = { sourceKind: LegacyMappingSourceKind; sourceRelation: string | null };
export class SourceIdentityRefusal extends Error {
  constructor(readonly reason: string) { super(`PCAT-MAP-SOURCE-${reason}`); }
}
const refuse = (reason: string): never => { throw new SourceIdentityRefusal(reason); };
const sourceTuple = (identity: Omit<MappingSourceIdentity, "legacyIdentityId">) =>
  [identity.sourceSystem, identity.sourceKind, identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId];
const tupleKey = (identity: Omit<MappingSourceIdentity, "legacyIdentityId">) => JSON.stringify(sourceTuple(identity));
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Read the installed, closed 0137 source registry; the source transaction
 * owner locks these physical relations before taking its inventory snapshot.
 * Missing relations are not silently interpreted as empty inventories.
 */
export async function readLegacySourceRegistry(client: MappingQueryable): Promise<readonly SourceRegistryEntry[]> {
  try {
    const rows = structuredClone((await client.query<SourceRegistryEntry>(`
      select source_kind as "sourceKind",source_relation as "sourceRelation"
      from parameter_catalog.legacy_identity_source_registry() order by source_kind collate "C"`)).rows);
    if (rows.length !== legacyMappingSourceKinds.length || new Set(rows.map(row => row.sourceKind)).size !== rows.length ||
      rows.some(row => !(legacyMappingSourceKinds as readonly string[]).includes(row.sourceKind) ||
        (row.sourceKind === "unresolved-protected-reference" ? row.sourceRelation !== null :
          typeof row.sourceRelation !== "string" || !/^public\.[a-z_][a-z0-9_]*$/.test(row.sourceRelation)))) refuse("REGISTRY-UNAVAILABLE");
    return rows;
  } catch (error) {
    if (error instanceof SourceIdentityRefusal) throw error;
    throw new SourceIdentityRefusal("REGISTRY-UNAVAILABLE");
  }
}

/** Complete physical source keys, including the existing composite audit key
 * codec. Embedded unresolved references are collected by their consumer owner;
 * a missing consumer association blocks P0 rather than inventing a source row.
 */
export async function capturePhysicalSourceIdentities(input: {
  client: MappingQueryable; sourceSystem: string;
}): Promise<readonly MappingSourceIdentity[]> {
  try {
    const registry = await readLegacySourceRegistry(input.client), sources: SourceKey[] = [];
    for (const entry of registry) {
      if (entry.sourceKind === "unresolved-protected-reference") continue;
      const key = entry.sourceKind === "audit-subject-link" ?
        "parameter_catalog.serialize_legacy_source_key(array['auditEventId','semanticId','subjectKind'],array[audit_event_id,semantic_id,subject_kind])" : "id";
      // The relation is a grammar-checked identifier from the installed owner
      // registry, never a path or SQL fragment supplied by a comparison case.
      const rows = (await input.client.query<{ sourceId: string }>(`select ${key} as "sourceId" from ${entry.sourceRelation} order by ${key} collate "C"`)).rows;
      for (const row of rows) sources.push({ sourceKind: entry.sourceKind, sourceId: row.sourceId });
    }
    const identities = await capturePlannedSourceIdentities({ ...input, sources });
    if (!isDeepStrictEqual(registry, await readLegacySourceRegistry(input.client))) refuse("REGISTRY-DRIFT");
    return identities;
  } catch (error) {
    if (error instanceof SourceIdentityRefusal) throw error;
    throw new SourceIdentityRefusal("SOURCE-SCHEMA-UNAVAILABLE");
  }
}

/** The P0 owner supplies its complete observed source keys. This helper proves
 * each key's real source ownership, not inventory completeness or a write
 * boundary. The caller retains its original source transaction and custody.
 * The existing 0137 owner function must already be installed by the separately
 * verified management preparation; this function never installs or grants it.
 */
export async function capturePlannedSourceIdentities(input: {
  client: MappingQueryable; sourceSystem: string; sources: readonly SourceKey[];
}): Promise<readonly MappingSourceIdentity[]> {
  try {
  const sourceSystem = input.sourceSystem, sources = structuredClone(input.sources);
  if (typeof sourceSystem !== "string" || !sourceSystem || sourceSystem.replace(/^ +| +$/g, "") !== sourceSystem) refuse("NAMESPACE-UNDECLARED");
  const keys = new Set<string>();
  for (const source of sources) {
    const key = JSON.stringify([source.sourceKind, source.sourceId]);
    if (!(legacyMappingSourceKinds as readonly string[]).includes(source.sourceKind) ||
      typeof source.sourceId !== "string" || !source.sourceId || source.sourceId.replace(/^ +| +$/g, "") !== source.sourceId || keys.has(key)) refuse("KEYS-INVALID");
    keys.add(key);
  }
  const existing = await readProtectedIdentityInventory(input.client);
  // One declared source deployment per capture. An existing namespace must be
  // adopted explicitly, never silently renamed or ignored as another source.
  if (existing.some(identity => identity.sourceSystem !== sourceSystem)) refuse("NAMESPACE-CONFLICT");
  const selected: MappingSourceIdentity[] = [];
  for (const source of sources) {
    const owners = structuredClone((await input.client.query<SourceOwner>(`
      select owner_scope_kind as "ownerScopeKind",owner_scope_id as "ownerScopeId"
      from parameter_catalog.resolve_legacy_identity_owner($1,$2)`, [source.sourceKind, source.sourceId])).rows);
    if (owners.length !== 1 || !["platform", "organization", "project"].includes(owners[0]!.ownerScopeKind) ||
      typeof owners[0]!.ownerScopeId !== "string" || !owners[0]!.ownerScopeId ||
      owners[0]!.ownerScopeKind === "platform" && owners[0]!.ownerScopeId !== "platform") refuse("OWNER-UNAVAILABLE");
    const tuple = { sourceSystem, ...source, ...owners[0]! };
    const prior = existing.filter(identity => tupleKey(identity) === tupleKey(tuple));
    if (prior.length > 1) refuse("IDENTITY-CONFLICT");
    // Only a legacy registry ID is derived. Catalog Subject, Definition and
    // Revision IDs retain their independent, explicit release manifest rules.
    const legacyIdentityId = prior[0]?.legacyIdentityId ?? `legacy_${digestOf({ version: "pcat-source-identity/v1", tuple: sourceTuple(tuple) }).slice("sha256:".length)}`;
    if (existing.some(identity => identity.legacyIdentityId === legacyIdentityId && tupleKey(identity) !== tupleKey(tuple))) refuse("IDENTITY-CONFLICT");
    selected.push({ legacyIdentityId, ...tuple });
  }
  if (existing.some(identity => !selected.some(item => isDeepStrictEqual(item, identity)))) refuse("INVENTORY-INCOMPLETE");
  if (!isDeepStrictEqual(existing, await readProtectedIdentityInventory(input.client))) refuse("REGISTRY-DRIFT");
  if (new Set(selected.map(identity => identity.legacyIdentityId)).size !== selected.length) refuse("IDENTITY-CONFLICT");
  return selected.sort((left, right) => order(left.legacyIdentityId, right.legacyIdentityId));
  } catch (error) {
    if (error instanceof SourceIdentityRefusal) throw error;
    throw new SourceIdentityRefusal("OBSERVATION-UNAVAILABLE");
  }
}

/** Called only inside the existing P0 transaction, after the root's durable
 * original attempt intent. The same transaction owns its P0 checkpoint and
 * commit. This helper never starts/commits/retries a transaction or issues a
 * checkpoint, a mapping head, a release approval, or a source namespace.
 */
export async function registerPlannedSourceIdentities(input: {
  client: MappingQueryable; identities: readonly MappingSourceIdentity[]; sourceSystem: string;
  /** The original transaction owner revalidates its issued source boundary
   * after all ownership reads, immediately before the single registry write. */
  beforeEffect(): Promise<void>;
}): Promise<void> {
  try {
  const identities = structuredClone(input.identities), sourceSystem = input.sourceSystem;
  const observed = await capturePlannedSourceIdentities({ client: input.client, sourceSystem,
    sources: identities.map(identity => ({ sourceKind: identity.sourceKind, sourceId: identity.sourceId })) });
  if (!isDeepStrictEqual([...identities].sort((left, right) => order(left.legacyIdentityId, right.legacyIdentityId)), observed)) refuse("PLAN-DRIFT");
  const values = [JSON.stringify(observed)];
  await input.beforeEffect();
  // One statement consumes the fixed set. A conflict is not success: full
  // readback below must match, with all real 0137 constraints still active.
  await input.client.query(`insert into parameter_catalog.legacy_identities
    (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
    select "legacyIdentityId","sourceSystem","sourceKind","ownerScopeKind","ownerScopeId","sourceId"
    from jsonb_to_recordset($1::jsonb) as planned("legacyIdentityId" text,"sourceSystem" text,"sourceKind" text,
      "ownerScopeKind" text,"ownerScopeId" text,"sourceId" text) on conflict do nothing`, values);
  if (!isDeepStrictEqual(observed, await readProtectedIdentityInventory(input.client))) refuse("REGISTRATION-CONFLICT");
  } catch (error) {
    if (error instanceof SourceIdentityRefusal) throw error;
    throw new SourceIdentityRefusal("REGISTRATION-UNAVAILABLE");
  }
}
