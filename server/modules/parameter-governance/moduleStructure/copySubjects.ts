import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import { ApiError } from "../../../shared/http/errors";
import type { Queryable } from "../../../shared/database/client";
import { moduleStructureExportSchema, moduleStructurePreviewRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { listOwnedCatalogSubjects } from "../../catalog-kernel/ownerSchema";
import { CatalogReleaseId, CatalogSubjectId } from "../../parameter-catalog-contract";
import { insertPlacement, insertRegistration } from "../registration/repositories";
import { readInheritedRegistrationRecognitionSettings, readRegistrationRecognitionSettings, registrationRecognitionEtag, validateRecognitionCapacity, validateRegistrationRecognitionSettings } from "../../parameter-modules/recognitionSettings";
import { listModuleRecognitionInstances } from "../../parameter-modules/recognitionInstances";
import { stable } from "./preview";
import type { SubjectChange } from "./subjects";
import type { LifecycleChange } from "./lifecycle";
import type { planRecognition } from "./recognition";

type Subject = z.infer<typeof moduleStructureExportSchema>["subjects"][number];
type Input = z.infer<typeof moduleStructurePreviewRequestSchema>;

export async function planCopySubjects(client: pg.PoolClient, organizationId: string, input: Input, current: Subject[], moduleIds: Map<string, string>, releaseId: string) {
  const parsed = moduleStructureExportSchema.shape.subjects.safeParse(input.document.subjects);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Copy requires complete Subject snapshots.", { path: "subjects", issues: parsed.error.issues });
  const subjects = parsed.data;
  const seen = new Set<string>();
  const existing = new Map(current.map(subject => [subject.subjectId, subject]));
  const creates: Subject[] = [];
  const placements: SubjectChange[] = [];
  const lifecycle: LifecycleChange[] = [];
  const recognitionChanges: Awaited<ReturnType<typeof planRecognition>>["changes"] = [];
  const changes: { moduleId: string; field: string; before: unknown; after: unknown }[] = [];
  const conflicts: { key: string; moduleId: string; field: string; baseline: unknown; file: unknown; current: unknown }[] = [];
  const evidence: unknown[] = [];
  const recognitionProjects = new Map<string, Set<string>>();
  const db = client as unknown as Queryable;
  for (const [index, subject] of subjects.entries()) {
    if (seen.has(subject.subjectId)) throw new ApiError("VALIDATION_FAILED", "Duplicate Subject.", { path: `subjects.${index}.subjectId` });
    seen.add(subject.subjectId);
    const catalog = (await client.query<{ kind: Subject["kind"]; owner_subject_id: string | null; lifecycle: string }>(
      `select s.kind,s.owner_subject_id,rs.lifecycle from parameter_catalog.catalog_subjects s
       join parameter_catalog.catalog_release_subjects rs on rs.subject_id=s.id and rs.release_id=$2 where s.id=$1`, [subject.subjectId, releaseId])).rows[0];
    if (!catalog || catalog.lifecycle !== "active" || catalog.kind !== subject.kind || catalog.owner_subject_id !== subject.ownerSubjectId)
      throw new ApiError("CONFLICT", "Catalog Subject is unavailable or ownership is incompatible.", { path: `subjects.${index}.subjectId` });
    if (subject.cascadeRetired && (subject.state !== "retired" || !subject.ownerSubjectId))
      throw new ApiError("CONFLICT", "Invalid cascade-retirement snapshot.", { path: `subjects.${index}.cascadeRetired` });
    if (subject.ownerSubjectId ? subject.placement !== null || subject.displayAlias !== null : !subject.placement || subject.placement.kind === "reference")
      throw new ApiError("CONFLICT", "Subject placement is incompatible with its ownership.", { path: `subjects.${index}.placement` });
    if (subject.displayAlias !== null && (!subject.displayAlias.trim() || subject.displayAlias !== subject.displayAlias.trim() || [...subject.displayAlias].length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(subject.displayAlias)))
      throw new ApiError("VALIDATION_FAILED", "Invalid display alias.", { path: `subjects.${index}.displayAlias` });
    const rule = subject.recognition;
    if (subject.kind === "configuration-schema" ? rule !== null : !rule ||
      (rule.mode === "inherit" ? rule.override !== null : !rule.override || (subject.kind === "driver"
        ? rule.override.nodeTypeName !== null || rule.override.driverNature === null || rule.override.instanceCardinality === null
        : rule.override.nodeTypeName === null || rule.override.compatibles.length !== 0 || rule.override.driverNature !== null || rule.override.instanceCardinality !== null)))
      throw new ApiError("VALIDATION_FAILED", "Recognition settings do not match the Subject kind.", { path: `subjects.${index}.recognition` });
    if (subject.placement?.kind === "module" && !moduleIds.has(subject.placement.moduleRef)) throw new ApiError("CONFLICT", "Placement destination is unavailable.");
    if (subject.placement?.kind === "unclassified" && !(await client.query(`select 1 from parameter_modules
      where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null`, [organizationId])).rowCount)
      throw new ApiError("CONFLICT", "Unclassified destination is unavailable.");
    const target = existing.get(subject.subjectId);
    if (target) {
      for (const field of ["state", "cascadeRetired", "placement", "displayAlias", "recognition"] as const) {
        const file = field === "placement" && subject.placement?.kind === "module"
          ? { kind: "module", moduleRef: moduleIds.get(subject.placement.moduleRef)! } : subject[field];
        if (field === "recognition" && stable(subject.recognition && { mode: subject.recognition.mode, override: subject.recognition.override }) ===
          stable(target.recognition && { mode: target.recognition.mode, override: target.recognition.override })) continue;
        if (stable(file) === stable(target[field])) continue;
        const key = `subject:${subject.subjectId}:${field}`;
        const choice = input.resolutions[key];
        if (!choice) { conflicts.push({ key, moduleId: `subject:${subject.subjectId}`, field, baseline: null, file, current: target[field] }); continue; }
        if (choice === "current") continue;
        if (field === "cascadeRetired" || (subject.ownerSubjectId && field === "state")) continue;
        if (subject.ownerSubjectId && (field === "placement" || field === "displayAlias"))
          throw new ApiError("CONFLICT", "Owned Subject placement and alias cannot be changed independently.");
        if (field === "state") {
          const row = (await client.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, subject.subjectId])).rows[0]!;
          lifecycle.push({ subjectId: subject.subjectId, operation: subject.state === "active" ? "restore" : "retire", registrationId: row.id, kind: subject.kind });
        } else if (field === "placement" || field === "displayAlias") {
          placements.push({ subjectId: subject.subjectId, field, before: target[field], after: subject[field] } as SubjectChange);
        } else if (field === "recognition") {
          if (!subject.recognition || subject.kind === "configuration-schema") throw new ApiError("CONFLICT", "Recognition is incompatible.");
          const row = (await client.query<{ id: string }>("select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [organizationId, subject.subjectId])).rows[0]!;
          const settings = await readRegistrationRecognitionSettings(db, organizationId, row.id);
          if (!settings) throw new ApiError("CONFLICT", "Subject registration no longer exists.");
          const override = subject.recognition.override;
          const body = subject.kind === "driver" ? { compatibles: override?.compatibles, driverNature: override?.driverNature ?? undefined,
            instanceCardinality: override?.instanceCardinality ?? undefined } : { nodeTypeName: override?.nodeTypeName ?? undefined };
          if (subject.recognition.mode === "override" && !override) throw new ApiError("VALIDATION_FAILED", "Recognition override is required.");
          const next = subject.recognition.mode === "inherit" ? await readInheritedRegistrationRecognitionSettings(db, settings, releaseId)
            : await validateRegistrationRecognitionSettings(db, organizationId, settings, body);
          if (subject.recognition.mode === "inherit") await validateRecognitionCapacity(db, organizationId, next);
          const instances = await listModuleRecognitionInstances(db, organizationId, next);
          instances.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.logicalNodeId.localeCompare(b.logicalNodeId));
          recognitionProjects.set(subject.subjectId, new Set(instances.map(instance => instance.projectId)));
          const bindings = (await client.query(`select project_id,coalesce(logical_node_id,source_occurrence_id) as instance_id from parameter_catalog.current_project_parameter_bindings
            where organization_id=$1 and subject_id=$2 order by 1,2`, [organizationId, subject.subjectId])).rows;
          evidence.push({ subjectId: subject.subjectId, instances, bindings, next });
          recognitionChanges.push({ subjectId: subject.subjectId, registrationId: row.id, ifMatch: registrationRecognitionEtag(settings), mode: subject.recognition.mode, body, before: target.recognition, after: next });
        }
        if (field !== "recognition") changes.push({ moduleId: `subject:${subject.subjectId}`, field, before: target[field], after: file });
      }
      continue;
    }
    let previewRecognition = subject.recognition;
    if (subject.kind !== "configuration-schema") {
      if (!subject.recognition) throw new ApiError("VALIDATION_FAILED", "Recognition settings are required.");
      const initial = { kind: subject.kind, recognitionSubjectId: subject.subjectId, compatibles: [] as string[], nodeTypeName: null,
        driverNature: null, instanceCardinality: null, overridden: false };
      const inherited = await readInheritedRegistrationRecognitionSettings(db, initial, releaseId);
      const rule = subject.recognition;
      const body = subject.kind === "driver" ? { compatibles: rule.override?.compatibles, driverNature: rule.override?.driverNature ?? undefined,
        instanceCardinality: rule.override?.instanceCardinality ?? undefined } : { nodeTypeName: rule.override?.nodeTypeName ?? undefined };
      if (rule.mode === "override" && !rule.override) throw new ApiError("VALIDATION_FAILED", "Recognition override is required.");
      const next = rule.mode === "inherit" ? inherited : await validateRegistrationRecognitionSettings(db, organizationId, inherited, body);
      if (rule.mode === "inherit") await validateRecognitionCapacity(db, organizationId, next);
      previewRecognition = { mode: rule.mode, override: rule.override, effective: { compatibles: next.compatibles,
        nodeTypeName: next.nodeTypeName, driverNature: next.driverNature, instanceCardinality: next.instanceCardinality } };
      const instances = await listModuleRecognitionInstances(db, organizationId, next);
      instances.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.logicalNodeId.localeCompare(b.logicalNodeId));
      recognitionProjects.set(subject.subjectId, new Set(instances.map(instance => instance.projectId)));
      const bindings = (await client.query(`select project_id,coalesce(logical_node_id,source_occurrence_id) as instance_id from parameter_catalog.current_project_parameter_bindings
        where organization_id=$1 and subject_id=$2 order by 1,2`, [organizationId, subject.subjectId])).rows;
      evidence.push({ subjectId: subject.subjectId, instances, bindings, next });
    } else if (subject.recognition !== null) throw new ApiError("VALIDATION_FAILED", "Recognition does not apply to this Subject.");
    creates.push(subject);
    changes.push({ moduleId: `subject:${subject.subjectId}`, field: "state", before: null, after: subject.state });
    changes.push({ moduleId: `subject:${subject.subjectId}`, field: "cascadeRetired", before: null, after: subject.cascadeRetired });
    if (!subject.ownerSubjectId) {
      changes.push({ moduleId: `subject:${subject.subjectId}`, field: "placement", before: null, after: subject.placement });
      changes.push({ moduleId: `subject:${subject.subjectId}`, field: "displayAlias", before: null, after: subject.displayAlias });
    }
    if (previewRecognition) changes.push({ moduleId: `subject:${subject.subjectId}`, field: "recognition", before: null, after: previewRecognition });
  }
  const byId = new Map(subjects.map(subject => [subject.subjectId, subject]));
  for (const subject of subjects) {
    if (subject.ownerSubjectId) {
      const owner = byId.get(subject.ownerSubjectId);
      const ownerTarget = existing.get(subject.ownerSubjectId);
      const ownerState = ownerTarget && input.resolutions[`subject:${subject.ownerSubjectId}:state`] === "current" ? ownerTarget.state : owner?.state;
      const target = existing.get(subject.subjectId);
      const cascade = target && input.resolutions[`subject:${subject.subjectId}:cascadeRetired`] !== "file" ? target.cascadeRetired : subject.cascadeRetired;
      if (!owner || (ownerState === "active" && cascade))
        throw new ApiError("CONFLICT", "Owned Subject lifecycle is incompatible with its root.");
      const action = lifecycle.find(change => change.subjectId === subject.ownerSubjectId)?.operation;
      if (!target && ((action === "retire" && subject.state === "active") || (action === "restore" && subject.cascadeRetired)))
        throw new ApiError("CONFLICT", "The selected root lifecycle cannot preserve the new owned-Subject snapshot.");
      if (target) {
        const predicted = action === "retire" && target.state === "active" ? { state: "retired", cascadeRetired: true }
          : action === "restore" && target.state === "retired" && target.cascadeRetired ? { state: "active", cascadeRetired: false }
            : { state: target.state, cascadeRetired: target.cascadeRetired };
        for (const field of ["state", "cascadeRetired"] as const) {
          const choice = input.resolutions[`subject:${subject.subjectId}:${field}`];
          const expected = choice === "file" ? subject[field] : target[field];
          if (predicted[field] !== expected && (choice || stable(subject[field]) === stable(target[field])))
            throw new ApiError("CONFLICT", "The selected root lifecycle does not produce the confirmed owned-Subject snapshot.");
        }
      }
    } else if (subject.kind === "driver") {
      const children = await listOwnedCatalogSubjects(client, CatalogSubjectId(subject.subjectId), CatalogReleaseId(releaseId));
      if (children.some(id => !byId.has(id))) throw new ApiError("CONFLICT", "The retained owned-Subject snapshot is incomplete.");
    }
  }
  const impactedIds = [...new Set([...changes, ...conflicts].map(change => change.moduleId.slice("subject:".length)).concat(recognitionChanges.map(change => change.subjectId)))];
  const impact = impactedIds.length ? (await client.query<{ subjectId: string; projectId: string; bindingCount: number; definitions: string[]; bindingVersions: string[] }>(`select owner.subject_id as "subjectId", b.project_id as "projectId", count(*)::int as "bindingCount",
    array_agg(distinct b.definition_id order by b.definition_id) as definitions,
    array_agg(b.id || ':' || b.effective_revision_id || ':' || b.updated_at::text order by b.id) as "bindingVersions"
    from parameter_catalog.organization_subject_registrations owner
    join parameter_catalog.catalog_subjects s on s.id=owner.subject_id or s.owner_subject_id=owner.subject_id
    join parameter_catalog.project_parameter_bindings b on b.organization_id=owner.organization_id and b.subject_id=s.id
    where owner.organization_id=$1 and owner.subject_id=any($2::text[]) group by 1,2 order by 1,2`, [organizationId, impactedIds])).rows : [];
  evidence.push({ impact });
  const publicImpact = impact.map(({ bindingVersions: _versions, ...item }) => item);
  for (const [subjectId, projects] of recognitionProjects) for (const projectId of projects) {
    if (!publicImpact.some(item => item.subjectId === subjectId && item.projectId === projectId))
      publicImpact.push({ subjectId, projectId, bindingCount: 0, definitions: [] });
  }
  return { creates, changes, conflicts, evidence, placements, lifecycle, recognitionChanges,
    impact: publicImpact };
}

export async function applyCopySubjects(client: pg.PoolClient, organizationId: string, creates: Subject[], moduleIds: Map<string, string>, reason: string) {
  const recognitionChanges: Awaited<ReturnType<typeof planRecognition>>["changes"] = [];
  for (const subject of [...creates].sort((a, b) => Number(!!a.ownerSubjectId) - Number(!!b.ownerSubjectId))) {
    let moduleId: string | null = null;
    if (subject.placement?.kind === "module") moduleId = moduleIds.get(subject.placement.moduleRef) ?? null;
    if (subject.placement?.kind === "unclassified") moduleId = (await client.query<{ id: string }>(
      `select id from parameter_modules where organization_id=$1 and kind='unclassified' and parent_id is null and archived_at is null`, [organizationId])).rows[0]?.id ?? null;
    if (subject.placement && subject.placement.kind !== "unset" && !moduleId) throw new ApiError("CONFLICT", "Placement destination is unavailable.");
    const id = `sreg_${randomUUID()}`, placementId = `spla_${randomUUID()}`;
    await insertRegistration(client, { id, organizationId, subjectId: subject.subjectId, method: "explicit", proof: { reason }, placementId,
      status: subject.state, cascadeRetired: subject.cascadeRetired, ...(subject.displayAlias ? { displayAlias: subject.displayAlias } : {}) });
    await insertPlacement(client, { id: placementId, registrationId: id, organizationId, moduleId, origin: "curated" });
    if (subject.recognition?.mode === "override" && subject.recognition.override && subject.kind !== "configuration-schema") {
      const current = await readRegistrationRecognitionSettings(client as unknown as Queryable, organizationId, id);
      if (!current) throw new ApiError("CONFLICT", "Subject recognition is unavailable.");
      const override = subject.recognition.override;
      const body = subject.kind === "driver" ? { compatibles: override.compatibles, driverNature: override.driverNature ?? undefined,
        instanceCardinality: override.instanceCardinality ?? undefined } : { nodeTypeName: override.nodeTypeName ?? undefined };
      recognitionChanges.push({ subjectId: subject.subjectId, registrationId: id, ifMatch: registrationRecognitionEtag(current), mode: "override", body, before: null, after: subject.recognition });
    }
  }
  return recognitionChanges;
}
