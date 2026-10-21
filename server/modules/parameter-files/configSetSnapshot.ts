import type { Queryable } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import { listConfigSetMemberFiles } from "./baselineRepository";
import type { ConfigSetRole, ParameterFileFormat } from "./types";

/** Roles applied over the base when assembling/compiling a config set. */
const OVERLAY_ROLES = new Set<ConfigSetRole>(["overlay", "charging", "thermal", "misc"]);

export type ConfigSetSnapshotMember = {
  fileId: string;
  fileName: string;
  format: ParameterFileFormat;
  role: ConfigSetRole;
  sortOrder: number;
  versionId: string;
  versionNumber: number;
  content: string;
};

export type ConfigSetSnapshotSkipped = {
  fileId: string;
  fileName: string;
  reason: "no-current-version";
};

export type ConfigSetSnapshot = {
  configSetId: string;
  /** Members with a current version, in config-set order, contents loaded. */
  members: ConfigSetSnapshotMember[];
  /** Members without a current version — callers decide whether that matters. */
  skipped: ConfigSetSnapshotSkipped[];
  /**
   * DTS compile entry: the base-role member with the lowest sortOrder, falling
   * back to the first DTS member when roles are not annotated (legacy sets).
   */
  entryFile: string | null;
  includeSearchPaths: string[];
  /** DTS overlay file names in application order (all non-base roles). */
  overlayOrder: string[];
  /** DTS members as validator input. */
  dtsFiles: Array<{ name: string; content: string }>;
  /** DTS members keyed by file name, the shape the DTS toolchain consumes. */
  toolchainFiles: Map<string, { content: string }>;
};

/**
 * One loader for "the current content of a config set."
 *
 * Members arrive from a single query that already joins the current version
 * (name, format, role, sortOrder, version, storage key); contents are fetched
 * from the object store in parallel. Callers previously re-implemented this as
 * a serial loop with three redundant per-member lookups (file for the format,
 * membership for the role, version for the storage key) — all of it data the
 * member row already carried.
 */
export async function loadConfigSetSnapshot(
  db: Queryable,
  objectStore: ObjectStore,
  configSetId: string
): Promise<ConfigSetSnapshot> {
  const rows = await listConfigSetMemberFiles(db, configSetId);

  const skipped: ConfigSetSnapshotSkipped[] = [];
  const loadable = rows.filter((row) => {
    if (row.currentVersionId && row.currentVersionStorageKey) {
      return true;
    }
    skipped.push({ fileId: row.fileId, fileName: row.fileName, reason: "no-current-version" });
    return false;
  });

  const contents = await Promise.all(
    loadable.map(async (row) => (await objectStore.get(row.currentVersionStorageKey!)).toString("utf8"))
  );

  const members: ConfigSetSnapshotMember[] = loadable.map((row, index) => ({
    fileId: row.fileId,
    fileName: row.fileName,
    format: row.format,
    role: row.role,
    sortOrder: row.sortOrder,
    versionId: row.currentVersionId!,
    versionNumber: row.currentVersionNumber ?? 0,
    content: contents[index]
  }));

  const dts = members.filter((member) => member.format === "dts");
  let entryFile: string | null = null;
  let entrySort = Number.POSITIVE_INFINITY;
  const overlays: Array<{ name: string; sortOrder: number }> = [];
  for (const member of dts) {
    if (member.role === "base" && member.sortOrder <= entrySort) {
      entryFile = member.fileName;
      entrySort = member.sortOrder;
    } else if (OVERLAY_ROLES.has(member.role)) {
      overlays.push({ name: member.fileName, sortOrder: member.sortOrder });
    }
  }
  if (!entryFile) {
    entryFile = dts[0]?.fileName ?? null;
  }
  overlays.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // Canonical revisions already persist exact parser inputs. Reusing them
  // avoids compiling include-only members as overlays from legacy role names.
  const manifest = (await db.query<{ entry_file: string | null; include_search_paths: string[]; overlay_order: string[];
    members: Array<{ fileId: string; sourceName: string }> }>(`select revision.entry_file,revision.include_search_paths,revision.overlay_order,
      (select jsonb_agg(jsonb_build_object('fileId',member.file_id,'sourceName',member.source_name))
        from dts_config_revision_members member where member.config_revision_id=revision.id) as members
    from dts_config_revisions revision where revision.config_set_id=$1 and revision.status='resolved'
      and (select count(*) from dts_config_revision_members member where member.config_revision_id=revision.id)=$2
      and not exists(select 1 from dts_config_revision_members member
        left join project_parameter_files file on file.id=member.file_id and file.config_set_id=revision.config_set_id
        where member.config_revision_id=revision.id and (file.id is null or file.current_version_id is distinct from member.file_version_id
          or file.config_set_role is distinct from case when member.role='include' then 'misc' else member.role end
          or file.config_set_sort_order is distinct from member.sort_order))
    order by revision.revision_number desc limit 1`,[configSetId,members.length])).rows[0];
  const exactManifest = manifest && Array.isArray(manifest.members) ? manifest : null;
  const sourceName = (fileId: string,fileName: string) => exactManifest?.members.find((row) => row.fileId===fileId)?.sourceName ?? fileName;

  return {
    configSetId,
    members,
    skipped,
    entryFile: exactManifest ? exactManifest.entry_file : entryFile,
    includeSearchPaths: exactManifest?.include_search_paths ?? [],
    overlayOrder: exactManifest?.overlay_order ?? overlays.map((overlay) => overlay.name),
    dtsFiles: dts.map((member) => ({ name: member.fileName, content: member.content })),
    toolchainFiles: new Map(dts.map((member) => [sourceName(member.fileId,member.fileName), { content: member.content }]))
  };
}
