import type { Database } from "../../../shared/database/client";
import { mustUseSemanticParameterIdentity } from "../semanticParameterReads";
import { SEMANTIC_IDENTITY_SQL, SEMANTIC_RISK_EXPR } from "../semanticParameterIdentityNames";
import {
  actionableReviewStatusesForRole,
  ADMIN_GOVERNANCE_AUDIT_APPS,
  ADMIN_GOVERNANCE_AUDIT_KINDS,
  sqlInList,
  type PersonalRoleLevel
} from "./personalMetrics";
import {
  aggregateRiskDistributionLegacy,
  countCommitterPersonalKpisLegacy,
  countKpisLegacy,
  countUserPersonalKpisLegacy
} from "./legacyDashboardAdapter";

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

type PersonalTrendInput = OrgScope & {
  userId: string;
  windowStart: string;
  windowEnd: string;
  granularity: "day" | "week";
  roleLevel: PersonalRoleLevel;
};

export async function countKpis(
  db: Database,
  input: OrgScope & { windowStart: string }
) {
  if (!(await mustUseSemanticParameterIdentity(db))) {
    return countKpisLegacy(db, input);
  }

  const params = [input.organizationId, input.windowStart, input.projectId];
  const projectFilter = input.projectId ? "and b.project_id = $3" : "";
  const rows = await db.query<{
    total_parameters: string;
    managed_projects: string;
    change_frequency: string;
    active_contributors: string;
    high_risk_parameters: string;
  }>(
    `
    select
      (select count(*) from ${SEMANTIC_IDENTITY_SQL.bindingsTable} b
         join projects p on p.id = b.project_id
        where p.organization_id = $1 ${projectFilter}) as total_parameters,
      (select count(*) from projects p where p.organization_id = $1
        ${input.projectId ? "and p.id = $3" : ""}) as managed_projects,
      (select count(*) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as change_frequency,
      (select count(distinct h.changed_by_user_id) from parameter_history_entries h
        where h.organization_id = $1 and h.changed_at >= $2
        ${input.projectId ? "and h.project_id = $3" : ""}) as active_contributors,
      (select count(*) from ${SEMANTIC_IDENTITY_SQL.bindingsTable} b
         join projects p on p.id = b.project_id
         join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = b.parameter_spec_id
        where p.organization_id = $1 and ${SEMANTIC_RISK_EXPR} = 'High' ${projectFilter}) as high_risk_parameters
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

export async function aggregateTrend(
  db: Database,
  input: OrgScope & { windowStart: string; windowEnd: string; granularity: "day" | "week" }
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const step = input.granularity === "week" ? "1 week" : "1 day";
  const projectFilter = input.projectId ? "and t.project_id = $4" : "";
  const args = input.projectId
    ? [input.windowStart, input.windowEnd, input.organizationId, input.projectId]
    : [input.windowStart, input.windowEnd, input.organizationId];
  const rows = await db.query<{
    bucket_start: Date;
    change_count: string;
    workflow_event_count: string;
  }>(
    `
    with buckets as (
      select generate_series(date_trunc('${trunc}', $1::timestamptz),
                             date_trunc('${trunc}', $2::timestamptz) - interval '${step}',
                             interval '${step}') as bucket_start
    ),
    changes as (
      select date_trunc('${trunc}', t.changed_at) as bucket_start, count(*) as c
        from parameter_history_entries t
       where t.organization_id = $3 and t.changed_at >= $1 and t.changed_at < $2 ${projectFilter}
       group by 1
    ),
    workflow as (
      select date_trunc('${trunc}', t.created_at) as bucket_start, count(*) as c
        from parameter_change_requests t
       where t.organization_id = $3 and t.created_at >= $1 and t.created_at < $2 ${projectFilter}
       group by 1
    )
    select b.bucket_start,
           coalesce(changes.c, 0) as change_count,
           coalesce(workflow.c, 0) as workflow_event_count
      from buckets b
      left join changes on changes.bucket_start = b.bucket_start
      left join workflow on workflow.bucket_start = b.bucket_start
     order by b.bucket_start asc
    `,
    args
  );
  return rows.rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    changeCount: Number(r.change_count),
    workflowEventCount: Number(r.workflow_event_count)
  }));
}

export async function countPersonalKpis(db: Database, input: PersonalKpiInput) {
  if (input.roleLevel === "guest") {
    return {
      contributionCount: 0,
      workflowCount: 0,
      openItemCount: 0,
      pendingTodoCount: 0,
      highRiskTouchCount: 0
    };
  }

  if (input.roleLevel === "committer") {
    return countCommitterPersonalKpis(db, input);
  }

  if (input.roleLevel === "admin") {
    return countAdminPersonalKpis(db, input);
  }

  return countUserPersonalKpis(db, input);
}

async function countUserPersonalKpis(db: Database, input: PersonalKpiInput) {
  if (!(await mustUseSemanticParameterIdentity(db))) {
    return countUserPersonalKpisLegacy(db, input);
  }

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
        join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = h.parameter_spec_id
        where h.organization_id = $1
          and h.changed_by_user_id = $2
          and h.changed_at >= $3
          and ${SEMANTIC_RISK_EXPR} = 'High'
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

async function countCommitterPersonalKpis(db: Database, input: PersonalKpiInput) {
  if (!(await mustUseSemanticParameterIdentity(db))) {
    return countCommitterPersonalKpisLegacy(db, input);
  }

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
        join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = cr.parameter_spec_id
        where rd.organization_id = $1
          and rd.reviewer_user_id = $2
          and rd.created_at >= $3
          and ${SEMANTIC_RISK_EXPR} = 'High'
          ${decisionProjectFilter}) as high_risk_reviews,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1
          and cr.status not in ('merged', 'rejected', 'withdrawn')
          ${reviewStatusFilter}
          ${queueProjectFilter}) as pending_reviews,
      (select count(*) from parameter_change_requests cr
        join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = cr.parameter_spec_id
        where cr.organization_id = $1
          and cr.status not in ('merged', 'rejected', 'withdrawn')
          and ${SEMANTIC_RISK_EXPR} = 'High'
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

async function countAdminPersonalKpis(db: Database, input: PersonalKpiInput) {
  const auditProjectFilter = input.projectId ? "and ae.project_id = $4" : "";
  const importProjectFilter = input.projectId ? "and b.project_id = $4" : "";
  const args = input.projectId
    ? [input.organizationId, input.userId, input.windowStart, input.projectId]
    : [input.organizationId, input.userId, input.windowStart];

  const rows = await db.query<{
    governance_actions: string;
    imports_created: string;
    high_risk_governance: string;
  }>(
    `
    select
      (select count(*) from audit_events ae
        where ae.organization_id = $1
          and ae.actor_user_id = $2
          and ae.created_at >= $3
          and (
            ae.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
            or ae.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)})
          )
          ${auditProjectFilter}) as governance_actions,
      (select count(*) from parameter_import_batches b
        where b.organization_id = $1
          and b.created_by_user_id = $2
          and b.created_at >= $3
          ${importProjectFilter}) as imports_created,
      (select count(*) from audit_events ae
        where ae.organization_id = $1
          and ae.actor_user_id = $2
          and ae.created_at >= $3
          and ae.severity = 'High'
          and (
            ae.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
            or ae.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)})
          )
          ${auditProjectFilter}) as high_risk_governance
    `,
    args
  );
  const r = rows.rows[0];
  return {
    contributionCount: Number(r.governance_actions),
    workflowCount: Number(r.imports_created),
    highRiskTouchCount: Number(r.high_risk_governance),
    openItemCount: input.workbenchSignals.unappliedImportBatches,
    pendingTodoCount: input.workbenchSignals.inactiveAccounts
  };
}

export async function aggregatePersonalTrend(
  db: Database,
  input: PersonalTrendInput
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  if (input.roleLevel === "guest") {
    return aggregateEmptyPersonalTrend(input);
  }
  if (input.roleLevel === "committer") {
    return aggregateCommitterPersonalTrend(db, input);
  }
  if (input.roleLevel === "admin") {
    return aggregateAdminPersonalTrend(db, input);
  }
  return aggregateUserPersonalTrend(db, input);
}

async function aggregateEmptyPersonalTrend(_input: PersonalTrendInput) {
  return [];
}

async function aggregateCommitterPersonalTrend(
  db: Database,
  input: PersonalTrendInput
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const step = input.granularity === "week" ? "1 week" : "1 day";
  const projectFilter = input.projectId ? "and cr.project_id = $5" : "";
  const args = input.projectId
    ? [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId]
    : [input.windowStart, input.windowEnd, input.organizationId, input.userId];
  const rows = await db.query<{
    bucket_start: Date;
    change_count: string;
    workflow_event_count: string;
  }>(
    `
    with buckets as (
      select generate_series(date_trunc('${trunc}', $1::timestamptz),
                             date_trunc('${trunc}', $2::timestamptz) - interval '${step}',
                             interval '${step}') as bucket_start
    ),
    reviews as (
      select date_trunc('${trunc}', rd.created_at) as bucket_start, count(distinct rd.request_id) as c
        from parameter_review_decisions rd
        join parameter_change_requests cr on cr.id = rd.request_id
       where rd.organization_id = $3
         and rd.reviewer_user_id = $4
         and rd.created_at >= $1
         and rd.created_at < $2
         and rd.decision in ('advance', 'reject')
         ${projectFilter}
       group by 1
    ),
    requests as (
      select date_trunc('${trunc}', rd.created_at) as bucket_start, count(*) as c
        from parameter_review_decisions rd
        join parameter_change_requests cr on cr.id = rd.request_id
       where rd.organization_id = $3
         and rd.reviewer_user_id = $4
         and rd.created_at >= $1
         and rd.created_at < $2
         ${projectFilter}
       group by 1
    )
    select b.bucket_start,
           coalesce(reviews.c, 0) as change_count,
           coalesce(requests.c, 0) as workflow_event_count
      from buckets b
      left join reviews on reviews.bucket_start = b.bucket_start
      left join requests on requests.bucket_start = b.bucket_start
     order by b.bucket_start asc
    `,
    args
  );
  return rows.rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    changeCount: Number(r.change_count),
    workflowEventCount: Number(r.workflow_event_count)
  }));
}

async function aggregateAdminPersonalTrend(
  db: Database,
  input: PersonalTrendInput
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const step = input.granularity === "week" ? "1 week" : "1 day";
  const auditProjectFilter = input.projectId ? "and ae.project_id = $5" : "";
  const importProjectFilter = input.projectId ? "and b.project_id = $5" : "";
  const args = input.projectId
    ? [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId]
    : [input.windowStart, input.windowEnd, input.organizationId, input.userId];
  const rows = await db.query<{
    bucket_start: Date;
    change_count: string;
    workflow_event_count: string;
  }>(
    `
    with buckets as (
      select generate_series(date_trunc('${trunc}', $1::timestamptz),
                             date_trunc('${trunc}', $2::timestamptz) - interval '${step}',
                             interval '${step}') as bucket_start
    ),
    governance as (
      select date_trunc('${trunc}', ae.created_at) as bucket_start, count(*) as c
        from audit_events ae
       where ae.organization_id = $3
         and ae.actor_user_id = $4
         and ae.created_at >= $1
         and ae.created_at < $2
         and (
           ae.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
           or ae.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)})
         )
         ${auditProjectFilter}
       group by 1
    ),
    imports as (
      select date_trunc('${trunc}', b.created_at) as bucket_start, count(*) as c
        from parameter_import_batches b
       where b.organization_id = $3
         and b.created_by_user_id = $4
         and b.created_at >= $1
         and b.created_at < $2
         ${importProjectFilter}
       group by 1
    )
    select b.bucket_start,
           coalesce(governance.c, 0) as change_count,
           coalesce(imports.c, 0) as workflow_event_count
      from buckets b
      left join governance on governance.bucket_start = b.bucket_start
      left join imports on imports.bucket_start = b.bucket_start
     order by b.bucket_start asc
    `,
    args
  );
  return rows.rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    changeCount: Number(r.change_count),
    workflowEventCount: Number(r.workflow_event_count)
  }));
}

async function aggregateUserPersonalTrend(
  db: Database,
  input: PersonalTrendInput
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const trunc = input.granularity === "week" ? "week" : "day";
  const step = input.granularity === "week" ? "1 week" : "1 day";
  const projectFilter = input.projectId ? "and t.project_id = $5" : "";
  const args = input.projectId
    ? [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId]
    : [input.windowStart, input.windowEnd, input.organizationId, input.userId];
  const rows = await db.query<{
    bucket_start: Date;
    change_count: string;
    workflow_event_count: string;
  }>(
    `
    with buckets as (
      select generate_series(date_trunc('${trunc}', $1::timestamptz),
                             date_trunc('${trunc}', $2::timestamptz) - interval '${step}',
                             interval '${step}') as bucket_start
    ),
    changes as (
      select date_trunc('${trunc}', t.changed_at) as bucket_start, count(*) as c
        from parameter_history_entries t
       where t.organization_id = $3
         and t.changed_by_user_id = $4
         and t.changed_at >= $1
         and t.changed_at < $2
         ${projectFilter}
       group by 1
    ),
    workflow as (
      select date_trunc('${trunc}', t.created_at) as bucket_start, count(*) as c
        from parameter_change_requests t
       where t.organization_id = $3
         and t.submitter_user_id = $4
         and t.created_at >= $1
         and t.created_at < $2
         ${projectFilter}
       group by 1
    )
    select b.bucket_start,
           coalesce(changes.c, 0) as change_count,
           coalesce(workflow.c, 0) as workflow_event_count
      from buckets b
      left join changes on changes.bucket_start = b.bucket_start
      left join workflow on workflow.bucket_start = b.bucket_start
     order by b.bucket_start asc
    `,
    args
  );
  return rows.rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    changeCount: Number(r.change_count),
    workflowEventCount: Number(r.workflow_event_count)
  }));
}

export async function aggregateRiskDistribution(
  db: Database,
  input: OrgScope
): Promise<Array<{ projectId: string; projectCode: string; projectName: string; high: number; medium: number; low: number; total: number }>> {
  if (!(await mustUseSemanticParameterIdentity(db))) {
    return aggregateRiskDistributionLegacy(db, input);
  }

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
           count(*) filter (where ${SEMANTIC_RISK_EXPR} = 'High') as high,
           count(*) filter (where ${SEMANTIC_RISK_EXPR} = 'Medium') as medium,
           count(*) filter (where ${SEMANTIC_RISK_EXPR} = 'Low') as low
      from projects p
      join ${SEMANTIC_IDENTITY_SQL.bindingsTable} b on b.project_id = p.id
      join ${SEMANTIC_IDENTITY_SQL.specsTable} ps on ps.id = b.parameter_spec_id
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

export async function aggregateWorkbenchSignals(
  db: Database,
  input: OrgScope & { userId: string }
) {
  const projectFilter = input.projectId ? "and cr.project_id = $3" : "";
  const args = input.projectId ? [input.organizationId, input.userId, input.projectId] : [input.organizationId, input.userId];
  const rows = await db.query<{
    review_queue: string;
    my_drafts: string;
    returned_changes: string;
    waiting_merge: string;
    unapplied_import_batches: string;
    inactive_accounts: string;
  }>(
    `
    select
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.status not in ('merged','rejected','withdrawn') ${projectFilter}) as review_queue,
      (select count(*) from parameter_drafts d
        where d.organization_id = $1 and d.user_id = $2 ${input.projectId ? "and d.project_id = $3" : ""}) as my_drafts,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.submitter_user_id = $2 and cr.status = 'rejected' ${projectFilter}) as returned_changes,
      (select count(*) from parameter_change_requests cr
        where cr.organization_id = $1 and cr.status = 'software_merge' ${projectFilter}) as waiting_merge,
      (select count(*) from parameter_import_batches b
        where b.organization_id = $1 and b.applied_at is null ${input.projectId ? "and b.project_id = $3" : ""}) as unapplied_import_batches,
      (select count(*) from users u
        where u.organization_id = $1 and u.is_active = false) as inactive_accounts
    `,
    args
  );
  const r = rows.rows[0];
  return {
    reviewQueue: Number(r.review_queue),
    myDrafts: Number(r.my_drafts),
    returnedChanges: Number(r.returned_changes),
    waitingMerge: Number(r.waiting_merge),
    unappliedImportBatches: Number(r.unapplied_import_batches),
    inactiveAccounts: Number(r.inactive_accounts)
  };
}
