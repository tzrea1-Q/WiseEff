import { setTimeout as delay } from "node:timers/promises";
import type { OrganizationErasureDomainAdapter } from "../users/organizationErasureDomains";
import { inspectOrganizationCheckpoints } from "./xiaoze/checkpointOwnership";
import { ApiError } from "../../shared/http/errors";

export const agentDevicesFeedbackErasure: OrganizationErasureDomainAdapter = {
  domain: "agent-devices-feedback",
  inventoryCategories: ["agent", "devices", "feedback-notifications"],
  async erase(db, intent, runtime) {
    const checkpointer = runtime.agentCheckpointer;
    if (!checkpointer) throw new ApiError("CONFLICT", "Agent checkpoint runtime is unavailable.");
    let renewalError: unknown;
    const renew = async () => { if (renewalError) throw renewalError; await runtime.renewLease(); };
    const timer = setInterval(() => { void runtime.renewLease().catch(error => { renewalError = error; }); }, 15_000);
    const action = async (phase: string, key?: string, tx = db) => {
      if (renewalError) throw renewalError;
      return (await tx.query<{ keys: string[] }>("select parameter_catalog.erase_organization_runtime($1,$2,$3,$4) keys", [intent.id, intent.leaseOwner, phase, key ?? null])).rows[0]!.keys;
    };
    try {
      await renew();
      const inventory = await inspectOrganizationCheckpoints(db, intent.targetOrganizationId, checkpointer);
      if (inventory.some(row => row.category === "unclassified" && Number(row.item_count))) throw new ApiError("CONFLICT", "Agent checkpoint ownership is unresolved.");
      const store = await checkpointer.inspectStore();
      // Exact registered tuples or the preview's uniquely verified legacy tuple;
      // never current Home membership, raw session IDs, splitting or prefix scans.
      const namespaces = (await db.query<{ key: string }>(`select checkpoint_thread_id key from agent_checkpoint_namespaces where organization_id=$1 and store_id=$2 and store_kind=$3
        union select organization_id||':'||coalesce(historical_attribution#>>'{actors,actor_user_id,id}',actor_user_id)||':'||id from agent_sessions
          where organization_id=$1 and coalesce(historical_attribution#>>'{actors,actor_user_id,id}',actor_user_id) is not null`, [intent.targetOrganizationId, store.id, store.kind])).rows;
      const bridges = await action("prepare");
      if (bridges.length && !runtime.bridgeConnectionPool?.drain) throw new ApiError("CONFLICT", "Device bridge runtime is unavailable.");
      for (const bridge of bridges) await runtime.bridgeConnectionPool!.drain!(bridge);
      for (const { key } of namespaces) {
        const deadline = Date.now() + 10_000;
        for (;;) {
          await renew();
          try { await checkpointer.deleteThread(key); break; }
          catch (error) {
            if (!(error instanceof ApiError) || error.details?.reason !== "xiaoze-thread-busy" || Date.now() >= deadline) throw error;
            await delay(50);
          }
        }
      }
      for (const key of await action("keys")) {
        await renew();
        await db.transaction(async tx => {
          if (!(await action("object", key, tx)).length) return;
          if (!runtime.objectStore?.delete) throw new ApiError("CONFLICT", "Feedback object deletion is unavailable.");
          await runtime.objectStore.delete(key);
          await action("ack", key, tx);
        });
      }
      await renew();
      await action("finish");
    } finally { clearInterval(timer); }
  }
};
