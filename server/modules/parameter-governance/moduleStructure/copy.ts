import { createHash } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import type { UserInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { captureModuleStructure } from "./export";
import { stable } from "./preview";
import { planCopySubjects } from "./copySubjects";
import { moduleStructureExportSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { validateChangedPaths } from "./pathBudget";

const fields = ["name", "description", "scope", "sortOrder", "importance", "parentRef"] as const;
const normalized = (field: typeof fields[number], value: unknown) => typeof value === "string" && field !== "parentRef" && field !== "importance" ? value.trim() : value;
type Input = z.infer<typeof moduleStructurePreviewRequestSchema>;
type Change = { moduleId: string; field: typeof fields[number] | "create"; before: unknown; after: unknown };
type Conflict = { key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown };

/** Plan only against the authorized target; source metadata is never a read authority. */
export async function planModuleCopy(client: pg.PoolClient, organizationId: string, invocation: UserInvocationContext, input: Input) {
  const { document, resolutions, mappings: choices } = input;
  if (document.source.organizationId === organizationId) throw new ApiError("VALIDATION_FAILED", "Copy requires another source organization.");
  const current = await captureModuleStructure(client, organizationId, document.source.exportId);
  const rows = (await client.query<{ id: string; parent_id: string | null; name: string; kind: string; path: string }>(
    "select id,parent_id,name,kind,path from parameter_modules where organization_id=$1 and archived_at is null order by id", [organizationId])).rows;
  const saved = (await client.query<{ package_ref: string; module_id: string; initial_snapshot: Input["document"]["modules"][number] }>(
    `select package_ref,module_id,initial_snapshot from parameter_catalog.module_structure_created_refs
     where organization_id=$1 and source_organization_id=$2 and export_id=$3`, [organizationId, document.source.organizationId, document.source.exportId])).rows;
  const savedByRef = new Map(saved.map(row => [row.package_ref, row]));
  const sourceByRef = new Map<string, Input["document"]["modules"][number]>();
  const sourceIds = new Set<string>();
  for (const [index, module] of document.modules.entries()) {
    if (sourceByRef.has(module.ref) || (module.sourceId && sourceIds.has(module.sourceId))) throw new ApiError("VALIDATION_FAILED", "Duplicate module reference.", { path: `modules.${index}.ref` });
    sourceByRef.set(module.ref, module); if (module.sourceId) sourceIds.add(module.sourceId);
  }
  const active = document.modules.filter(module => module.operation !== "delete");
  const referenceIds = new Set<string>();
  for (const [index, reference] of document.references.entries()) {
    if (referenceIds.has(reference.sourceId) || sourceByRef.has(reference.sourceId))
      throw new ApiError("VALIDATION_FAILED", "Duplicate module reference.", { path: `references.${index}.sourceId` });
    referenceIds.add(reference.sourceId);
  }
  const reservedRefs = new Set(document.references.filter(reference => reference.kind === "unclassified" && !reference.archived && !reference.parentId).map(reference => reference.sourceId));
  if (reservedRefs.size > 1) throw new ApiError("VALIDATION_FAILED", "Multiple unclassified roots are not supported.", { path: "references" });
  const reserved = rows.find(row => row.kind === "unclassified" && !row.parent_id);
  for (const [index, module] of active.entries()) {
    if (module.name !== undefined && !module.name.trim()) throw new ApiError("VALIDATION_FAILED", "Module name is required.", { path: `modules.${index}.name` });
    if (module.parentRef && (!sourceByRef.has(module.parentRef) || sourceByRef.get(module.parentRef)?.operation === "delete") && !reservedRefs.has(module.parentRef))
      throw new ApiError("VALIDATION_FAILED", "A retained module references an excluded or unavailable parent.", { path: `modules.${index}.parentRef` });
    if (module.parentRef && reservedRefs.has(module.parentRef) && !reserved) throw new ApiError("CONFLICT", "Unclassified destination is unavailable.");
    if (module.parentRef && reservedRefs.has(module.parentRef)) throw new ApiError("CONFLICT", "A business module cannot be placed under the unclassified root.", { path: `modules.${index}.parentRef` });
  }
  const activeRefs = new Set(active.map(module => module.ref));
  for (const key of Object.keys(choices)) if (!activeRefs.has(key)) throw new ApiError("VALIDATION_FAILED", "Unknown module mapping.", { path: `mappings.${key}` });
  const allowed = new Set([...active.flatMap(module => fields.map(field => `${module.ref}:${field}`)),
    ...document.subjects.flatMap(subject => ["ownerSubjectId", "state", "cascadeRetired", "placement", "displayAlias", "recognition"].map(field => `subject:${subject.subjectId}:${field}`))]);
  for (const key of Object.keys(resolutions)) if (!allowed.has(key)) throw new ApiError("VALIDATION_FAILED", "Unknown conflict choice.", { path: `resolutions.${key}` });
  const byId = new Map(rows.map(row => [row.id, row]));
  const technicalAncestors = new Set<string>();
  for (const row of rows) if (row.kind !== "business") {
    let parent = row.parent_id;
    while (parent && !technicalAncestors.has(parent)) { technicalAncestors.add(parent); parent = byId.get(parent)?.parent_id ?? null; }
  }
  const pathKeys = (nodes: Map<string, { parent: string | null; name: string; reserved?: boolean }>) => {
    const keys = new Map<string, string>();
    for (const id of nodes.keys()) {
      const pending: string[] = []; const visiting = new Set<string>(); let next: string | null = id;
      while (next && nodes.has(next) && !keys.has(next)) {
        if (visiting.has(next)) throw new ApiError("CONFLICT", "The copied hierarchy contains a cycle.");
        visiting.add(next); pending.push(next); next = nodes.get(next)!.parent;
      }
      let key = next ? keys.get(next) ?? "" : "";
      while (pending.length) { const nodeId = pending.pop()!; const node = nodes.get(nodeId)!;
        if (!node.reserved) key = createHash("sha256").update(stable([key, node.name])).digest("hex");
        keys.set(nodeId, key);
      }
    }
    return keys;
  };
  const targetKeys = pathKeys(new Map(rows.map(row => [row.id, { parent: row.parent_id, name: row.name, reserved: row.kind === "unclassified" }])));
  const sourceKeys = pathKeys(new Map(active.map(module => [module.ref, { parent: module.parentRef ?? null,
    name: module.name === undefined || module.parentRef === undefined ? `\u0000incomplete:${module.ref}` : module.name }])));
  const candidatesByPath = new Map<string, { id: string; name: string; suggested: boolean }[]>();
  for (const row of rows.filter(row => row.kind === "business")) {
    const key = targetKeys.get(row.id)!; const candidates = candidatesByPath.get(key) ?? [];
    candidates.push({ id: row.id, name: row.name, suggested: true }); candidatesByPath.set(key, candidates);
  }
  const suggestions = active.map(module => ({ ref: module.ref, selected: savedByRef.get(module.ref)?.module_id ?? choices[module.ref] ?? null, frozen: savedByRef.has(module.ref),
    candidates: candidatesByPath.get(sourceKeys.get(module.ref)!) ?? [] }));
  const mappingTargets = rows.filter(row => row.kind === "business").map(row => ({ id: row.id, name: `${row.name} (${row.id})` }));
  const moduleIds = new Map<string, string>();
  for (const ref of reservedRefs) if (reserved) moduleIds.set(ref, reserved.id);
  const conflicts: Conflict[] = []; const changes: Change[] = []; const used = new Set<string>();
  for (const module of active) {
    const prior = savedByRef.get(module.ref); const choice = prior?.module_id ?? choices[module.ref];
    if (prior && choices[module.ref] && choices[module.ref] !== prior.module_id) throw new ApiError("CONFLICT", "A saved module mapping cannot be changed.");
    if (!choice) { conflicts.push({ key: `mapping:${module.ref}`, moduleId: module.ref, field: "mapping", baseline: null, file: module.name ?? null, current: null }); continue; }
    if (choice !== "create") {
      const target = byId.get(choice);
      if (!target || target.kind !== "business") throw new ApiError("CONFLICT", prior ? "A mapped module was deleted." : "The selected target module is unavailable.");
      if (used.has(choice)) throw new ApiError("CONFLICT", "A target module cannot be mapped twice in one copy.");
      used.add(choice); moduleIds.set(module.ref, choice);
    } else { if (prior) throw new ApiError("CONFLICT", "A saved module mapping cannot be changed.");
      if (byId.has(module.ref)) throw new ApiError("VALIDATION_FAILED", "A new module reference cannot equal an existing module identity.");
      if (module.name === undefined || module.parentRef === undefined || module.description === undefined || module.scope === undefined || module.sortOrder === undefined || module.importance === undefined)
        throw new ApiError("VALIDATION_FAILED", "A new module requires all editable fields.", { path: `modules.${module.ref}` });
      moduleIds.set(module.ref, module.ref); }
  }
  const actor = { id: invocation.principal.user.id, organizationId: invocation.principal.organization.id,
    roles: invocation.principal.roles.map(role => `${role.roleId}:${role.projectId ?? ""}`).sort(), permissions: [...invocation.principal.permissions].sort() };
  let token = createHash("sha256").update(stable({ organizationId, actor, input, current, rows, saved })).digest("hex");
  const parents = new Map(rows.map(row => [row.id, row.parent_id])); const namesById = new Map(rows.map(row => [row.id, row.name]));
  const currentModules = new Map(current.modules.map(module => [module.sourceId, module]));
  if (conflicts.length) return { changes, conflicts, subjectChanges: [], recognitionChanges: [], lifecycle: [], copyCreates: [], moduleIds, parents, namesById, deleted: new Set<string>(), impact: [], token, mappingSuggestions: suggestions, mappingTargets, copyMappings: [], currentCatalogReleaseId: current.source.catalogReleaseId };
  const copyMappings: { ref: string; moduleId: string; snapshot: Input["document"]["modules"][number] }[] = [];
  for (const module of active) {
    const id = moduleIds.get(module.ref)!; const prior = savedByRef.get(module.ref); const target = currentModules.get(id);
    if (!prior && !target) {
      if (byId.has(module.ref)) throw new ApiError("VALIDATION_FAILED", "A new module reference cannot equal an existing module identity.");
      changes.push({ moduleId: module.ref, field: "create", before: null, after: module.name!.trim() });
      for (const field of fields) changes.push({ moduleId: module.ref, field, before: null, after: normalized(field, module[field]) });
      namesById.set(id, module.name!.trim()); parents.set(id, module.parentRef ? moduleIds.get(module.parentRef)! : null);
      continue;
    }
    if (!target) throw new ApiError("CONFLICT", "A mapped module was deleted.");
    if (!prior) copyMappings.push({ ref: module.ref, moduleId: id, snapshot: { ...module, name: module.name?.trim(), description: module.description?.trim(), scope: module.scope?.trim() } });
    for (const field of fields) {
      if (module[field] === undefined) continue;
      const file = field === "parentRef" && module.parentRef ? moduleIds.get(module.parentRef)! : normalized(field, module[field]);
      const now = target[field];
      const original = field === "parentRef" && prior?.initial_snapshot.parentRef ? moduleIds.get(prior.initial_snapshot.parentRef) ?? prior.initial_snapshot.parentRef : prior?.initial_snapshot[field];
      if (stable(file) === stable(now) || prior && stable(normalized(field, module[field])) === stable(prior.initial_snapshot[field])) continue;
      const key = `${module.ref}:${field}`;
      if ((!prior || stable(now) !== stable(original)) && !resolutions[key]) { conflicts.push({ key, moduleId: id, field, baseline: prior ? original : null, file, current: now }); continue; }
      if (resolutions[key] === "current") continue;
      if (field === "parentRef" && technicalAncestors.has(id))
        throw new ApiError("CONFLICT", "Move legacy technical descendants before moving this module.");
      changes.push({ moduleId: id, field, before: now, after: file });
      if (field === "name") namesById.set(id, file as string);
      if (field === "parentRef") parents.set(id, file as string | null);
    }
  }
  const validated = new Set<string>();
  for (const [id, parent] of parents) {
    if (parent && !parents.has(parent)) throw new ApiError("VALIDATION_FAILED", "Parent reference is missing or invalid.");
    const seen = new Set([id]); let next = parent;
    while (next && !validated.has(next)) { if (seen.has(next)) throw new ApiError("CONFLICT", "The resulting module hierarchy contains a cycle."); seen.add(next); next = parents.get(next) ?? null; }
    for (const node of seen) validated.add(node);
  }
  validateChangedPaths(organizationId, parents, rows, changes);
  const siblingNames = new Set<string>();
  for (const [id, name] of namesById) { const key = stable([parents.get(id) ?? null, name]); if (siblingNames.has(key)) throw new ApiError("CONFLICT", "The resulting module names are not unique within their parent."); siblingNames.add(key); }
  const subjects = await planCopySubjects(client, organizationId, input, moduleStructureExportSchema.parse(current).subjects, moduleIds, current.source.catalogReleaseId);
  token = createHash("sha256").update(stable({ organizationId, actor, input, current, rows, saved, subjects: subjects.evidence })).digest("hex");
  return { changes: [...changes, ...subjects.changes], conflicts: [...conflicts, ...subjects.conflicts], subjectChanges: subjects.placements, recognitionChanges: subjects.recognitionChanges, lifecycle: subjects.lifecycle, copyCreates: subjects.creates, moduleIds, parents, namesById, deleted: new Set<string>(), impact: subjects.impact, token, mappingSuggestions: suggestions, mappingTargets, copyMappings, currentCatalogReleaseId: current.source.catalogReleaseId };
}
