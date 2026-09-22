import type { Database } from "../../../shared/database/client";
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
      date_trunc('${trunc}', $1::timestamptz),
      date_trunc('${trunc}', $2::timestamptz - interval '1 microsecond'),
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
  const rows = await db.query<{
    total_bindings: string;
    total_definitions: string;
    managed_projects: string;
    change_frequency: string;
    active_contributors: string;
  }>(
    `
    select
      (select count(distinct binding.id)
         from parameter_catalog.current_project_parameter_bindings binding
         join parameter_catalog.project_parameter_values current_value
           on current_value.id = binding.current_value_id
          and current_value.binding_id = binding.id
          and current_value.definition_id = binding.definition_id
          and current_value.value_state = 'present'
         and current_value.source_ref <> 'canonical-binding-identity'
        join parameter_catalog.project_value_source_pins source_pin
          on source_pin.project_value_id = current_value.id
         and source_pin.binding_id = binding.id
         and source_pin.definition_id = binding.definition_id
         and source_pin.organization_id = binding.organization_id
         and source_pin.project_id = binding.project_id
         and source_pin.source_occurrence_id = binding.source_occurrence_id
         and source_pin.config_revision_id = current_value.config_revision_id
        where true ${scopeSql("binding")}) as total_bindings,
      (select count(distinct binding.definition_id)
         from parameter_catalog.current_project_parameter_bindings binding
         join parameter_catalog.project_parameter_values current_value
           on current_value.id = binding.current_value_id
          and current_value.binding_id = binding.id
          and current_value.definition_id = binding.definition_id
          and current_value.value_state = 'present'
         and current_value.source_ref <> 'canonical-binding-identity'
        join parameter_catalog.project_value_source_pins source_pin
          on source_pin.project_value_id = current_value.id
         and source_pin.binding_id = binding.id
         and source_pin.definition_id = binding.definition_id
         and source_pin.organization_id = binding.organization_id
         and source_pin.project_id = binding.project_id
         and source_pin.source_occurrence_id = binding.source_occurrence_id
         and source_pin.config_revision_id = current_value.config_revision_id
        where true ${scopeSql("binding")}) as total_definitions,
      (select count(distinct project.id)
         from public.projects project
        where project.organization_id = $1
          and ($2::text is null or project.id = $2)
          and ($3::text[] is null or project.id = any($3::text[]))) as managed_projects,
      (select count(distinct history.id)
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
         join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = binding.organization_id
          and audit.project_id = binding.project_id
        where history.created_at >= $4 and history.created_at < $5
          ${scopeSql("binding")}) as change_frequency,
      (select count(distinct audit.actor_user_id)
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
         join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = binding.organization_id
          and audit.project_id = binding.project_id
        where history.created_at >= $4 and history.created_at < $5
          and audit.actor_user_id is not null
          ${scopeSql("binding")}) as active_contributors
    `,
    [...scopeArgs(input), input.windowStart, input.windowEnd ?? new Date().toISOString()]
  );
  const row = rows.rows[0];
  return {
    // A dashboard parameter is an active canonical Binding. The distinct
    // Definition count is exposed separately for consumers that need it.
    totalParameters: Number(row?.total_bindings ?? 0),
    totalBindings: Number(row?.total_bindings ?? 0),
    totalDefinitions: Number(row?.total_definitions ?? 0),
    managedProjects: Number(row?.managed_projects ?? 0),
    changeFrequency: Number(row?.change_frequency ?? 0),
    activeContributors: Number(row?.active_contributors ?? 0),
    highRiskParameters: null,
    riskAvailability: "unavailable" as const
  };
}

export async function aggregateTrend(
  db: Database,
  input: OrgScope & { windowStart: string; windowEnd: string; granularity: "day" | "week" }
): Promise<Array<{ bucketStart: string; changeCount: number; workflowEventCount: number }>> {
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `
    with buckets as (${trendBucketsSql(input.granularity)}),
    changes as (
      select date_trunc('${input.granularity === "week" ? "week" : "day"}', history.created_at) as bucket_start,
             count(distinct history.id) as c
        from parameter_catalog.binding_history_events history
        join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
        join public.audit_events audit
          on audit.id = history.success_audit_ref
         and audit.organization_id = binding.organization_id
         and audit.project_id = binding.project_id
       where history.created_at >= $1 and history.created_at < $2
         ${scopeSql("binding", { organization: "$3", project: "$4", authorized: "$5" })}
       group by 1
    ),
    workflow as (
      select date_trunc('${input.granularity === "week" ? "week" : "day"}', request.created_at) as bucket_start,
             count(distinct request.id) as c
        from public.project_parameter_value_change_requests request
       where request.created_at >= $1 and request.created_at < $2
         ${scopeSql("request", { organization: "$3", project: "$4", authorized: "$5" })}
       group by 1
    )
    select buckets.bucket_start,
           coalesce(changes.c, 0) as change_count,
           coalesce(workflow.c, 0) as workflow_event_count
      from buckets
      left join changes on changes.bucket_start = buckets.bucket_start
      left join workflow on workflow.bucket_start = buckets.bucket_start
     order by buckets.bucket_start asc
    `,
    [input.windowStart, input.windowEnd, input.organizationId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return mapTrendRows(rows.rows);
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
  const rows = await db.query<{ contribution_count: string; workflow_count: string }>(
    `
    select
      (select count(distinct history.id)
         from parameter_catalog.binding_history_events history
         join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
         join public.audit_events audit
           on audit.id = history.success_audit_ref
          and audit.organization_id = binding.organization_id
          and audit.project_id = binding.project_id
        where audit.actor_user_id = $4
          and history.created_at >= $5
          and history.created_at < $6
          ${scopeSql("binding")}) as contribution_count,
      (select count(distinct request.id)
         from public.project_parameter_value_change_requests request
        where request.submitter_user_id = $4
          and request.created_at >= $5
          and request.created_at < $6
          ${scopeSql("request")}) as workflow_count
    `,
    [input.organizationId, input.projectId, input.authorizedProjectIds ?? null, input.userId, input.windowStart, input.windowEnd ?? new Date().toISOString()]
  );
  const row = rows.rows[0];
  return {
    contributionCount: Number(row?.contribution_count ?? 0),
    workflowCount: Number(row?.workflow_count ?? 0),
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
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `
    with buckets as (${trendBucketsSql(input.granularity)}),
    changes as (
      select date_trunc('${trunc}', history.created_at) as bucket_start, count(distinct history.id) as c
        from parameter_catalog.binding_history_events history
        join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
        join public.audit_events audit
          on audit.id = history.success_audit_ref
         and audit.organization_id = binding.organization_id
         and audit.project_id = binding.project_id
       where audit.actor_user_id = $4 and history.created_at >= $1 and history.created_at < $2
          ${scopeSql("binding", { organization: "$3", project: "$5", authorized: "$6" })}
       group by 1
    ),
    workflow as (
      select date_trunc('${trunc}', request.created_at) as bucket_start, count(distinct request.id) as c
        from public.project_parameter_value_change_requests request
       where request.submitter_user_id = $4 and request.created_at >= $1 and request.created_at < $2
         ${scopeSql("request", { organization: "$3", project: "$5", authorized: "$6" })}
       group by 1
    )
    select buckets.bucket_start,
           coalesce(changes.c, 0) as change_count,
           coalesce(workflow.c, 0) as workflow_event_count
      from buckets
      left join changes on changes.bucket_start = buckets.bucket_start
      left join workflow on workflow.bucket_start = buckets.bucket_start
     order by buckets.bucket_start asc
    `,
    [input.windowStart, input.windowEnd, input.organizationId, input.userId, input.projectId, input.authorizedProjectIds ?? null]
  );
  return mapTrendRows(rows.rows);
}

async function aggregateCommitterPersonalTrend(db: Database, input: PersonalTrendInput) {
  const trunc = input.granularity === "week" ? "week" : "day";
  const rows = await db.query<{ bucket_start: Date | string; change_count: string; workflow_event_count: string }>(
    `
    with buckets as (${trendBucketsSql(input.granularity)}),
    reviews as (
      select date_trunc('${trunc}', request.updated_at) as bucket_start, count(distinct request.id) as c
        from public.project_parameter_value_change_requests request
       where request.reviewer_user_id = $4 and request.status in ('approved', 'rejected')
         and request.updated_at >= $1 and request.updated_at < $2
         ${scopeSql("request", { organization: "$3", project: "$5", authorized: "$6" })}
       group by 1
    )
    select buckets.bucket_start,
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
      select date_trunc('${trunc}', audit.created_at) as bucket_start, count(*) as c
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
      select date_trunc('${trunc}', batch.created_at) as bucket_start, count(*) as c
        from public.parameter_import_batches batch
       where batch.organization_id = $3 and batch.created_by_user_id = $4
         and batch.created_at >= $1 and batch.created_at < $2
         and ($5::text is null or batch.project_id = $5)
         and ($6::text[] is null or batch.project_id = any($6::text[]))
       group by 1
    )
    select buckets.bucket_start,
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
  const rows = await db.query<{ project_id: string; project_code: string; project_name: string; total: string }>(
    `
    select project.id as project_id,
           project.code as project_code,
           project.name as project_name,
           count(distinct binding.id) as total
      from public.projects project
      join parameter_catalog.current_project_parameter_bindings binding
        on binding.project_id = project.id
       and binding.organization_id = project.organization_id
      join parameter_catalog.project_parameter_values current_value
        on current_value.id = binding.current_value_id
       and current_value.binding_id = binding.id
       and current_value.definition_id = binding.definition_id
       and current_value.value_state = 'present'
       and current_value.source_ref <> 'canonical-binding-identity'
      join parameter_catalog.project_value_source_pins source_pin
        on source_pin.project_value_id = current_value.id
       and source_pin.binding_id = binding.id
       and source_pin.definition_id = binding.definition_id
       and source_pin.organization_id = binding.organization_id
       and source_pin.project_id = binding.project_id
       and source_pin.source_occurrence_id = binding.source_occurrence_id
       and source_pin.config_revision_id = current_value.config_revision_id
     where project.organization_id = $1
       and ($2::text is null or project.id = $2)
       and ($3::text[] is null or project.id = any($3::text[]))
     group by project.id, project.code, project.name
     order by project.code asc
    `,
    scopeArgs(input)
  );
  return rows.rows.map((row) => ({
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
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
          and not exists (
            select 1 from public.project_parameter_value_change_requests pending_or_approved
             where pending_or_approved.organization_id = draft.organization_id
               and pending_or_approved.project_id = draft.project_id
               and pending_or_approved.draft_id = draft.id
               and pending_or_approved.status in ('pending', 'approved')
          )) as my_drafts,
      0::bigint as returned_changes,
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
