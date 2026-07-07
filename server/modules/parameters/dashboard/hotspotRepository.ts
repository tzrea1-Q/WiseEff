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
};

type AggregateInput = {
  organizationId: string;
  projectId: string | null;
  dimension: HotspotDimension;
  windowStart: string;
  windowEnd: string;
};

const DRIFT_EXPR = `
  case
    when ppv.current_value ~ '^-?[0-9.]+$' and ppv.recommended_value ~ '^-?[0-9.]+$' then
      abs(ppv.current_value::numeric - ppv.recommended_value::numeric)
      / greatest(abs(ppv.current_value::numeric), abs(ppv.recommended_value::numeric), 1)
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

function mapRow(row: RawRow): HotspotGroupAggregate {
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
    lastChangedAt: row.last_changed_at ? new Date(row.last_changed_at).toISOString() : undefined
  };
}

async function aggregateProjectGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and p.id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<RawRow>(
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
      count(*) filter (where d.risk = 'High') as high_risk_count,
      coalesce(sum(${RISK_WEIGHT_EXPR}), 0) as risk_weight_sum,
      coalesce(sum(${DRIFT_EXPR}), 0) as drift_sum,
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
  return rows.rows.map(mapRow);
}

async function aggregateModuleGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and ppv.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<RawRow>(
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
      count(*) filter (where d.risk = 'High') as high_risk_count,
      coalesce(sum(${RISK_WEIGHT_EXPR}), 0) as risk_weight_sum,
      coalesce(sum(${DRIFT_EXPR}), 0) as drift_sum,
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
  return rows.rows.map(mapRow);
}

async function aggregateParameterGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const projectFilter = input.projectId ? "and ppv.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.windowStart, input.windowEnd, input.projectId]
    : [input.organizationId, input.windowStart, input.windowEnd];
  const rows = await db.query<RawRow>(
    `
    select
      d.id as group_id,
      'parameter' as kind,
      d.name as title,
      ppv.project_id as project_id,
      p.code as project_code,
      d.module as module,
      count(distinct ppv.id) as parameter_count,
      1 as definition_count,
      count(distinct cr.id) filter (
        where cr.created_at >= $2 and cr.created_at < $3
      ) as related_request_count,
      count(*) filter (where d.risk = 'High') as high_risk_count,
      coalesce(sum(${RISK_WEIGHT_EXPR}), 0) as risk_weight_sum,
      coalesce(sum(${DRIFT_EXPR}), 0) as drift_sum,
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
    group by d.id, d.name, d.module, ppv.project_id, p.code
    order by d.name asc, p.code asc
    `,
    args
  );
  return rows.rows.map(mapRow);
}

export async function aggregateHotspotGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  switch (input.dimension) {
    case "project":
      return aggregateProjectGroups(db, input);
    case "module":
      return aggregateModuleGroups(db, input);
    case "parameter":
      return aggregateParameterGroups(db, input);
    case "overall":
      return [
        ...(await aggregateModuleGroups(db, input)),
        ...(await aggregateProjectGroups(db, input)),
        ...(await aggregateParameterGroups(db, input))
      ];
  }
}
