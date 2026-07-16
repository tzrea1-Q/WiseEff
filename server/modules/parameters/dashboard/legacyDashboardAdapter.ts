/**
 * Pre-cutover dashboard SQL. Allowlisted by legacyDependencyGuard; active dashboard
 * repos must route here only before identity cutover completes.
 */
import type { Database } from "../../../shared/database/client";
import { LEGACY_IDENTITY_SQL } from "../legacyParameterIdentityNames";
import {
  actionableReviewStatusesForRole,
  ADMIN_GOVERNANCE_AUDIT_APPS,
  ADMIN_GOVERNANCE_AUDIT_KINDS,
  sqlInList,
  type PersonalRoleLevel
} from "./personalMetrics";
import type { HotspotDimension } from "../../../../src/domain/parameters/dashboardTypes";
import type { HotspotGroupAggregate } from "./hotspotRepository";

type OrgScope = { organizationId: string; projectId: string | null };
type PersonalKpiInput = OrgScope & {
  userId: string;
  windowStart: string;
  perspectiveRoleId: string;
  workbenchSignals: {
    reviewQueue: number;
    myDrafts: number;
    returnedChanges: number;
    waitingMerge: number;
    unappliedImportBatches: number;
    inactiveAccounts: number;
  };
  roleLevel: PersonalRoleLevel;
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

export async function countKpisLegacy(
  db: Database,
  input: OrgScope & { windowStart: string }
) {
  const params = [input.organizationId, input.windowStart, input.projectId];
  const projectFilter = input.projectId ? "and ppv.project_id = $3" : "";
  const rows = await db.query<{
    total_parameters: string;
    managed_projects: string;
    change_frequency: string;
    active_contributors: string;
    high_risk_parameters: string;
  }>(
    `
    select
      (select count(*) from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
         join projects p on p.id = ppv.project_id
        where p.organization_id = $1 ${projectFilter}) as total_parameters,
      (select count(*) from projects p where p.organization_id = $1
        ${input.projectId ? "and p.id = $3" : ""}) as managed_projects,
      (select count(*) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as change_frequency,
      (select count(distinct h.changed_by_user_id) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as active_contributors,
      (select count(*) from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
         join projects p on p.id = ppv.project_id
         join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = ppv.parameter_definition_id
        where p.organization_id = $1 and d.risk = 'High' ${projectFilter}) as high_risk_parameters
    `,
    input.projectId ? params : [input.organizationId, input.windowStart]
  );
  const r = rows.rows[0];
  return {
    totalParameters: Number(r.total_parameters),
    managedProjects: Number(r.managed_projects),
    changeFrequency: Number(r.change_frequency),
    activeContributors: Number(r.active_contributors),
    highRiskParameters: Number(r.high_risk_parameters)
  };
}

export async function countUserPersonalKpisLegacy(db: Database, input: PersonalKpiInput) {
  const historyProjectFilter = input.projectId ? "and h.project_id = $4" : "";
  const workflowProjectFilter = input.projectId ? "and r.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.userId, input.windowStart, input.projectId]
    : [input.organizationId, input.userId, input.windowStart];
  const rows = await db.query<{
    contribution_count: string;
    workflow_count: string;
    high_risk_touch_count: string;
  }>(
    `
    select
      (select count(*) from parameter_history_entries h
        where h.organization_id = $1
          and h.changed_by_user_id = $2
          and h.changed_at >= $3
          ${historyProjectFilter}) as contribution_count,
      (select count(*) from parameter_change_requests r
        where r.organization_id = $1
          and r.submitter_user_id = $2
          and r.created_at >= $3
          ${workflowProjectFilter}) as workflow_count,
      (select count(*) from parameter_history_entries h
        join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = h.parameter_definition_id
        where h.organization_id = $1
          and h.changed_by_user_id = $2
          and h.changed_at >= $3
          and d.risk = 'High'
          ${historyProjectFilter}) as high_risk_touch_count
    `,
    args
  );
  const r = rows.rows[0];
  return {
    contributionCount: Number(r.contribution_count),
    workflowCount: Number(r.workflow_count),
    highRiskTouchCount: Number(r.high_risk_touch_count),
    openItemCount: input.workbenchSignals.myDrafts,
    pendingTodoCount: input.workbenchSignals.returnedChanges + input.workbenchSignals.waitingMerge
  };
}

export async function countCommitterPersonalKpisLegacy(db: Database, input: PersonalKpiInput) {
  const reviewStatuses = actionableReviewStatusesForRole(input.perspectiveRoleId);
  const reviewStatusFilter = reviewStatuses.length > 0 ? `and cr.status in (${sqlInList(reviewStatuses)})` : "and false";
  const decisionProjectFilter = input.projectId ? "and cr.project_id = $4" : "";
  const queueProjectFilter = input.projectId ? "and cr.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.userId, input.windowStart, input.projectId]
    : [input.organizationId, input.userId, input.windowStart];

  const rows = await db.query<{
    reviews_completed: string;
    requests_processed: string;
    high_risk_reviews: string;
    pending_reviews: string;
    high_risk_queue: string;
  }>(
    `
    select
      (select count(distinct rd.request_id) from parameter_review_decisions rd
        join parameter_change_requests cr on cr.id = rd.request_id
        where rd.organization_id = $1
          and rd.reviewer_user_id = $2
          and rd.created_at >= $3
          and rd.decision in ('advance', 'reject')
          ${decisionProjectFilter}) as reviews_completed,
      (select count(*) from parameter_review_decisions rd
        join parameter_change_requests cr on cr.id = rd.request_id
        where rd.organization_id = $1
          and rd.reviewer_user_id = $2
          and rd.created_at >= $3
          ${decisionProjectFilter}) as requests_processed,
      (select count(distinct rd.request_id) from parameter_review_decisions rd
        join parameter_change_requests cr on cr.id = rd.request_id
        join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = cr.parameter_definition_id
        where rd.organization_id = $1
          and rd.reviewer_user_id = $2
          and rd.created_at >= $3
          and d.risk = 'High'
          ${decisionProjectFilter}) as high_risk_reviews,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1
          and cr.status not in ('merged', 'rejected', 'withdrawn')
          ${reviewStatusFilter}
          ${queueProjectFilter}) as pending_reviews,
      (select count(*) from parameter_change_requests cr
        join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = cr.parameter_definition_id
        where cr.organization_id = $1
          and cr.status not in ('merged', 'rejected', 'withdrawn')
          and d.risk = 'High'
          ${reviewStatusFilter}
          ${queueProjectFilter}) as high_risk_queue
    `,
    args
  );
  const r = rows.rows[0];
  return {
    contributionCount: Number(r.reviews_completed),
    workflowCount: Number(r.requests_processed),
    highRiskTouchCount: Number(r.high_risk_reviews),
    openItemCount: Number(r.pending_reviews),
    pendingTodoCount: Number(r.high_risk_queue)
  };
}

export async function aggregateRiskDistributionLegacy(
  db: Database,
  input: OrgScope
): Promise<Array<{ projectId: string; projectCode: string; projectName: string; high: number; medium: number; low: number; total: number }>> {
  const projectFilter = input.projectId ? "and p.id = $2" : "";
  const args = input.projectId ? [input.organizationId, input.projectId] : [input.organizationId];
  const rows = await db.query<{
    project_id: string;
    project_code: string;
    project_name: string;
    high: string;
    medium: string;
    low: string;
  }>(
    `
    select p.id as project_id, p.code as project_code, p.name as project_name,
           count(*) filter (where d.risk = 'High') as high,
           count(*) filter (where d.risk = 'Medium') as medium,
           count(*) filter (where d.risk = 'Low') as low
      from projects p
      join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.project_id = p.id
      join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = ppv.parameter_definition_id
     where p.organization_id = $1 ${projectFilter}
     group by p.id, p.code, p.name
     order by p.code asc
    `,
    args
  );
  return rows.rows.map((r) => {
    const high = Number(r.high);
    const medium = Number(r.medium);
    const low = Number(r.low);
    return {
      projectId: r.project_id,
      projectCode: r.project_code,
      projectName: r.project_name,
      high,
      medium,
      low,
      total: high + medium + low
    };
  });
}

async function aggregateProjectGroupsLegacy(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
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
    join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.project_id = p.id
    join ${LEGACY_IDENTITY_SQL.definitionsTable} d on d.id = ppv.parameter_definition_id
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

async function aggregateModuleGroupsLegacy(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
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
    from ${LEGACY_IDENTITY_SQL.definitionsTable} d
    join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.parameter_definition_id = d.id
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

async function aggregateParameterGroupsLegacy(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
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
    from ${LEGACY_IDENTITY_SQL.definitionsTable} d
    join ${LEGACY_IDENTITY_SQL.valuesTable} ppv on ppv.parameter_definition_id = d.id
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

export async function aggregateHotspotGroupsLegacy(
  db: Database,
  input: AggregateInput
): Promise<HotspotGroupAggregate[]> {
  switch (input.dimension) {
    case "project":
      return aggregateProjectGroupsLegacy(db, input);
    case "module":
      return aggregateModuleGroupsLegacy(db, input);
    case "parameter":
      return aggregateParameterGroupsLegacy(db, input);
  }
}
