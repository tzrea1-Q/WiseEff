import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { BundleFile } from "./bundleIntake";

export type LogFileDto = Omit<BundleFile, "sha256" | "bytes">;
export type StoredLogFile = LogFileDto & { objectKey: string | null };
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
    encoding, lossy, status, skip_reason as "skipReason", object_key as "objectKey"
    from log_files where organization_id = $1 and record_id = $2 order by path`, [organizationId, recordId]);
  return result.rows;
}
export function fileInventory(files: StoredLogFile[]): LogFileDto[] {
  return files.map(({ path, sizeBytes, lineCount, encoding, lossy, status, skipReason }) =>
    ({ path, sizeBytes, lineCount, encoding, lossy, status, skipReason }));
}
