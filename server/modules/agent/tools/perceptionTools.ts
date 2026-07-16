import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: { query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> };
};

type OverviewRow = {
  project_id: string;
  parameter_count: number;
  open_change_requests: number;
};

type ParameterSearchRow = {
  id: string;
  name: string;
  description: string | null;
  explanation: string | null;
  module: string | null;
  default_range: string | null;
  unit: string | null;
  project_id: string;
  current_value: string | null;
  policy_target: string | null;
  schema_default: string | null;
  risk: string | null;
};

type NodeSnapshotRow = {
  id: string;
  name: string;
  current_value: string | null;
  target_value: string | null;
  node_path: string | null;
  protocol: string | null;
};

type LogConclusionRow = {
  id: string;
  status: string;
  severity: string;
  conclusion: string | null;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

export function createPerceptionTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "perception.getProjectOverview",
      label: "Get project overview",
      kind: "read",
      permission: "parameter:view",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const { rows } = await options.db.query<OverviewRow>(
          `
select $2::text as project_id,
       (select count(*)::int from project_parameter_bindings b where b.project_id = $2 and b.organization_id = $1) as parameter_count,
       (select count(*)::int from parameter_change_requests pcr
        where pcr.project_id = $2
          and pcr.organization_id = $1
          and pcr.status not in ('merged', 'rejected', 'withdrawn')) as open_change_requests
          `,
          [context.auth.organization.id, projectId]
        );
        const row = rows[0];
        return {
          summary: `Project ${projectId}: ${row?.parameter_count ?? 0} parameters, ${row?.open_change_requests ?? 0} open change requests.`,
          data: { ...(row ?? { project_id: projectId, parameter_count: 0, open_change_requests: 0 }) },
          citations: [{ type: "parameter", id: String(projectId), label: `Project ${projectId} overview` }]
        };
      }
    },
    {
      name: "perception.searchParameters",
      label: "Search parameters",
      kind: "read",
      permission: "parameter:view",
      requiresApproval: false,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const query = typeof payload.query === "string" ? payload.query.trim() : "";
        const pattern = query ? `%${query}%` : "%";
        const { rows } = await options.db.query<ParameterSearchRow>(
          `
select b.id,
       coalesce(psv.display_name, dps.property_key, ps.specification_key) as name,
       psv.description,
       dps.documentation as explanation,
       nullif(split_part(ps.specification_key, '/', 1), '') as module,
       null::text as default_range,
       dps.units as unit,
       b.project_id,
       coalesce(bpr.raw_value, bpr.canonical_value #>> '{}') as current_value,
       ppt.target_value #>> '{}' as policy_target,
       psv.schema_default #>> '{}' as schema_default,
       null::text as risk
from project_parameter_bindings b
inner join parameter_specs ps
  on ps.id = b.parameter_spec_id
left join dts_property_specs dps
  on dps.parameter_spec_id = ps.id
left join parameter_spec_versions psv
  on psv.parameter_spec_id = ps.id
 and psv.id = (
   select psv2.id from parameter_spec_versions psv2
   where psv2.parameter_spec_id = ps.id
   order by psv2.version desc
   limit 1
 )
left join lateral (
  select raw_value, canonical_value
  from project_parameter_binding_revisions
  where binding_id = b.id
  order by created_at desc
  limit 1
) bpr on true
left join parameter_policy_targets ppt
  on ppt.parameter_spec_id = ps.id
 and ppt.organization_id = b.organization_id
where b.organization_id = $1
  and ($2::text is null or b.project_id = $2)
  and (
    $3::text = '%'
    or coalesce(psv.display_name, '') ilike $3
    or coalesce(dps.property_key, '') ilike $3
    or coalesce(psv.description, '') ilike $3
    or coalesce(dps.documentation, '') ilike $3
  )
order by coalesce(psv.display_name, dps.property_key, ps.specification_key) asc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null, pattern]
        );
        return {
          summary:
            rows.length > 0
              ? `Found ${rows.length} parameters${query ? ` matching "${query}"` : ""}.`
              : `No parameters found${query ? ` matching "${query}"` : ""}.`,
          data: {
            parameters: rows.map((row) => ({
              id: row.id,
              name: row.name,
              description: row.description,
              explanation: row.explanation,
              module: row.module,
              range: row.default_range,
              unit: row.unit,
              project_id: row.project_id,
              current_value: row.current_value,
              policy_target: row.policy_target,
              schema_default: row.schema_default,
              risk: row.risk
            }))
          },
          citations: rows.map((row) => ({
            type: "parameter" as const,
            id: row.id,
            label: row.name,
            href: `/parameters?bindingId=${encodeURIComponent(row.id)}`,
            snippet: row.description || row.explanation || row.current_value || undefined
          }))
        };
      }
    },
    {
      name: "perception.getNodeSnapshot",
      label: "Get node snapshot",
      kind: "read",
      permission: "debugging:view",
      requiresApproval: false,
      run: async (context, _payload) => {
        const { rows } = await options.db.query<NodeSnapshotRow>(
          `
select p.id,
       p.name,
       p.current_value,
       p.target_value,
       b.node_path,
       b.protocol
from debugging_parameters p
left join debugging_parameter_node_bindings b
  on b.parameter_id = p.id
 and b.organization_id = p.organization_id
 and b.enabled = true
where p.organization_id = $1
  and p.enabled = true
  and p.archived_at is null
order by p.sort_order asc, p.name asc
limit 20
          `,
          [context.auth.organization.id]
        );
        return {
          summary: `Node snapshot: ${rows.length} debugging parameters with bindings.`,
          data: { nodes: rows },
          citations: rows.map((row) => ({
            type: "debugging" as const,
            id: row.id,
            label: row.name,
            href: `/debugging?parameterId=${encodeURIComponent(row.id)}`,
            snippet: row.node_path ? `${row.protocol ?? "unknown"}://${row.node_path}` : undefined
          }))
        };
      }
    },
    {
      name: "perception.getRecentLogConclusions",
      label: "Get recent log conclusions",
      kind: "read",
      permission: "logs:view",
      requiresApproval: false,
      run: async (context, _payload) => {
        const { rows } = await options.db.query<LogConclusionRow>(
          `
select lr.id,
       lr.status,
       coalesce(report.severity, 'unknown') as severity,
       coalesce(report.conclusion, lr.failure_reason) as conclusion
from log_records lr
left join log_analysis_reports report on report.run_id = lr.current_run_id
where lr.organization_id = $1
order by lr.captured_at desc
limit 10
          `,
          [context.auth.organization.id]
        );
        const primary = rows[0];
        return {
          summary: primary?.conclusion
            ? `Most recent log conclusion: ${primary.conclusion}`
            : `Found ${rows.length} recent log records.`,
          data: { logs: rows },
          citations: rows.map((row) => ({
            type: "log" as const,
            id: row.id,
            label: `${row.severity} ${row.status} log`,
            href: `/logs?logId=${encodeURIComponent(row.id)}`,
            snippet: row.conclusion ?? undefined
          }))
        };
      }
    }
  ];
}
