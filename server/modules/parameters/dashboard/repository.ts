import type { Database } from "../../../shared/database/client";

type OrgScope = { organizationId: string; projectId: string | null };
type PersonalKpiInput = OrgScope & {
  userId: string;
  windowStart: string;
  workbenchSignals: {
    reviewQueue: number;
    myDrafts: number;
    returnedChanges: number;
    waitingMerge: number;
    unappliedImportBatches: number;
    inactiveAccounts: number;
  };
  roleLevel: "user" | "committer" | "admin" | "guest";
};

export async function countKpis(
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
      (select count(*) from project_parameter_values ppv
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
      (select count(*) from project_parameter_values ppv
         join projects p on p.id = ppv.project_id
         join parameter_definitions d on d.id = ppv.parameter_definition_id
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
        join parameter_definitions d on d.id = h.parameter_definition_id
        where h.organization_id = $1
          and h.changed_by_user_id = $2
          and h.changed_at >= $3
          and d.risk = 'High'
          ${historyProjectFilter}) as high_risk_touch_count
    `,
    args
  );
  const r = rows.rows[0];
  const openItemCount =
    input.roleLevel === "user"
      ? input.workbenchSignals.myDrafts
      : input.roleLevel === "committer"
        ? input.workbenchSignals.reviewQueue
        : input.roleLevel === "admin"
          ? input.workbenchSignals.unappliedImportBatches
          : 0;
  const pendingTodoCount =
    input.roleLevel === "user"
      ? input.workbenchSignals.returnedChanges + input.workbenchSignals.waitingMerge
      : input.roleLevel === "committer"
        ? input.workbenchSignals.reviewQueue
        : input.roleLevel === "admin"
          ? input.workbenchSignals.inactiveAccounts
          : 0;
  return {
    contributionCount: Number(r.contribution_count),
    workflowCount: Number(r.workflow_count),
    highRiskTouchCount: Number(r.high_risk_touch_count),
    openItemCount,
    pendingTodoCount
  };
}

export async function aggregatePersonalTrend(
  db: Database,
  input: OrgScope & { userId: string; windowStart: string; windowEnd: string; granularity: "day" | "week" }
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
      join project_parameter_values ppv on ppv.project_id = p.id
      join parameter_definitions d on d.id = ppv.parameter_definition_id
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
