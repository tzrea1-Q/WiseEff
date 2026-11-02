import type { Queryable } from "../../../shared/database/client";
import { CURRENT_POINTER_LOCK_KEY } from "../../catalog-kernel/install/lockProtocol";

export async function lockCurrentRecognitionRelease(db: Queryable): Promise<string | null> {
  await db.query("select pg_catalog.pg_advisory_xact_lock_shared($1::bigint)", [CURRENT_POINTER_LOCK_KEY]);
  const result = await db.query<{ id: string }>(
    "select current_catalog_release_id as id from parameter_catalog.catalog_state",
  );
  return result.rows[0]?.id ?? null;
}

export type ModuleRecognitionPlacementFact = {
  registration_id: string;
  subject_id: string;
  module_id: string | null;
};

export async function readRegistrationRecognitionSubject(db: Queryable, organizationId: string, registrationId: string) {
  const result = await db.query<{ subject_id: string; kind: string }>(
    `select registration.subject_id, subject.kind
       from parameter_catalog.organization_subject_registrations registration
       join parameter_catalog.catalog_subjects subject on subject.id = registration.subject_id
      where registration.organization_id = $1 and registration.id = $2`, [organizationId, registrationId],
  );
  return result.rows[0] ?? null;
}

export async function readRecognitionIdempotency(db: Queryable, organizationId: string, key: string) {
  const result = await db.query<{ request_fingerprint: string; state: string; result_ref: string | null }>(
    `select request_fingerprint, state, result_ref from parameter_catalog.governance_command_idempotency
     where organization_id = $1 and command_family = 'registration-recognition' and idempotency_key = $2 for update`,
    [organizationId, key],
  );
  return result.rows[0] ?? null;
}

export async function writeRecognitionIdempotency(db: Queryable, organizationId: string, key: string, fingerprint: string, result: string) {
  await db.query(`insert into parameter_catalog.governance_command_idempotency
    (organization_id, command_family, idempotency_key, request_fingerprint, state, result_kind, result_ref, committed_at)
    values ($1,'registration-recognition',$2,$3,'committed','recognition',$4,now())`, [organizationId, key, fingerprint, result]);
}

/** Current retained placement ownership, including retired and unset registrations. */
export async function listModuleRecognitionPlacements(db: Queryable, organizationId: string): Promise<ModuleRecognitionPlacementFact[]> {
  const result = await db.query<ModuleRecognitionPlacementFact>(
    `select registration_id, subject_id, module_id
     from parameter_catalog.registration_effective_module
     where organization_id = $1`, [organizationId],
  );
  return result.rows;
}

export type ModuleRecognitionSubjectDefault = {
  subject_id: string;
  selector_snapshot: { kind: string; values?: string[]; value?: string };
  nature: "physical-device" | "logical-service" | null;
  cardinality: "multiple" | "singleton-per-project" | null;
  aliases: string[];
};

/** Published selectors and driver attributes for a captured release, or the current release when absent. */
export async function readModuleRecognitionSubjectDefaults(
  db: Queryable, subjectIds: readonly string[], releaseId: string | null,
): Promise<ModuleRecognitionSubjectDefault[]> {
  if (subjectIds.length === 0) return [];
  const result = await db.query<ModuleRecognitionSubjectDefault>(
    `select membership.subject_id, membership.selector_snapshot, driver.nature, driver.cardinality,
       coalesce((select array_agg(alias.normalized_selector order by alias.normalized_selector)
         from parameter_catalog.catalog_release_subject_aliases alias_membership
         join parameter_catalog.catalog_subject_aliases alias on alias.id = alias_membership.alias_id
         where alias_membership.release_id = membership.release_id and alias.subject_id = membership.subject_id
           and alias_membership.lifecycle = 'active'), '{}') as aliases
     from parameter_catalog.catalog_release_subjects membership
     left join parameter_catalog.catalog_drivers driver on driver.subject_id = membership.subject_id
     where membership.subject_id = any($1::text[]) and membership.release_id = coalesce($2::text,
       (select current_catalog_release_id from parameter_catalog.catalog_state))`, [subjectIds, releaseId],
  );
  return result.rows;
}

export async function hasMultipleCurrentModuleSubjectInstances(
  db: Queryable, organizationId: string, subjectId: string | null,
): Promise<boolean> {
  if (!subjectId) return false;
  const result = await db.query<{ project_id: string }>(
    `select project_id from parameter_catalog.current_project_parameter_bindings
     where organization_id = $1 and subject_id = $2 group by project_id
     having count(distinct coalesce(logical_node_id, source_occurrence_id)) > 1 limit 1`,
    [organizationId, subjectId],
  );
  return result.rows.length > 0;
}
