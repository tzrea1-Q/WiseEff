// Pre-PR #1598 SQL kept here as a PostgreSQL equivalence oracle.
import type { Database } from "../../../shared/database/client";
import type { HotspotDimension } from "../../../../src/domain/parameters/dashboardTypes";
import { publishedSubjectOwner } from "../../catalog-kernel/ownerSchema";

export type BindingDashboardScope = {
  organizationId: string;
  projectId: string | null;
  authorizedProjectIds?: readonly string[] | null;
};

export type BindingDashboardKpis = {
  totalBindings: number;
  totalDefinitions: number;
  changeFrequency: number;
  activeContributors: number;
};

export type BindingDashboardHotspotGroup = {
  groupId: string;
  kind: "module" | "project" | "parameter";
  title: string;
  projectId?: string;
  projectCode: string;
  module: string;
  parameterCount: number;
  definitionCount: number;
  relatedRequestCount: number;
  highRiskCount: number;
  riskWeightSum: number;
  driftSum: number;
  logSignalCount: number;
  lastChangedAt?: string;
  historyEventsInWindow: number;
  modifiedParamCount: number;
  openRequestCount: number;
  returnedInWindow: number;
  contributorsInWindow: number;
  contributorsAllTime: number;
};

type BindingDashboardHotspotInput = BindingDashboardScope & {
  dimension: HotspotDimension;
  windowStart: string;
  windowEnd: string;
};

type RawHotspotRow = {
  group_id: string;
  title: string;
  project_id: string | null;
  project_code: string;
  module: string;
  parameter_count: string;
  definition_count: string;
  related_request_count: string;
  history_events_in_window: string;
  modified_param_count: string;
  open_request_count: string;
  returned_in_window: string;
  contributors_in_window: string;
  contributors_all_time: string;
  last_changed_at: Date | string | null;
};

function scopeSql(alias: string) {
  return `and ${alias}.organization_id = $1
    and ($2::text is null or ${alias}.project_id = $2)
    and ($3::text[] is null or ${alias}.project_id = any($3::text[]))`;
}

function scopeValues(input: BindingDashboardScope) {
  return [input.organizationId, input.projectId, input.authorizedProjectIds ?? null];
}

function currentManagedSourceBindingPredicate(binding: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(binding)) throw new TypeError("Invalid Binding SQL alias");
  const owner = `coalesce(managed_registration.owner_subject_id, ${publishedSubjectOwner("managed_subject_membership", "managed_subject")})`;
  return `exists (
    select 1
      from parameter_catalog.catalog_state managed_state
      join parameter_catalog.catalog_release_subjects managed_subject_membership
        on managed_subject_membership.release_id=managed_state.current_catalog_release_id
       and managed_subject_membership.subject_id=${binding}.subject_id
       and managed_subject_membership.lifecycle='active'
      join parameter_catalog.catalog_subjects managed_subject
        on managed_subject.id=managed_subject_membership.subject_id
      join parameter_catalog.catalog_release_definition_heads managed_head
        on managed_head.release_id=managed_state.current_catalog_release_id
       and managed_head.definition_id=${binding}.definition_id
      join parameter_catalog.definition_revisions managed_definition
        on managed_definition.id=managed_head.revision_id
       and managed_definition.definition_id=managed_head.definition_id
       and coalesce(managed_definition.content->>'lifecycle','active') in ('active','deprecated')
      join parameter_catalog.organization_subject_registrations managed_registration
        on managed_registration.id=${binding}.registration_id
       and managed_registration.organization_id=${binding}.organization_id
       and managed_registration.subject_id=${binding}.subject_id
       and managed_registration.status='active'
     where (${owner} is null or exists (
       select 1 from parameter_catalog.catalog_release_subjects managed_owner
       join parameter_catalog.organization_subject_registrations managed_owner_registration
         on managed_owner_registration.subject_id=managed_owner.subject_id
        and managed_owner_registration.organization_id=${binding}.organization_id
        and managed_owner_registration.status='active'
       where managed_owner.release_id=managed_state.current_catalog_release_id
         and managed_owner.subject_id=${owner} and managed_owner.lifecycle='active'
     ))
       and not parameter_catalog.current_source_binding_is_suspended(
         ${binding}.organization_id, ${binding}.project_id, ${binding}.id
       )
  )`;
}

const ACTIVE_SOURCE_BACKED_BINDINGS = `
  from parameter_catalog.current_project_parameter_bindings b
  join parameter_catalog.project_parameter_values value
    on value.id = b.current_value_id
   and value.binding_id = b.id
   and value.definition_id = b.definition_id
   and value.value_state = 'present'
   and value.source_ref <> 'canonical-binding-identity'
  join parameter_catalog.project_value_source_pins source_pin
    on source_pin.project_value_id = value.id
   and source_pin.binding_id = b.id
   and source_pin.definition_id = b.definition_id
   and source_pin.organization_id = b.organization_id
   and source_pin.project_id = b.project_id
   and source_pin.source_occurrence_id = b.source_occurrence_id
   and source_pin.config_revision_id = value.config_revision_id
  join public.projects p on p.id = b.project_id and p.organization_id = b.organization_id
  left join parameter_catalog.registration_effective_module placement
    on placement.registration_id = b.registration_id and placement.organization_id = b.organization_id
  left join public.parameter_modules module on module.id = placement.module_id and module.organization_id = b.organization_id
  join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
  join parameter_catalog.definition_revisions revision
    on revision.id = b.effective_revision_id and revision.definition_id = b.definition_id
   and ${currentManagedSourceBindingPredicate("b")}`;

export async function readBindingDashboardKpis(
  db: Database,
  input: BindingDashboardScope & { windowStart: string; windowEnd: string }
): Promise<BindingDashboardKpis> {
  const rows = await db.query<{
    total_bindings: string;
    total_definitions: string;
    change_frequency: string;
    active_contributors: string;
  }>(
    `select
       (select count(distinct b.id) ${ACTIVE_SOURCE_BACKED_BINDINGS}
         where true ${scopeSql("b")}) as total_bindings,
       (select count(distinct b.definition_id) ${ACTIVE_SOURCE_BACKED_BINDINGS}
         where true ${scopeSql("b")}) as total_definitions,
       (select count(distinct history.id)
          from parameter_catalog.binding_history_events history
          join parameter_catalog.project_parameter_bindings b on b.id = history.binding_id
          join public.audit_events audit
            on audit.id = history.success_audit_ref
           and audit.organization_id = b.organization_id
           and audit.project_id = b.project_id
         where history.created_at >= $4 and history.created_at < $5 ${scopeSql("b")}) as change_frequency,
       (select count(distinct audit.actor_user_id)
          from parameter_catalog.binding_history_events history
          join parameter_catalog.project_parameter_bindings b on b.id = history.binding_id
          join public.audit_events audit
            on audit.id = history.success_audit_ref
           and audit.organization_id = b.organization_id
           and audit.project_id = b.project_id
         where history.created_at >= $4 and history.created_at < $5
           and audit.actor_user_id is not null ${scopeSql("b")}) as active_contributors`,
    [...scopeValues(input), input.windowStart, input.windowEnd]
  );
  const row = rows.rows[0];
  return {
    totalBindings: Number(row?.total_bindings ?? 0),
    totalDefinitions: Number(row?.total_definitions ?? 0),
    changeFrequency: Number(row?.change_frequency ?? 0),
    activeContributors: Number(row?.active_contributors ?? 0)
  };
}

function hotspotGrouping(dimension: HotspotDimension) {
  switch (dimension) {
    case "project":
      return {
        kind: "project" as const,
        select: `p.id as group_id, p.code as title, p.id as project_id, p.code as project_code,
                 '项目参数' as module, count(distinct b.id) as parameter_count,
                 count(distinct b.definition_id) as definition_count`,
        groupBy: "p.id, p.code",
        orderBy: "p.code asc"
      };
    case "module":
      return {
        kind: "module" as const,
        select: `coalesce(module.id, 'unassigned') as group_id, coalesce(module.name, '未分组') as title,
                 case when $4::text is null then null else max(b.project_id) end as project_id,
                 count(distinct b.project_id)::text || ' 个项目' as project_code,
                 coalesce(module.name, '未分组') as module, count(distinct b.id) as parameter_count,
                 count(distinct b.definition_id) as definition_count`,
        groupBy: "module.id, module.name",
        orderBy: "coalesce(module.name, '未分组') asc"
      };
    case "parameter":
      return {
        kind: "parameter" as const,
        select: `b.id as group_id,
                 coalesce(nullif(revision.content->>'displayName', ''), definition.property_key) as title,
                 b.project_id as project_id, p.code as project_code, coalesce(module.name, '未分组') as module,
                 1 as parameter_count, 1 as definition_count`,
        groupBy: "b.id, revision.content->>'displayName', definition.property_key, b.project_id, p.code, module.name",
        orderBy: "title asc"
      };
  }
}

export async function aggregateBindingDashboardHotspots(
  db: Database,
  input: BindingDashboardHotspotInput
): Promise<BindingDashboardHotspotGroup[]> {
  const grouping = hotspotGrouping(input.dimension);
  const rows = await db.query<RawHotspotRow>(
    `select ${grouping.select},
       count(distinct request.id) filter (where request.created_at >= $2 and request.created_at < $3) as related_request_count,
       count(distinct history.id) as history_events_in_window,
       count(distinct b.id) filter (where exists (
         select 1 from parameter_catalog.binding_history_events modified_history
          join parameter_catalog.project_parameter_values old_value
            on old_value.id = modified_history.old_current_value_id
           and old_value.binding_id = b.id
           and old_value.source_ref <> 'canonical-binding-identity'
          where modified_history.binding_id = b.id
       )) as modified_param_count,
       count(distinct request.id) filter (where request.status = 'pending') as open_request_count,
       count(distinct request.id) filter (
         where request.status = 'rejected' and request.updated_at >= $2 and request.updated_at < $3
       ) as returned_in_window,
       count(distinct history_audit.actor_user_id) filter (where history_audit.actor_user_id is not null) as contributors_in_window,
       count(distinct all_time_audit.actor_user_id) filter (where all_time_audit.actor_user_id is not null) as contributors_all_time,
       max(history.created_at) as last_changed_at
       ${ACTIVE_SOURCE_BACKED_BINDINGS}
       left join parameter_catalog.binding_history_events history
         on history.binding_id = b.id and history.created_at >= $2 and history.created_at < $3
       left join public.audit_events history_audit
         on history_audit.id = history.success_audit_ref
        and history_audit.organization_id = b.organization_id and history_audit.project_id = b.project_id
       left join parameter_catalog.binding_history_events all_history on all_history.binding_id = b.id
       left join public.audit_events all_time_audit
         on all_time_audit.id = all_history.success_audit_ref
        and all_time_audit.organization_id = b.organization_id and all_time_audit.project_id = b.project_id
       left join public.project_parameter_value_change_requests request
         on request.organization_id = b.organization_id and request.project_id = b.project_id and request.binding_id = b.id
      where b.organization_id = $1
        and ($4::text is null or b.project_id = $4)
        and ($5::text[] is null or b.project_id = any($5::text[]))
      group by ${grouping.groupBy}
      order by ${grouping.orderBy}`,
    [input.organizationId, input.windowStart, input.windowEnd, input.projectId, input.authorizedProjectIds ?? null]
  );
  return rows.rows.map((row) => ({
    groupId: row.group_id,
    kind: grouping.kind,
    title: row.title,
    projectId: row.project_id ?? undefined,
    projectCode: row.project_code,
    module: row.module,
    parameterCount: Number(row.parameter_count),
    definitionCount: Number(row.definition_count),
    relatedRequestCount: Number(row.related_request_count),
    highRiskCount: 0,
    riskWeightSum: 0,
    driftSum: 0,
    logSignalCount: 0,
    lastChangedAt: row.last_changed_at ? new Date(row.last_changed_at).toISOString() : undefined,
    historyEventsInWindow: Number(row.history_events_in_window),
    modifiedParamCount: Number(row.modified_param_count),
    openRequestCount: Number(row.open_request_count),
    returnedInWindow: Number(row.returned_in_window),
    contributorsInWindow: Number(row.contributors_in_window),
    contributorsAllTime: Number(row.contributors_all_time)
  }));
}
