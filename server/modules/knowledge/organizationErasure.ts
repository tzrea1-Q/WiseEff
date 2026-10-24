import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import type { OrganizationErasureDomainAdapter } from "../users/organizationErasureDomains";

export const knowledgeOrganizationErasure: OrganizationErasureDomainAdapter = {
  domain: "knowledge",
  inventoryCategories: ["knowledge"],
  async erase(db, intent, runtime) {
    await runtime.renewLease();
    const admit = async (tx: Database) => {
      const owned = await tx.query(`select id from organization_erasures where id=$1 and target_organization_id=$2
        and status='running' and stage='domains' and lease_owner=$3 and lease_expires_at>clock_timestamp() for update`,
      [intent.id, intent.targetOrganizationId, intent.leaseOwner]);
      if (!owned.rowCount) throw new Error("Knowledge erasure lease unavailable");
      await tx.query("select set_config('wiseeff.organization_erasure_id',$1,true),set_config('wiseeff.organization_erasure_lease',$2,true)", [intent.id, intent.leaseOwner]);
    };
    await db.transaction(async tx => {
      await admit(tx);
      // ponytail: short fixed metadata fence pauses knowledge writes across tenants;
      // replace with composite owner FKs/per-object reservations if contention grows.
      await tx.query(`lock table knowledge_entries,knowledge_files,knowledge_revisions,knowledge_chunks,
        knowledge_index_status,knowledge_parameter_references in share row exclusive mode nowait`);
      // Historical entry-only FKs are weaker than current tenant admission.
      // Refuse inconsistent ownership before a cascade could erase foreign data.
      const foreign = await tx.query(`with entries as (select id from knowledge_entries where organization_id=$1),
        revisions as (select id from knowledge_revisions where organization_id=$1)
        select 1 from knowledge_files where organization_id<>$1 and entry_id in (select id from entries)
        union all select 1 from knowledge_revisions where organization_id<>$1 and entry_id in (select id from entries)
        union all select 1 from knowledge_chunks where organization_id<>$1 and (entry_id in (select id from entries) or revision_id in (select id from revisions))
        union all select 1 from knowledge_index_status where organization_id<>$1 and (entry_id in (select id from entries) or indexed_revision_id in (select id from revisions))
        union all select 1 from knowledge_parameter_references where organization_id<>$1 and entry_id in (select id from entries)
        limit 1`, [intent.targetOrganizationId]);
      if (foreign.rowCount) throw new Error("Knowledge ownership is inconsistent");
      // A running put owns its reservation row until IO settles. A queued writer
      // must find this row before put; adopting/deleting it cancels that admission.
      await tx.query("select id from knowledge_attachment_writes where organization_id=$1 order by id for update nowait", [intent.targetOrganizationId]);
      const keys = (await tx.query<{ storage_key: string }>("select distinct storage_key from knowledge_files where organization_id=$1", [intent.targetOrganizationId])).rows;
      for (const { storage_key } of keys) {
        await tx.query("insert into knowledge_attachment_writes(id,organization_id,storage_key,erasure_id) values($1,$2,$3,$4)", [randomUUID(), intent.targetOrganizationId, storage_key, intent.id]);
      }
      await tx.query("update knowledge_attachment_writes set erasure_id=$2 where organization_id=$1", [intent.targetOrganizationId, intent.id]);
      await tx.query("delete from knowledge_import_batches where organization_id=$1", [intent.targetOrganizationId]);
      await tx.query("update knowledge_entries set head_revision_id=null where organization_id=$1", [intent.targetOrganizationId]);
      await tx.query("delete from knowledge_entries where organization_id=$1", [intent.targetOrganizationId]);
    });
    const pending = (await db.query<{ storage_key: string }>("select distinct storage_key from knowledge_attachment_writes where erasure_id=$1 order by storage_key", [intent.id])).rows;
    for (const { storage_key } of pending) {
      await runtime.renewLease();
      await db.transaction(async tx => {
        await admit(tx);
        const retained = (await tx.query<{ referenced: boolean }>("select public.knowledge_erasure_object_referenced($1,$2,$3) referenced", [intent.id, intent.leaseOwner, storage_key])).rows[0]?.referenced;
        if (retained === false) {
          if (!runtime.objectStore?.delete) throw new Error("Knowledge object deletion unavailable");
          await runtime.objectStore.delete(storage_key);
        } else if (retained !== true) throw new Error("Knowledge object ownership unavailable");
        await tx.query("delete from knowledge_attachment_writes where erasure_id=$1 and storage_key=$2", [intent.id, storage_key]);
      });
    }
  }
};
