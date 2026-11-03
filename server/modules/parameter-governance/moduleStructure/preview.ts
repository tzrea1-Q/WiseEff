import { createHash } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import type { z } from "zod";
import { captureModuleStructure, MODULE_STRUCTURE_MAX_BYTES } from "./export";

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

export async function planModuleStructure(client: pg.PoolClient, organizationId: string, raw: unknown) {
  const documentBytes = raw && typeof raw === "object" && "document" in raw ? JSON.stringify(raw.document) : "";
  if (Buffer.byteLength(documentBytes ?? "", "utf8") > MODULE_STRUCTURE_MAX_BYTES) throw new ApiError("VALIDATION_FAILED", "Module structure exceeds the supported byte limit.");
  const parsed = moduleStructurePreviewRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid module structure document.", { issues: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
  const { document, resolutions } = parsed.data;
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
    for (const [field, value] of Object.entries(subject)) if (!unchangedSubset(value, base[field as keyof typeof base]))
      throw new ApiError("VALIDATION_FAILED", "Subject changes are not supported.", { path: `subjects.${index}.${field}` });
  }
  const allowedChoices = new Set(document.modules.flatMap(module => fields.map(field => `${module.ref}:${field}`)));
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
      const file = typeof supplied === "string" && field !== "importance" ? supplied.trim() : supplied;
      const original = base[field]; const now = target[field];
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
  const evidence = { organizationId, document, resolutions, current, names: names.rows };
  return { changes, conflicts, token: createHash("sha256").update(stable(evidence)).digest("hex") };
}

export async function previewModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure preview");
  const client = await pool.connect();
  try { await client.query("begin isolation level repeatable read read only"); const plan = await planModuleStructure(client, organizationId, raw); await client.query("commit"); return plan; }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
