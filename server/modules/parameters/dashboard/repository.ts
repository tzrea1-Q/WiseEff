import type { Database } from "../../../shared/database/client";
import {
  aggregateBindingDashboardHotspots,
  listProjectsWithSourceBackedBindings,
  readBindingDashboardKpis,
  readBindingDashboardTrend,
  readUserBindingActivity,
  readUserBindingTrend
} from "../../parameter-bindings/dashboardRead";
import {
  ADMIN_GOVERNANCE_AUDIT_APPS,
  ADMIN_GOVERNANCE_AUDIT_KINDS,
  sqlInList,
  type PersonalRoleLevel
} from "./personalMetrics";

type OrgScope = {
  organizationId: string;
  projectId: string | null;
  /** null means an organization-wide role; an array is the caller's project allow-list. */
  authorizedProjectIds?: readonly string[] | null;
};

type PersonalKpiInput = OrgScope & {
  userId: string;
  windowStart: string;
  windowEnd?: string;
  perspectiveRoleId: string;
  workbenchSignals: WorkbenchSignalCounts;
  roleLevel: PersonalRoleLevel;
};

type PersonalTrendInput = OrgScope & {
  userId: string;
  windowStart: string;
  windowEnd: string;
  granularity: "day" | "week";
  roleLevel: PersonalRoleLevel;
};

type WorkbenchSignalCounts = {
  reviewQueue: number;
  myDrafts: number;
  returnedChanges: number;
  waitingMerge: number;
  unappliedImportBatches: number;
  inactiveAccounts: number;
};

type ReviewableScope = OrgScope & {
  userId: string;
  reviewableProjectIds: readonly string[];
};

function scopeArgs(input: OrgScope) {
  return [input.organizationId, input.projectId, input.authorizedProjectIds ?? null];
}

function scopeSql(
  alias: string,
  positions: { organization: string; project: string; authorized: string } = {
    organization: "$1",
    project: "$2",
    authorized: "$3"
  }
) {
  return `
    and ${alias}.organization_id = ${positions.organization}
    and (${positions.project}::text is null or ${alias}.project_id = ${positions.project})
    and (${positions.authorized}::text[] is null or ${alias}.project_id = any(${positions.authorized}::text[]))`;
}

function trendBucketsSql(granularity: "day" | "week") {
  const trunc = granularity === "week" ? "week" : "day";
  const step = granularity === "week" ? "1 week" : "1 day";
  return `
    select generate_series(
      date_trunc('${trunc}', $1::timestamptz at time zone 'UTC'),
      date_trunc('${trunc}', ($2::timestamptz - interval '1 microsecond') at time zone 'UTC'),
      interval '${step}'
    ) as bucket_start`;
}

function mapTrendRows(rows: Array<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>) {
  return rows.map((row) => ({
    bucketStart: new Date(row.bucket_start).toISOString(),
    changeCount: Number(row.change_count),
    workflowEventCount: Number(row.workflow_event_count)
  }));
}

export async function countKpis(db: Database, input: OrgScope & { windowStart: string; windowEnd?: string }) {
  const [bindings, projects] = await Promise.all([
    readBindingDashboardKpis(db, { ...input, windowEnd: input.windowEnd ?? new Date().toISOString() }),
    db.query<{ managed_projects: string }>(
      `select count(distinct project.id) as managed_projects
         from public.projects project
        where project.organization_id = $1
          and ($2::text is null or project.id = $2)
          and ($3::text[] is null or project.id = any($3::text[]))`,
      scopeArgs(input)
    )
  ]);
  return {
    // A dashboard parameter is an active canonical Binding. The distinct
    // Definition count is exposed separately for consumers that need it.
    totalParameters: bindings.totalBindings,
    totalBindings: bindings.totalBindings,
    totalDefinitions: bindings.totalDefinitions,
    managedProjects: Number(projects.rows[0]?.managed_projects ?? 0),
    changeFrequency: bindings.changeFrequency,
    activeContributors: bindings.activeContributors,
    highRiskParameters: null,
    riskAvailability: "unavailable" as const
  };
}

export async function aggregateTrend(
  db: Database,
  input: OrgScope & { windowStart: string; windowEnd: string; granularity: "day" | "week" }
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  return readBindingDashboardTrend(db, input);
}

export async function countPersonalKpis(db: Database, input: PersonalKpiInput) {
  if (input.roleLevel === "guest") {
    return {
      contributionCount: 0,
      workflowCount: 0,
      openItemCount: 0,
      pendingTodoCount: 0,
      highRiskTouchCount: null,
      riskAvailability: "unavailable" as const
    };
  }
  if (input.roleLevel === "committer") return countCommitterPersonalKpis(db, input);
  if (input.roleLevel === "admin") return countAdminPersonalKpis(db, input);
  return countUserPersonalKpis(db, input);
}

async function countUserPersonalKpis(db: Database, input: PersonalKpiInput) {
  const activity = await readUserBindingActivity(db, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    authorizedProjectIds: input.authorizedProjectIds,
    userId: input.userId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd ?? new Date().toISOString()
  });
  return {
    contributionCount: activity.contributionCount,
    workflowCount: activity.workflowCount,
    highRiskTouchCount: null,
    riskAvailability: "unavailable" as const,
    openItemCount: input.workbenchSignals.myDrafts,
    // Rejected requests keep their canonical draft available. The count is a
    // returned-work indicator, not an additional draft todo.
    pendingTodoCount: input.workbenchSignals.returnedChanges
  };
}

async function countCommitterPersonalKpis(db: Database, input: PersonalKpiInput) {
  const rows = await db.query<{ reviews_completed: string; requests_processed: string }>(
    `
    select
      (select count(distinct request.id)
         from public.project_parameter_value_change_requests request
        where request.organization_id = $1
          and request.reviewer_user_id = $4
          and request.status in ('approved', 'rejected')
         and request.updated_at >= $5
         and request.updated_at < $6
          and ($2::text is null or request.project_id = $2)
          and ($3::text[] is null or request.project_id = any($3::text[]))) as reviews_completed,
      (select count(distinct request.id)
         from public.project_parameter_value_change_requests request
        where request.organization_id = $1
          and request.reviewer_user_id = $4
          and request.status in ('approved', 'rejected')
         and request.updated_at >= $5
         and request.updated_at < $6
          and ($2::text is null or request.project_id = $2)
          and ($3::text[] is null or request.project_id = any($3::text[]))) as requests_processed
    `,
    [input.organizationId, input.projectId, input.authorizedProjectIds ?? null, input.userId, input.windowStart, input.windowEnd ?? new Date().toISOString()]
  );
  const row = rows.rows[0];
  return {
    contributionCount: Number(row?.reviews_completed ?? 0),
    workflowCount: Number(row?.requests_processed ?? 0),
    highRiskTouchCount: null,
    riskAvailability: "unavailable" as const,
    openItemCount: input.workbenchSignals.reviewQueue,
    pendingTodoCount: 0
  };
}

async function countAdminPersonalKpis(db: Database, input: PersonalKpiInput) {
  const rows = await db.query<{ governance_actions: string; imports_created: string; high_risk_governance: string }>(
    `
    select
      (select count(*) from public.audit_events audit
        where audit.organization_id = $1
          and audit.actor_user_id = $4
          and audit.created_at >= $5
          and audit.created_at < $6
          and (audit.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
            or audit.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)}))
          and ($2::text is null or audit.project_id = $2)
          and ($3::text[] is null or audit.project_id = any($3::text[]))) as governance_actions,
      (select count(*) from public.parameter_import_batches batch
        where batch.organization_id = $1
          and batch.created_by_user_id = $4
          and batch.created_at >= $5
          and batch.created_at < $6
          and ($2::text is null or batch.project_id = $2)
          and ($3::text[] is null or batch.project_id = any($3::text[]))) as imports_created,
      (select count(*) from public.audit_events audit
        where audit.organization_id = $1
          and audit.actor_user_id = $4
          and audit.created_at >= $5
          and audit.created_at < $6
          and audit.severity = 'High'
          and (audit.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
            or audit.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)}))
          and ($2::text is null or audit.project_id = $2)
          and ($3::text[] is null or audit.project_id = any($3::text[]))) as high_risk_governance
    `,
    [input.organizationId, input.projectId, input.authorizedProjectIds ?? null, input.userId, input.windowStart, input.windowEnd ?? new Date().toISOString()]
  );
  const row = rows.rows[0];
  return {
    contributionCount: Number(row?.governance_actions ?? 0),
    workflowCount: Number(row?.imports_created ?? 0),
    highRiskTouchCount: Number(row?.high_risk_governance ?? 0),
    openItemCount: input.workbenchSignals.unappliedImportBatches,
    pendingTodoCount: input.workbenchSignals.inactiveAccounts,
    riskAvailability: "available" as const
  };
}

export async function aggregatePersonalTrend(
  db: Database,
  input: PersonalTrendInput
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  if (input.roleLevel === "guest") return [];
  if (input.roleLevel === "committer") return aggregateCommitterPersonalTrend(db, input);
  if (input.roleLevel === "admin") return aggregateAdminPersonalTrend(db, input);
  return aggregateUserPersonalTrend(db, input);
}

async function aggregateUserPersonalTrend(db: Database, input: PersonalTrendInput) {
  return readUserBindingTrend(db, input);
}

async function aggregateCommitterPersonalTrend(db: Database, input: PersonalTrendInput) {
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `
    with buckets as (${trendBucketsSql(input.granularity)}),
    reviews as (
      select date_trunc('${trunc}', request.updated_at at time zone 'UTC') as bucket_start, count(distinct request.id) as c
        from public.project_parameter_value_change_requests request
       where request.reviewer_user_id = $4 and request.status in ('approved', 'rejected')
         and request.updated_at >= $1 and request.updated_at < $2
         ${scopeSql("request", { organization: "$3", project: "$5", authorized: "$6" })}
       group by 1
    )
    select buckets.bucket_start at time zone 'UTC' as bucket_start,
           coalesce(reviews.c, 0) as change_count,
           coalesce(reviews.c, 0) as workflow_event_count
      from buckets
      left join reviews on reviews.bucket_start = buckets.bucket_start
     order by buckets.bucket_start asc
    `,
    [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return mapTrendRows(rows.rows);
}

async function aggregateAdminPersonalTrend(db: Database, input: PersonalTrendInput) {
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `
    with buckets as (${trendBucketsSql(input.granularity)}),
    governance as (
      select date_trunc('${trunc}', audit.created_at at time zone 'UTC') as bucket_start, count(*) as c
        from public.audit_events audit
       where audit.organization_id = $3 and audit.actor_user_id = $4
         and audit.created_at >= $1 and audit.created_at < $2
         and (audit.app in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_APPS)})
           or audit.kind in (${sqlInList(ADMIN_GOVERNANCE_AUDIT_KINDS)}))
         and ($5::text is null or audit.project_id = $5)
         and ($6::text[] is null or audit.project_id = any($6::text[]))
       group by 1
    ),
    imports as (
      select date_trunc('${trunc}', batch.created_at at time zone 'UTC') as bucket_start, count(*) as c
        from public.parameter_import_batches batch
       where batch.organization_id = $3 and batch.created_by_user_id = $4
         and batch.created_at >= $1 and batch.created_at < $2
         and ($5::text is null or batch.project_id = $5)
         and ($6::text[] is null or batch.project_id = any($6::text[]))
       group by 1
    )
    select buckets.bucket_start at time zone 'UTC' as bucket_start,
           coalesce(governance.c, 0) as change_count,
           coalesce(imports.c, 0) as workflow_event_count
      from buckets
      left join governance on governance.bucket_start = buckets.bucket_start
      left join imports on imports.bucket_start = buckets.bucket_start
     order by buckets.bucket_start asc
    `,
    [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return mapTrendRows(rows.rows);
}

export async function aggregateRiskDistribution(
  db: Database,
  input: OrgScope
): Promise<Array<{
  projectId: string;
  projectCode: string;
  projectName: string;
  high: number | null;
  medium: number | null;
  low: number | null;
  total: number | null;
  riskAvailability: "unavailable";
}>> {
  const projects = await listProjectsWithSourceBackedBindings(db, input);
  return projects.map((project) => ({
    ...project,
    high: null,
    medium: null,
    low: null,
    total: null,
    riskAvailability: "unavailable" as const
  }));
}

export async function aggregateWorkbenchSignals(
  db: Database,
  input: ReviewableScope
): Promise<WorkbenchSignalCounts> {
  const rows = await db.query<{
    review_queue: string;
    my_drafts: string;
    returned_changes: string;
    unapplied_import_batches: string;
    inactive_accounts: string;
  }>(
    `
    select
      (select count(distinct request.id)
         from public.project_parameter_value_change_requests request
        where request.status = 'pending'
          and request.submitter_user_id is distinct from $4
          and request.project_id = any($5::text[])
          and request.organization_id = $1
          and ($2::text is null or request.project_id = $2)
          and ($3::text[] is null or request.project_id = any($3::text[]))) as review_queue,
      (select count(distinct draft.id)
         from public.project_parameter_value_drafts draft
        where draft.organization_id = $1
          and draft.user_id = $4
          and ($2::text is null or draft.project_id = $2)
          and ($3::text[] is null or draft.project_id = any($3::text[]))
          and coalesce((
            select latest.status
              from public.project_parameter_value_change_requests latest
             where latest.organization_id = draft.organization_id
               and latest.project_id = draft.project_id
               and latest.draft_id = draft.id
               and latest.submitter_user_id = draft.user_id
             order by latest.updated_at desc, latest.created_at desc, latest.id desc
             limit 1
          ), 'withdrawn') = 'withdrawn'
      ) as my_drafts,
      (select count(distinct draft.id)
         from public.project_parameter_value_drafts draft
         join lateral (
           select latest.status
             from public.project_parameter_value_change_requests latest
            where latest.organization_id = draft.organization_id
              and latest.project_id = draft.project_id
              and latest.draft_id = draft.id
              and latest.submitter_user_id = draft.user_id
            order by latest.updated_at desc, latest.created_at desc, latest.id desc
            limit 1
         ) latest on true
        where draft.organization_id = $1
          and draft.user_id = $4
          and ($2::text is null or draft.project_id = $2)
          and ($3::text[] is null or draft.project_id = any($3::text[]))
          and latest.status = 'rejected'
      ) as returned_changes,
      (select count(*)
         from public.parameter_import_batches batch
        where batch.organization_id = $1
          and batch.applied_at is null
          and ($2::text is null or batch.project_id = $2)
          and ($3::text[] is null or batch.project_id = any($3::text[]))) as unapplied_import_batches,
      (select count(*) from public.users user_account
        where user_account.organization_id = $1 and user_account.is_active = false) as inactive_accounts
    `,
    [input.organizationId, input.projectId, input.authorizedProjectIds ?? null, input.userId, input.reviewableProjectIds]
  );
  const row = rows.rows[0];
  return {
    reviewQueue: Number(row?.review_queue ?? 0),
    myDrafts: Number(row?.my_drafts ?? 0),
    returnedChanges: Number(row?.returned_changes ?? 0),
    // Canonical requests have no software_merge phase.
    waitingMerge: 0,
    unappliedImportBatches: Number(row?.unapplied_import_batches ?? 0),
    inactiveAccounts: Number(row?.inactive_accounts ?? 0)
  };
}
