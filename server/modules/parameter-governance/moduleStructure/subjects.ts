import type pg from "pg";
import type { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import { moduleStructureExportSchema, moduleStructureUpdateDocumentSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { updatePlacementModule } from "../registration/repositories";

type Subject = z.infer<typeof moduleStructureExportSchema>["subjects"][number];
type SubjectEdit = z.infer<typeof moduleStructureUpdateDocumentSchema>["subjects"][number];
type Placement = NonNullable<Subject["placement"]>;
type Field = "placement" | "displayAlias";
type Value = Placement | string | null;
export type SubjectChange = { subjectId: string; field: Field; before: Value; after: Value };
export type SubjectConflict = { key: string; subjectId: string; field: Field; baseline: Value; file: Value; current: Value };

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Plan only explicitly supplied root placement and alias edits. */
export function planSubjectPlacement(edits: SubjectEdit[], baseline: Subject[], current: Subject[], resolutions: Record<string, "current" | "file">) {
  const bases = new Map(baseline.map(subject => [subject.subjectId, subject]));
  const targets = new Map(current.map(subject => [subject.subjectId, subject]));
  const changes: SubjectChange[] = [];
  const conflicts: SubjectConflict[] = [];
  for (const [index, edit] of edits.entries()) {
    const base = bases.get(edit.subjectId);
    const target = targets.get(edit.subjectId);
    if (!base) throw new ApiError("VALIDATION_FAILED", "Unknown Subject.", { path: `subjects.${index}.subjectId` });
    for (const field of ["placement", "displayAlias"] as const) {
      const file = edit[field];
      if (file === undefined || equal(file, base[field])) continue;
      if (base.ownerSubjectId) throw new ApiError("VALIDATION_FAILED", "Owned children inherit their owner's placement and cannot edit a root alias.", { path: `subjects.${index}.${field}` });
      if (!target || target.ownerSubjectId !== base.ownerSubjectId || target.state !== base.state)
        throw new ApiError("CONFLICT", "Subject registration or ownership changed after export.", { path: `subjects.${index}` });
      if (field === "placement" && (!file || (typeof file === "object" && file.kind === "reference")))
        throw new ApiError("VALIDATION_FAILED", "Choose a business module, unclassified, or unset.", { path: `subjects.${index}.placement` });
      if (field === "displayAlias" && typeof file === "string" && (!file.trim() || file !== file.trim() || [...file].length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(file)))
        throw new ApiError("VALIDATION_FAILED", "Invalid display alias.", { path: `subjects.${index}.displayAlias` });
      const now = target[field];
      if (equal(file, now)) continue;
      const key = `subject:${edit.subjectId}:${field}`;
      if (!equal(now, base[field]) && !resolutions[key]) {
        conflicts.push({ key, subjectId: edit.subjectId, field, baseline: base[field], file, current: now });
      } else if (equal(now, base[field]) || resolutions[key] === "file") {
        changes.push({ subjectId: edit.subjectId, field, before: now, after: file });
      }
    }
  }
  return { changes, conflicts };
}

/** Caller holds the common governance locks and has validated the final module graph. */
export async function applySubjectPlacement(client: pg.PoolClient, organizationId: string, changes: SubjectChange[], moduleIds: Map<string, string>) {
  for (const change of changes) {
    const result = await client.query<{ id: string; placement_id: string; owner_subject_id: string | null }>(
      `select r.id,r.current_placement_id as placement_id,coalesce(r.owner_subject_id,s.owner_subject_id) as owner_subject_id
       from parameter_catalog.organization_subject_registrations r
       join parameter_catalog.catalog_subjects s on s.id=r.subject_id
       where r.organization_id=$1 and r.subject_id=$2 for update of r`, [organizationId, change.subjectId]);
    const row = result.rows[0];
    if (!row || row.owner_subject_id) throw new ApiError("CONFLICT", "Subject registration or ownership changed.");
    if (change.field === "displayAlias") {
      await client.query(`update parameter_catalog.organization_subject_registrations
        set display_alias=$3,updated_at=greatest(clock_timestamp(),updated_at + interval '1 microsecond')
        where organization_id=$1 and id=$2`, [organizationId, row.id, change.after]);
    } else {
      const placement = change.after as Placement;
      let moduleId: string | null = null;
      if (placement.kind === "module") moduleId = moduleIds.get(placement.moduleRef) ?? null;
      if (placement.kind === "unclassified") moduleId = (await client.query<{ id: string }>(
        `select id from parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null`, [organizationId])).rows[0]?.id ?? null;
      if (placement.kind === "reference" || (placement.kind !== "unset" && !moduleId)) throw new ApiError("CONFLICT", "Placement destination is unavailable.");
      if (moduleId) {
        const destination = await client.query(`select 1 from parameter_modules where organization_id=$1 and id=$2 and archived_at is null
          and (kind='business' or (kind='unclassified' and parent_id is null))`, [organizationId, moduleId]);
        if (!destination.rowCount) throw new ApiError("CONFLICT", "Placement destination is unavailable.");
      }
      await updatePlacementModule(client, row.placement_id, moduleId);
    }
  }
}
