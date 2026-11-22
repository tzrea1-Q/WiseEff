import { disableBindingReadJit } from "./readTransaction";
import type { Database, Queryable } from "../../shared/database/client";
import type { HotspotDimension } from "../../../src/domain/parameters/dashboardTypes";
import { currentManagedSourceBindingPredicate } from "./queries/currentManagedBindings";

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
function activeSourceBackedBindings(scope: string) {
  return `
  select b.id, b.definition_id, b.organization_id, b.project_id, b.registration_id, b.effective_revision_id
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
  where true ${scope}
    and ${currentManagedSourceBindingPredicate("b", 1)}`;
}

const DASHBOARD_INVENTORY_JOINS = `
  join public.projects p on p.id = b.project_id and p.organization_id = b.organization_id
  join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
  join parameter_catalog.definition_revisions revision
    on revision.id = b.effective_revision_id and revision.definition_id = b.definition_id`;

/** Tenant-wide inventory of displayable current source-backed Binding identities. */
export async function countSourceBackedBindingsByProject(
  db: Queryable,
  organizationId: string,
): Promise<Map<string, number>> {
  const result = await db.query<{ project_id: string; parameter_count: string }>(
    `with active_bindings as materialized (${activeSourceBackedBindings("and b.organization_id = $1")})
     select b.project_id, count(distinct b.id)::text as parameter_count
       from active_bindings b ${DASHBOARD_INVENTORY_JOINS}
      group by b.project_id`,
    [organizationId],
  );
  return new Map(result.rows.map((row) => [row.project_id, Number(row.parameter_count)]));
}

export async function readBindingDashboardKpis(
  db: Database,
  input: BindingDashboardScope & { windowStart: string; windowEnd: string }
): Promise<BindingDashboardKpis> {
  const rows = await db.transaction(async tx => {
    await disableBindingReadJit(tx);
    return tx.query<{
      total_bindings: string;
      total_definitions: string;
      change_frequency: string;
      active_contributors: string;
    }>(
      `with active_bindings as materialized (${activeSourceBackedBindings(scopeSql("b"))}),
       inventory as (
         select count(distinct b.id) as total_bindings, count(distinct b.definition_id) as total_definitions
         from active_bindings b ${DASHBOARD_INVENTORY_JOINS}
       ), activity as (
         select count(distinct history.id) as change_frequency,
                count(distinct audit.actor_user_id) as active_contributors
           from parameter_catalog.binding_history_events history
           join parameter_catalog.project_parameter_bindings b on b.id = history.binding_id
           join public.audit_events audit
             on audit.id = history.success_audit_ref
            and audit.organization_id = b.organization_id
            and audit.project_id = b.project_id
          where history.created_at >= $4 and history.created_at < $5 ${scopeSql("b")}
       )
       select inventory.*, activity.* from inventory cross join activity`,
      [...scopeValues(input), input.windowStart, input.windowEnd]
    );
  });
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
  const rows = await db.transaction(async tx => {
    await disableBindingReadJit(tx);
    return tx.query<{ project_id: string; project_code: string; project_name: string }>(
      `with active_bindings as materialized (${activeSourceBackedBindings(scopeSql("b"))})
       select p.id as project_id, p.code as project_code, p.name as project_name
         from active_bindings b ${DASHBOARD_INVENTORY_JOINS}
        group by p.id, p.code, p.name
        order by p.code asc`,
      scopeValues(input)
    );
  });
  return rows.rows.map((row) => ({ projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name }));
}

function hotspotGrouping(dimension: HotspotDimension) {
  switch (dimension) {
    case "project":
      return {
        key: "p.id",
        select: `project_code as title, project_id, project_code, '项目参数' as module,
                 count(distinct id) as parameter_count, count(distinct definition_id) as definition_count`,
        groupBy: "project_id, project_code"
      };
    case "module":
      return {
        key: "module.id",
        select: `module as title, case when $4::text is null then null else max(project_id) end as project_id,
                 count(distinct project_id)::text || ' 个项目' as project_code, module,
                 count(distinct id) as parameter_count, count(distinct definition_id) as definition_count`,
        groupBy: "module"
      };
    case "parameter":
      return {
        key: "b.id",
        select: `parameter_title as title, project_id, project_code, module,
                 1 as parameter_count, 1 as definition_count`,
        groupBy: "parameter_title, project_id, project_code, module"
      };
  }
}

export async function aggregateBindingDashboardHotspots(
  db: Database,
  input: BindingDashboardHotspotInput
): Promise<BindingDashboardHotspotGroup[]> {
  const grouping = hotspotGrouping(input.dimension);
  const needsModule = input.dimension !== "project";
  const scope = `and b.organization_id = $1
    and ($4::text is null or b.project_id = $4)
    and ($5::text[] is null or b.project_id = any($5::text[]))`;
  // The array key keeps the null module group joinable without conflating it with a real module ID.
  // Count distinct actors at group grain so contributors shared by multiple bindings count once.
  // Activity and workflow keys are subsets of inventory. Full joins let PostgreSQL
  // use a hash or merge join even when it estimates one row from the binding view.
  const rows = await db.transaction(async tx => {
    await disableBindingReadJit(tx);
    return tx.query<RawHotspotRow>(
      `with active_bindings as materialized (${activeSourceBackedBindings(scope)}),
       ${needsModule ? `placements as materialized (
         select registration_id, organization_id, module_id
         from parameter_catalog.registration_effective_module
         where organization_id = $1
       ),` : ""}
       scoped_bindings as materialized (
         select b.id, b.definition_id, b.organization_id, b.project_id, p.code as project_code,
                ${needsModule ? "coalesce(module.name, '未分组')" : "'项目参数'"} as module,
                coalesce(nullif(revision.content->>'displayName', ''), definition.property_key) as parameter_title,
                array[${grouping.key}] as group_key
         from active_bindings b ${DASHBOARD_INVENTORY_JOINS}
         ${needsModule ? `left join placements placement
           on placement.registration_id = b.registration_id and placement.organization_id = b.organization_id
         left join public.parameter_modules module
           on module.id = placement.module_id and module.organization_id = b.organization_id` : ""}
       ), inventory as (
         select group_key, ${grouping.select}
         from scoped_bindings
         group by group_key, ${grouping.groupBy}
       ), binding_activity as materialized (
         select b.group_key, b.id, audit.actor_user_id,
                count(distinct history.id) filter (where history.created_at >= $2 and history.created_at < $3) as history_events_in_window,
                bool_or(old_value.id is not null) as modified,
                max(history.created_at) filter (where history.created_at >= $2 and history.created_at < $3) as last_changed_at
         from scoped_bindings b
         join parameter_catalog.binding_history_events history on history.binding_id = b.id
         left join parameter_catalog.project_parameter_values old_value
           on old_value.id = history.old_current_value_id
          and old_value.binding_id = b.id
          and old_value.source_ref <> 'canonical-binding-identity'
         left join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = b.organization_id and audit.project_id = b.project_id
         group by b.group_key, b.id, audit.actor_user_id
       ), activity as (
         select group_key,
                sum(history_events_in_window) as history_events_in_window,
                count(distinct id) filter (where modified) as modified_param_count,
                count(distinct actor_user_id) filter (where history_events_in_window > 0) as contributors_in_window,
                count(distinct actor_user_id) as contributors_all_time,
                max(last_changed_at) as last_changed_at
         from binding_activity
         group by group_key
       ), workflow as materialized (
         select b.group_key,
                count(distinct request.id) filter (where request.created_at >= $2 and request.created_at < $3) as related_request_count,
                count(distinct request.id) filter (where request.status = 'pending') as open_request_count,
                count(distinct request.id) filter (
                  where request.status = 'rejected' and request.updated_at >= $2 and request.updated_at < $3
                ) as returned_in_window
         from scoped_bindings b
         join public.project_parameter_value_change_requests request
           on request.organization_id = b.organization_id and request.project_id = b.project_id and request.binding_id = b.id
         group by b.group_key
       )
       select coalesce(inventory.group_key[1], 'unassigned') as group_id,
              inventory.title, inventory.project_id, inventory.project_code, inventory.module,
              inventory.parameter_count, inventory.definition_count,
              coalesce(workflow.related_request_count, 0) as related_request_count,
              coalesce(workflow.open_request_count, 0) as open_request_count,
              coalesce(workflow.returned_in_window, 0) as returned_in_window,
              coalesce(activity.history_events_in_window, 0) as history_events_in_window,
              coalesce(activity.modified_param_count, 0) as modified_param_count,
              coalesce(activity.contributors_in_window, 0) as contributors_in_window,
              coalesce(activity.contributors_all_time, 0) as contributors_all_time,
              activity.last_changed_at
       from inventory
       full join activity using (group_key)
       full join workflow using (group_key)
       order by inventory.title asc`,
      [input.organizationId, input.windowStart, input.windowEnd, input.projectId, input.authorizedProjectIds ?? null]
    );
  });
  return rows.rows.map((row) => ({
    groupId: row.group_id,
    kind: input.dimension,
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
