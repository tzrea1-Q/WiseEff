import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "./objectStore";

export type LogArtifactWriter = (store: ObjectStore, recordId: string,
  input: Parameters<ObjectStore["put"]>[0]) => ReturnType<typeof putLogArtifact>;

/** Keep the physical write fenced until its receipt is committed, even if the
 * caller's cancellation wins its own Promise.race or the store loses a response. */
export async function putLogArtifact(db: Database, store: ObjectStore, recordId: string,
  input: Parameters<ObjectStore["put"]>[0], admit?: (tx: Database) => Promise<void>) {
  if (!store.planKey) throw new ApiError("INTERNAL_ERROR", "日志产物存储不支持持久写入保管。");
  const predictedKey = store.planKey(input);
  let failure: unknown;
  const stored = await db.transaction(async (tx) => {
    await admit?.(tx);
    // Acquire the writer table/row lock before IO; the erasure's SHARE fence
    // must wait for this transaction before collecting its exact object closure.
    const current = await tx.query("update log_records set id=id where organization_id=$1 and id=$2 returning id", [input.organizationId, recordId]);
    if (!current.rows.length) throw new ApiError("NOT_FOUND", "分析记录不存在。");
    await tx.query("insert into log_artifact_objects(organization_id,record_id,object_key) values($1,$2,$3) on conflict do nothing",
      [input.organizationId, recordId, predictedKey]);
    try {
      const value = await store.put(input);
      if (value.storageKey !== predictedKey) await tx.query("insert into log_artifact_objects(organization_id,record_id,object_key) values($1,$2,$3) on conflict do nothing",
        [input.organizationId, recordId, value.storageKey]);
      return value;
    } catch (error) { failure = error; return null; }
  });
  if (!stored) throw failure;
  return stored;
}
