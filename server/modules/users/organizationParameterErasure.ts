import { ApiError } from "../../shared/http/errors";
import type { OrganizationErasureDomainAdapter } from "./organizationErasureDomains";
import { catalogArchiveGraphIsOwned, type DefinitionDeletionInventory } from "../parameter-catalog-api/definitionDeletion/archives";
import { ARCHIVE_DOCUMENT_BYTES_CAP } from "../parameter-bindings/seedInitialization/archive";
import { archiveGraphChecksum, buildArchiveAad, checksumContract, decryptArchiveObject } from "../catalog-cutover/archive";
import type { ContractJsonValue } from "../parameter-catalog-contract";

export const organizationParameterErasure: OrganizationErasureDomainAdapter = {
  domain: "projects-parameters",
  inventoryCategories: ["projects", "organization-parameters", "catalog", "legacy-archives", "shared-references"],
  async erase(db, intent, runtime) {
    const values = [intent.id, intent.actorUserId, intent.leaseOwner];
    await runtime.renewLease();
    await db.transaction(async tx => {
      const manifest = (await tx.query<{ manifest: { archives: DefinitionDeletionInventory["catalogArchives"]; ownedIds: string[] } }>(
        "select parameter_catalog.organization_parameter_archives($1,$2,$3) as manifest", values)).rows[0]?.manifest;
      if (!manifest) throw new ApiError("CONFLICT", "无法核实组织迁移归档。");
      const owned = new Set(manifest.ownedIds);
      for (const archive of manifest.archives) {
        if (!runtime.catalogArchiveStore || !runtime.catalogArchiveKey) throw new ApiError("CONFLICT", "迁移归档存储暂不可用，清理尚未完成。");
        if (!await runtime.catalogArchiveStore.exists(archive.encrypted_object_ref)) continue;
        const bytes = await runtime.catalogArchiveStore.get(archive.encrypted_object_ref);
        if (bytes.length > ARCHIVE_DOCUMENT_BYTES_CAP) throw new ApiError("CONFLICT", "迁移归档超过可核实范围。");
        const graph = JSON.parse(decryptArchiveObject({ key: runtime.catalogArchiveKey,
          aad: buildArchiveAad({ archiveId: archive.id, legacyIdentityId: archive.legacy_identity_id, cutoverRunId: archive.cutover_run_id,
            sourceChecksum: archive.source_checksum, graphChecksum: archive.graph_checksum }), envelope: bytes }).toString("utf8")) as Record<string, unknown>;
        if (!graph || typeof graph !== "object" || checksumContract(graph.sourcePayload as ContractJsonValue) !== archive.source_checksum ||
          archiveGraphChecksum({ relationGraph: graph.relationGraph as ContractJsonValue, protectedReferences: archive.protected_references }) !== archive.graph_checksum ||
          !catalogArchiveGraphIsOwned(graph, archive, owned)) throw new ApiError("CONFLICT", "迁移归档混有未核实归属或其他组织的数据，清理尚未完成。");
      }
      await tx.query("select parameter_catalog.purge_organization_parameter_assets($1,$2,$3)", values);
    });
    const objects = (await db.query<{ store: "plane" | "catalog"; object_ref: string }>(
      "select * from parameter_catalog.organization_parameter_pending_objects($1,$2,$3)", values)).rows;
    for (const object of objects) {
      await runtime.renewLease();
      await db.transaction(async tx => {
        const args = [...values, object.store, object.object_ref];
        const retained = (await tx.query<{ retained: boolean }>(
          "select parameter_catalog.finish_organization_parameter_object($1,$2,$3,$4,$5,false) as retained", args)).rows[0]?.retained;
        if (retained === true) return;
        if (retained !== false) throw new ApiError("CONFLICT", "无法确认参数文件的保留引用。");
        // Hold the reference fence through actual IO. A failed/unknown commit
        // keeps the durable key; deletion of that exact key is idempotent.
        if (object.store === "plane" && runtime.objectStore?.delete) await runtime.objectStore.delete(object.object_ref);
        else if (object.store === "catalog" && runtime.catalogArchiveStore) await runtime.catalogArchiveStore.remove(object.object_ref);
        else throw new ApiError("CONFLICT", "参数归档存储暂不可用，清理尚未完成。");
        await tx.query("select parameter_catalog.finish_organization_parameter_object($1,$2,$3,$4,$5,true)", args);
      });
    }
  }
};
