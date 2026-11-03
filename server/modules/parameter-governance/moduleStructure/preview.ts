import { createHash } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext, type UserInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import type { z } from "zod";
import { captureModuleStructure, MODULE_STRUCTURE_MAX_BYTES } from "./export";
import { planSubjectPlacement } from "./subjects";

const fields = ["name", "description", "scope", "sortOrder", "importance"] as const;

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
  const seen = new Set<string>();
  const changes: { moduleId: string; field: typeof fields[number]; before: unknown; after: unknown }[] = [];
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
    for (const [field, value] of Object.entries(subject)) if (field !== "placement" && field !== "displayAlias" && !unchangedSubset(value, base[field as keyof typeof base]))
      throw new ApiError("VALIDATION_FAILED", "Subject changes are not supported.", { path: `subjects.${index}.${field}` });
  }
  const subjectPlan = planSubjectPlacement(document.subjects, baseline.subjects, moduleStructureExportSchema.parse(current).subjects, resolutions);
  const moduleIds = new Map(current.modules.map(module => [module.ref, module.sourceId]));
  for (const change of subjectPlan.changes) if (change.field === "placement" && typeof change.after === "object" && change.after?.kind === "module" && !moduleIds.has(change.after.moduleRef))
    throw new ApiError("CONFLICT", "Placement destination is unavailable.");
  if (subjectPlan.changes.some(change => change.field === "placement" && typeof change.after === "object" && change.after?.kind === "unclassified")) {
    const reserved = await client.query("select 1 from parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null", [organizationId]);
    if (!reserved.rowCount) throw new ApiError("CONFLICT", "Unclassified destination is unavailable.");
  }
  const subjectVersions = await client.query(`select r.subject_id,r.status,r.updated_at::text,p.id as placement_id,p.updated_at::text as placement_updated_at,s.owner_subject_id
    from parameter_catalog.organization_subject_registrations r
    join parameter_catalog.subject_placements p on p.id=r.current_placement_id and p.organization_id=r.organization_id
    join parameter_catalog.catalog_subjects s on s.id=r.subject_id
    where r.organization_id=$1 order by r.subject_id`, [organizationId]);
  const impactedIds = [...new Set([...subjectPlan.changes, ...subjectPlan.conflicts].map(change => change.subjectId))];
  const impact = impactedIds.length ? (await client.query<{ subjectId: string; projectId: string }>(`select distinct owner.subject_id as "subjectId", b.project_id as "projectId"
    from parameter_catalog.organization_subject_registrations owner
    join parameter_catalog.catalog_subjects s on s.id=owner.subject_id or s.owner_subject_id=owner.subject_id
    join parameter_catalog.project_parameter_bindings b on b.organization_id=owner.organization_id and b.subject_id=s.id
    where owner.organization_id=$1 and owner.subject_id=any($2::text[]) order by 1,2`, [organizationId, impactedIds])).rows : [];
  const allowedChoices = new Set([...document.modules.flatMap(module => fields.map(field => `${module.ref}:${field}`)),
    ...document.subjects.flatMap(subject => ["placement", "displayAlias"].map(field => `subject:${subject.subjectId}:${field}`))]);
  for (const key of Object.keys(resolutions)) if (!allowedChoices.has(key)) throw new ApiError("VALIDATION_FAILED", "Unknown conflict choice.", { path: `resolutions.${key}` });
  for (const [index, module] of document.modules.entries()) {
    if (seen.has(module.ref) || seen.has(`id:${module.sourceId}`)) throw new ApiError("VALIDATION_FAILED", "Duplicate module reference.", { path: `modules.${index}.ref` });
    seen.add(module.ref); seen.add(`id:${module.sourceId}`);
    const base = baseModules.get(module.sourceId); const target = currentModules.get(module.sourceId);
    if (!base || module.ref !== base.ref || (module.parentRef !== undefined && module.parentRef !== base.parentRef) ||
      (module.reference !== undefined && stable(module.reference) !== stable(base.reference)))
      throw new ApiError("VALIDATION_FAILED", "New, structural, or reference changes are not supported.", { path: `modules.${index}` });
    if (!target) throw new ApiError("CONFLICT", "A module was deleted after export.", { path: `modules.${index}.sourceId` });
    for (const field of fields) {
      const supplied = module[field]; if (supplied === undefined) continue;
      const original = base[field]; const now = target[field];
      // A byte-for-byte round trip must not normalize historical values.
      if (supplied === original || supplied === now) continue;
      const file = typeof supplied === "string" && field !== "importance" ? supplied.trim() : supplied;
      if (file === original || file === now) continue;
      const key = `${module.ref}:${field}`;
      if (now !== original && !resolutions[key]) { conflicts.push({ key, moduleId: module.sourceId, field, baseline: original, file, current: now }); continue; }
      if (now !== original && resolutions[key] === "current") continue;
      if (field === "name" && !(file as string).trim()) throw new ApiError("VALIDATION_FAILED", "Module name is required.", { path: `modules.${index}.name` });
      changes.push({ moduleId: module.sourceId, field, before: now, after: file });
    }
  }
  const names = await client.query<{ id: string; parent_id: string | null; name: string }>(
    "select id,parent_id,name from parameter_modules where organization_id=$1 and archived_at is null order by id", [organizationId]);
  const renames = new Map(changes.filter(change => change.field === "name").map(change => [change.moduleId, change.after as string]));
  const siblingNames = new Set<string>();
  for (const row of names.rows) {
    const key = JSON.stringify([row.parent_id, renames.get(row.id) ?? row.name]);
    if (siblingNames.has(key)) throw new ApiError("CONFLICT", "The resulting module names are not unique within their parent.");
    siblingNames.add(key);
  }
  const actor = { id: invocation.principal.user.id, organizationId: invocation.principal.organization.id,
    roles: invocation.principal.roles.map(role => `${role.roleId}:${role.projectId ?? ""}`).sort(), permissions: [...invocation.principal.permissions].sort() };
  const evidence = { organizationId, actor, mode, document, resolutions, current, names: names.rows, subjectVersions: subjectVersions.rows, impact };
  return { changes: [...changes, ...subjectPlan.changes.map(({ subjectId, ...change }) => ({ moduleId: `subject:${subjectId}`, ...change }))],
    conflicts: [...conflicts, ...subjectPlan.conflicts.map(({ subjectId, ...conflict }) => ({ moduleId: `subject:${subjectId}`, ...conflict }))],
    subjectChanges: subjectPlan.changes, moduleIds, impact, token: createHash("sha256").update(stable(evidence)).digest("hex") };
}

export async function previewModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure preview");
  const client = await pool.connect();
  try { await client.query("begin isolation level repeatable read read only"); const { subjectChanges: _subjectChanges, moduleIds: _moduleIds, ...plan } = await planModuleStructure(client, organizationId, invocation, raw); await client.query("commit"); return plan; }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
