import type { Database } from "../../../shared/database/client";
import type { HotspotDimension } from "../../../../src/domain/parameters/dashboardTypes";

export type HotspotGroupAggregate = {
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

type AggregateInput = {
  organizationId: string;
  projectId: string | null;
  dimension: HotspotDimension;
  windowStart: string;
  windowEnd: string;
};

/** Policy/schema drift replaces legacy recommended-vs-current scoring. */
const DRIFT_EXPR = `
  case
    when b.raw_value ~ '^-?[0-9.]+$'
      and coalesce(ppt.target_value #>> '{}', psv.schema_default #>> '{}', '') ~ '^-?[0-9.]+$' then
      abs(
        b.raw_value::numeric
        - coalesce(ppt.target_value #>> '{}', psv.schema_default #>> '{}', '0')::numeric
      )
      / greatest(
        abs(b.raw_value::numeric),
        abs(coalesce(ppt.target_value #>> '{}', psv.schema_default #>> '{}', '0')::numeric),
        1
      )
      * 100
    else 0
  end
`;

const RISK_WEIGHT_EXPR = `case d.risk when 'High' then 3 when 'Medium' then 2 else 1 end`;

type RawRow = {
  group_id: string;
  kind: string;
  title: string;
  project_id: string | null;
  project_code: string;
  module: string;
  parameter_count: string;
  definition_count: string;
  related_request_count: string;
  high_risk_count: string;
  risk_weight_sum: string;
  drift_sum: string;
  last_changed_at: Date | null;
};

function mapLegacyRow(row: RawRow): HotspotGroupAggregate {
  return {
    groupId: row.group_id,
    kind: row.kind as HotspotGroupAggregate["kind"],
    title: row.title,
    projectId: row.project_id ?? undefined,
    projectCode: row.project_code,
    module: row.module,
    parameterCount: Number(row.parameter_count),
    definitionCount: Number(row.definition_count),
    relatedRequestCount: Number(row.related_request_count),
    highRiskCount: Number(row.high_risk_count),
    riskWeightSum: Number(row.risk_weight_sum),
    driftSum: Number(row.drift_sum),
    logSignalCount: 0,
    lastChangedAt: row.last_changed_at ? new Date(row.last_changed_at).toISOString() : undefined,
    historyEventsInWindow: 0,
    modifiedParamCount: 0,
    openRequestCount: 0,
    returnedInWindow: 0,
    contributorsInWindow: 0,
    contributorsAllTime: 0
  };
}

type BehavioralRawRow = RawRow & {
  history_events_in_window: string;
  modified_param_count: string;
  open_request_count: string;
  returned_in_window: string;
  contributors_in_window: string;
  contributors_all_time: string;
};

function mapBehavioralRow(row: BehavioralRawRow, kind: "project" | "module" | "parameter"): HotspotGroupAggregate {
  return {
    groupId: row.group_id,
    kind,
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
  };
}

async function aggregateProjectGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and p.id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<BehavioralRawRow>(
    `
    select
      p.id as group_id,
      'project' as kind,
      p.code as title,
      p.id as project_id,
      p.code as project_code,
      '项目参数' as module,
      count(distinct ppv.id) as parameter_count,
      count(distinct d.id) as definition_count,
      count(distinct cr.id) filter (
        where cr.created_at >= $2 and cr.created_at < $3
      ) as related_request_count,
      0 as high_risk_count,
      0 as risk_weight_sum,
      0 as drift_sum,
      count(h.id) filter (
        where h.changed_at >= $2 and h.changed_at < $3
      ) as history_events_in_window,
      count(distinct case
        when exists (
          select 1
          from parameter_history_entries h_mod
          where h_mod.project_parameter_value_id = ppv.id
            and h_mod.version > 1
        ) then d.id
      end) as modified_param_count,
      count(distinct cr.id) filter (
        where cr.status in ('submitted', 'hardware_review', 'software_review', 'software_merge')
      ) as open_request_count,
      count(distinct cr.id) filter (
        where cr.status = 'rejected'
          and cr.updated_at >= $2
          and cr.updated_at < $3
      ) as returned_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_at >= $2
          and h.changed_at < $3
          and h.changed_by_user_id is not null
      ) as contributors_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_by_user_id is not null
      ) as contributors_all_time,
      max(h.changed_at) as last_changed_at
    from projects p
    join project_parameter_values ppv on ppv.project_id = p.id
    join parameter_definitions d on d.id = ppv.parameter_definition_id
    left join parameter_change_requests cr
      on cr.organization_id = p.organization_id
     and cr.project_id = p.id
     and cr.parameter_definition_id = d.id
    left join parameter_history_entries h
      on h.organization_id = p.organization_id
     and h.project_id = p.id
     and h.parameter_definition_id = d.id
    where p.organization_id = $1 ${projectFilter}
    group by p.id, p.code
    order by p.code asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "project"));
}

async function aggregateModuleGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and ppv.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<BehavioralRawRow>(
    `
    select
      d.module as group_id,
      'module' as kind,
      d.module as title,
      null as project_id,
      count(distinct ppv.project_id)::text || ' 个项目' as project_code,
      d.module as module,
      count(distinct ppv.id) as parameter_count,
      count(distinct d.id) as definition_count,
      count(distinct cr.id) filter (
        where cr.created_at >= $2 and cr.created_at < $3
      ) as related_request_count,
      0 as high_risk_count,
      0 as risk_weight_sum,
      0 as drift_sum,
      count(h.id) filter (
        where h.changed_at >= $2 and h.changed_at < $3
      ) as history_events_in_window,
      count(distinct case
        when exists (
          select 1
          from parameter_history_entries h_mod
          where h_mod.project_parameter_value_id = ppv.id
            and h_mod.version > 1
        ) then d.id
      end) as modified_param_count,
      count(distinct cr.id) filter (
        where cr.status in ('submitted', 'hardware_review', 'software_review', 'software_merge')
      ) as open_request_count,
      count(distinct cr.id) filter (
        where cr.status = 'rejected'
          and cr.updated_at >= $2
          and cr.updated_at < $3
      ) as returned_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_at >= $2
          and h.changed_at < $3
          and h.changed_by_user_id is not null
      ) as contributors_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_by_user_id is not null
      ) as contributors_all_time,
      max(h.changed_at) as last_changed_at
    from parameter_definitions d
    join project_parameter_values ppv on ppv.parameter_definition_id = d.id
    join projects p on p.id = ppv.project_id
    left join parameter_change_requests cr
      on cr.organization_id = d.organization_id
     and cr.project_id = ppv.project_id
     and cr.parameter_definition_id = d.id
    left join parameter_history_entries h
      on h.organization_id = d.organization_id
     and h.project_id = ppv.project_id
     and h.parameter_definition_id = d.id
    where d.organization_id = $1 ${projectFilter}
    group by d.module
    order by d.module asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "module"));
}

async function aggregateParameterGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and ppv.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<BehavioralRawRow>(
    `
    select
      d.id as group_id,
      'parameter' as kind,
      d.name as title,
      null as project_id,
      count(distinct ppv.project_id)::text || ' 个项目' as project_code,
      d.module as module,
      count(distinct ppv.project_id) as parameter_count,
      1 as definition_count,
      count(distinct cr.id) filter (
        where cr.created_at >= $2 and cr.created_at < $3
      ) as related_request_count,
      0 as high_risk_count,
      0 as risk_weight_sum,
      0 as drift_sum,
      count(h.id) filter (
        where h.changed_at >= $2 and h.changed_at < $3
      ) as history_events_in_window,
      count(distinct case
        when exists (
          select 1
          from parameter_history_entries h_mod
          where h_mod.project_parameter_value_id = ppv.id
            and h_mod.version > 1
        ) then ppv.project_id
      end) as modified_param_count,
      count(distinct cr.id) filter (
        where cr.status in ('submitted', 'hardware_review', 'software_review', 'software_merge')
      ) as open_request_count,
      count(distinct cr.id) filter (
        where cr.status = 'rejected'
          and cr.updated_at >= $2
          and cr.updated_at < $3
      ) as returned_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_at >= $2
          and h.changed_at < $3
          and h.changed_by_user_id is not null
      ) as contributors_in_window,
      count(distinct h.changed_by_user_id) filter (
        where h.changed_by_user_id is not null
      ) as contributors_all_time,
      max(h.changed_at) as last_changed_at
    from parameter_definitions d
    join project_parameter_values ppv on ppv.parameter_definition_id = d.id
    join projects p on p.id = ppv.project_id
    left join parameter_change_requests cr
      on cr.organization_id = d.organization_id
     and cr.project_id = ppv.project_id
     and cr.parameter_definition_id = d.id
    left join parameter_history_entries h
      on h.organization_id = d.organization_id
     and h.project_id = ppv.project_id
     and h.parameter_definition_id = d.id
    where d.organization_id = $1 ${projectFilter}
    group by d.id, d.name, d.module
    order by d.name asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "parameter"));
}

export async function aggregateHotspotGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  switch (input.dimension) {
    case "project":
      return aggregateProjectGroups(db, input);
    case "module":
      return aggregateModuleGroups(db, input);
    case "parameter":
      return aggregateParameterGroups(db, input);
  }
}
