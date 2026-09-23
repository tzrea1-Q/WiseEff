import type { Database } from "../../shared/database/client";
import type { HotspotDimension } from "../../../src/domain/parameters/dashboardTypes";

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

export type BindingDashboardTrendPoint = {
  bucketStart: string;
  changeCount: number;
  workflowEventCount: number;
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

type BindingDashboardTrendInput = BindingDashboardScope & {
  windowStart: string;
  windowEnd: string;
  granularity: "day" | "week";
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

function trendBucketsSql(granularity: "day" | "week") {
  const trunc = granularity === "week" ? "week" : "day";
  const step = granularity === "week" ? "1 week" : "1 day";
  return `select generate_series(
      date_trunc('${trunc}', $1::timestamptz at time zone 'UTC'),
      date_trunc('${trunc}', ($2::timestamptz - interval '1 microsecond') at time zone 'UTC'),
      interval '${step}'
    ) as bucket_start`;
}

/**
 * Dashboard aggregates use the same displayable Binding identity as the
 * project Binding list: the current present value and its exact source pin.
 * Bootstrap identity placeholders and values without a matching source pin
 * never enter these aggregates.
 */
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
  left join parameter_catalog.organization_subject_registrations registration
    on registration.id = b.registration_id
  left join parameter_catalog.subject_placements placement
    on placement.id = registration.current_placement_id
  left join public.parameter_modules module on module.id = placement.module_id
  join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
  join parameter_catalog.definition_revisions revision
    on revision.id = b.effective_revision_id and revision.definition_id = b.definition_id`;

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

export async function readBindingDashboardTrend(db: Database, input: BindingDashboardTrendInput): Promise<BindingDashboardTrendPoint[]> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `with buckets as (${trendBucketsSql(input.granularity)}),
     changes as (
       select date_trunc('${trunc}', history.created_at at time zone 'UTC') as bucket_start, count(distinct history.id) as c
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
         join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = binding.organization_id
          and audit.project_id = binding.project_id
        where history.created_at >= $1 and history.created_at < $2
          and binding.organization_id = $3
          and ($4::text is null or binding.project_id = $4)
          and ($5::text[] is null or binding.project_id = any($5::text[]))
        group by 1
     ),
     workflow as (
       select date_trunc('${trunc}', request.created_at at time zone 'UTC') as bucket_start, count(distinct request.id) as c
         from public.project_parameter_value_change_requests request
        where request.created_at >= $1 and request.created_at < $2
          and request.organization_id = $3
          and ($4::text is null or request.project_id = $4)
          and ($5::text[] is null or request.project_id = any($5::text[]))
        group by 1
     )
     select buckets.bucket_start at time zone 'UTC' as bucket_start,
            coalesce(changes.c, 0) as change_count,
            coalesce(workflow.c, 0) as workflow_event_count
       from buckets
       left join changes on changes.bucket_start = buckets.bucket_start
       left join workflow on workflow.bucket_start = buckets.bucket_start
      order by buckets.bucket_start asc`,
    [input.windowStart, input.windowEnd, input.organizationId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return rows.rows.map((row) => ({
    bucketStart: new Date(row.bucket_start).toISOString(),
    changeCount: Number(row.change_count),
    workflowEventCount: Number(row.workflow_event_count)
  }));
}

export async function readUserBindingActivity(
  db: Database,
  input: BindingDashboardScope & { userId: string; windowStart: string; windowEnd: string }
) {
  const rows = await db.query<{ contribution_count: string; workflow_count: string }>(
    `select
       (select count(distinct history.id)
          from parameter_catalog.binding_history_events history
          join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
          join public.audit_events audit
            on audit.id = history.success_audit_ref
           and audit.organization_id = binding.organization_id
           and audit.project_id = binding.project_id
         where audit.actor_user_id = $4
           and history.created_at >= $5 and history.created_at < $6 ${scopeSql("binding")}) as contribution_count,
       (select count(distinct request.id)
          from public.project_parameter_value_change_requests request
         where request.submitter_user_id = $4
           and request.created_at >= $5 and request.created_at < $6 ${scopeSql("request")}) as workflow_count`,
    [...scopeValues(input), input.userId, input.windowStart, input.windowEnd]
  );
  const row = rows.rows[0];
  return {
    contributionCount: Number(row?.contribution_count ?? 0),
    workflowCount: Number(row?.workflow_count ?? 0)
  };
}

export async function readUserBindingTrend(
  db: Database,
  input: BindingDashboardTrendInput & { userId: string }
): Promise<BindingDashboardTrendPoint[]> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `with buckets as (${trendBucketsSql(input.granularity)}),
     changes as (
       select date_trunc('${trunc}', history.created_at at time zone 'UTC') as bucket_start, count(distinct history.id) as c
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
         join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = binding.organization_id
          and audit.project_id = binding.project_id
        where audit.actor_user_id = $4 and history.created_at >= $1 and history.created_at < $2
          and binding.organization_id = $3
          and ($5::text is null or binding.project_id = $5)
          and ($6::text[] is null or binding.project_id = any($6::text[]))
        group by 1
     ),
     workflow as (
       select date_trunc('${trunc}', request.created_at at time zone 'UTC') as bucket_start, count(distinct request.id) as c
         from public.project_parameter_value_change_requests request
        where request.submitter_user_id = $4 and request.created_at >= $1 and request.created_at < $2
          and request.organization_id = $3
          and ($5::text is null or request.project_id = $5)
          and ($6::text[] is null or request.project_id = any($6::text[]))
        group by 1
     )
     select buckets.bucket_start at time zone 'UTC' as bucket_start,
            coalesce(changes.c, 0) as change_count,
            coalesce(workflow.c, 0) as workflow_event_count
       from buckets
       left join changes on changes.bucket_start = buckets.bucket_start
       left join workflow on workflow.bucket_start = buckets.bucket_start
      order by buckets.bucket_start asc`,
    [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return rows.rows.map((row) => ({
    bucketStart: new Date(row.bucket_start).toISOString(),
    changeCount: Number(row.change_count),
    workflowEventCount: Number(row.workflow_event_count)
  }));
}

export async function listProjectsWithSourceBackedBindings(db: Database, input: BindingDashboardScope) {
  const rows = await db.query<{ project_id: string; project_code: string; project_name: string }>(
    `select p.id as project_id, p.code as project_code, p.name as project_name
       ${ACTIVE_SOURCE_BACKED_BINDINGS}
      where true ${scopeSql("b")}
      group by p.id, p.code, p.name
      order by p.code asc`,
    scopeValues(input)
  );
  return rows.rows.map((row) => ({ projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name }));
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
