import { randomUUID } from "node:crypto";
import { isRootDatabase, type Database, type RootDatabase } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireActiveOrganization } from "../auth/organizationLifecycle";
import type { ObjectStore, ObjectStorePutInput, StoredObject } from "../logs/objectStore";

/** Root custody commits before IO even when metadata is inside an import savepoint.
 * The caller transaction retains the reservation lock through metadata commit;
 * rollback, uncertain put and uncertain commit all leave a discoverable key. */
export async function withKnowledgeAttachmentWrite<T>(db: Database, root: RootDatabase | undefined, store: ObjectStore,
  input: ObjectStorePutInput, write: (tx: Database, put: () => Promise<StoredObject>) => Promise<T>): Promise<T> {
  if (!root || !isRootDatabase(root) || !store.planKey) {
    throw new ApiError("INTERNAL_ERROR", "知识附件存储不支持持久写入保管。", { reason: "knowledge-upload-custody-unavailable" });
  }
  const id = randomUUID(), key = store.planKey(input);
  await root.transaction(async tx => {
    await requireActiveOrganization(tx, input.organizationId, true);
    await tx.query("insert into knowledge_attachment_writes(id,organization_id,storage_key) values($1,$2,$3)", [id, input.organizationId, key]);
  });
  return db.transaction(async tx => {
    const receipt = await tx.query("select id from knowledge_attachment_writes where id=$1 and erasure_id is null for update", [id]);
    if (!receipt.rowCount) throw new ApiError("CONFLICT", "知识附件上传已取消。");
    await requireActiveOrganization(tx, input.organizationId);
    const result = await write(tx, () => store.put(input));
    await tx.query("delete from knowledge_attachment_writes where id=$1", [id]);
    return result;
  });
}
