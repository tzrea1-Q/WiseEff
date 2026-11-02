import { randomUUID } from "node:crypto";
import type { Queryable } from "../shared/database/client";
import { createParameterModule, getParameterModuleById } from "../modules/parameters/parameterModuleRepository";
import { insertAttributionSubjectForNewModule } from "./legacyAttributionSubjectFixture";

/** Construct persisted pre-ADR-0053 rows for migration and historical-read tests only. */
export async function createLegacyParameterModule(db: Queryable, input: Omit<Parameters<typeof createParameterModule>[1], "kind"> & {
  kind?: "business" | "unclassified" | "driver-group" | "node-type";
  id?: string;
  attributionSubjectId?: string | null;
  defaultBusinessCategoryModuleId?: string | null;
}) {
  if (!input.kind || input.kind === "business" || input.kind === "unclassified") return createParameterModule(db, { ...input, kind: input.kind });
  const id = input.id ?? randomUUID();
  const parent = input.parentId ? await getParameterModuleById(db, { organizationId: input.organizationId, moduleId: input.parentId, activeOnly: true }) : null;
  if (input.parentId && !parent) throw new Error("Parent parameter module not found");
  const path = parent ? `${parent.path}/${id}` : id;
  const origin = input.origin ?? "curated";
  const attributionSubjectId = input.attributionSubjectId ?? await insertAttributionSubjectForNewModule(db, {
    moduleId: id, organizationId: input.organizationId, kind: input.kind, displayName: input.name.trim(), origin,
    sourceKey: input.sourceKey ?? null, notes: input.description ?? "",
    defaultBusinessCategoryModuleId: input.kind === "driver-group" ? input.defaultBusinessCategoryModuleId ?? input.parentId ?? null : null,
  });
  await db.query(`insert into parameter_modules
    (id,organization_id,parent_id,name,path,depth,sort_order,description,scope,importance,kind,origin,source_key,attribution_subject_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [id, input.organizationId, input.parentId ?? null, input.name.trim(), path, path.split("/").length,
    input.sortOrder ?? 0, input.description ?? "", input.scope ?? "", input.importance ?? "medium", input.kind,
    origin, input.sourceKey ?? null, attributionSubjectId]);
  const module = await getParameterModuleById(db, { organizationId: input.organizationId, moduleId: id });
  if (!module) throw new Error("Legacy fixture was not created");
  return module;
}

/** Seed a retained pre-ADR-0053 module mapping. */
export async function seedLegacyModuleMapping(db: Queryable, input: {
  id: string; organizationId: string; moduleId: string; matchKind: "compatible" | "node-type"; matchValue: string;
}) {
  await db.query(`insert into parameter_module_mappings(id,organization_id,parameter_module_id,match_kind,match_value)
    values ($1,$2,$3,$4,$5)`, [input.id, input.organizationId, input.moduleId, input.matchKind, input.matchValue]);
}

/** Seed the retained mapping and existing Binding used by identity-upgrade tests. */
export async function seedLegacyMappedBinding(db: Queryable, input: {
  organizationId: string; projectId: string; logicalNodeId: string; specId: string; moduleId: string; businessId: string;
}) {
  await seedLegacyModuleMapping(db, { id: "identity-legacy-map", organizationId: input.organizationId,
    moduleId: input.moduleId, matchKind: "node-type", matchValue: "sc8562" });
  await db.query(`insert into project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id)
    values ('existing-identity-binding',$1,$2,$3,$4,$5)`,
  [input.organizationId, input.projectId, input.logicalNodeId, input.specId, input.businessId]);
}

export async function listLegacyFixtureBindingIds(db: Queryable, projectId: string, specId: string): Promise<string[]> {
  return (await db.query<{ id: string }>("select id from project_parameter_bindings where project_id=$1 and parameter_spec_id=$2", [projectId, specId])).rows.map(row => row.id);
}
