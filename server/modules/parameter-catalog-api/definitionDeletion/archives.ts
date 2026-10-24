import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ApiError } from "../../../shared/http/errors";
import type { ObjectStore } from "../../logs/objectStore";
import { archiveGraphChecksum, buildArchiveAad, checksumContract, decryptArchiveObject,
  type ArchiveObjectStore, type ArchiveProtectedReference } from "../../catalog-cutover/archive";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import type { Database, Queryable } from "../../../shared/database/client";
import { parameterObjectWriteCustody } from "../../parameter-files/objectWriteCustody";
import {
  ARCHIVED_PARAMETER_PLANE_RELATIONS, ARCHIVE_DOCUMENT_BYTES_CAP, archiveDigestOf,
  type ArchivedPlaneDocument,
} from "../../parameter-bindings/seedInitialization/archive";

export type DefinitionDeletionInventory = {
  definition: { id: string; propertyKey: string; subjectName: string };
  catalogRelease: { id: string; digest: string };
  fingerprint: string;
  counts: Record<string, number>;
  targets: Record<string, string[]>;
  organizationIds: string[];
  projectIds: string[];
  legacySpecIds: string[];
  planeArchives: { id: string; organization_id: string; object_ref: string; content_digest: string;
    archive_digest: string; scope: string; counts: Record<string, number> }[];
  catalogArchives: { id: string; legacy_identity_id: string; encrypted_object_ref: string;
    cutover_run_id: string; source_checksum: string; graph_checksum: string;
    protected_references: ArchiveProtectedReference[] }[];
};

export type DefinitionArchiveStores = { objectStore?: ObjectStore; catalogArchiveStore?: ArchiveObjectStore; catalogArchiveKey?: Buffer };
export type DefinitionArchiveErasure = {
  planeUpdates: { id: string; oldObjectRef: string; newObjectRef: string; contentDigest: string;
    archiveDigest: string; counts: Record<string, number> }[];
  catalogDeletes: { id: string; oldObjectRef: string }[];
  pendingObjectRefs: string[];
  affectedArchiveRecords: number;
  affectedOrganizationIds: string[];
  affectedProjectIds: string[];
};

const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identityKeys = new Set(["id", "draftid", "definitionid", "parameterdefinitionid", "parameterspecid", "specid", "parameterid", "bindingid",
  "canonicalbindingid", "projectparameterbindingid", "sourceprojectparameterbindingid", "sourceprojectvalueid",
  "projectvalueid", "projectparametervalueid", "currentvalueid", "valueid", "requestid", "submissionroundid"]);
const keyOf = (key: string) => key.replaceAll("_", "").toLowerCase();

function ownsTarget(value: unknown, ids: ReadonlySet<string>): boolean {
  return record(value) && Object.entries(value).some(([key, child]) =>
    identityKeys.has(keyOf(key)) && typeof child === "string" && ids.has(child));
}

function scrub(value: unknown, ids: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.filter(child => !ownsTarget(child, ids)).map(child => scrub(child, ids));
  if (!record(value)) return value;
  if (ownsTarget(value, ids)) return null;
  const detachReplacement = Object.entries(value).some(([key, child]) =>
    keyOf(key).startsWith("replacedfrom") && typeof child === "string" && ids.has(child));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    keyOf(key).startsWith("replacedfrom") && detachReplacement ? null :
      keyOf(key).endsWith("ids") && Array.isArray(child) ? child.filter(id => typeof id !== "string" || !ids.has(id)).map(id => scrub(id, ids)) : scrub(child, ids)]));
}

const sourceKeys = new Set(ARCHIVED_PARAMETER_PLANE_RELATIONS.filter(relation =>
  ["file", "configSet", "baseline", "configRevision", "logicalNode"].includes(relation.scope.kind) ||
  ["project_parameter_files", "project_parameter_file_candidates", "dts_config_set", "dts_config_revisions", "dts_logical_nodes", "canonical_source_occurrences"].includes(relation.key)
).map(relation => relation.key));
const candidateSnapshots = new Set(["impact", "blockers", "frozen_binding_manifest", "source_revision_context"]);

function rowMetadata(row: unknown, key: string): unknown {
  if (!record(row)) return row;
  const omitted = key === "canonical_values" || key === "legacy_parameter_values"
    ? new Set(["raw_value", "normalized_value", "value"])
    : key === "binding_history_events" || key === "canonical_source_pins"
      ? new Set(["applied_request_id", "delete_request_id", "delete_target_id"]) : new Set<string>();
  return Object.fromEntries(Object.entries(row).filter(([name]) => !omitted.has(name)));
}

function containsTarget(value: unknown, ids: ReadonlySet<string>): boolean {
  return ownsTarget(value, ids) || (Array.isArray(value) ? value.some(child => containsTarget(child, ids)) :
    record(value) && Object.values(value).some(child => containsTarget(child, ids)));
}

/** Archives own parameter rows; their original configuration objects remain byte-for-byte intact. */
export function eraseDefinitionFromPlaneArchive(document: ArchivedPlaneDocument, inventory: DefinitionDeletionInventory): ArchivedPlaneDocument {
  const ids = new Set([inventory.definition.id, ...inventory.legacySpecIds, ...Object.values(inventory.targets).flat()]);
  const relationMap = new Map(ARCHIVED_PARAMETER_PLANE_RELATIONS.map(relation => [relation.key, relation.from]));
  let previous = -1;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const [key, rows] of Object.entries(document.relations)) {
      if (sourceKeys.has(key)) continue;
      for (const row of rows) if (containsTarget(rowMetadata(row, key), ids) && record(row)) {
        if (typeof row.id === "string") ids.add(row.id);
        if (typeof row.draft_id === "string") ids.add(row.draft_id);
        // An approval batch cannot keep a proof with only part of its targets.
        if (key === "project_parameter_value_change_targets" && typeof row.request_id === "string") ids.add(row.request_id);
      }
    }
  }
  const relations = Object.fromEntries(Object.entries(document.relations).map(([key, rows]) => {
    if (sourceKeys.has(key)) return [key, key === "project_parameter_file_candidates" ? rows.map(row =>
      record(row) ? Object.fromEntries(Object.entries(row).map(([name, value]) =>
        [name, candidateSnapshots.has(name) ? scrub(value, ids) ?? (Array.isArray(value) ? [] : {}) : value])) : row) : rows];
    const selected = new Set(inventory.targets[relationMap.get(key) ?? key] ?? []);
    return [key, rows.filter(row => !(record(row) && selected.has(String(row.id ?? row.draft_id))) && !containsTarget(rowMetadata(row, key), ids))
      .map(row => {
        // A surviving parameter's value is user data, even when its JSON happens to contain a deleted ID.
        if ((key === "canonical_values" || key === "legacy_parameter_values") && record(row)) {
          const { raw_value, normalized_value, value, ...metadata } = row;
          return { ...scrub(metadata, ids) as Record<string, unknown>,
            ...("raw_value" in row ? { raw_value } : {}), ...("normalized_value" in row ? { normalized_value } : {}),
            ...("value" in row ? { value } : {}) };
        }
        if (["binding_history_events", "canonical_source_pins"].includes(key) && record(row)) {
          const next = { ...row };
          for (const field of ["applied_request_id", "delete_request_id", "delete_target_id"]) {
            if (typeof next[field] === "string" && ids.has(next[field])) next[field] = null;
          }
          return scrub(next, ids);
        }
        return scrub(row, ids);
      })];
  }));
  const counts = Object.fromEntries(Object.entries(relations).map(([key, rows]) => [key, rows.length]));
  return { ...document, relations, counts };
}

export function catalogArchiveGraphIsOwned(graph: Record<string, unknown>, archive: Pick<DefinitionDeletionInventory["catalogArchives"][number], "legacy_identity_id" | "protected_references">, ids: ReadonlySet<string>): boolean {
  const source = graph.sourcePayload;
  const relations = graph.relationGraph;
  if (!record(source) || !record(relations) || !Array.isArray(relations.edges)) return false;
  const sourceKeys = new Set(["kind", "cls", "rClass", "disposition", "specId", "token"]);
  if (Object.keys(source).some(key => !sourceKeys.has(key))) return false;
  if (source.kind !== "legacy-row" && source.kind !== "legacy-source-row") return false;
  if (source.kind === "legacy-source-row" && (typeof source.specId !== "string" || !ids.has(source.specId))) return false;
  if (Object.keys(relations).some(key => key !== "edges" && key !== "identityId")) return false;
  if (relations.identityId !== undefined && relations.identityId !== archive.legacy_identity_id) return false;
  return archive.protected_references.every(ref => ids.has(ref.id)) && relations.edges.every(edge =>
    record(edge) && Object.keys(edge).every(key => ["from", "to", "kind"].includes(key)) &&
    typeof edge.from === "string" && ids.has(edge.from) && typeof edge.to === "string" && ids.has(edge.to));
}

function mentionsIdentity(value: unknown, ids: ReadonlySet<string>): boolean {
  return typeof value === "string" ? ids.has(value) : Array.isArray(value) ? value.some(child => mentionsIdentity(child, ids)) :
    record(value) && Object.values(value).some(child => mentionsIdentity(child, ids));
}

export async function prepareDefinitionArchiveErasure(inventory: DefinitionDeletionInventory, stores: DefinitionArchiveStores,
  options: { dryRun?: boolean; db?: Queryable; rootDb?: Database } = {}): Promise<DefinitionArchiveErasure> {
  const plan: DefinitionArchiveErasure = { planeUpdates: [], catalogDeletes: [], pendingObjectRefs: [],
    affectedArchiveRecords: 0, affectedOrganizationIds: [], affectedProjectIds: [] };
  const uploads: { archive: DefinitionDeletionInventory["planeArchives"][number]; next: ArchivedPlaneDocument; bytes: Buffer }[] = [];
  for (const archive of inventory.planeArchives) {
    const store = stores.objectStore;
    if (!store?.getBounded || !store.delete) throw new ApiError("CONFLICT", "归档存储尚不支持完整删除。", { reason: "definition-archive-store-unavailable" });
    const bytes = await store.getBounded(archive.object_ref, ARCHIVE_DOCUMENT_BYTES_CAP);
    if (digest(bytes) !== archive.content_digest || archiveDigestOf({ scope: archive.scope, counts: archive.counts,
      contentDigest: archive.content_digest }) !== archive.archive_digest) {
      throw new ApiError("CONFLICT", "参数归档校验失败，尚未删除任何数据。", { reason: "definition-archive-integrity-failed" });
    }
    const document: unknown = JSON.parse(bytes.toString("utf8"));
    if (!record(document) || document.schemaVersion !== "project-parameter-plane-archive/v2" || !record(document.relations) || !record(document.objects)) {
      throw new ApiError("CONFLICT", "参数归档格式无法安全清理。", { reason: "definition-archive-format-unavailable" });
    }
    const original = document as ArchivedPlaneDocument;
    const next = eraseDefinitionFromPlaneArchive(original, inventory);
    if (isDeepStrictEqual(next.relations, original.relations)) continue;
    for (const [key, rows] of Object.entries(original.relations)) {
      const retained = new Set((next.relations[key] ?? []).map(row => serializeContract(row as ContractJsonValue)));
      plan.affectedArchiveRecords += rows.filter(row => !retained.has(serializeContract(row as ContractJsonValue))).length;
    }
    plan.affectedOrganizationIds.push(original.organizationId);
    plan.affectedProjectIds.push(original.projectId);
    if (options.dryRun) continue;
    const sanitized = Buffer.from(`${JSON.stringify(next)}\n`);
    uploads.push({ archive, next, bytes: sanitized });
  }
  const owned = new Set(inventory.targets["parameter_catalog.parameter_catalog_archives"] ?? []);
  const ids = new Set([inventory.definition.id, ...inventory.legacySpecIds, ...Object.values(inventory.targets).flat()]);
  for (const archive of inventory.catalogArchives) {
    if (!stores.catalogArchiveStore || !stores.catalogArchiveKey) {
      throw new ApiError("CONFLICT", "需要先连接迁移归档存储，才能完成彻底删除。", { reason: "definition-catalog-archive-store-unavailable" });
    }
    // Missing owned ciphertext is already absent. Never infer the contents of a surviving archive.
    if (!await stores.catalogArchiveStore.exists(archive.encrypted_object_ref)) {
      if (!owned.has(archive.id)) throw new ApiError("CONFLICT", "迁移归档缺失，无法核实关联数据。", { reason: "definition-catalog-archive-missing" });
    } else {
      let graph: unknown;
      try {
        const bytes = await stores.catalogArchiveStore.get(archive.encrypted_object_ref);
        if (bytes.length > ARCHIVE_DOCUMENT_BYTES_CAP) throw new Error("Archive too large");
        graph = JSON.parse(decryptArchiveObject({ key: stores.catalogArchiveKey,
          aad: buildArchiveAad({ archiveId: archive.id, legacyIdentityId: archive.legacy_identity_id,
            cutoverRunId: archive.cutover_run_id, sourceChecksum: archive.source_checksum, graphChecksum: archive.graph_checksum }), envelope: bytes }).toString("utf8"));
        if (!record(graph) || checksumContract(graph.sourcePayload as ContractJsonValue) !== archive.source_checksum ||
          archiveGraphChecksum({ relationGraph: graph.relationGraph as ContractJsonValue, protectedReferences: archive.protected_references }) !== archive.graph_checksum) throw new Error("Archive checksum mismatch");
      } catch {
        throw new ApiError("CONFLICT", "迁移归档校验失败，尚未删除任何数据。", { reason: "definition-catalog-archive-integrity-failed" });
      }
      if (owned.has(archive.id) ? !catalogArchiveGraphIsOwned(graph as Record<string, unknown>, archive, ids) :
        mentionsIdentity(graph, ids) || mentionsIdentity(archive.protected_references, ids)) {
        throw new ApiError("CONFLICT", "迁移归档混有其他参数或原始文件，需要先迁移归档格式后再删除。", { reason: "definition-catalog-archive-mixed-graph" });
      }
    }
    if (owned.has(archive.id)) {
      plan.affectedArchiveRecords += 1;
      plan.catalogDeletes.push({ id: archive.id, oldObjectRef: archive.encrypted_object_ref });
      plan.pendingObjectRefs.push(`catalog::${archive.encrypted_object_ref}`);
    }
  }
  try {
    for (const { archive, next, bytes } of uploads) {
      const contentDigest = digest(bytes);
      const objectStore = options.rootDb ? parameterObjectWriteCustody(options.rootDb, stores.objectStore!) : stores.objectStore!;
      const stored = await objectStore.put({ organizationId: archive.organization_id,
        fileName: `parameter-plane-${archive.id}-${contentDigest.slice(7, 19)}.json`, contentType: "application/json", bytes });
      plan.planeUpdates.push({ id: archive.id, oldObjectRef: archive.object_ref, newObjectRef: stored.storageKey,
        contentDigest, archiveDigest: archiveDigestOf({ scope: archive.scope, counts: next.counts, contentDigest }), counts: next.counts });
      plan.pendingObjectRefs.push(`plane::${archive.object_ref}`);
    }
  } catch (error) {
    if (options.db) await cleanupPreparedArchiveErasure(plan, stores, options.db);
    throw error;
  }
  return plan;
}

export async function deleteErasedArchiveObject(reference: string, stores: DefinitionArchiveStores, db: Queryable): Promise<void> {
  const separator = reference.indexOf("::");
  const referenced = await db.query<{ referenced: boolean }>(
    "select parameter_catalog.definition_erasure_object_is_referenced($1,$2) as referenced",
    [reference.slice(0, separator), reference.slice(separator + 2)]);
  if (referenced.rows[0]?.referenced !== false) throw new Error("Archive object still has retained references");
  if (reference.startsWith("plane::") && stores.objectStore?.delete) return stores.objectStore.delete(reference.slice(7));
  if (reference.startsWith("catalog::") && stores.catalogArchiveStore) return stores.catalogArchiveStore.remove(reference.slice(9));
  throw new Error("Erased archive object store is unavailable");
}

export async function cleanupPreparedArchiveErasure(plan: DefinitionArchiveErasure, stores: DefinitionArchiveStores, db: Queryable): Promise<void> {
  for (const archive of plan.planeUpdates) await deleteErasedArchiveObject(`plane::${archive.newObjectRef}`, stores, db);
}
