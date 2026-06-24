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
  description: string;
  explanation: string;
  module: string;
  default_range: string;
  unit: string;
  project_id: string;
  current_value: string | null;
  recommended_value: string | null;
  risk: string | null;
};

type NodeSnapshotRow = {
  id: string;
  name: string;
  project_id: string | null;
  current_value: string | null;
  target_value: string | null;
  node_path: string | null;
  protocol: string | null;
};

type LogConclusionRow = {
  id: string;
  project_id: string | null;
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
       (select count(*)::int from project_parameter_values ppv where ppv.project_id = $2 and ppv.organization_id = $1) as parameter_count,
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
select pd.id,
       pd.name,
       pd.description,
       pd.explanation,
       pd.module,
       pd.default_range,
       pd.unit,
       ppv.project_id,
       ppv.current_value,
       ppv.recommended_value,
       pd.risk
from parameter_definitions pd
join project_parameter_values ppv
  on ppv.parameter_definition_id = pd.id
 and ppv.organization_id = pd.organization_id
where pd.organization_id = $1
  and ($2::text is null or ppv.project_id = $2)
  and ($3::text = '%' or pd.name ilike $3 or pd.description ilike $3 or pd.explanation ilike $3)
order by pd.name asc
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
              recommended_value: row.recommended_value,
              risk: row.risk
            }))
          },
          citations: rows.map((row) => ({
            type: "parameter" as const,
            id: row.id,
            label: row.name,
            href: `/parameters?parameterId=${encodeURIComponent(row.id)}`,
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
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const { rows } = await options.db.query<NodeSnapshotRow>(
          `
select p.id,
       p.name,
       p.project_id,
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
  and ($2::text is null or p.project_id is null or p.project_id = $2)
  and p.enabled = true
  and p.archived_at is null
order by p.sort_order asc, p.name asc
limit 20
          `,
          [context.auth.organization.id, projectId ?? null]
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
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const { rows } = await options.db.query<LogConclusionRow>(
          `
select lr.id,
       lr.project_id,
       lr.status,
       coalesce(report.severity, 'unknown') as severity,
       coalesce(report.conclusion, lr.failure_reason) as conclusion
from log_records lr
left join log_analysis_reports report on report.run_id = lr.current_run_id
where lr.organization_id = $1
  and ($2::text is null or lr.project_id = $2)
order by lr.captured_at desc
limit 10
          `,
          [context.auth.organization.id, projectId ?? null]
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
