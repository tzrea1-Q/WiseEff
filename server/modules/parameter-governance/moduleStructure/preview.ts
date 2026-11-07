import { createHash } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext, type UserInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import type { z } from "zod";
import { captureModuleStructure, MODULE_STRUCTURE_MAX_BYTES } from "./export";
import { planRecognition } from "./recognition";
import { planSubjectPlacement } from "./subjects";
import { planModuleCopy } from "./copy";
import type { LifecycleChange } from "./lifecycle";
import { validateChangedPaths } from "./pathBudget";
import { assertReadonlyModuleStructure } from "./diagnostics";
import { enrichModuleStructureError } from "./importErrorDetails";

const fields = ["name", "description", "scope", "sortOrder", "importance", "parentRef"] as const;

// Canonical key ordering makes tokens independent of JSON object property order.
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function unchangedSubset(value: unknown, baseline: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value) && baseline && typeof baseline === "object" && !Array.isArray(baseline)) {
    return Object.entries(value).every(([key, nested]) => unchangedSubset(nested, (baseline as Record<string, unknown>)[key]));
  }
  return stable(value) === stable(baseline);
}

export async function planModuleStructure(client: pg.PoolClient, organizationId: string, invocation: UserInvocationContext, raw: unknown) {
  try { return await planModuleStructureContent(client, organizationId, invocation, raw); }
  catch (error) { throw enrichModuleStructureError(error, raw); }
}

async function planModuleStructureContent(client: pg.PoolClient, organizationId: string, invocation: UserInvocationContext, raw: unknown) {
  const documentBytes = raw && typeof raw === "object" && "document" in raw ? JSON.stringify(raw.document) : "";
  if (Buffer.byteLength(documentBytes ?? "", "utf8") > MODULE_STRUCTURE_MAX_BYTES) throw new ApiError("VALIDATION_FAILED", "Module structure exceeds the supported byte limit.");
  const parsed = moduleStructurePreviewRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid module structure document.", { issues: parsed.error.issues });
  const { mode, document, resolutions } = parsed.data;
  if (mode === "copy") return planModuleCopy(client, organizationId, invocation, parsed.data);
  if (Object.keys(parsed.data.mappings).length) throw new ApiError("VALIDATION_FAILED", "Mappings are only valid in copy mode.");
  if (document.source.organizationId !== organizationId) throw new ApiError("FORBIDDEN", "The package is not from this organization.");
  const result = await client.query<{ document: z.infer<typeof moduleStructureExportSchema> }>(
    "select document from parameter_catalog.module_structure_export_baselines where organization_id=$1 and export_id=$2", [organizationId, document.source.exportId]);
  const baseline = result.rows[0]?.document;
  if (!baseline) throw new ApiError("NOT_FOUND", "The export baseline is unavailable.");
  const current = await captureModuleStructure(client, organizationId, document.source.exportId);
  const baseModules = new Map(baseline.modules.map(m => [m.sourceId, m]));
  const currentModules = new Map(current.modules.map(m => [m.sourceId, m]));
  const mappings = (await client.query<{ package_ref: string; module_id: string; initial_snapshot: typeof baseline.modules[number] }>(
    `select package_ref,module_id,initial_snapshot from parameter_catalog.module_structure_created_refs
     where organization_id=$1 and source_organization_id=$2 and export_id=$3`,
    [organizationId, document.source.organizationId, document.source.exportId])).rows;
  const mapped = new Map(mappings.map(row => [row.package_ref, row]));
  const seen = new Set<string>();
  const changes: { moduleId: string; field: typeof fields[number] | "create" | "delete" | "legacyImpact"; before: unknown; after: unknown }[] = [];
  const deleted = new Set<string>();
  const conflicts: { key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown }[] = [];
  assertReadonlyModuleStructure(document, baseline);
  const subjectBaselines = new Map(baseline.subjects.map(subject => [subject.subjectId, subject]));
  const subjectEdits = new Map(document.subjects.map(subject => [subject.subjectId, subject]));
  const seenSubjects = new Set<string>();
  const lifecycle: LifecycleChange[] = [];
  const normalizedSubjects = document.subjects.map(subject => ({ ...subject }));
  for (const [index, subject] of normalizedSubjects.entries()) {
    const base = subjectBaselines.get(subject.subjectId);
    if (seenSubjects.has(subject.subjectId)) throw new ApiError("VALIDATION_FAILED", "Duplicate Subject.", { path: `subjects.${index}.subjectId` });
    seenSubjects.add(subject.subjectId);
    const requested = subject.state === undefined || subject.state === base?.state ? undefined
      : !base && subject.state === "active" ? "register"
      : base && subject.state === "retired" ? "retire"
      : base && subject.state === "active" ? "restore" : undefined;
    if (!base && subject.state === "retired") throw new ApiError("VALIDATION_FAILED", "A new registration must be active.");
    if (subject.operation && subject.state !== undefined && subject.state !== (subject.operation === "retire" ? "retired" : "active"))
      throw new ApiError("VALIDATION_FAILED", "State and lifecycle operation disagree.", { path: `subjects.${index}.state` });
    if (requested) subject.operation = requested;
    if (subject.operation) {
      const target = current.subjects.find(row => row.subjectId === subject.subjectId);
      const catalog = (await client.query<{ kind: LifecycleChange["kind"]; owner_subject_id: string | null; lifecycle: string; registration_id: string | null }>(`select s.kind,coalesce(r.owner_subject_id,s.owner_subject_id) as owner_subject_id,rs.lifecycle,r.id as registration_id
        from parameter_catalog.catalog_subjects s join parameter_catalog.catalog_state cs on cs.singleton
        join parameter_catalog.catalog_release_subjects rs on rs.release_id=cs.current_catalog_release_id and rs.subject_id=s.id
        left join parameter_catalog.organization_subject_registrations r on r.organization_id=$1 and r.subject_id=s.id where s.id=$2`, [organizationId, subject.subjectId])).rows[0];
      if (!catalog || catalog.owner_subject_id || (subject.operation !== "retire" && catalog.lifecycle !== "active")) throw new ApiError("CONFLICT", "Catalog Subject is unavailable or owned by a driver.", { path: `subjects.${index}.subjectId` });
      if (subject.operation === "register") {
        if (base || target) throw new ApiError("CONFLICT", "Subject is already registered; restore retired registrations explicitly.");
        if (subject.displayAlias !== undefined && subject.displayAlias !== null && (!subject.displayAlias.trim() || subject.displayAlias !== subject.displayAlias.trim() || [...subject.displayAlias].length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(subject.displayAlias)))
          throw new ApiError("VALIDATION_FAILED", "Invalid display alias.", { path: `subjects.${index}.displayAlias` });
        if (!subject.placement || (subject.placement.kind !== "module" && subject.placement.kind !== "unclassified")) throw new ApiError("VALIDATION_FAILED", "Registration requires a business module or unclassified.");
        const moduleId = subject.placement.kind === "module" ? subject.placement.moduleRef :
          (await client.query<{ id: string }>("select id from parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null", [organizationId])).rows[0]?.id;
        if (!moduleId) throw new ApiError("CONFLICT", "Placement destination is unavailable.");
        lifecycle.push({ subjectId: subject.subjectId, operation: "register", kind: catalog.kind, moduleId, ...(subject.displayAlias ? { displayAlias: subject.displayAlias } : {}) });
      } else {
        if (!base || !target || base.ownerSubjectId || !catalog.registration_id || base.state !== (subject.operation === "retire" ? "active" : "retired")) throw new ApiError("CONFLICT", "Subject lifecycle changed after export.");
        if (target.state === base.state) lifecycle.push({ subjectId: subject.subjectId, operation: subject.operation, kind: catalog.kind, registrationId: catalog.registration_id });
      }
    } else if (!base) throw new ApiError("VALIDATION_FAILED", "Unknown Subject.", { path: `subjects.${index}.subjectId` });
    for (const [field, value] of Object.entries(subject)) if (field !== "subjectId" && field !== "operation" && field !== "placement" && field !== "displayAlias" && field !== "recognition" && field !== "state" && (!base || !unchangedSubset(value, base[field as keyof typeof base])))
      throw new ApiError("VALIDATION_FAILED", "Subject changes are not supported.", { path: `subjects.${index}.${field}` });
  }
  const currentSubjects = moduleStructureExportSchema.parse(current).subjects.map(subject => {
    const placement = subject.placement;
    return placement?.kind === "module"
      ? { ...subject, placement: { ...placement, moduleRef: mappings.find(mapping => mapping.module_id === placement.moduleRef)?.package_ref ?? placement.moduleRef } }
      : subject;
  });
  const subjectPlan = planSubjectPlacement(normalizedSubjects.filter(subject => subject.operation !== "register"), baseline.subjects, currentSubjects, resolutions);
  const moduleIds = new Map(current.modules.map(module => [module.ref, module.sourceId]));
  for (const module of document.modules) moduleIds.set(module.ref, module.sourceId ?? mapped.get(module.ref)?.module_id ?? module.ref);
  for (const change of subjectPlan.changes) if (change.field === "placement" && typeof change.after === "object" && change.after?.kind === "module" && !moduleIds.has(change.after.moduleRef))
    throw new ApiError("CONFLICT", "Placement destination is unavailable.");
  if (subjectPlan.changes.some(change => change.field === "placement" && typeof change.after === "object" && change.after?.kind === "unclassified")) {
    const reserved = await client.query("select 1 from parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null", [organizationId]);
    if (!reserved.rowCount) throw new ApiError("CONFLICT", "Unclassified destination is unavailable.");
  }
  const subjectVersions = await client.query(`select r.subject_id,r.status,r.updated_at::text,p.id as placement_id,p.updated_at::text as placement_updated_at,coalesce(r.owner_subject_id,s.owner_subject_id) as owner_subject_id
    from parameter_catalog.organization_subject_registrations r
    join parameter_catalog.subject_placements p on p.id=r.current_placement_id and p.organization_id=r.organization_id
    join parameter_catalog.catalog_subjects s on s.id=r.subject_id
    where r.organization_id=$1 order by r.subject_id`, [organizationId]);
  const impactedIds = [...new Set([...subjectPlan.changes, ...subjectPlan.conflicts, ...lifecycle].map(change => change.subjectId))];
  const impact = impactedIds.length ? (await client.query<{ subjectId: string; projectId: string; bindingCount: number; definitions: string[]; bindingVersions: string[] }>(`select owner.subject_id as "subjectId", b.project_id as "projectId", count(*)::int as "bindingCount",
    array_agg(distinct b.definition_id order by b.definition_id) as definitions,
    array_agg(b.id || ':' || b.effective_revision_id || ':' || b.updated_at::text order by b.id) as "bindingVersions"
    from parameter_catalog.organization_subject_registrations owner
    join parameter_catalog.organization_subject_registrations child on child.organization_id=owner.organization_id
    join parameter_catalog.catalog_subjects s on s.id=child.subject_id and
      (s.id=owner.subject_id or coalesce(child.owner_subject_id,s.owner_subject_id)=owner.subject_id)
    join parameter_catalog.project_parameter_bindings b on b.organization_id=owner.organization_id and b.subject_id=s.id
    where owner.organization_id=$1 and owner.subject_id=any($2::text[]) group by 1,2 order by 1,2`, [organizationId, impactedIds])).rows : [];
  const allowedChoices = new Set([...document.modules.flatMap(module => fields.map(field => `${module.ref}:${field}`)),
    ...document.subjects.flatMap(subject => ["placement", "displayAlias"].map(field => `subject:${subject.subjectId}:${field}`)),
    ...document.subjects.flatMap(subject => ["mode", "compatibles", "driverNature", "instanceCardinality", "nodeTypeName"].map(field => `${subject.subjectId}:recognition.${field}`))]);
  for (const key of Object.keys(resolutions)) if (!allowedChoices.has(key)) throw new ApiError("VALIDATION_FAILED", "Unknown conflict choice.", { path: `resolutions.${key}` });
  for (const [index, module] of document.modules.entries()) {
    if (!module.ref || seen.has(module.ref) || (module.sourceId && seen.has(`id:${module.sourceId}`))) throw new ApiError("VALIDATION_FAILED", "Duplicate module reference.", { path: `modules.${index}.ref` });
    seen.add(module.ref); if (module.sourceId) seen.add(`id:${module.sourceId}`);
    const mapping = mapped.get(module.ref);
    const base = module.sourceId ? baseModules.get(module.sourceId) : mapping?.initial_snapshot;
    const targetId = module.sourceId ?? mapping?.module_id;
    const target = targetId ? currentModules.get(targetId) : undefined;
    if (module.sourceId && (!base || module.ref !== base.ref) || (!module.sourceId && (baseModules.has(module.ref) || module.reference !== undefined)) ||
      (base && module.reference !== undefined && stable(module.reference) !== stable(base.reference)))
      throw new ApiError("VALIDATION_FAILED", "Invalid module identity or reference.", { path: `modules.${index}` });
    if (targetId && !target) throw new ApiError("CONFLICT", "A mapped or exported module was deleted.", { path: `modules.${index}.sourceId` });
    if (module.operation === "delete") {
      if (!base || !targetId || !target) throw new ApiError("VALIDATION_FAILED", "Only an existing business module can be deleted.", { path: `modules.${index}.operation` });
      if (stable(target) !== stable(base)) throw new ApiError("CONFLICT", "The module changed since export; export again before deleting.");
      if (fields.some(field => module[field] !== undefined && module[field] !== base[field]))
        throw new ApiError("VALIDATION_FAILED", "A deleted module cannot also have metadata or parent edits.", { path: `modules.${index}` });
      deleted.add(targetId);
      changes.push({ moduleId: targetId, field: "delete", before: target.name, after: null });
      continue;
    }
    if (!base) {
      if (module.name === undefined || !module.name.trim() || module.parentRef === undefined || module.description === undefined || module.scope === undefined || module.sortOrder === undefined || module.importance === undefined)
        throw new ApiError("VALIDATION_FAILED", "A new module requires all editable fields.", { path: `modules.${index}` });
      changes.push({ moduleId: module.ref, field: "create", before: null, after: module.name.trim() });
      for (const field of fields) changes.push({ moduleId: module.ref, field, before: null, after: typeof module[field] === "string" && field !== "parentRef" && field !== "importance" ? module[field].trim() : module[field] });
      continue;
    }
    for (const field of fields) {
      const supplied = module[field]; if (supplied === undefined) continue;
      const original = base[field]; const now = field === "parentRef" && target!.parentRef ? (mappings.find(m => m.module_id === target!.parentRef)?.package_ref ?? target!.parentRef) : target![field];
      // A byte-for-byte round trip must not normalize historical values.
      if (supplied === original || supplied === now) continue;
      const file = typeof supplied === "string" && field !== "importance" && field !== "parentRef" ? supplied.trim() : supplied;
      if (file === original || file === now) continue;
      const key = `${module.ref}:${field}`;
      if (now !== original && !resolutions[key]) { conflicts.push({ key, moduleId: targetId!, field, baseline: original, file, current: now }); continue; }
      if (now !== original && resolutions[key] === "current") continue;
      if (field === "name" && !(file as string).trim()) throw new ApiError("VALIDATION_FAILED", "Module name is required.", { path: `modules.${index}.name` });
      changes.push({ moduleId: targetId!, field, before: now, after: file });
    }
  }
  const names = await client.query<{ id: string; parent_id: string | null; name: string; kind: string; path: string }>(
    "select id,parent_id,name,kind,path from parameter_modules where organization_id=$1 and archived_at is null order by id", [organizationId]);
  const existingIds = new Set(names.rows.map(row => row.id));
  for (const module of document.modules) if (!module.sourceId && !mapped.has(module.ref) && existingIds.has(module.ref))
    throw new ApiError("VALIDATION_FAILED", "A new module reference cannot equal an existing module identity.");
  for (const change of changes.filter(change => change.field === "parentRef")) {
    const node = names.rows.find(row => row.id === change.moduleId);
    if (node && names.rows.some(row => row.kind !== "business" && row.path.startsWith(`${node.path}/`)))
      throw new ApiError("CONFLICT", "Move legacy technical descendants before moving this module.");
  }
  const parents = new Map(names.rows.map(row => [row.id, row.parent_id]));
  const namesById = new Map(names.rows.map(row => [row.id, row.name]));
  for (const module of document.modules) {
    const id = moduleIds.get(module.ref)!;
    if (!namesById.has(id)) { namesById.set(id, module.name!.trim()); parents.set(id, module.parentRef ?? null); }
  }
  for (const change of changes) {
    if (change.field === "name") namesById.set(change.moduleId, change.after as string);
    if (change.field === "parentRef") parents.set(change.moduleId, change.after as string | null);
  }
  for (const [id, parent] of parents) if (parent && moduleIds.has(parent)) parents.set(id, moduleIds.get(parent)!);
  for (const row of names.rows) if (deleted.has(row.id) && row.kind !== "business") throw new ApiError("CONFLICT", "Protected modules cannot be deleted.");
  for (const [id, parent] of parents) if (parent && deleted.has(parent)) {
    if (!deleted.has(id)) throw new ApiError("CONFLICT", "Every child of a deleted module must be explicitly moved or deleted.");
  }
  for (const subject of currentSubjects) {
    if (subject.ownerSubjectId || subject.placement?.kind !== "module") continue;
    const currentId = moduleIds.get(subject.placement.moduleRef) ?? subject.placement.moduleRef;
    if (!deleted.has(currentId)) continue;
    const change = subjectPlan.changes.find(item => item.subjectId === subject.subjectId && item.field === "placement");
    const destination = change?.after;
    if (!destination || typeof destination !== "object" || (destination.kind === "module" && deleted.has(moduleIds.get(destination.moduleRef) ?? destination.moduleRef)))
      throw new ApiError("CONFLICT", "Every root registration in a deleted module requires an explicit destination or unset.");
  }
  for (const change of subjectPlan.changes) if (change.field === "placement" && typeof change.after === "object" && change.after?.kind === "module" && deleted.has(moduleIds.get(change.after.moduleRef) ?? change.after.moduleRef))
    throw new ApiError("CONFLICT", "A placement cannot target a deleted module.");
  const legacyImpact = deleted.size ? (await client.query<{ module_id: string; kind: string; id: string }>(
    "select * from parameter_catalog.module_deletion_references($1,$2::text[])", [organizationId, [...deleted]])).rows : [];
  for (const id of deleted) changes.push({ moduleId: id, field: "legacyImpact", before: legacyImpact.filter(item => item.module_id === id).length, after: null });
  for (const id of deleted) { parents.delete(id); namesById.delete(id); }
  const validated = new Set<string>();
  for (const [id, parent] of parents) {
    if (parent && !parents.has(parent)) throw new ApiError("VALIDATION_FAILED", "Parent reference is missing or invalid.", { path: `modules.${document.modules.findIndex(module => moduleIds.get(module.ref) === id)}.parentRef` });
    const visited = new Set([id]); let next = parent;
    while (next && !validated.has(next)) { if (visited.has(next)) throw new ApiError("CONFLICT", "The resulting module hierarchy contains a cycle.", { path: `modules.${document.modules.findIndex(module => changes.some(change => change.field === "parentRef" && change.moduleId === moduleIds.get(module.ref) && visited.has(change.moduleId)))}.parentRef` }); visited.add(next); next = parents.get(next) ?? null; }
    for (const node of visited) validated.add(node);
  }
  const newIds = new Set(document.modules.filter(module => !module.sourceId && !mapped.has(module.ref)).map(module => moduleIds.get(module.ref)!));
  validateChangedPaths(organizationId, parents, names.rows, changes);
  for (const change of lifecycle) if (change.operation === "register" && change.moduleId) {
    const id = moduleIds.get(change.moduleId) ?? change.moduleId;
    const isUnclassified = subjectEdits.get(change.subjectId)?.placement?.kind === "unclassified";
    if ((isUnclassified ? !names.rows.some(row => row.id === id && row.kind === "unclassified") : !currentModules.has(id) && !newIds.has(id)) || deleted.has(id))
      throw new ApiError("CONFLICT", "Placement destination is unavailable.");
  }
  for (const change of changes.filter(change => change.field === "parentRef" || change.field === "create")) {
    const parent = parents.get(change.moduleId);
    if (parent && !currentModules.has(parent) && !newIds.has(parent))
      throw new ApiError("CONFLICT", "A module may only be placed under an active business module.");
  }
  const siblingNames = new Set<string>();
  for (const [id, name] of namesById) {
    const key = JSON.stringify([parents.get(id) ?? null, name]);
    if (siblingNames.has(key)) throw new ApiError("CONFLICT", "The resulting module names are not unique within their parent.");
    siblingNames.add(key);
  }
  const recognition = await planRecognition(client, organizationId, current.source.catalogReleaseId, normalizedSubjects, baseline.subjects,
    moduleStructureExportSchema.parse(current).subjects, resolutions, lifecycle);
  const actor = { id: invocation.principal.user.id, organizationId: invocation.principal.organization.id,
    roles: invocation.principal.roles.map(role => `${role.roleId}:${role.projectId ?? ""}`).sort(), permissions: [...invocation.principal.permissions].sort() };
  const evidence = { organizationId, actor, mode, document, resolutions, current, names: names.rows, mappings, subjectVersions: subjectVersions.rows, impact, legacyImpact, recognition: recognition.evidence };
  return { changes: [...changes, ...subjectPlan.changes.map(({ subjectId, ...change }) => ({ moduleId: `subject:${subjectId}`, ...change })), ...lifecycle.flatMap(change => [
    { moduleId: `subject:${change.subjectId}`, field: "state", before: change.operation === "register" ? null : change.operation === "retire" ? "active" : "retired", after: change.operation === "retire" ? "retired" : "active" },
    ...(change.operation === "register" ? [{ moduleId: `subject:${change.subjectId}`, field: "placement", before: null, after: subjectEdits.get(change.subjectId)!.placement },
      ...(change.displayAlias ? [{ moduleId: `subject:${change.subjectId}`, field: "displayAlias", before: null, after: change.displayAlias }] : [])] : []),
  ])],
    conflicts: [...conflicts, ...subjectPlan.conflicts.map(({ subjectId, ...conflict }) => ({ moduleId: `subject:${subjectId}`, ...conflict })), ...recognition.conflicts],
    subjectChanges: subjectPlan.changes, recognitionChanges: recognition.changes, lifecycle, copyCreates: [], moduleIds, parents, namesById, deleted, currentCatalogReleaseId: current.source.catalogReleaseId, impact: impact.map(({ bindingVersions: _versions, ...item }) => item), token: createHash("sha256").update(stable(evidence)).digest("hex"), mappingSuggestions: [], mappingTargets: [], copyMappings: [] };
}

export async function previewModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure preview");
  const client = await pool.connect();
  try { await client.query("begin isolation level repeatable read read only"); const { changes, conflicts, token, impact, recognitionChanges, mappingSuggestions, mappingTargets } = await planModuleStructure(client, organizationId, invocation, raw); await client.query("commit");
    return { changes: [...changes, ...recognitionChanges.map(change => ({ moduleId: change.subjectId, field: "recognition", before: change.before, after: change.after }))], conflicts, token, impact, mappings: mappingSuggestions, targets: mappingTargets }; }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
