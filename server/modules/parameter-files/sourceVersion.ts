import { createHash } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import { normalizeManifestLogicalPath, normalizePersistedManifest } from "../parameter-topology/configRevisionManifest";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import { MAX_PARAMETER_SOURCE_BYTES } from "./jsonSource";

export type ExactSourceRevisionIdentity = {
  organizationId: string; projectId: string; configSetId: string; configRevisionId: string;
  fileId: string; fileVersionId: string;
};

type Member = {
  id: string; configRevisionId: string; fileId: string; fileVersionId: string;
  sourceName: string; role: string; sortOrder: number;
};
type SourceVersion = Member & {
  organizationId: string; projectId: string; configSetId: string; format: "dts" | "json";
  checksum: string; sizeBytes: number; storageKey: string; versionNumber: number;
};

const MAX_SOURCE_MEMBERS = 128;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_METADATA_BYTES = 8 * 1024 * 1024;
const REVISION_MEMBER_ROLES = new Set(["base", "overlay", "charging", "thermal", "misc", "include"]);
const DTS_OVERLAY_ROLES = new Set(["overlay", "charging", "thermal", "misc"]);

function conflict(message: string): never { throw new ApiError("CONFLICT", message, { reason: "source-proof-invalid" }); }
function limit(): never { throw new ApiError("CONFLICT", "Exact source proof exceeds its bounded capacity.", { reason: "source-proof-limit" }); }
/** Callers must roll back their entire transaction; no reads may follow this refusal. */
export function rethrowSourceTransactionError(error: unknown): never {
  if (["55P03", "40001"].includes((error as { code?: string } | null)?.code ?? "")) {
    throw new ApiError("CONFLICT", "Source is being changed; retry the exact proof.", { reason: "source-proof-busy" });
  }
  throw error;
}
const ids = (values: string[]) => [...new Set(values)].sort();
const members = async (tx: Queryable, revisionIds: string[]) => (await tx.query<Member>(
  `select id,config_revision_id as "configRevisionId",file_id as "fileId",file_version_id as "fileVersionId",
    source_name as "sourceName",role,sort_order as "sortOrder"
   from dts_config_revision_members where config_revision_id=any($1::text[]) order by id limit 129`, [revisionIds],
)).rows;

/** Source-prefix locks only; callers acquire Binding/workflow locks afterward in the same transaction. */
export async function lockExactSourceRevisionsForProof(tx: Queryable, inputs: readonly ExactSourceRevisionIdentity[]): Promise<void> {
  if (!inputs.length) return;
  const revisionIds = ids(inputs.map((entry) => entry.configRevisionId));
  const before = await members(tx, revisionIds);
  if (before.length > 128) limit();
  for (const input of inputs) {
    if (before.filter((member) => member.configRevisionId === input.configRevisionId
      && member.fileId === input.fileId && member.fileVersionId === input.fileVersionId).length !== 1) conflict("Exact source membership is missing.");
  }
  const setIds = ids(inputs.map((entry) => entry.configSetId));
  const fileIds = ids(before.map((member) => member.fileId));
  const versionIds = ids(before.map((member) => member.fileVersionId));
  const versionMembers = async () => (await tx.query(
    `select id,config_revision_id,file_id,file_version_id from dts_config_revision_members
     where file_version_id=any($1::text[]) order by id limit 100001`, [versionIds],
  )).rows;
  const referencesBefore = await versionMembers();
  if (referencesBefore.length > 100_000) limit();
  try {
    await tx.query(`select id from dts_config_set where id=any($1::text[]) order by id for update nowait`, [setIds]);
    await tx.query(`select id from project_parameter_files where id=any($1::text[]) order by id for update nowait`, [fileIds]);
    await tx.query(`select id from project_parameter_file_versions where id=any($1::text[]) order by id for update nowait`, [versionIds]);
    await tx.query(`select id from dts_config_revisions where id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    await tx.query(`select id from dts_config_revision_members where config_revision_id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    if (JSON.stringify(await members(tx, revisionIds)) !== JSON.stringify(before)) conflict("Source membership changed during lock acquisition.");
    const count = await tx.query<{ count: number }>(`select (
      (select count(*) from dts_logical_node_revisions where config_revision_id=any($1::text[]))+
      (select count(*) from dts_node_occurrences where config_revision_id=any($1::text[]))+
      (select count(*) from dts_property_occurrences where config_revision_id=any($1::text[]))+
      (select count(*) from dts_occurrence_effects where config_revision_id=any($1::text[])))::int as count`, [revisionIds]);
    if (count.rows[0]!.count > 100_000) limit();
    await tx.query(`select id from dts_logical_nodes where id in
      (select logical_node_id from dts_logical_node_revisions where config_revision_id=any($1::text[]))
      order by id for update nowait`, [revisionIds]);
    await tx.query(`select id from dts_logical_node_revisions where config_revision_id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    await tx.query(`select id from dts_node_occurrences where config_revision_id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    await tx.query(`select id from dts_property_occurrences where config_revision_id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    await tx.query(`select id from dts_occurrence_effects where config_revision_id=any($1::text[]) order by id for update nowait`, [revisionIds]);
    if (JSON.stringify(await versionMembers()) !== JSON.stringify(referencesBefore)) conflict("Source version membership changed during lock acquisition.");
  } catch (error) {
    rethrowSourceTransactionError(error);
  }
}

/** Pre-pin read: storage metadata is always resolved server-side, never accepted from a command. */
export async function loadExactSourceRevisionForProof(tx: Queryable, objectStore: ObjectStore, input: ExactSourceRevisionIdentity) {
  if (!objectStore?.getBounded) conflict("Exact source proof requires bounded source storage.");
  const revisions = await tx.query<{ entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[]; status: string; manifestState: string }>(
    `select entry_file as "entryFile",include_search_paths as "includeSearchPaths",overlay_order as "overlayOrder",
      status,manifest_state as "manifestState" from dts_config_revisions
     where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4`,
    [input.configRevisionId,input.organizationId,input.projectId,input.configSetId],
  );
  const rawRevision = revisions.rows[0];
  if (revisions.rows.length !== 1 || !rawRevision || rawRevision.manifestState !== "complete") conflict("Source revision is not an exact complete manifest.");
  if (Buffer.byteLength(JSON.stringify(rawRevision)) > MAX_MANIFEST_METADATA_BYTES) limit();
  if ((rawRevision.entryFile !== null && typeof rawRevision.entryFile !== "string")
    || !Array.isArray(rawRevision.includeSearchPaths) || !rawRevision.includeSearchPaths.every((path) => typeof path === "string" && !/[\u0000-\u001f\u007f]/.test(path))
    || !Array.isArray(rawRevision.overlayOrder) || !rawRevision.overlayOrder.every((path) => typeof path === "string")) {
    conflict("Source revision manifest has malformed metadata.");
  }
  const { entryFile,includeSearchPaths,overlayOrder } = rawRevision;
  const rows = (await tx.query<SourceVersion>(
    `select member.id,member.config_revision_id as "configRevisionId",member.file_id as "fileId",
      member.file_version_id as "fileVersionId",member.source_name as "sourceName",member.role,member.sort_order as "sortOrder",
      file.organization_id as "organizationId",file.project_id as "projectId",file.config_set_id as "configSetId",file.format,
      version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey",version.version_number as "versionNumber"
     from dts_config_revision_members member
     left join project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=member.file_id
     left join project_parameter_files file on file.id=member.file_id
     where member.config_revision_id=$1 order by member.sort_order,member.id limit 129`, [input.configRevisionId],
  )).rows;
  if (rows.length > MAX_SOURCE_MEMBERS) limit();
  if (Buffer.byteLength(JSON.stringify({ revision: rawRevision,members: rows })) > MAX_MANIFEST_METADATA_BYTES) limit();
  const fileIds = new Set<string>();
  const versionIds = new Set<string>();
  const aliases = new Set<string>();
  let totalBytes = 0;
  for (const row of rows) {
    if (row.configRevisionId !== input.configRevisionId
      || typeof row.sourceName !== "string" || !REVISION_MEMBER_ROLES.has(row.role)
      || !Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0
      || row.organizationId !== input.organizationId || row.projectId !== input.projectId || row.configSetId !== input.configSetId
      || (row.format !== "dts" && row.format !== "json")
      || typeof row.checksum !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(row.checksum)
      || typeof row.sizeBytes !== "number" || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || row.sizeBytes > MAX_PARAMETER_SOURCE_BYTES
      || typeof row.storageKey !== "string" || !row.storageKey
      || typeof row.versionNumber !== "number" || !Number.isSafeInteger(row.versionNumber) || row.versionNumber < 1) {
      conflict("Source member has invalid ownership or version metadata.");
    }
    const normalizedAlias = normalizeManifestLogicalPath(row.sourceName);
    if (!normalizedAlias || normalizedAlias !== row.sourceName || aliases.has(normalizedAlias)
      || fileIds.has(row.fileId) || versionIds.has(row.fileVersionId)) conflict("Source member alias or identity is missing or ambiguous.");
    fileIds.add(row.fileId);
    versionIds.add(row.fileVersionId);
    aliases.add(normalizedAlias);
    totalBytes += row.sizeBytes;
    if (totalBytes > MAX_SOURCE_BYTES) limit();
  }
  if (rows.filter((row) => row.fileId === input.fileId && row.fileVersionId === input.fileVersionId).length !== 1) conflict("Source version is absent from its exact manifest.");

  const dtsMembers = rows.filter((member) => member.format === "dts");
  if (dtsMembers.length === 0) {
    if (entryFile !== null || includeSearchPaths.length !== 0 || overlayOrder.length !== 0) conflict("JSON-only source manifest contains DTS metadata.");
  } else {
    if (typeof entryFile !== "string") conflict("DTS source manifest is missing its entry file.");
    const baseMembers = rows.filter((member) => member.role === "base");
    const dtsBaseMembers = dtsMembers.filter((member) => member.role === "base");
    if (baseMembers.length !== 1 || dtsBaseMembers.length !== 1) conflict("DTS source manifest must have one unique DTS base member.");
    const normalized = normalizePersistedManifest({
      entryFile, includeSearchPaths, overlayOrder,
      members: dtsMembers.map((member) => ({
        fileId: member.fileId, fileVersionId: member.fileVersionId, fileName: member.sourceName,
        sourceName: member.sourceName, role: member.role as ConfigRevisionMemberRole, sortOrder: member.sortOrder,
        content: "", format: "dts",
      })),
    });
    if (!normalized.ok) conflict("DTS source manifest is not safe or complete.");
    const normalizedEntry = normalized.manifest.entryFile;
    const entryMembers = dtsMembers.filter((member) => normalizeManifestLogicalPath(member.sourceName) === normalizedEntry);
    if (entryMembers.length !== 1 || entryMembers[0]!.role !== "base") conflict("DTS source manifest entry is absent or not its base member.");
    const seenOverlays = new Set<string>();
    for (const overlay of normalized.manifest.overlayOrder) {
      if (seenOverlays.has(overlay)) conflict("DTS source manifest overlay order is not unique.");
      seenOverlays.add(overlay);
      const overlayMembers = dtsMembers.filter((member) => normalizeManifestLogicalPath(member.sourceName) === overlay);
      if (overlayMembers.length !== 1 || !DTS_OVERLAY_ROLES.has(overlayMembers[0]!.role)) conflict("DTS source manifest overlay is absent or wrong-format.");
    }
  }
  const result: Array<Omit<SourceVersion, "storageKey"> & { bytes: Buffer; content: string }> = [];
  for (const row of rows) {
    let bytes: Buffer;
    try { bytes = await objectStore.getBounded!(row.storageKey, MAX_PARAMETER_SOURCE_BYTES); }
    catch { conflict("Exact source object is missing or unreadable."); }
    if (bytes!.length !== row.sizeBytes || createHash("sha256").update(bytes!).digest("hex") !== row.checksum.replace(/^sha256:/, "")) conflict("Source bytes disagree with their immutable version.");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes!); }
    catch { conflict("Exact source object is not UTF-8."); }
    const { storageKey: _storageKey, ...metadata } = row;
    result.push({ ...metadata, bytes: bytes!, content: content! });
  }
  return { revision: rawRevision, members: result };
}
