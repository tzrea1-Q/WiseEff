import type pg from "pg";

export async function readPlacementHintEvidence(pool: Pick<pg.Client, "query">, organizationId: string) {
  const [modules, registrations] = await Promise.all([
    pool.query<{ id: string; name: string; parentId: string | null; kind: string }>(
      `select id, name, parent_id as "parentId", kind from public.parameter_modules where organization_id = $1 and archived_at is null`, [organizationId]),
    pool.query<{ subjectId: string; moduleId: string }>(
      `select subject_id as "subjectId", module_id as "moduleId"
       from parameter_catalog.registration_effective_module where organization_id = $1`, [organizationId]),
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
    pool.query<{ id: string; canonicalName: string; kind: "driver" | "node-type" | "configuration-schema"; childCount: number }>(
      `select subject.id, subject.canonical_key as "canonicalName", subject.kind,
         (select count(*)::int from parameter_catalog.catalog_subjects child
          join parameter_catalog.catalog_release_subjects child_membership on child_membership.subject_id=child.id
          left join parameter_catalog.organization_subject_registrations child_registration
            on child_registration.subject_id=child.id and child_registration.organization_id=$2
          where coalesce(child_registration.owner_subject_id,child.owner_subject_id)=subject.id
            and child_membership.release_id=$1 and child_membership.lifecycle='active') as "childCount"
       from parameter_catalog.catalog_release_subjects membership
       join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
       where membership.release_id = $1 and membership.lifecycle = 'active'
         and subject.owner_subject_id is null
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
         exists (select 1 from parameter_catalog.registration_effective_module placement
                 where placement.organization_id = module.organization_id and placement.module_id = module.id) as occupied
       from public.parameter_modules module where module.organization_id = $1 and module.archived_at is null order by module.path, module.id`, [organizationId]),
  ]);
  return { catalogReleaseId: releaseId, items: subjects.rows.map((subject) => ({ ...subject,
    availableModuleIds: modules.rows.filter((module) => module.kind === "business" || (module.kind === "unclassified" && module.parentId === null)).map((module) => module.id),
  })), modules: modules.rows };
}
