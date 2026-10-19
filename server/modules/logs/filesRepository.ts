import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { BundleFile } from "./bundleIntake";

export type LogFileDto = Omit<BundleFile, "sha256" | "bytes"> & { role?: string | null; skillMatched?: boolean | null };
export type StoredLogFile = LogFileDto & { objectKey: string | null; lineIndexKey?: string | null };
export async function insertLogFiles(db: Queryable, organizationId: string, recordId: string,
  files: Array<BundleFile & { objectKey: string | null }>) {
  for (const file of files) {
    await db.query(`insert into log_files(id, organization_id, record_id, path, size_bytes, sha256, encoding, lossy,
      line_count, status, skip_reason, object_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [randomUUID(), organizationId, recordId, file.path, file.sizeBytes, file.sha256, file.encoding, file.lossy,
      file.lineCount, file.status, file.skipReason, file.objectKey]);
  }
}
export async function loadLogFiles(db: Queryable, organizationId: string, recordId: string): Promise<StoredLogFile[]> {
  const result = await db.query<StoredLogFile>(`select path, size_bytes::float8 as "sizeBytes", line_count as "lineCount",
    encoding, lossy, status, skip_reason as "skipReason", object_key as "objectKey", line_index_key as "lineIndexKey",
    role, skill_matched as "skillMatched"
    from log_files where organization_id = $1 and record_id = $2 order by path`, [organizationId, recordId]);
  return result.rows;
}

/** Backfill the original single text object only when the record has no bundle inventory. */
export async function loadLegacyLogFile(db: Queryable, organizationId: string, recordId: string, path: string): Promise<StoredLogFile | undefined> {
  await db.query(`insert into log_files(id, organization_id, record_id, path, size_bytes, sha256, encoding, line_count, status, object_key)
    select $1, r.organization_id, r.id, r.file_name, f.file_size_bytes, f.checksum_sha256, 'utf-8', 0, 'analyzed', f.storage_key
    from log_records r join log_file_objects f on f.id=r.file_object_id and f.organization_id=r.organization_id
    where r.organization_id=$2 and r.id=$3 and r.file_name=$4 and f.storage_key not like 'inline/%'
      and not exists (select 1 from log_files lf where lf.record_id=r.id and lf.organization_id=r.organization_id)
    on conflict (record_id,path) do nothing`, [randomUUID(), organizationId, recordId, path]);
  return (await loadLogFiles(db, organizationId, recordId)).find((file) => file.path === path);
}
export function fileInventory(files: StoredLogFile[]): LogFileDto[] {
  return files.map(({ path, sizeBytes, lineCount, encoding, lossy, status, skipReason, role, skillMatched }) =>
    ({ path, sizeBytes, lineCount, encoding, lossy, status, skipReason, role, skillMatched }));
}
