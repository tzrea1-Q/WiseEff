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
  authorizedProjectIds?: readonly string[] | null;
  dimension: HotspotDimension;
  windowStart: string;
  windowEnd: string;
};

type BehavioralRawRow = {
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

function mapBehavioralRow(row: BehavioralRawRow, kind: HotspotGroupAggregate["kind"]): HotspotGroupAggregate {
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

/**
 * The dashboard follows the same source-backed current Binding identity as the
 * parameter list. A current value without its exact owned source pin is not a
 * displayable parameter, and canonical bootstrap values are not source-backed
 * list rows.
 */
const ACTIVE_BINDINGS = `
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
    join public.projects p
      on p.id = b.project_id
     and p.organization_id = b.organization_id
    left join parameter_catalog.organization_subject_registrations registration
      on registration.id = b.registration_id
    left join parameter_catalog.subject_placements placement
      on placement.id = registration.current_placement_id
    left join public.parameter_modules module
      on module.id = placement.module_id
    join parameter_catalog.parameter_definitions definition
      on definition.id = b.definition_id
    join parameter_catalog.definition_revisions revision
      on revision.id = b.effective_revision_id
     and revision.definition_id = b.definition_id
`;

const JOIN_BEHAVIOR = `
    left join parameter_catalog.binding_history_events history
      on history.binding_id = b.id
     and history.created_at >= $2
     and history.created_at < $3
    left join public.audit_events history_audit
      on history_audit.id = history.success_audit_ref
     and history_audit.organization_id = b.organization_id
     and history_audit.project_id = b.project_id
    left join parameter_catalog.binding_history_events all_history
      on all_history.binding_id = b.id
    left join public.audit_events all_time_audit
      on all_time_audit.id = all_history.success_audit_ref
     and all_time_audit.organization_id = b.organization_id
     and all_time_audit.project_id = b.project_id
    left join public.project_parameter_value_change_requests request
      on request.organization_id = b.organization_id
     and request.project_id = b.project_id
     and request.binding_id = b.id`;

function groupSql(dimension: HotspotDimension) {
  switch (dimension) {
    case "project":
      return {
        kind: "project" as const,
        select: `
      p.id as group_id,
      p.code as title,
      p.id as project_id,
      p.code as project_code,
      '项目参数' as module,
      count(distinct b.id) as parameter_count,
      count(distinct b.definition_id) as definition_count`,
        groupBy: "p.id, p.code",
        orderBy: "p.code asc"
      };
    case "module":
      return {
        kind: "module" as const,
        select: `
      coalesce(module.id, 'unassigned') as group_id,
      coalesce(module.name, '未分组') as title,
      case when $4::text is null then null else max(b.project_id) end as project_id,
      count(distinct b.project_id)::text || ' 个项目' as project_code,
      coalesce(module.name, '未分组') as module,
      count(distinct b.id) as parameter_count,
      count(distinct b.definition_id) as definition_count`,
        groupBy: "module.id, module.name",
        orderBy: "coalesce(module.name, '未分组') asc"
      };
    case "parameter":
      return {
        kind: "parameter" as const,
        select: `
      b.id as group_id,
      coalesce(nullif(revision.content->>'displayName', ''), definition.property_key) as title,
      b.project_id as project_id,
      p.code as project_code,
      coalesce(module.name, '未分组') as module,
      1 as parameter_count,
      1 as definition_count`,
        groupBy: "b.id, revision.content->>'displayName', definition.property_key, b.project_id, p.code, module.name",
        orderBy: "title asc"
      };
  }
}

async function aggregateCanonicalGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  const grouping = groupSql(input.dimension);
  const sql = `
    select${grouping.select},
      count(distinct request.id) filter (
        where request.created_at >= $2 and request.created_at < $3
      ) as related_request_count,
      count(distinct history.id) as history_events_in_window,
      count(distinct b.id) filter (
        where exists (
          select 1
            from parameter_catalog.binding_history_events modified_history
           where modified_history.binding_id = b.id
        )
      ) as modified_param_count,
      count(distinct request.id) filter (where request.status = 'pending') as open_request_count,
      count(distinct request.id) filter (
        where request.status = 'rejected'
          and request.updated_at >= $2
          and request.updated_at < $3
      ) as returned_in_window,
      count(distinct history_audit.actor_user_id) filter (where history_audit.actor_user_id is not null) as contributors_in_window,
      count(distinct all_time_audit.actor_user_id) filter (where all_time_audit.actor_user_id is not null) as contributors_all_time,
      max(history.created_at) as last_changed_at
    ${ACTIVE_BINDINGS}
    ${JOIN_BEHAVIOR}
    where b.organization_id = $1
      and ($4::text is null or b.project_id = $4)
      and ($5::text[] is null or b.project_id = any($5::text[]))
    group by ${grouping.groupBy}
    order by ${grouping.orderBy}
    `;
  const rows = await db.query<BehavioralRawRow>(
    sql,
    [input.organizationId, input.windowStart, input.windowEnd, input.projectId, input.authorizedProjectIds ?? null]
  );
  return rows.rows.map((row) => mapBehavioralRow(row, grouping.kind));
}

export async function aggregateHotspotGroups(db: Database, input: AggregateInput): Promise<HotspotGroupAggregate[]> {
  return aggregateCanonicalGroups(db, input);
}
