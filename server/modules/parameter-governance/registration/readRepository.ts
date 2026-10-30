import type pg from "pg";
import { moduleKindForSubject } from "./repositories";

export async function readPlacementHintEvidence(pool: Pick<pg.Client, "query">, organizationId: string) {
  const [modules, registrations] = await Promise.all([
    pool.query<{ id: string; name: string; parentId: string | null; kind: string }>(
      `select id, name, parent_id as "parentId", kind from public.parameter_modules where organization_id = $1`, [organizationId]),
    pool.query<{ subjectId: string; moduleId: string }>(
      `select registration.subject_id as "subjectId", placement.module_id as "moduleId"
       from parameter_catalog.organization_subject_registrations registration
       join parameter_catalog.subject_placements placement on placement.id = registration.current_placement_id
       where registration.organization_id = $1`, [organizationId]),
  ]);
  return { modules: modules.rows, registrations: registrations.rows };
}

export function modulePath(id: string, modules: readonly { id: string; name: string; parentId: string | null }[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const module = modules.find((item) => item.id === current);
    if (!module) break;
    parts.unshift(module.name);
    current = module.parentId;
  }
  return parts.join(" / ");
}

export async function listUnregisteredSubjects(pool: pg.Pool, organizationId: string, releaseId: string, source: "organization" | "all") {
  const [subjects, modules] = await Promise.all([
    pool.query<{ id: string; canonicalName: string; kind: "driver" | "node-type" | "configuration-schema" }>(
      `select subject.id, subject.canonical_key as "canonicalName", subject.kind
       from parameter_catalog.catalog_release_subjects membership
       join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
       where membership.release_id = $1 and membership.lifecycle = 'active'
         and not exists (select 1 from parameter_catalog.organization_subject_registrations registration
                         where registration.organization_id = $2 and registration.subject_id = subject.id)
         and ($3 = 'all' or exists (
           select 1 from parameter_catalog.catalog_activation_receipts receipt
           join catalog_publication.candidates candidate on candidate.id = receipt.candidate_id
           where receipt.release_id = subject.introduced_release_id
             and candidate.identity_allocation->>'authorOrganizationId' = $2
         ))
       order by subject.canonical_key, subject.id`, [releaseId, organizationId, source]),
    pool.query<{ id: string; name: string; parentId: string | null; kind: string; occupied: boolean }>(
      `select module.id, module.name, module.parent_id as "parentId", module.kind,
         exists (select 1 from parameter_catalog.subject_placements placement
                 where placement.organization_id = module.organization_id and placement.module_id = module.id) as occupied
       from public.parameter_modules module where module.organization_id = $1 order by module.path, module.id`, [organizationId]),
  ]);
  return { catalogReleaseId: releaseId, items: subjects.rows.map((subject) => ({ ...subject,
    availableModuleIds: modules.rows.filter((module) => !module.occupied && module.kind === moduleKindForSubject(subject.kind)).map((module) => module.id),
  })), modules: modules.rows };
}
