import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";

const tracked = new WeakSet<ObjectStore>();
/** A separately committed exact key precedes IO, including a rejected put whose
 * remote result is unknown. No key derivation for unqualified custom stores. */
export function parameterObjectWriteCustody(root: Database, store: ObjectStore): ObjectStore {
  if (tracked.has(store)) return store;
  const wrapped: ObjectStore = { ...store, async put(input) {
    if (!store.planKey) throw new ApiError("CONFLICT", "参数存储不能持久登记写入目标。");
    const key = store.planKey(input);
    const id = (await root.query<{ id: string }>("select parameter_catalog.reserve_parameter_object_write($1,$2) as id", [input.organizationId, key])).rows[0]?.id;
    if (!id) throw new ApiError("CONFLICT", "参数文件写入登记失败。");
    return root.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_parameter_object_write($1)", [id]);
      const result = await store.put(input);
      if (result.storageKey !== key) throw new ApiError("CONFLICT", "参数存储返回了与登记不一致的文件目标。");
      return result;
    });
  } };
  tracked.add(wrapped);
  return wrapped;
}
