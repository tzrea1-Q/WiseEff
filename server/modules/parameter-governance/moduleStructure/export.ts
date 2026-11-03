import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { readModuleRecognitionSubjectDefaults } from "../queries/moduleRecognition";

export const MODULE_STRUCTURE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

/** Capture the package and its immutable server baseline in the same snapshot. */
export async function exportModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, requestId: string) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure export");
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read");
    const pin = await client.query<{ id: string }>("select current_catalog_release_id as id from parameter_catalog.catalog_state where singleton");
    if (!pin.rows[0]) throw new ApiError("CONFLICT", "Catalog is unavailable.");
    const modules = await client.query<{ id: string; parent_id: string | null; name: string; description: string; scope: string; sort_order: number; importance: string; importance_override: boolean; origin: string; kind: string; archived_at: Date | null }>(
      `select id,parent_id,name,description,scope,sort_order,importance,importance_override,origin,kind,archived_at
       from public.parameter_modules where organization_id=$1 order by path,id limit $2`, [organizationId, MAX_ENTRIES + 1]);
    const registrations = await client.query<{ id: string; subject_id: string; status: string; cascade_retired: boolean; display_alias: string | null; owner_subject_id: string | null; kind: string; module_id: string | null; compatibles: string[] | null; driver_nature: string | null; instance_cardinality: string | null; node_type_name: string | null }>(
      `select r.id,r.subject_id,r.status,r.cascade_retired,r.display_alias,s.owner_subject_id,s.kind,p.module_id,
         rr.compatibles,rr.driver_nature,rr.instance_cardinality,rr.node_type_name
       from parameter_catalog.organization_subject_registrations r
       join parameter_catalog.catalog_subjects s on s.id=r.subject_id
       join parameter_catalog.subject_placements p on p.id=r.current_placement_id and p.organization_id=r.organization_id
       left join public.registration_recognition_rules rr on rr.organization_id=r.organization_id and rr.registration_id=r.id
       where r.organization_id=$1 order by r.subject_id limit $2`, [organizationId, MAX_ENTRIES + 1]);
    if (modules.rowCount! > MAX_ENTRIES || registrations.rowCount! > MAX_ENTRIES) throw new ApiError("VALIDATION_FAILED", "Module structure exceeds the supported entry limit.");
    const defaults = await readModuleRecognitionSubjectDefaults(client, registrations.rows.map(r => r.subject_id), pin.rows[0].id);
    const defaultBySubject = new Map(defaults.map(value => [value.subject_id, value]));
    const byId = new Map(modules.rows.map(module => [module.id, module]));
    const business = modules.rows.filter(module => module.kind === "business" && module.archived_at === null);
    const referenceIds = new Set(modules.rows.filter(module => module.kind === "unclassified" && module.parent_id === null).map(module => module.id));
    for (const id of [...business.map(module => module.parent_id), ...registrations.rows.map(registration => registration.module_id)]) {
      let current = id;
      while (current && !referenceIds.has(current)) {
        const module = byId.get(current);
        if (!module || (module.kind === "business" && module.archived_at === null)) break;
        referenceIds.add(current);
        current = module.parent_id;
      }
    }
    const document = {
      format: "wiseeff-module-structure", version: 1,
      source: { exportId: `msex_${randomUUID()}`, organizationId, catalogReleaseId: pin.rows[0].id },
      limits: { maxBytes: MODULE_STRUCTURE_MAX_BYTES, maxEntries: MAX_ENTRIES },
      counts: { modules: business.length, subjects: registrations.rows.length },
      modules: business.map(module => ({ ref: module.id, sourceId: module.id, operation: "upsert", name: module.name,
        parentRef: module.parent_id, description: module.description, scope: module.scope, sortOrder: module.sort_order, importance: module.importance,
        reference: { importanceOverride: module.importance_override, origin: module.origin } })),
      subjects: registrations.rows.map(registration => {
        const published = defaultBySubject.get(registration.subject_id);
        if (!published && registration.compatibles === null && (registration.kind === "driver" || registration.kind === "node-type")) {
          throw new ApiError("CONFLICT", "A retained Subject has no recognition defaults in the captured Catalog release.", { subjectId: registration.subject_id });
        }
        const selector = published?.selector_snapshot;
        const effective = { compatibles: registration.compatibles ?? (selector?.kind === "driver-compatible" ? [...new Set([...(selector.values ?? []), ...(published?.aliases ?? [])])] : []),
          nodeTypeName: registration.node_type_name ?? (selector?.kind === "node-type-name" ? selector.value ?? null : null),
          driverNature: registration.kind === "driver" ? registration.driver_nature ?? published?.nature ?? "physical-device" : null,
          instanceCardinality: registration.kind === "driver" ? registration.instance_cardinality ?? published?.cardinality ?? "multiple" : null };
        const placementModule = registration.module_id ? byId.get(registration.module_id) : null;
        return { subjectId: registration.subject_id, kind: registration.kind, ownerSubjectId: registration.owner_subject_id,
          state: registration.status, cascadeRetired: registration.cascade_retired,
          placement: registration.owner_subject_id ? null : !registration.module_id ? { kind: "unset" } : placementModule?.kind === "unclassified"
            ? { kind: "unclassified" } : placementModule?.kind === "business" && placementModule.archived_at === null
              ? { kind: "module", moduleRef: registration.module_id } : { kind: "reference", sourceId: registration.module_id },
          displayAlias: registration.display_alias,
          recognition: registration.kind === "configuration-schema" ? null : { mode: registration.compatibles === null ? "inherit" : "override",
            override: registration.compatibles === null ? null : { compatibles: registration.compatibles,
              nodeTypeName: registration.node_type_name, driverNature: registration.driver_nature,
              instanceCardinality: registration.instance_cardinality }, effective } };
      }),
      references: modules.rows.filter(module => referenceIds.has(module.id))
        .map(module => ({ sourceId: module.id, parentId: module.parent_id, name: module.name, kind: module.kind, archived: module.archived_at !== null })),
    };
    if (Buffer.byteLength(JSON.stringify(document), "utf8") > MODULE_STRUCTURE_MAX_BYTES) throw new ApiError("VALIDATION_FAILED", "Module structure exceeds the supported byte limit.");
    await client.query("insert into parameter_catalog.module_structure_export_baselines(export_id,organization_id,document) values ($1,$2,$3)",
      [document.source.exportId, organizationId, JSON.stringify(document)]);
    await writeAuditEventInTx(asAuditTx(client), invocation, { requestId }, { app: "parameter-governance", kind: "module-structure-export",
      action: "module-structure-export", severity: "Medium", projectId: null, targetType: "organization", targetId: organizationId,
      metadata: { exportId: document.source.exportId, catalogReleaseId: pin.rows[0].id, ...document.counts } });
    await client.query("commit");
    return document;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
