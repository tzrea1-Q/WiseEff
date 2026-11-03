import { createHash } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext, type UserInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import type { z } from "zod";
import { captureModuleStructure, MODULE_STRUCTURE_MAX_BYTES } from "./export";

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
  const documentBytes = raw && typeof raw === "object" && "document" in raw ? JSON.stringify(raw.document) : "";
  if (Buffer.byteLength(documentBytes ?? "", "utf8") > MODULE_STRUCTURE_MAX_BYTES) throw new ApiError("VALIDATION_FAILED", "Module structure exceeds the supported byte limit.");
  const parsed = moduleStructurePreviewRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid module structure document.", { issues: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
  const { mode, document, resolutions } = parsed.data;
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
  const changes: { moduleId: string; field: typeof fields[number] | "create"; before: unknown; after: unknown }[] = [];
  const conflicts: { key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown }[] = [];
  if (stable(document.source) !== stable(baseline.source) || stable(document.limits) !== stable(baseline.limits) ||
    stable(document.counts) !== stable(baseline.counts) ||
    stable(document.references) !== stable(baseline.references)) throw new ApiError("VALIDATION_FAILED", "Unsupported changes outside module metadata.");
  const subjectBaselines = new Map(baseline.subjects.map(subject => [subject.subjectId, subject]));
  const seenSubjects = new Set<string>();
  for (const [index, subject] of document.subjects.entries()) {
    const base = subjectBaselines.get(subject.subjectId);
    if (!base || seenSubjects.has(subject.subjectId)) throw new ApiError("VALIDATION_FAILED", "Unknown or duplicate Subject.", { path: `subjects.${index}.subjectId` });
    seenSubjects.add(subject.subjectId);
    for (const [field, value] of Object.entries(subject)) if (!unchangedSubset(value, base[field as keyof typeof base]))
      throw new ApiError("VALIDATION_FAILED", "Subject changes are not supported.", { path: `subjects.${index}.${field}` });
  }
  const allowedChoices = new Set(document.modules.flatMap(module => fields.map(field => `${module.ref}:${field}`)));
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
    const node = names.rows.find(row => row.id === change.moduleId)!;
    if (names.rows.some(row => row.kind !== "business" && row.path.startsWith(`${node.path}/`)))
      throw new ApiError("CONFLICT", "Move legacy technical descendants before moving this module.");
  }
  const moduleIds = new Map(document.modules.map(module => [module.ref, module.sourceId ?? mapped.get(module.ref)?.module_id ?? module.ref]));
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
  const validated = new Set<string>();
  for (const [id, parent] of parents) {
    if (parent && !parents.has(parent)) throw new ApiError("VALIDATION_FAILED", "Parent reference is missing or invalid.");
    const visited = new Set([id]); let next = parent;
    while (next && !validated.has(next)) { if (visited.has(next)) throw new ApiError("CONFLICT", "The resulting module hierarchy contains a cycle."); visited.add(next); next = parents.get(next) ?? null; }
    for (const node of visited) validated.add(node);
  }
  const newIds = new Set(document.modules.filter(module => !module.sourceId && !mapped.has(module.ref)).map(module => moduleIds.get(module.ref)!));
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
  const actor = { id: invocation.principal.user.id, organizationId: invocation.principal.organization.id,
    roles: invocation.principal.roles.map(role => `${role.roleId}:${role.projectId ?? ""}`).sort(), permissions: [...invocation.principal.permissions].sort() };
  const evidence = { organizationId, actor, mode, document, resolutions, current, names: names.rows, mappings };
  return { changes, conflicts, token: createHash("sha256").update(stable(evidence)).digest("hex"), moduleIds, parents, namesById };
}

export async function previewModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure preview");
  const client = await pool.connect();
  try { await client.query("begin isolation level repeatable read read only"); const { changes, conflicts, token } = await planModuleStructure(client, organizationId, invocation, raw); await client.query("commit"); return { changes, conflicts, token }; }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
