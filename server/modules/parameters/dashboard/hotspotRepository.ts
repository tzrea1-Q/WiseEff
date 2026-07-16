import type { Database } from "../../../shared/database/client";
import { mustUseSemanticParameterIdentity } from "../semanticParameterReads";
import {
  SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL,
  SEMANTIC_IDENTITY_SQL,
  SEMANTIC_MODULE_EXPR,
  SEMANTIC_TITLE_EXPR
} from "../semanticParameterIdentityNames";
import type { HotspotDimension } from "../../../../src/domain/parameters/dashboardTypes";
import { aggregateHotspotGroupsLegacy } from "./legacyDashboardAdapter";

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

async function aggregateProjectGroupsSemantic(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
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
      count(distinct b.id) as parameter_count,
      count(distinct ps.id) as definition_count,
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
          where h_mod.project_parameter_binding_id = b.id
            and h_mod.version > 1
        ) then ps.id
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
    join ${SEMANTIC_IDENTITY_SQL.bindingsTable} b on b.project_id = p.id
    join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = b.parameter_spec_id
    ${SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL}
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join parameter_change_requests cr
      on cr.organization_id = p.organization_id
     and cr.project_id = p.id
     and cr.project_parameter_binding_id = b.id
    left join parameter_history_entries h
      on h.organization_id = p.organization_id
     and h.project_id = p.id
     and h.project_parameter_binding_id = b.id
    where p.organization_id = $1 ${projectFilter}
    group by p.id, p.code
    order by p.code asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "project"));
}

async function aggregateModuleGroupsSemantic(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and b.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<BehavioralRawRow>(
    `
    select
      ${SEMANTIC_MODULE_EXPR} as group_id,
      'module' as kind,
      ${SEMANTIC_MODULE_EXPR} as title,
      null as project_id,
      count(distinct b.project_id)::text || ' 个项目' as project_code,
      ${SEMANTIC_MODULE_EXPR} as module,
      count(distinct b.id) as parameter_count,
      count(distinct ps.id) as definition_count,
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
          where h_mod.project_parameter_binding_id = b.id
            and h_mod.version > 1
        ) then ps.id
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
    from ${SEMANTIC_IDENTITY_SQL.bindingsTable} b
    join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = b.parameter_spec_id
    ${SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL}
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    join projects p on p.id = b.project_id
    left join parameter_change_requests cr
      on cr.organization_id = b.organization_id
     and cr.project_id = b.project_id
     and cr.project_parameter_binding_id = b.id
    left join parameter_history_entries h
      on h.organization_id = b.organization_id
     and h.project_id = b.project_id
     and h.project_parameter_binding_id = b.id
    where b.organization_id = $1 ${projectFilter}
    group by ${SEMANTIC_MODULE_EXPR}
    order by ${SEMANTIC_MODULE_EXPR} asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "module"));
}

async function aggregateParameterGroupsSemantic(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and b.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<BehavioralRawRow>(
    `
    select
      ps.id as group_id,
      'parameter' as kind,
      ${SEMANTIC_TITLE_EXPR} as title,
      null as project_id,
      count(distinct b.project_id)::text || ' 个项目' as project_code,
      ${SEMANTIC_MODULE_EXPR} as module,
      count(distinct b.project_id) as parameter_count,
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
          where h_mod.project_parameter_binding_id = b.id
            and h_mod.version > 1
        ) then b.project_id
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
    from ${SEMANTIC_IDENTITY_SQL.specsTable} ps
    join ${SEMANTIC_IDENTITY_SQL.bindingsTable} b on b.parameter_spec_id = ps.id
    ${SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL}
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    join projects p on p.id = b.project_id
    left join parameter_change_requests cr
      on cr.organization_id = ps.organization_id
     and cr.project_id = b.project_id
     and cr.project_parameter_binding_id = b.id
    left join parameter_history_entries h
      on h.organization_id = ps.organization_id
     and h.project_id = b.project_id
     and h.project_parameter_binding_id = b.id
    where ps.organization_id = $1 ${projectFilter}
    group by ps.id, ${SEMANTIC_TITLE_EXPR}, ${SEMANTIC_MODULE_EXPR}
    order by ${SEMANTIC_TITLE_EXPR} asc
    `,
    args
  );
  return rows.rows.map((row) => mapBehavioralRow(row, "parameter"));
}

async function aggregateHotspotGroupsSemantic(
  db: Database,
  input: AggregateInput
): Promise<HotspotGroupAggregate[]> {
  switch (input.dimension) {
    case "project":
      return aggregateProjectGroupsSemantic(db, input);
    case "module":
      return aggregateModuleGroupsSemantic(db, input);
    case "parameter":
      return aggregateParameterGroupsSemantic(db, input);
  }
}

export async function aggregateHotspotGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  if (await mustUseSemanticParameterIdentity(db)) {
    return aggregateHotspotGroupsSemantic(db, input);
  }
  return aggregateHotspotGroupsLegacy(db, input);
}
