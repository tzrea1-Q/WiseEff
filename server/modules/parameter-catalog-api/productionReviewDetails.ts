import type pg from "pg";
import { DriverCompatible, NormalizedNodeTypeName, type CatalogSnapshot, type CatalogSubjectSnapshot } from "../catalog-kernel/interface";
import { CatalogSubjectId, type CatalogReleasePin } from "../parameter-catalog-contract";
import { loadReviewObservationSource } from "../parameter-governance/queries/reviewObservationSource";
import { parseStoredEvidence } from "../parameter-governance/review/query";
import type { ReviewQueueItem } from "../parameter-governance/review/types";
import { reviewEvidenceSourceIsOwned } from "../parameter-governance/resolveReviewItem/unitOfWork";
import type { ReviewItemDetails } from "./governance/types";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";

const token = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type EvidenceRow = { id: string; observationId: string | null; evidence: unknown };

/** Presentation reads only: a grouping identity and safe digest are never subject IDs or source locators. */
export async function readReviewItemDetails(
  client: pg.PoolClient,
  input: { organizationId: string; pin: CatalogReleasePin; items: readonly ReviewQueueItem[] },
  catalog: CatalogSnapshot,
): Promise<ReadonlyMap<string, ReviewItemDetails>> {
  catalog = await loadOrganizationCatalogSnapshot(client, input.organizationId, catalog);
  const evidenceIds = [...new Set(input.items.flatMap((item) => item.evidenceRefs.map((ref) => ref.id)))];
  const evidence = evidenceIds.length ? (await client.query<EvidenceRow>(
    `select id, observation_id as "observationId", evidence
       from parameter_catalog.parameter_review_evidence
      where organization_id = $1 and id = any($2::text[])`, [input.organizationId, evidenceIds],
  )).rows : [];
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const result = new Map<string, ReviewItemDetails>();
  for (const item of input.items) {
    const candidates = new Map<string, ReviewItemDetails["candidates"][number]>();
    const sources = new Map<string, NonNullable<ReviewItemDetails["sourceSummary"]>>();
    let observation: ReviewItemDetails["observation"];
    let summary: ReviewItemDetails["sourceSummary"];
    let allOwned = item.organizationId === input.organizationId && item.catalogReleaseId === input.pin.id
      && catalog.release.id === input.pin.id && catalog.release.digest === input.pin.digest
      && item.evidenceRefs.length > 0;
    for (const ref of item.evidenceRefs) {
      const row = byId.get(ref.id);
      const body = parseStoredEvidence(row?.evidence);
      if (!row || !body || body.catalogReleaseId !== input.pin.id || body.matcherRevision !== item.matcherRevision) {
        allOwned = false;
        continue;
      }
      const source = row.observationId
        ? await loadReviewObservationSource(client, input.organizationId, row.observationId) : null;
      if ((row.observationId && (!source || source.catalogReleaseId !== body.catalogReleaseId
        || source.matcherRevision !== body.matcherRevision))
        || !await reviewEvidenceSourceIsOwned(client, input.organizationId, body.payload, source?.references)) {
        allOwned = false;
        continue;
      }
      const references: Record<string, unknown> = { ...record(body.payload.sourceRevision), ...record(body.payload.sourceProof),
        ...body.payload, ...source?.references };
      const propertyKey = [references.propertyName, references.propertyKey, references.property].find(token);
      const compatible = token(body.payload.compatible) ? body.payload.compatible : undefined;
      const nodeType = [body.payload.nodeType, body.payload.nodeTypeName].find(token);
      const facts = (await client.query<{ projectId: string; projectName: string; fileId: string | null;
        fileName: string | null; nodeLocator: string | null }>(
        `select project.id as "projectId", project.name as "projectName", file.id as "fileId",
           file.file_name as "fileName", logical.node_locator as "nodeLocator"
         from public.projects project
         left join public.project_parameter_files file
           on file.project_id = project.id and file.organization_id = project.organization_id and file.id = $3
         left join public.dts_logical_nodes node
           on node.project_id = project.id and node.organization_id = project.organization_id and node.id = $4
         left join public.dts_logical_node_revisions logical
           on logical.logical_node_id = node.id and logical.config_revision_id = $5
         where project.organization_id = $1 and (project.id = $2 or ($2::text is null and exists (
           select 1 from public.dts_config_revisions revision where revision.id = $5
             and revision.organization_id = project.organization_id and revision.project_id = project.id)))`,
        [input.organizationId, token(references.projectId) ? references.projectId : null,
          token(references.fileId) ? references.fileId : null,
          token(references.logicalNodeId) ? references.logicalNodeId : null,
          token(references.configRevisionId) ? references.configRevisionId : null],
      )).rows[0];
      const sourceSummary = { status: "available" as const, evidenceCount: 1,
          ...(row.observationId ? { observationId: row.observationId } : {}),
          ...(propertyKey ? { propertyKey } : {}), ...(compatible ? { compatible } : {}),
          ...(nodeType ? { nodeType } : {}),
          ...(token(references.configRevisionId) ? { configRevisionId: references.configRevisionId } : {}),
          ...(facts ? { projectId: facts.projectId, projectName: facts.projectName,
            ...(facts.fileId ? { fileId: facts.fileId } : {}), ...(facts.fileName ? { fileName: facts.fileName } : {}),
            ...(facts.nodeLocator ? { nodeLocator: facts.nodeLocator } : {}) } : {}),
        };
      const sourceKey = JSON.stringify(facts ? sourceSummary : { ...sourceSummary, evidenceId: row.id });
      const existing = sources.get(sourceKey);
      sources.set(sourceKey, { ...sourceSummary, evidenceCount: (existing?.evidenceCount ?? 0) + 1 });
      if (!summary) {
        summary = sourceSummary;
        if (propertyKey) observation = { id: row.observationId ?? row.id, propertyKey,
          sourceRef: { kind: row.observationId ? "observation" : "review-evidence", id: row.observationId ?? row.id } };
      }
      const matched = compatible || nodeType ? catalog.resolveSubject({ driverCompatibles: compatible ? [DriverCompatible(compatible)] : [],
        nodeTypeFallback: nodeType ? { kind: "present", name: NormalizedNodeTypeName(nodeType) } : { kind: "absent" } }) : null;
      const subjects: readonly CatalogSubjectSnapshot[] = matched?.status === "ambiguous" ? matched.candidates
        : matched?.status === "matched" || matched?.status === "retired" ? [matched.subject] : [];
      const referencedSubject = token(body.payload.subjectId) ? catalog.getSubject(CatalogSubjectId(body.payload.subjectId)) : null;
      for (const subject of [...subjects, ...(referencedSubject?.status === "found" ? [referencedSubject.subject] : [])]) {
        if (subject.membership.lifecycle !== "active") continue;
        const current = candidates.get(subject.id);
        candidates.set(subject.id, { subjectId: subject.id, canonicalName: subject.canonicalKey, kind: subject.kind,
          evidence: [...new Set([...(current?.evidence ?? []), ...(compatible ? [compatible] : []), ...(nodeType ? [nodeType] : [])])] });
      }
    }
    const registrations = allOwned && candidates.size ? (await client.query<{
      id: string; subjectId: string; placementDisplayName: string;
    }>(
      `select registration.id, registration.subject_id as "subjectId", coalesce(module.name, '未设置模块 (unset)') as "placementDisplayName"
       from parameter_catalog.organization_subject_registrations registration
       join parameter_catalog.subject_placements placement
         on placement.id = registration.current_placement_id and placement.registration_id = registration.id
         and placement.organization_id = registration.organization_id
       left join public.parameter_modules module on module.id = placement.module_id
         and module.organization_id = placement.organization_id
       where registration.organization_id = $1 and registration.subject_id = any($2::text[]) and registration.status = 'retired'`,
      [input.organizationId, [...candidates.keys()]],
    )).rows : [];
    result.set(item.id, {
      ...(allOwned && observation ? { observation } : {}),
      sourceSummary: { ...(allOwned ? summary : undefined), status: allOwned ? "available" : "unavailable", evidenceCount: item.evidenceCount },
      sources: allOwned ? [...sources.values()] : [],
      candidates: allOwned ? [...candidates.values()] : [],
      restorableRegistrations: registrations.map((registration) => ({ ...registration,
        canonicalName: candidates.get(registration.subjectId)!.canonicalName! })),
      allowedResolutions: allOwned ? item.allowedResolutions.filter((resolution) =>
        resolution !== "register-subject" || candidates.size > 0).filter((resolution) =>
        resolution !== "restore-registration" || registrations.length > 0) : [],
    });
  }
  return result;
}

/** Keep display facts within one organization-scoped read snapshot. Writes retain their own locked checks. */
export async function readReviewItemDetailsFromPool(
  pool: pg.Pool, input: Parameters<typeof readReviewItemDetails>[1], catalog: CatalogSnapshot,
) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const result = await readReviewItemDetails(client, input, catalog);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
