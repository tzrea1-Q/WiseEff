import type { VerificationPlan } from "../../core/types";
import type { GateResult } from "../../core/types";
import { digestOf } from "../../core/digest";
import { asInt, asStringArray, countedResult, orderedChecksum } from "./evidence";
import {
  CATALOG_STRUCTURAL_RELATIONS,
  catalogRelation,
  definitionRelation,
  projectValueRelation,
  quoteIdent,
} from "./relations";
import type { GateQuery } from "./session";

type CountRow = {
  violation_count: string | number;
  offending_ids?: unknown;
  extra?: unknown;
};

const countSql = async (
  query: GateQuery,
  sql: string,
  values: unknown[] = [],
): Promise<{ violationCount: number; offendingIds: readonly string[]; extra: unknown }> => {
  const result = await query<CountRow>(sql, values);
  const row = result.rows[0];
  return {
    violationCount: asInt(row?.violation_count),
    offendingIds: asStringArray(row?.offending_ids),
    extra: row?.extra ?? null,
  };
};

const withChecksum = (
  gateId: string,
  failureCode: string,
  observation: { violationCount: number; offendingIds: readonly string[]; extra: unknown },
  extraEvidence: Record<string, unknown> = {},
): GateResult =>
  countedResult(gateId, failureCode, observation.violationCount, {
    extra: observation.extra,
    offendingChecksum: orderedChecksum(observation.offendingIds),
    offendingIds: observation.offendingIds,
    ...extraEvidence,
  });

export const runV01 = async (query: GateQuery, plan: VerificationPlan): Promise<GateResult> => {
  const definitions = catalogRelation(definitionRelation());
  const observation = await countSql(
    query,
    `
    with current_pointer as (
      select current_catalog_release_id as release_id
      from ${catalogRelation("catalog_state")}
    ),
    current_definitions as (
      select definition.id, definition.subject_id, definition.property_key
      from ${definitions} definition
      join ${catalogRelation("catalog_release_definition_heads")} head
        on head.definition_id = definition.id
      join current_pointer pointer
        on pointer.release_id = head.release_id
    ),
    duplicate_groups as (
      select subject_id, property_key, count(*)::int as group_size
      from current_definitions
      group by subject_id, property_key
      having count(*) > 1
    )
    select
      (select count(*)::int from duplicate_groups) as violation_count,
      coalesce((
        select json_agg(definition.id order by definition.id)
        from current_definitions definition
        where exists (
          select 1
          from duplicate_groups duplicate
          where duplicate.subject_id = definition.subject_id
            and duplicate.property_key = definition.property_key
        )
      ), '[]'::json) as offending_ids,
      json_build_object(
        'definitionCount', (select count(*)::int from current_definitions),
        'groupCount', (select count(*)::int from duplicate_groups),
        'releaseId', (select release_id from current_pointer)
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V01", "PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION", observation, {
    releasePin: plan.pins.catalog.releaseId,
  });
};

export const runV02 = async (query: GateQuery): Promise<GateResult> => {
  const definitions = catalogRelation(definitionRelation());
  const observation = await countSql(
    query,
    `
    with defs as (
      select id, current_revision_id
      from ${definitions}
    ),
    cardinality as (
      select
        definition.id,
        (
          select count(*)::int
          from ${catalogRelation("definition_revisions")} revision
          where revision.definition_id = definition.id
            and revision.id = definition.current_revision_id
        ) as current_matches
      from defs definition
    )
    select
      (select count(*)::int from cardinality where current_matches <> 1) as violation_count,
      coalesce((
        select json_agg(id order by id)
        from cardinality
        where current_matches <> 1
      ), '[]'::json) as offending_ids,
      json_build_object(
        'definitionCount', (select count(*)::int from defs),
        'revisionCount', (select count(*)::int from ${catalogRelation("definition_revisions")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V02", "PCAT-VRF-V02-CURRENT-REVISION-CARDINALITY", observation);
};

export const runV03 = async (query: GateQuery): Promise<GateResult> => {
  const definitions = catalogRelation(definitionRelation());
  const values = catalogRelation(projectValueRelation());
  const observation = await countSql(
    query,
    `
    with mismatches as (
      select placement.id, 'subject_placements'::text as relation
      from ${catalogRelation("subject_placements")} placement
      join ${catalogRelation("organization_subject_registrations")} registration
        on registration.id = placement.registration_id
      where placement.organization_id is distinct from registration.organization_id
      union all
      select binding.id, 'project_parameter_bindings'
      from ${catalogRelation("project_parameter_bindings")} binding
      join public.projects project on project.id = binding.project_id
      where binding.organization_id is distinct from project.organization_id
      union all
      select binding.id, 'project_parameter_bindings'
      from ${catalogRelation("project_parameter_bindings")} binding
      join ${catalogRelation("organization_subject_registrations")} registration
        on registration.id = binding.registration_id
      where binding.organization_id is distinct from registration.organization_id
         or binding.subject_id is distinct from registration.subject_id
      union all
      select value.id, 'project_parameter_values'
      from ${values} value
      join ${catalogRelation("project_parameter_bindings")} binding
        on binding.id = value.binding_id
      where value.definition_id is distinct from binding.definition_id
      union all
      select observation.id, 'parameter_observations'
      from ${catalogRelation("parameter_observations")} observation
      join public.projects project on project.id = observation.project_id
      where observation.organization_id is distinct from project.organization_id
      union all
      select match.id, 'parameter_observation_matches'
      from ${catalogRelation("parameter_observation_matches")} match
      join ${catalogRelation("parameter_observations")} observation
        on observation.id = match.observation_id
      where match.organization_id is distinct from observation.organization_id
      union all
      select archive.id, 'parameter_catalog_archives'
      from ${catalogRelation("parameter_catalog_archives")} archive
      join ${catalogRelation("legacy_identities")} identity
        on identity.id = archive.legacy_identity_id
      where archive.owner_scope_kind is distinct from identity.owner_scope_kind
         or archive.owner_scope_id is distinct from identity.owner_scope_id
      union all
      select definition.id, 'definitions'
      from ${definitions} definition
      join ${catalogRelation("catalog_subjects")} subject
        on subject.id = definition.subject_id
      where false
    )
    select
      (select count(*)::int from mismatches) as violation_count,
      coalesce((select json_agg(id order by id) from mismatches), '[]'::json) as offending_ids,
      coalesce((
        select json_object_agg(relation, relation_count)
        from (
          select relation, count(*)::int as relation_count
          from mismatches
          group by relation
        ) buckets
      ), '{}'::json) as extra
    `,
  );
  return withChecksum("PCAT-DB-V03", "PCAT-VRF-V03-OWNER-SCOPE-MISMATCH", observation);
};

export const runV04 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with current_pointer as (
      select current_catalog_release_id as release_id
      from ${catalogRelation("catalog_state")}
    ),
    active_membership as (
      select membership.subject_id
      from ${catalogRelation("catalog_release_subjects")} membership
      join current_pointer pointer on pointer.release_id = membership.release_id
      where membership.lifecycle = 'active'
    ),
    missing as (
      select registration.id, 'registration'::text as family
      from ${catalogRelation("organization_subject_registrations")} registration
      where not exists (
        select 1 from active_membership membership
        where membership.subject_id = registration.subject_id
      )
      union all
      select binding.id, 'binding'
      from ${catalogRelation("project_parameter_bindings")} binding
      where not exists (
        select 1 from active_membership membership
        where membership.subject_id = binding.subject_id
      )
      union all
      select match.id, 'observation-match'
      from ${catalogRelation("parameter_observation_matches")} match
      where not exists (
        select 1 from active_membership membership
        where membership.subject_id = match.subject_id
      )
    )
    select
      (select count(*)::int from missing) as violation_count,
      coalesce((select json_agg(id order by id) from missing), '[]'::json) as offending_ids,
      json_build_object(
        'subjectCount', (select count(*)::int from ${catalogRelation("catalog_subjects")}),
        'membershipCount', (select count(*)::int from active_membership),
        'registrationCount', (select count(*)::int from ${catalogRelation("organization_subject_registrations")}),
        'bindingCount', (select count(*)::int from ${catalogRelation("project_parameter_bindings")}),
        'matchCount', (select count(*)::int from ${catalogRelation("parameter_observation_matches")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V04", "PCAT-VRF-V04-SUBJECT-MEMBERSHIP-MISSING", observation);
};

export const runV05 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with registrations as (
      select *
      from ${catalogRelation("organization_subject_registrations")}
      where status in ('active', 'retired')
    ),
    placement_counts as (
      select registration_id, count(*)::int as retained
      from ${catalogRelation("subject_placements")}
      group by registration_id
    ),
    violations as (
      select registration.id
      from registrations registration
      left join ${catalogRelation("subject_placements")} placement
        on placement.id = registration.current_placement_id
       and placement.registration_id = registration.id
      left join placement_counts counts
        on counts.registration_id = registration.id
      left join public.parameter_modules module
        on module.id = placement.module_id
       and module.organization_id = placement.organization_id
      left join ${catalogRelation("catalog_subjects")} subject
        on subject.id = registration.subject_id
      where placement.id is null
         or coalesce(counts.retained, 0) <> 1
         or placement.organization_id is distinct from registration.organization_id
         or subject.id is null
         or (
           (subject.kind = 'driver' and module.kind is distinct from 'driver-group')
           or (subject.kind = 'node-type' and module.kind is distinct from 'node-type')
         )
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'activeCount', (select count(*)::int from registrations where status = 'active'),
        'retiredCount', (select count(*)::int from registrations where status = 'retired')
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V05", "PCAT-VRF-V05-PLACEMENT-CARDINALITY", observation);
};

export const runV06 = async (query: GateQuery): Promise<GateResult> => {
  const definitions = catalogRelation(definitionRelation());
  const observation = await countSql(
    query,
    `
    with violations as (
      select binding.id
      from ${catalogRelation("project_parameter_bindings")} binding
      left join ${catalogRelation("organization_subject_registrations")} registration
        on registration.id = binding.registration_id
       and registration.organization_id = binding.organization_id
       and registration.subject_id = binding.subject_id
      left join ${catalogRelation("catalog_subjects")} subject
        on subject.id = binding.subject_id
      left join ${definitions} definition
        on definition.id = binding.definition_id
       and definition.subject_id = binding.subject_id
      left join ${catalogRelation("catalog_release_definition_heads")} head
        on head.release_id = binding.catalog_release_id
       and head.definition_id = binding.definition_id
       and head.revision_id = binding.effective_revision_id
      left join public.projects project
        on project.id = binding.project_id
       and project.organization_id = binding.organization_id
      where registration.id is null
         or subject.id is null
         or definition.id is null
         or head.definition_id is null
         or project.id is null
         or btrim(binding.logical_node_id) = ''
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'bindingCount', (select count(*)::int from ${catalogRelation("project_parameter_bindings")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V06", "PCAT-VRF-V06-BINDING-DEFINITION-MISMATCH", observation);
};

export const runV07 = async (query: GateQuery): Promise<GateResult> => {
  const values = catalogRelation(projectValueRelation());
  const observation = await countSql(
    query,
    `
    with violations as (
      select value.id
      from ${values} value
      left join ${catalogRelation("project_parameter_bindings")} binding
        on binding.id = value.binding_id
      left join ${catalogRelation("definition_revisions")} revision
        on revision.id = value.definition_revision_id
       and revision.definition_id = value.definition_id
      where binding.id is null
         or binding.definition_id is distinct from value.definition_id
         or revision.id is null
      union
      select binding.id
      from ${catalogRelation("project_parameter_bindings")} binding
      left join ${values} current_value
        on current_value.id = binding.current_value_id
       and current_value.binding_id = binding.id
       and current_value.definition_id = binding.definition_id
      where current_value.id is null
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'valueCount', (select count(*)::int from ${values}),
        'bindingCount', (select count(*)::int from ${catalogRelation("project_parameter_bindings")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V07", "PCAT-VRF-V07-PROJECT-VALUE-REVISION-MISMATCH", observation);
};

export const runV08 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with unmapped as (
      select identity.id
      from ${catalogRelation("legacy_identities")} identity
      left join ${catalogRelation("legacy_mapping_heads")} head
        on head.legacy_identity_id = identity.id
      left join ${catalogRelation("legacy_mapping_versions")} version
        on version.id = head.current_version_id
       and version.legacy_identity_id = identity.id
      left join ${catalogRelation("parameter_catalog_classification_ledger")} blocked
        on blocked.legacy_identity_id = identity.id
       and blocked.disposition = 'blocked'
      where head.legacy_identity_id is null
         or (
           version.target_id is null
           and version.archive_id is null
           and blocked.legacy_identity_id is null
         )
    )
    select
      (select count(*)::int from unmapped) as violation_count,
      coalesce((select json_agg(id order by id) from unmapped), '[]'::json) as offending_ids,
      json_build_object(
        'identityCount', (select count(*)::int from ${catalogRelation("legacy_identities")}),
        'headCount', (select count(*)::int from ${catalogRelation("legacy_mapping_heads")}),
        'archiveCount', (select count(*)::int from ${catalogRelation("parameter_catalog_archives")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V08", "PCAT-VRF-V08-PROTECTED-ID-UNMAPPED", observation);
};

export const runV09 = async (query: GateQuery, plan: VerificationPlan): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with missing_ledger as (
      select identity.id
      from ${catalogRelation("legacy_identities")} identity
      where not exists (
        select 1
        from ${catalogRelation("parameter_catalog_classification_ledger")} ledger
        where ledger.legacy_identity_id = identity.id
      )
    ),
    missing_identity as (
      select ledger.legacy_identity_id as id
      from ${catalogRelation("parameter_catalog_classification_ledger")} ledger
      where not exists (
        select 1
        from ${catalogRelation("legacy_identities")} identity
        where identity.id = ledger.legacy_identity_id
      )
    ),
    duplicate_primary as (
      select legacy_identity_id as id
      from ${catalogRelation("parameter_catalog_classification_ledger")}
      group by cutover_run_id, legacy_identity_id
      having count(*) > 1
    ),
    violations as (
      select id from missing_ledger
      union
      select id from missing_identity
      union
      select id from duplicate_primary
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'identityCount', (select count(*)::int from ${catalogRelation("legacy_identities")}),
        'ledgerCount', (select count(*)::int from ${catalogRelation("parameter_catalog_classification_ledger")}),
        'missingLedger', (select count(*)::int from missing_ledger),
        'missingIdentity', (select count(*)::int from missing_identity)
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V09", "PCAT-VRF-V09-SOURCE-CONSERVATION", observation, {
    sourceSnapshotFingerprint: plan.pins.cutover.sourceSnapshotFingerprint,
  });
};

export const runV10 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with heads as (
      select
        version.legacy_identity_id,
        version.r_class,
        version.target_kind,
        version.target_id,
        version.archive_id,
        identity.source_id
      from ${catalogRelation("legacy_mapping_versions")} version
      join ${catalogRelation("legacy_mapping_heads")} head
        on head.legacy_identity_id = version.legacy_identity_id
       and head.current_version_id = version.id
      join ${catalogRelation("legacy_identities")} identity
        on identity.id = version.legacy_identity_id
      where version.r_class in ('R6', 'R8')
      union all
      select
        ledger.legacy_identity_id,
        ledger.r_class,
        version.target_kind,
        version.target_id,
        version.archive_id,
        identity.source_id
      from ${catalogRelation("parameter_catalog_classification_ledger")} ledger
      join ${catalogRelation("legacy_identities")} identity
        on identity.id = ledger.legacy_identity_id
      left join ${catalogRelation("legacy_mapping_versions")} version
        on version.id = ledger.mapping_version_id
      where ledger.r_class in ('R6', 'R8')
    ),
    violations as (
      select distinct heads.legacy_identity_id as id
      from heads
      where heads.target_kind in ('parameter-definition', 'definition-revision', 'catalog-subject')
         or (heads.target_id is not null and heads.target_id = heads.source_id)
      union
      select distinct left_head.legacy_identity_id as id
      from heads left_head
      join heads right_head
        on left_head.target_id is not null
       and left_head.target_id = right_head.target_id
       and left_head.target_kind is not distinct from right_head.target_kind
       and left_head.legacy_identity_id <> right_head.legacy_identity_id
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'cohortCount', (select count(*)::int from heads)
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V10", "PCAT-VRF-V10-R6-R8-IDENTITY-MERGE", observation);
};

export const runV11 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with violations as (
      select archive.id
      from ${catalogRelation("parameter_catalog_archives")} archive
      left join ${catalogRelation("legacy_identities")} identity
        on identity.id = archive.legacy_identity_id
      left join ${catalogRelation("parameter_catalog_cutover_runs")} cutover
        on cutover.id = archive.cutover_run_id
      left join ${catalogRelation("catalog_releases")} release
        on release.id = archive.catalog_release_id
      where identity.id is null
         or cutover.id is null
         or release.id is null
         or archive.encrypted_object_ref is null
         or btrim(archive.encrypted_object_ref) = ''
         or archive.source_checksum is null
         or btrim(archive.source_checksum) = ''
         or archive.graph_checksum is null
         or btrim(archive.graph_checksum) = ''
         or jsonb_typeof(archive.protected_references) is distinct from 'array'
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'archiveCount', (select count(*)::int from ${catalogRelation("parameter_catalog_archives")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V11", "PCAT-VRF-V11-ARCHIVE-INTEGRITY", observation);
};

export const runV12 = async (query: GateQuery, plan: VerificationPlan): Promise<GateResult> => {
  const row = await query<{
    release_id: string | null;
    release_digest: string | null;
    compiled_model_digest: string | null;
    compiled_fingerprint: string | null;
    database_fingerprint: string | null;
  }>(
    `
    select
      state.current_catalog_release_id as release_id,
      release.release_digest,
      release.compiled_model_digest,
      materialization.compiled_fingerprint,
      materialization.database_fingerprint
    from ${catalogRelation("catalog_state")} state
    left join ${catalogRelation("catalog_releases")} release
      on release.id = state.current_catalog_release_id
    left join ${catalogRelation("catalog_materializations")} materialization
      on materialization.release_id = release.id
    `,
  );
  const actual = row.rows[0] ?? {
    release_id: null,
    release_digest: null,
    compiled_model_digest: null,
    compiled_fingerprint: null,
    database_fingerprint: null,
  };
  const expected = plan.pins.catalog;
  const mismatches: string[] = [];
  if ((actual.release_id ?? "") !== expected.releaseId) {
    mismatches.push("releaseId");
  }
  if ((actual.release_digest ?? "") !== expected.releaseDigest) {
    mismatches.push("releaseDigest");
  }
  if ((actual.compiled_model_digest ?? "") !== expected.compiledModelDigest) {
    mismatches.push("compiledModelDigest");
  }
  if ((actual.compiled_fingerprint ?? "") !== expected.materializationFingerprint) {
    mismatches.push("materializationFingerprint");
  }
  return countedResult("PCAT-DB-V12", "PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT", mismatches.length, {
    actual: {
      compiledModelDigest: actual.compiled_model_digest,
      materializationFingerprint: actual.compiled_fingerprint,
      releaseDigest: actual.release_digest,
      releaseId: actual.release_id,
    },
    expected,
    mismatches,
  });
};

export const runV13 = async (query: GateQuery): Promise<GateResult> => {
  const publicLegacy = [
    definitionRelation(),
    "parameter_specs",
    "parameter_spec_versions",
    "project_parameter_bindings",
  ];
  const grants = await query<{
    grantee: string;
    table_name: string;
    privilege_type: string;
  }>(
    `
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any($1::text[])
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and grantee not in ('postgres', current_user)
    order by grantee, table_name, privilege_type
    `,
    [publicLegacy],
  );
  const definers = await query<{ proname: string }>(
    `
    select procedure.proname
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prosecdef
      and pg_catalog.pg_get_functiondef(procedure.oid) ~* '(insert|update|delete)'
      and (
        pg_catalog.pg_get_functiondef(procedure.oid) like '%public.parameter_specs%'
        or pg_catalog.pg_get_functiondef(procedure.oid) like '%public.parameter_spec_versions%'
        or pg_catalog.pg_get_functiondef(procedure.oid) like '%public.project_parameter_bindings%'
      )
      and pg_catalog.has_function_privilege('parameter_governance_writer_role', procedure.oid, 'execute')
    order by procedure.proname
    `,
  );
  const grantRows = grants.rows.filter(
    (row) =>
      row.grantee === "PUBLIC" ||
      row.grantee === "catalog_synchronizer_role" ||
      row.grantee === "parameter_governance_writer_role",
  );
  const violationCount = grantRows.length + definers.rows.length;
  return countedResult("PCAT-DB-V13", "PCAT-VRF-V13-LEGACY-WRITER-REACHABLE", violationCount, {
    definerCount: definers.rows.length,
    definers: definers.rows.map((row) => row.proname),
    grantCount: grantRows.length,
    grants: grantRows,
  });
};

export const runV14 = async (query: GateQuery): Promise<GateResult> => {
  const values = catalogRelation(projectValueRelation());
  const observation = await countSql(
    query,
    `
    with protected_bindings as (
      select binding.id
      from ${catalogRelation("project_parameter_bindings")} binding
      join ${catalogRelation("legacy_identities")} identity
        on identity.source_kind = 'project-parameter-binding'
       and identity.source_id = binding.id
      left join ${catalogRelation("legacy_mapping_heads")} head
        on head.legacy_identity_id = identity.id
      where head.legacy_identity_id is null
    ),
    protected_values as (
      select value.id
      from ${values} value
      join ${catalogRelation("legacy_identities")} identity
        on identity.source_kind = 'legacy-flat-project-parameter-value'
       and identity.source_id = value.id
      left join ${catalogRelation("legacy_mapping_heads")} head
        on head.legacy_identity_id = identity.id
      where head.legacy_identity_id is null
    ),
    violations as (
      select id from protected_bindings
      union
      select id from protected_values
    )
    select
      (select count(*)::int from violations) as violation_count,
      coalesce((select json_agg(id order by id) from violations), '[]'::json) as offending_ids,
      json_build_object(
        'bindingCount', (select count(*)::int from ${catalogRelation("project_parameter_bindings")}),
        'valueCount', (select count(*)::int from ${values}),
        'identityCount', (select count(*)::int from ${catalogRelation("legacy_identities")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V14", "PCAT-VRF-V14-BINDING-TIP-CONSERVATION", observation);
};

export const runV15 = async (query: GateQuery): Promise<GateResult> => {
  const observation = await countSql(
    query,
    `
    with orphans as (
      select event.id
      from ${catalogRelation("binding_history_events")} event
      left join public.audit_events audit on audit.id = event.success_audit_ref
      where audit.id is null
      union all
      select archive.id
      from ${catalogRelation("parameter_catalog_archives")} archive
      left join public.audit_events audit on audit.id = archive.success_audit_ref
      where audit.id is null
    )
    select
      (select count(*)::int from orphans) as violation_count,
      coalesce((select json_agg(id order by id) from orphans), '[]'::json) as offending_ids,
      json_build_object(
        'historyCount', (select count(*)::int from ${catalogRelation("binding_history_events")}),
        'archiveCount', (select count(*)::int from ${catalogRelation("parameter_catalog_archives")})
      ) as extra
    `,
  );
  return withChecksum("PCAT-DB-V15", "PCAT-VRF-V15-AUDIT-CONTINUITY", observation);
};

export const runV16 = async (query: GateQuery): Promise<GateResult> => {
  const columns = await query<{ relation: string }>(
    `
    select class.relname as relation
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class class on class.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = '${quoteIdent("parameter_catalog")}'
      and class.relname = any($1::text[])
      and attribute.attname = 'organization_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
    order by class.relname
    `,
    [[...CATALOG_STRUCTURAL_RELATIONS]],
  );
  return countedResult(
    "PCAT-DB-V16",
    "PCAT-VRF-V16-ORGANIZATION-STRUCTURAL-CATALOG",
    columns.rows.length,
    {
      relations: columns.rows.map((row) => row.relation),
    },
  );
};

export const runV17 = async (query: GateQuery, plan: VerificationPlan): Promise<GateResult> => {
  const counts = await query<{
    identities: string;
    mappings: string;
    archives: string;
    registrations: string;
    ledger: string;
  }>(
    `
    select
      (select count(*)::text from ${catalogRelation("legacy_identities")}) as identities,
      (select count(*)::text from ${catalogRelation("legacy_mapping_heads")}) as mappings,
      (select count(*)::text from ${catalogRelation("parameter_catalog_archives")}) as archives,
      (select count(*)::text from ${catalogRelation("organization_subject_registrations")}) as registrations,
      (select count(*)::text from ${catalogRelation("parameter_catalog_classification_ledger")}) as ledger
    `,
  );
  const row = counts.rows[0]!;
  const snapshot = {
    archives: asInt(row.archives),
    identities: asInt(row.identities),
    ledger: asInt(row.ledger),
    mappings: asInt(row.mappings),
    registrations: asInt(row.registrations),
  };
  const sourceInventoryDigest = digestOf(snapshot);
  const mismatches: string[] = [];
  if (plan.mode === "fresh") {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value !== 0) {
        mismatches.push(key);
      }
    }
  } else if (plan.mode === "populated") {
    if (sourceInventoryDigest !== plan.pins.cutover.sourceSnapshotFingerprint) {
      mismatches.push("sourceSnapshotFingerprint");
    }
  }
  if (plan.pins.artifact.gitSha.trim() === "" || plan.pins.target.deploymentId.trim() === "") {
    mismatches.push("artifactOrTargetPin");
  }
  return countedResult("PCAT-DB-V17", "PCAT-VRF-V17-MODE-RESULT-MISMATCH", mismatches.length, {
    mismatches,
    mode: plan.mode,
    sourceInventoryDigest,
    sourceSnapshotFingerprint: plan.pins.cutover.sourceSnapshotFingerprint,
    ...snapshot,
  });
};
