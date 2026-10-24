import type { OrganizationErasureDomainAdapter } from "../users/organizationErasureDomains";

export const logOrganizationErasure: OrganizationErasureDomainAdapter = {
  domain: "logs",
  inventoryCategories: ["logs", "producers"],
  async erase(db, intent, runtime) {
    const values = [intent.id, intent.leaseOwner, intent.actorUserId];
    await runtime.renewLease();
    await db.transaction(tx => tx.query("select parameter_catalog.erase_organization_logs($1,$2,$3)", values));
    const pending = (await db.query<{ object_key: string }>(
      "select * from parameter_catalog.organization_log_erasure_objects_pending($1,$2,$3)", values)).rows;
    for (const { object_key } of pending) {
      await runtime.renewLease();
      await db.transaction(async tx => {
        const shared = (await tx.query<{ referenced: boolean }>(
          "select parameter_catalog.organization_log_erasure_object_referenced($1,$2,$3,$4) referenced", [...values, object_key])).rows[0]?.referenced;
        if (shared === false) {
          if (!runtime.objectStore?.delete) throw new Error("Log object deletion unavailable");
          await runtime.objectStore.delete(object_key);
        } else if (shared !== true) throw new Error("Log object ownership unavailable");
        await tx.query("select parameter_catalog.finish_organization_log_erasure_object($1,$2,$3,$4)", [...values, object_key]);
      });
    }
  }
};
