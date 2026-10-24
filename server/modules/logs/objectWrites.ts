import { randomUUID } from "node:crypto";
import { isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireActiveOrganization } from "../auth/organizationLifecycle";
import type { ObjectStore, ObjectStorePutInput } from "./objectStore";

const scopedStores = new WeakSet<ObjectStore>();
export const hasLogObjectCustody = (store: ObjectStore) => scopedStores.has(store);

/** One public operation owns this scope, including nested import savepoints.
 * Reservations commit on the pool root before IO. Failed operations retain exact
 * keys for Organization erasure; committed metadata retires the custody. */
export async function withLogObjectCustody<T>(db: Database, store: ObjectStore, operation: (store: ObjectStore) => Promise<T>, prepared: ObjectStorePutInput[] = []): Promise<T> {
  if (hasLogObjectCustody(store)) return operation(store);
  if (!isRootDatabase(db)) throw new ApiError("INTERNAL_ERROR", "日志文件写入缺少持久保管连接。");
  const ids: string[] = [];
  const reserved = new Map<string, string>();
  const reserve = async (input: ObjectStorePutInput) => {
    if (!store.planKey) throw new ApiError("INTERNAL_ERROR", "日志存储不支持持久写入保管。", { reason: "log-upload-custody-unavailable" });
    const key = store.planKey(input), existing = reserved.get(key);
    if (existing) return existing;
    const id = randomUUID();
    await db.transaction(async tx => {
      await requireActiveOrganization(tx, input.organizationId, true);
      await tx.query("insert into log_object_writes(id,organization_id,object_key) values($1,$2,$3)", [id, input.organizationId, key]);
    });
    ids.push(id); reserved.set(key, id);
    return id;
  };
  // Packages create a skill before composing case imports. Reserve their exact
  // keys before that outer transaction can retain an Organization lock.
  for (const input of prepared) await reserve(input);
  const scoped: ObjectStore = {
    get: key => store.get(key),
    ...(store.planKey ? { planKey: store.planKey.bind(store) } : {}),
    ...(store.delete ? { delete: store.delete.bind(store) } : {}),
    ...(store.getBounded ? { getBounded: store.getBounded.bind(store) } : {}),
    ...(store.getStream ? { getStream: store.getStream.bind(store) } : {}),
    async put(input) {
      if (!store.planKey) throw new ApiError("INTERNAL_ERROR", "日志存储不支持持久写入保管。", { reason: "log-upload-custody-unavailable" });
      const id = await reserve(input), key = store.planKey(input);
      return db.transaction(async tx => {
        if (!(await tx.query("select id from log_object_writes where id=$1 for update", [id])).rowCount) throw new ApiError("CONFLICT", "日志文件上传已取消。");
        // The custody row fences raw IO. Admission may mark the Organization
        // deleting, but its metadata fence cannot overtake this physical writer.
        await requireActiveOrganization(tx, input.organizationId);
        const saved = await store.put(input);
        if (saved.storageKey !== key) throw new Error("Object store violated its planned-key contract");
        return saved;
      });
    }
  };
  scopedStores.add(scoped);
  const result = await operation(scoped);
  // Erasure may have adopted these keys after metadata committed. Failed
  // retirement leaves discoverable custody and never removes physical bytes.
  if (ids.length) await db.query("delete from log_object_writes where id=any($1::uuid[])", [ids]).catch(() => undefined);
  return result;
}
