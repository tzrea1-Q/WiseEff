import { createHash } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import type { InitializationConfigSnapshot } from "../parameters/initializationTypes";
import { loadExactSourceRevisionForProof, lockExactSourceRevisionsForProof, rethrowSourceTransactionError } from "./sourceVersion";
import { loadFormerRootOverlayFiles } from "./configSetSnapshot";
import type { CanonicalSourceManifest } from "./canonicalSource";
import { dtsBuildInputsSchema } from "../contracts/dtoSchemas/dtsPreprocessing";
import { loadActiveOrganizationSourceRegistrations } from "../parameter-bindings/catalogProjectValueSync";

export type InitializationCopyGroup = {
  key: string; sourceProjectId: string; sourceConfigSetId: string; sourceConfigRevisionId: string;
  name?: string;
  manifest: Pick<CanonicalSourceManifest, "organizationId" | "projectId" | "configSetId" | "members" | "entryFile" | "includeSearchPaths" | "overlayOrder" | "preprocessing" | "declaredBuildInputs">;
  files: Array<{ name: string; content: string }>;
  formerRootOverlayFiles?: string[];
};

const conflict = (message: string): never => { throw new ApiError("CONFLICT", message); };

/** Read the entire current configuration inventory under the existing source locks.
 * The proof stores identities and a digest, never a second copy of source bytes.
 */
export async function loadInitializationCopySources(db: Queryable, storage: ObjectStore,
  organizationId: string, projectIds: string[], catalogReleaseId: string) {
  try {
  if (projectIds.length > 32) conflict("完整复制最多支持 32 个来源项目。");
  const projects = (await db.query<{ initialization_status: string }>(`select initialization_status from public.projects
    where organization_id=$1 and id=any($2::text[]) order by id for update nowait`, [organizationId, projectIds])).rows;
  if (projects.length !== new Set(projectIds).size) throw new ApiError("FORBIDDEN", "Every initialization source project must belong to the current organization.");
  if (projects.some(row => row.initialization_status !== "initialized")) conflict("请先完成来源项目的初始化，再复制其完整配置。");
  const sets = (await db.query<{ id: string; projectId: string; name: string }>(
    `select id,project_id as "projectId",name from public.dts_config_set
     where organization_id=$1 and project_id=any($2::text[]) order by id for update nowait`, [organizationId, projectIds])).rows;
  if (sets.length > 32) conflict("完整复制最多支持 32 个配置，请缩小来源项目范围。");
  const inventory = (await db.query<{ fileId: string; fileVersionId: string; configSetId: string; projectId: string;
    sourceName: string; format: "dts" | "json"; role: string; sortOrder: number; checksum: string; sizeBytes: number; storageKey: string }>(
    `select file.id as "fileId",file.current_version_id as "fileVersionId",file.config_set_id as "configSetId",file.project_id as "projectId",
      file.file_name as "sourceName",file.format,file.config_set_role as role,file.config_set_sort_order as "sortOrder",
      version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey"
     from public.project_parameter_files file left join public.project_parameter_file_versions version
       on version.id=file.current_version_id and version.file_id=file.id
     where file.organization_id=$1 and file.project_id=any($2::text[]) order by file.id for update of file nowait`, [organizationId, projectIds])).rows;
  if (!inventory.length) conflict("来源项目没有可复制的配置源码，请选择其他项目或从零开始。");
  if (inventory.length > 128 || inventory.reduce((sum, row) => sum + row.sizeBytes, 0) > 32 * 1024 * 1024)
    conflict("完整复制超过 128 个文件或 32 MiB 的来源容量。");
  if (inventory.some(row => !row.configSetId || !row.fileVersionId || !row.storageKey || !sets.some(set => set.id === row.configSetId)))
    conflict("来源文件尚未加入完整配置或缺少当前版本，请先完成来源配置。");
  const groups: InitializationCopyGroup[] = [];
  const snapshots: InitializationConfigSnapshot[] = [];
  const registrations = await loadActiveOrganizationSourceRegistrations(db, { organizationId });
  for (const set of sets) {
    const current = inventory.filter(row => row.configSetId === set.id);
    if (!current.length) continue;
    const revision = (await db.query<{ id: string }>(`select revision.id from public.dts_config_revisions revision
      where revision.organization_id=$1 and revision.project_id=$2 and revision.config_set_id=$3
        and revision.status in ('resolved','validated','compiled','pending_approval') and revision.manifest_state='complete'
        and (select count(*) from public.dts_config_revision_members member where member.config_revision_id=revision.id)=$4
        and not exists(select 1 from public.dts_config_revision_members member
          left join public.project_parameter_files file on file.id=member.file_id and file.config_set_id=$3
          where member.config_revision_id=revision.id and (file.id is null or file.current_version_id is distinct from member.file_version_id
            or file.config_set_role is distinct from case when member.role='include' then 'misc' else member.role end
            or file.config_set_sort_order is distinct from member.sort_order))
      order by revision.revision_number desc limit 1`, [organizationId, set.projectId, set.id, current.length])).rows[0];
    let group: InitializationCopyGroup;
    if (revision) {
      const identity = { organizationId, projectId: set.projectId, configSetId: set.id, configRevisionId: revision.id,
        fileId: current[0]!.fileId, fileVersionId: current[0]!.fileVersionId };
      await lockExactSourceRevisionsForProof(db, [identity]);
      const exact = await loadExactSourceRevisionForProof(db, storage, identity);
      if (!dtsBuildInputsSchema.safeParse({ includeSearchPaths: exact.revision.includeSearchPaths,
        defines: exact.revision.preprocessing?.defines ?? {} }).success) conflict("固定私有副本最多声明 16 个搜索目录和 32 个构建宏，请先整理来源构建输入。");
      group = { key: `${set.projectId}:${set.id}:${revision.id}`, sourceProjectId: set.projectId, sourceConfigSetId: set.id,
        sourceConfigRevisionId: revision.id, name: set.name,
        manifest: { organizationId, projectId: set.projectId, configSetId: set.id,
          entryFile: exact.revision.entryFile, includeSearchPaths: exact.revision.includeSearchPaths,
          overlayOrder: exact.revision.overlayOrder, declaredBuildInputs: exact.revision.declaredBuildInputs,
          preprocessing: exact.revision.preprocessing ?? undefined,
          members: exact.members.map(row => ({ memberId: row.id, fileId: row.fileId, fileVersionId: row.fileVersionId,
            sourceName: row.sourceName, format: row.format, role: row.role, sortOrder: row.sortOrder,
            checksum: row.checksum, sizeBytes: row.sizeBytes, ...(row.sharedReference ? { sharedReference: row.sharedReference } : {}) })) },
        files: exact.members.map(row => ({ name: row.sourceName, content: row.content })),
        formerRootOverlayFiles: await loadFormerRootOverlayFiles(db, set.id, exact.members, exact.revision.overlayOrder) };
    } else {
      // Raw JSON is a legitimate complete source even before any Definition is bound.
      if (current.some(row => row.format !== "json")) conflict("DTS 来源缺少与全部当前文件一致的完整解析版本，请先解析来源配置。");
      const files = [];
      for (const row of current) {
        if (row.sizeBytes > 2 * 1024 * 1024 || !storage.getBounded) conflict("来源文件超出完整复制容量。");
        const bytes = await storage.getBounded!(row.storageKey, 2 * 1024 * 1024);
        if (bytes.length !== row.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== row.checksum.replace(/^sha256:/, ""))
          conflict("来源文件与固定版本校验不一致。");
        files.push({ name: row.sourceName, content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) });
      }
      group = { key: `${set.projectId}:${set.id}:raw`, sourceProjectId: set.projectId, sourceConfigSetId: set.id,
        sourceConfigRevisionId: "", name: set.name,
        manifest: { organizationId, projectId: set.projectId, configSetId: set.id, entryFile: null,
          includeSearchPaths: [], overlayOrder: [], members: current.map(row => ({ ...row, memberId: row.fileId })) }, files };
    }
    const closure = (await db.query(`select reference.id,reference.revision_id,reference.mount_path,upstream.digest,upstream.manifest
      from public.project_shared_dtsi_references reference join public.shared_dtsi_revisions upstream on upstream.id=reference.revision_id
      where reference.organization_id=$1 and reference.project_id=$2 and reference.config_set_id=$3 order by reference.id`,
    [organizationId, set.projectId, set.id])).rows;
    const digest = createHash("sha256").update(JSON.stringify({ group, closure, catalogReleaseId, registrations, configurationInventory: sets })).digest("hex");
    snapshots.push({ sourceProjectId: set.projectId, sourceConfigSetId: set.id, sourceConfigRevisionId: revision?.id ?? null,
      name: set.name, ownership: "private", digest, catalogReleaseId,
      members: group.manifest.members.map(row => ({ fileId: row.fileId, fileVersionId: row.fileVersionId, checksum: row.checksum,
        sourceName: row.sourceName, format: row.format,
        sharedVersion: row.sharedReference?.versionId ?? null })) });
    groups.push(group);
  }
  return { groups, snapshots };
  } catch (error) { rethrowSourceTransactionError(error); }
}
